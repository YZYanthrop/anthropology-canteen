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
