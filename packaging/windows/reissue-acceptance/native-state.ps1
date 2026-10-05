param(
  [Parameter(Mandatory=$true)][string]$TaskName,
  [Parameter(Mandatory=$true)][string]$OwnedRoot,
  [ValidateSet('Read','TaskDisabled','DailyDisabled','LogonDisabled','Remove','Once','FixtureDisabled')][string]$Mode = 'Read',
  [string]$NodePath,
  [string]$WorkerPath
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
Import-Module ScheduledTasks
$OwnedRoot = [IO.Path]::GetFullPath($OwnedRoot).TrimEnd('\')
$TempPrefix = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
if (-not $OwnedRoot.StartsWith($TempPrefix,[StringComparison]::OrdinalIgnoreCase) -or
    $TaskName -notmatch '^Anthropology Canteen Reminder [a-f0-9-]{12}$') { throw 'Unsafe native fixture identity' }
$Tasks = @(Get-ScheduledTask -ErrorAction Stop | Where-Object { $_.TaskPath -eq '\' -and $_.TaskName -eq $TaskName })
if ($Tasks.Count -gt 1) { throw 'Ambiguous native fixture' }
$Sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
if ($Mode -in @('Once','FixtureDisabled')) {
  if ($Tasks.Count) { throw 'Refusing to overwrite an existing task' }
  $NodePath = [IO.Path]::GetFullPath($NodePath)
  $WorkerPath = [IO.Path]::GetFullPath($WorkerPath)
  foreach ($Path in @($NodePath,$WorkerPath)) {
    if (-not $Path.StartsWith($OwnedRoot+'\',[StringComparison]::OrdinalIgnoreCase)) { throw 'Timer payload outside fixture' }
  }
  $Action = New-ScheduledTaskAction -Execute $NodePath -Argument ('"'+$WorkerPath+'"') -WorkingDirectory ([IO.Path]::GetDirectoryName([IO.Path]::GetDirectoryName($NodePath)))
  $Trigger = if ($Mode -eq 'Once') { @(New-ScheduledTaskTrigger -Once -At (Get-Date).AddSeconds(20)) } else { @((New-ScheduledTaskTrigger -Daily -At (Get-Date).AddHours(12)),(New-ScheduledTaskTrigger -AtLogOn -User $Sid)) }
  $Principal = New-ScheduledTaskPrincipal -UserId $Sid -LogonType Interactive -RunLevel Limited
  Register-ScheduledTask -TaskName $TaskName -TaskPath '\' -Action $Action -Trigger $Trigger -Principal $Principal -Settings (New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries) | Out-Null
  if ($Mode -eq 'FixtureDisabled') { Disable-ScheduledTask -TaskName $TaskName -TaskPath '\' | Out-Null }
  $Tasks = @(Get-ScheduledTask -TaskName $TaskName -TaskPath '\')
}
if ($Tasks.Count) {
  $Task = $Tasks[0]
  if (@($Task.Actions).Count -ne 1 -or -not ([IO.Path]::GetFullPath([string]$Task.Actions[0].WorkingDirectory)).StartsWith($OwnedRoot+'\',[StringComparison]::OrdinalIgnoreCase) -or [string]$Task.Principal.RunLevel -ne 'Limited') { throw 'Task is not owned by this limited fixture' }
  $Account = [string]$Task.Principal.UserId
  $ActualSid = if ($Account -match '^S-1-') { $Account } else { ([Security.Principal.NTAccount]$Account).Translate([Security.Principal.SecurityIdentifier]).Value }
  if ($ActualSid -ne $Sid) { throw 'Task belongs to another identity' }
  if ($Mode -eq 'Remove') {
    if ([string]$Task.State -eq 'Running') { Stop-ScheduledTask -TaskName $TaskName -TaskPath '\' }
    Unregister-ScheduledTask -TaskName $TaskName -TaskPath '\' -Confirm:$false
    if (@(Get-ScheduledTask | Where-Object TaskName -eq $TaskName).Count) { throw 'Task cleanup incomplete' }
    $Tasks = @()
  } elseif ($Mode -in @('TaskDisabled','DailyDisabled','LogonDisabled')) {
    if ($Mode -eq 'TaskDisabled') { $Task.Settings.Enabled = $false }
    foreach ($Trigger in $Task.Triggers) {
      if (($Mode -eq 'DailyDisabled' -and $Trigger.CimClass.CimClassName -eq 'MSFT_TaskDailyTrigger') -or ($Mode -eq 'LogonDisabled' -and $Trigger.CimClass.CimClassName -eq 'MSFT_TaskLogonTrigger')) { $Trigger.Enabled = $false }
    }
    Set-ScheduledTask -TaskName $TaskName -TaskPath '\' -Settings $Task.Settings -Trigger @($Task.Triggers) | Out-Null
    $Tasks = @(Get-ScheduledTask -TaskName $TaskName -TaskPath '\')
  }
}
if (-not $Tasks.Count) { @{ exists=$false; userSid=$Sid } | ConvertTo-Json -Compress; exit }
$Task = $Tasks[0]
$Xml = New-Object System.Xml.XmlDocument
$Xml.XmlResolver = $null
$Xml.LoadXml((Export-ScheduledTask -TaskName $TaskName -TaskPath '\'))
foreach ($UserNode in $Xml.GetElementsByTagName('UserId')) {
  if ($UserNode.InnerText -notmatch '^S-1-') { $UserNode.InnerText = ([Security.Principal.NTAccount]$UserNode.InnerText).Translate([Security.Principal.SecurityIdentifier]).Value }
}
@{ exists=$true; enabled=[bool]$Task.Settings.Enabled; userSid=$Sid; runLevel=[string]$Task.Principal.RunLevel;
  root=[string]$Task.Actions[0].WorkingDirectory;
  triggers=@($Task.Triggers | ForEach-Object { @{ type=$_.CimClass.CimClassName; enabled=[bool]$_.Enabled } });
  xml=$Xml.DocumentElement.OuterXml } | ConvertTo-Json -Compress -Depth 6
