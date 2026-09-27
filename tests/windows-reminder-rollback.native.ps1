[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$ProductRoot,
  [Parameter(Mandatory = $true)][string]$TestRoot,
  [Parameter(Mandatory = $true)][string]$NodePath,
  [Parameter(Mandatory = $true)][string]$OriginalUserSid
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Import-Module ScheduledTasks
$ProductRoot = [IO.Path]::GetFullPath($ProductRoot)
$TestRoot = [IO.Path]::GetFullPath($TestRoot)
$Allowed = [IO.Path]::GetFullPath((Join-Path $ProductRoot 'outputs\slice-a\native')) + '\'
if (-not $TestRoot.StartsWith($Allowed, [StringComparison]::OrdinalIgnoreCase) -or
    (Test-Path -LiteralPath $TestRoot) -or $OriginalUserSid -notmatch '^S-1-\d+(?:-\d+)+$') {
  throw 'Invalid or nonempty native fixture directory'
}
New-Item -ItemType Directory -Path $TestRoot -Force | Out-Null
$TaskName = 'Anthropology Canteen Reminder ' + [guid]::NewGuid().ToString('N').Substring(0, 12)
$OtherTaskName = 'Anthropology Canteen Reminder ' + [guid]::NewGuid().ToString('N').Substring(0, 12)
$Roots = @((Join-Path $TestRoot 'old'), (Join-Path $TestRoot 'new'))
$Events = New-Object System.Collections.Generic.List[string]
$global:SliceAReadCount = 0
$global:SliceAFault = ''

# Faults surround the real native cmdlets; no mock substitutes for the task
# registration, export, enabled state, or restore assertions in this harness.
function Get-ScheduledTask {
  [CmdletBinding()]
  param([string]$TaskName, [string]$TaskPath)
  $global:SliceAReadCount += 1
  if ($global:SliceAFault -in @('inspection', 'restore') -and $global:SliceAReadCount -eq 2) {
    throw 'INJECTED_INSPECTION_FAILURE'
  }
  if ($global:SliceAFault -eq 'validation' -and $global:SliceAReadCount -eq 2) { return }
  ScheduledTasks\Get-ScheduledTask @PSBoundParameters
}
function Register-ScheduledTask {
  [CmdletBinding()]
  param([string]$TaskName, [string]$TaskPath, $Action, [object[]]$Trigger, $Settings, $Principal, [string]$Xml, [switch]$Force)
  if ($Xml -and $global:SliceAFault -eq 'restore') { throw 'INJECTED_RESTORE_FAILURE' }
  ScheduledTasks\Register-ScheduledTask @PSBoundParameters
  if (-not $Xml -and $global:SliceAFault -eq 'register') { throw 'INJECTED_POST_REGISTRATION_FAILURE' }
}
function Invoke-FixtureHelper {
  param([string]$Root, [string]$Name = $TaskName, [string]$Fault = '', [string]$Mode = 'Register', [string]$Snapshot = '', [string]$Result = '')
  $global:SliceAReadCount = 0
  $global:SliceAFault = $Fault
  $Arguments = @{
    TaskName = $Name; NodePath = (Join-Path $Root 'runtime\node.exe')
    WorkerPath = (Join-Path $Root 'reminder-worker.mjs'); RootPath = $Root
    Time = (Get-Date).AddMinutes(20).ToString('HH:mm'); OriginalUserSid = $OriginalUserSid
    Mode = $Mode
  }
  if ($Snapshot) { $Arguments.TransactionPath = $Snapshot }
  if ($Result) { $Arguments.ResultPath = $Result }
  $global:LASTEXITCODE = 0
  $PreviousErrorWriter = [Console]::Error
  $CapturedError = New-Object IO.StringWriter
  [Console]::SetError($CapturedError)
  try {
    $Output = & (Join-Path $Root 'tools\register-windows-reminder.ps1') @Arguments
    $Exit = $LASTEXITCODE
  } finally { [Console]::SetError($PreviousErrorWriter) }
  $global:SliceAFault = ''
  return [pscustomobject]@{ Exit = $Exit; Output = (($Output -join "`n") + $CapturedError.ToString()) }
}
function Assert-Original {
  param([string]$Xml)
  $Actual = ScheduledTasks\Export-ScheduledTask -TaskName $TaskName -TaskPath '\'
  if ((Get-ReminderComparableXml $Actual) -ne (Get-ReminderComparableXml $Xml)) {
    [IO.File]::WriteAllText((Join-Path $TestRoot 'expected.xml'), $Xml)
    [IO.File]::WriteAllText((Join-Path $TestRoot 'actual.xml'), $Actual)
    throw ('Original task definition was not restored; fault=' + $Fault + '; helper=' + $Invocation.Output)
  }
  $Task = ScheduledTasks\Get-ScheduledTask -TaskName $TaskName -TaskPath '\'
  Assert-ReminderPreviousTask $Task $OriginalUserSid
}

try {
  foreach ($Root in $Roots) {
    New-Item -ItemType Directory -Path (Join-Path $Root 'runtime'), (Join-Path $Root 'tools'), (Join-Path $Root 'data') -Force | Out-Null
    New-Item -ItemType HardLink -Path (Join-Path $Root 'runtime\node.exe') -Value $NodePath | Out-Null
    [IO.File]::WriteAllText((Join-Path $Root 'reminder-worker.mjs'), '// Native fixture: no network, credentials, mail, or checks.' + "`n")
    foreach ($Script in @('register-windows-reminder.ps1', 'windows-reminder-task-common.ps1')) {
      Copy-Item -LiteralPath (Join-Path $ProductRoot ('tools\' + $Script)) -Destination (Join-Path $Root ('tools\' + $Script))
    }
  }
  . (Join-Path $ProductRoot 'tools\windows-reminder-task-common.ps1')
  $Created = Invoke-FixtureHelper $Roots[0]
  if ($Created.Exit -ne 0) { throw ('Initial temporary registration failed: ' + $Created.Output) }
  $Other = Invoke-FixtureHelper -Root $Roots[0] -Name $OtherTaskName
  if ($Other.Exit -ne 0) { throw 'Unrelated temporary task registration failed' }

  # A task created by another folder after an absent-task snapshot must never
  # be removed by this transaction's rollback.
  $ForeignSnapshot = Join-Path $Roots[1] ('data\.scheduler-task-' + [guid]::NewGuid().ToString('N') + '.json')
  @{ taskName = $OtherTaskName; userSid = $OriginalUserSid; root = $Roots[1]; existed = $false; xml = ''; enabled = $false } |
    ConvertTo-Json | Set-Content -LiteralPath $ForeignSnapshot -Encoding UTF8
  $OtherXml = ScheduledTasks\Export-ScheduledTask -TaskName $OtherTaskName -TaskPath '\'
  $Foreign = Invoke-FixtureHelper -Root $Roots[1] -Name $OtherTaskName -Mode Restore -Snapshot $ForeignSnapshot
  if ($Foreign.Exit -ne 3) { throw 'Rollback did not reject a task created by another folder' }
  if ((ScheduledTasks\Export-ScheduledTask -TaskName $OtherTaskName -TaskPath '\') -ne $OtherXml) { throw 'Foreign task was changed' }
  $Events.Add('rollback refuses task created by another folder')

  foreach ($State in @(
    @{ Enabled = $true; Daily = $true; Logon = $true },
    @{ Enabled = $true; Daily = $false; Logon = $true },
    @{ Enabled = $true; Daily = $true; Logon = $false },
    @{ Enabled = $false; Daily = $false; Logon = $false }
  )) {
    $Enabled = $State.Enabled
    $Old = ScheduledTasks\Get-ScheduledTask -TaskName $TaskName -TaskPath '\'
    $Old.Settings.Enabled = $Enabled
    foreach ($Trigger in @($Old.Triggers)) {
      if ($Trigger.CimClass.CimClassName -eq 'MSFT_TaskDailyTrigger') { $Trigger.Enabled = $State.Daily }
      if ($Trigger.CimClass.CimClassName -eq 'MSFT_TaskLogonTrigger') { $Trigger.Enabled = $State.Logon }
    }
    ScheduledTasks\Set-ScheduledTask -TaskName $TaskName -TaskPath '\' -Settings $Old.Settings -Trigger @($Old.Triggers) | Out-Null
    $Original = ScheduledTasks\Export-ScheduledTask -TaskName $TaskName -TaskPath '\'
    foreach ($Fault in @('inspection', 'validation', 'register', 'restore', 'result')) {
      $Snapshot = Join-Path $Roots[1] ('data\.scheduler-task-' + [guid]::NewGuid().ToString('N') + '.json')
      $Result = ''
      $ResultLock = $null
      if ($Fault -eq 'result') {
        $Result = Join-Path $Roots[1] ('data\.scheduler-result-' + [guid]::NewGuid().ToString('N') + '.json')
        $ResultLock = [IO.File]::Open($Result, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
      }
      try {
        $Invocation = Invoke-FixtureHelper -Root $Roots[1] -Fault $Fault -Snapshot $Snapshot -Result $Result
      } finally { if ($null -ne $ResultLock) { $ResultLock.Dispose() } }
      if ($Invocation.Exit -eq 0) { throw ('Fault unexpectedly succeeded: ' + $Fault) }
      if (-not (Test-Path -LiteralPath $Snapshot)) { throw 'Recovery snapshot was lost' }
      if ($Fault -eq 'restore') {
        if ($Invocation.Output -notmatch 'SCHEDULER_ROLLBACK_FAILED') { throw 'Restore failure was hidden' }
        $Recovered = Invoke-FixtureHelper -Root $Roots[1] -Mode Restore -Snapshot $Snapshot
        if ($Recovered.Exit -ne 0) { throw ('Explicit fixture recovery failed: ' + $Recovered.Output) }
      }
      Assert-Original $Original
      $Events.Add(('restore ' + $Fault + ' enabled=' + $Enabled + ' daily=' + $State.Daily + ' logon=' + $State.Logon))
    }
  }

  # Successful repeat updates also preserve the deliberately disabled task and
  # both disabled triggers. This is not an explicit request to re-enable it.
  foreach ($Repeat in 1..2) {
    $Updated = Invoke-FixtureHelper $Roots[1]
    if ($Updated.Exit -ne 0) { throw ('Repeated update failed: ' + $Updated.Output) }
    $Task = ScheduledTasks\Get-ScheduledTask -TaskName $TaskName -TaskPath '\'
    if ($Task.Settings.Enabled -or @($Task.Triggers | Where-Object Enabled).Count -ne 0) { throw 'A disabled task or trigger was re-enabled' }
    Assert-ReminderPreviousTask $Task $OriginalUserSid
    $Events.Add('repeat update preserves disabled state')
  }
  ScheduledTasks\Unregister-ScheduledTask -TaskName $TaskName -TaskPath '\' -Confirm:$false
  $NewFailure = Invoke-FixtureHelper -Root $Roots[1] -Fault inspection
  if ($NewFailure.Exit -eq 0) { throw 'New-task fault unexpectedly succeeded' }
  if (@(ScheduledTasks\Get-ScheduledTask | Where-Object TaskName -eq $TaskName).Count -ne 0) { throw 'Failed new task was not removed' }
  if (@(ScheduledTasks\Get-ScheduledTask | Where-Object TaskName -eq $OtherTaskName).Count -ne 1) { throw 'Unrelated temporary task was changed' }
  $Events.Add('new-task cleanup leaves unrelated task intact')
} finally {
  $global:SliceAFault = ''
  foreach ($Name in @($TaskName, $OtherTaskName)) {
    $Remaining = @(ScheduledTasks\Get-ScheduledTask -ErrorAction Stop | Where-Object { $_.TaskPath -eq '\' -and $_.TaskName -eq $Name })
    foreach ($Task in $Remaining) {
      Assert-ReminderPreviousTask $Task $OriginalUserSid
      $TaskRoot = [IO.Path]::GetFullPath([string]$Task.Actions[0].WorkingDirectory)
      if (-not $TaskRoot.StartsWith($TestRoot + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Refusing cleanup outside the native fixture' }
      ScheduledTasks\Unregister-ScheduledTask -TaskName $Name -TaskPath '\' -Confirm:$false -ErrorAction Stop
    }
  }
}

[pscustomobject]@{ passed = $true; checks = @($Events); temporaryTasksRemoved = $true } | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $TestRoot 'result.json') -Encoding UTF8
