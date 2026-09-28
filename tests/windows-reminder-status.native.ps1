# Synthetic inspection contract, no OS task writes. Pending unified execution.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '..\tools\windows-reminder-task-common.ps1')
$FixtureRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\outputs\status-fixture'))
$FixtureSid = 'S-1-5-21-111-222-333-1001'
$Task = [pscustomobject]@{
  TaskPath = '\'; TaskName = 'Anthropology Canteen Reminder fixture'
  Settings = [pscustomobject]@{ Enabled = $true }
  Principal = [pscustomobject]@{ UserId = $FixtureSid; LogonType = 'Interactive'; RunLevel = 'Limited' }
  Actions = @([pscustomobject]@{ Execute = (Join-Path $FixtureRoot 'runtime\node.exe'); Arguments = ('"' + (Join-Path $FixtureRoot 'reminder-worker.mjs') + '"'); WorkingDirectory = $FixtureRoot })
  Triggers = @(
    [pscustomobject]@{ CimClass = @{ CimClassName = 'MSFT_TaskDailyTrigger' }; DaysInterval = 1; StartBoundary = '2026-09-28T08:00:00'; Enabled = $true },
    [pscustomobject]@{ CimClass = @{ CimClassName = 'MSFT_TaskLogonTrigger' }; Enabled = $true }
  )
}
function Get-ScheduledTask { [CmdletBinding()]param(); return $Task }
$Arguments = @{ TaskName = $Task.TaskName; NodePath = $Task.Actions[0].Execute; WorkerPath = (Join-Path $FixtureRoot 'reminder-worker.mjs'); RootPath = $FixtureRoot; Time = '08:00'; ExpectedUserSid = $FixtureSid }
foreach ($Case in @('current', 'task-disabled', 'daily-disabled', 'logon-disabled')) {
  $Task.Settings.Enabled = $Case -ne 'task-disabled'
  $Task.Triggers[0].Enabled = $Case -ne 'daily-disabled'
  $Task.Triggers[1].Enabled = $Case -ne 'logon-disabled'
  $Result = Get-ReminderTaskInspection @Arguments
  if ($Case -eq 'current') {
    if ($Result.status -ne 'current' -or -not $Result.installed) { throw 'Enabled task was not confirmed' }
  } elseif ($Result.status -ne 'disabled' -or $Result.installed -or $Result.reasonCodes -notcontains $Case) {
    throw ('Disabled condition was hidden: ' + $Case)
  }
}
$OriginalTriggers = @($Task.Triggers)
foreach ($Case in @('missing-daily', 'missing-logon', 'old-path', 'permission', 'missing')) {
  $Task.Settings.Enabled = $true
  $Task.Triggers = @($OriginalTriggers)
  foreach ($Trigger in $Task.Triggers) { $Trigger.Enabled = $true }
  $Task.Actions[0].WorkingDirectory = $FixtureRoot
  if ($Case -eq 'missing-daily') { $Task.Triggers = @($OriginalTriggers[1]) }
  if ($Case -eq 'missing-logon') { $Task.Triggers = @($OriginalTriggers[0]) }
  if ($Case -eq 'old-path') { $Task.Actions[0].WorkingDirectory = Join-Path $FixtureRoot 'old' }
  function Get-ScheduledTask {
    [CmdletBinding()]param()
    if ($Case -eq 'permission') { throw [UnauthorizedAccessException]::new('Synthetic access denied') }
    if ($Case -ne 'missing') { return $Task }
  }
  if ($Case -eq 'permission') {
    $Rejected = $false
    try { Get-ReminderTaskInspection @Arguments | Out-Null } catch [UnauthorizedAccessException] { $Rejected = $true }
    if (-not $Rejected) { throw 'Permission failure was hidden' }
  } else {
    $Result = Get-ReminderTaskInspection @Arguments
    $Expected = if ($Case -eq 'missing') { 'missing' } else { 'stale' }
    if ($Result.status -ne $Expected -or $Result.installed) { throw ('Incorrect inspection: ' + $Case) }
  }
}
Write-Output '9 synthetic Windows inspection cases passed; no OS tasks modified.'
