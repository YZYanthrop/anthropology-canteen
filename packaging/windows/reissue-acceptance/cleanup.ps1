[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][string]$Manifest,
  [Parameter(Mandatory=$true)][string]$Report,
  [string]$ProductRoot = '',
  [switch]$CaptureOnly
)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$Receipt=Get-Content -LiteralPath $Manifest -Raw -Encoding UTF8 | ConvertFrom-Json
$RootValue=if ($Receipt.PSObject.Properties.Name -contains 'scratch') { $Receipt.scratch } else { $Receipt.root }
$OwnedRoot=[IO.Path]::GetFullPath([string]$RootValue).TrimEnd('\')
$TempPrefix=[IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\')+'\'
$Allowed=$OwnedRoot.StartsWith($TempPrefix,[StringComparison]::OrdinalIgnoreCase)
if ($ProductRoot) {
  $NativePrefix=[IO.Path]::GetFullPath((Join-Path $ProductRoot 'outputs\slice-a\native')).TrimEnd('\')+'\reissue-'
  $Allowed=$Allowed -or $OwnedRoot.StartsWith($NativePrefix,[StringComparison]::OrdinalIgnoreCase)
}
if (-not $Allowed -or $OwnedRoot -eq $TempPrefix.TrimEnd('\')) { throw 'Refusing cleanup outside unique fixture roots' }
$Names=@()
if ($Receipt.PSObject.Properties.Name -contains 'names') { $Names=@($Receipt.names) }
elseif ($Receipt.PSObject.Properties.Name -contains 'name') { $Names=@($Receipt.name) }
foreach ($Name in $Names) { if ($Name -notmatch '^Anthropology Canteen Reminder [a-f0-9-]{12}$') { throw 'Unsafe task receipt' } }
$Sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$Errors=New-Object 'System.Collections.Generic.List[string]'
$Tasks=New-Object 'System.Collections.Generic.List[object]'
$Processes=New-Object 'System.Collections.Generic.List[object]'
$Snapshot=@(Get-CimInstance Win32_Process -ErrorAction Stop | Where-Object { $_.Name -in @('node.exe','chrome.exe','msedge.exe') })
$Captured=@($Snapshot | Where-Object { $_.CommandLine -and ([string]$_.CommandLine).IndexOf($OwnedRoot+'\',[StringComparison]::OrdinalIgnoreCase) -ge 0 })
# Browser child commands omit the profile path. Link them to the owned parent snapshot.
for ($Depth=0; $Depth -lt 10; $Depth++) {
  $Ids=@($Captured | ForEach-Object { [int]$_.ProcessId })
  $Children=@($Snapshot | Where-Object { [int]$_.ParentProcessId -in $Ids -and [int]$_.ProcessId -notin $Ids })
  if (-not $Children.Count) { break }
  $Captured += $Children
}
$Proof=@($Captured | ForEach-Object { @{ pid=[int]$_.ProcessId; created=$_.CreationDate.ToUniversalTime().ToString('o'); name=[string]$_.Name } })
if ($CaptureOnly) {
  @{ root=$OwnedRoot; captured=$Proof } | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $Report -Encoding UTF8
  exit 0
}
$PreviousCapture=Join-Path (Split-Path -Parent $Manifest) 'captured-processes.json'
if (Test-Path -LiteralPath $PreviousCapture) {
  $Earlier=Get-Content -LiteralPath $PreviousCapture -Raw -Encoding UTF8 | ConvertFrom-Json
  if ([IO.Path]::GetFullPath([string]$Earlier.root) -ne $OwnedRoot) { throw 'Process receipt root mismatch' }
  foreach ($Item in @($Earlier.captured)) {
    if ($Item.name -notin @('node.exe','chrome.exe','msedge.exe')) { throw 'Unexpected process receipt executable' }
    $Proof+=@{pid=[int]$Item.pid;created=[string]$Item.created;name=[string]$Item.name}
  }
}
foreach ($Name in $Names) {
  try {
    $Found=@(Get-ScheduledTask -ErrorAction Stop | Where-Object { $_.TaskPath -eq '\' -and $_.TaskName -eq $Name })
    foreach ($Task in $Found) {
      $Account=[string]$Task.Principal.UserId
      $TaskSid=if ($Account -match '^S-1-') { $Account } else { ([Security.Principal.NTAccount]$Account).Translate([Security.Principal.SecurityIdentifier]).Value }
      $TaskRoot=[IO.Path]::GetFullPath([string]$Task.Actions[0].WorkingDirectory)
      if ($TaskSid -ne $Sid -or [string]$Task.Principal.RunLevel -ne 'Limited' -or @($Task.Actions).Count -ne 1 -or -not $TaskRoot.StartsWith($OwnedRoot+'\',[StringComparison]::OrdinalIgnoreCase)) { throw 'Task identity changed; will not remove' }
      if ([string]$Task.State -eq 'Running') { Stop-ScheduledTask -TaskName $Name -TaskPath '\' }
      Unregister-ScheduledTask -TaskName $Name -TaskPath '\' -Confirm:$false
    }
    if (@(Get-ScheduledTask -ErrorAction Stop | Where-Object { $_.TaskPath -eq '\' -and $_.TaskName -eq $Name }).Count) { throw 'Task still exists' }
    $Tasks.Add(@{name=$Name;absent=$true})
  } catch { $Errors.Add($Name+': '+$_.Exception.Message) }
}
foreach ($Item in @($Proof | Sort-Object { $_.pid } -Unique)) {
  try {
    $Current=Get-CimInstance Win32_Process -Filter ('ProcessId='+$Item.pid) -ErrorAction Stop
    if ($Current) {
      if ($Current.CreationDate.ToUniversalTime().ToString('o') -ne $Item.created -or [string]$Current.Name -ne $Item.name) { throw 'PID identity changed; will not stop' }
      Stop-Process -Id $Item.pid -Force -ErrorAction Stop
      for ($Attempt=0; $Attempt -lt 30; $Attempt++) {
        if (-not (Get-Process -Id $Item.pid -ErrorAction SilentlyContinue)) { break }
        Start-Sleep -Milliseconds 100
      }
      if (Get-Process -Id $Item.pid -ErrorAction SilentlyContinue) { throw 'Owned process still exists' }
    }
    $Processes.Add(@{pid=$Item.pid;absent=$true})
  } catch { $Errors.Add('process '+$Item.pid+': '+$_.Exception.Message) }
}
# A later root-associated process is a leak even if it was absent from the earlier snapshot.
$Residue=@(Get-CimInstance Win32_Process -ErrorAction Stop | Where-Object { $_.Name -in @('node.exe','chrome.exe','msedge.exe') -and $_.CommandLine -and ([string]$_.CommandLine).IndexOf($OwnedRoot+'\',[StringComparison]::OrdinalIgnoreCase) -ge 0 })
if ($Residue.Count) { $Errors.Add('Root-associated processes remain after cleanup') }
$Result=@{status=$(if ($Errors.Count) {'fail'} else {'pass'});root=$OwnedRoot;tasks=$Tasks.ToArray();processes=$Processes.ToArray();errors=$Errors.ToArray();syntheticEvidenceRetained=$true}
$Result | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $Report -Encoding UTF8
if ($Errors.Count) { throw 'Windows fixture cleanup incomplete; inspect saved report' }