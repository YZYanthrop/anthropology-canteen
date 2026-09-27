[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$TaskName,
  [Parameter(Mandatory = $true)][string]$NodePath,
  [Parameter(Mandatory = $true)][string]$WorkerPath,
  [Parameter(Mandatory = $true)][string]$RootPath,
  [Parameter(Mandatory = $true)][string]$Time,
  [string]$OriginalUserSid = '',
  [string]$ResultPath = '',
  [string]$TransactionPath = '',
  [ValidateSet('Register', 'Restore')][string]$Mode = 'Register'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'windows-reminder-task-common.ps1')
$MutationAttempted = $false
$Snapshot = $null
$OwnSnapshot = -not $TransactionPath

try {
  $Paths = Assert-ReminderTaskArguments -TaskName $TaskName -NodePath $NodePath -WorkerPath $WorkerPath -RootPath $RootPath -Time $Time
  if (-not $OriginalUserSid) {
    $OriginalUserSid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
  }
  if ($OriginalUserSid -notmatch '^S-1-\d+(?:-\d+)+$') { throw 'INVALID_ORIGINAL_USER' }
  $DataDirectory = [IO.Path]::GetFullPath((Join-Path $Paths.RootPath 'data'))
  if (-not $TransactionPath) {
    if ($Mode -eq 'Restore') { throw 'MISSING_TASK_SNAPSHOT' }
    $TransactionPath = Join-Path $DataDirectory ('.scheduler-task-' + [guid]::NewGuid().ToString('N') + '.json')
  }
  $TransactionPath = [IO.Path]::GetFullPath($TransactionPath)
  if ([IO.Path]::GetDirectoryName($TransactionPath) -ne $DataDirectory -or
      [IO.Path]::GetFileName($TransactionPath) -notmatch '^\.scheduler-task-[a-f0-9]{32}\.json$') {
    throw 'INVALID_TASK_SNAPSHOT_PATH'
  }
  if ($ResultPath) {
    $ResultPath = [IO.Path]::GetFullPath($ResultPath)
    if ([IO.Path]::GetDirectoryName($ResultPath) -ne $DataDirectory -or
        [IO.Path]::GetFileName($ResultPath) -notmatch '^\.scheduler-result-[a-f0-9]{32}\.json$') {
      throw 'INVALID_RESULT_PATH'
    }
  }
  if (Test-Path -LiteralPath $TransactionPath) {
    $Snapshot = Get-Content -LiteralPath $TransactionPath -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($Snapshot.taskName -ne $TaskName -or $Snapshot.userSid -ne $OriginalUserSid -or
        $Snapshot.root -ne $Paths.RootPath) { throw 'INVALID_TASK_SNAPSHOT_IDENTITY' }
  }
  if ($Mode -eq 'Restore') {
    if ($null -eq $Snapshot) { throw 'MISSING_TASK_SNAPSHOT' }
    Restore-ReminderTaskSnapshot $Snapshot $TaskName $OriginalUserSid
    $Result = @{ status = 'restored'; installed = [bool]$Snapshot.existed }
  } else {
    # Failed inspection is never evidence that the original task was absent.
    $PreviousTask = Get-ReminderExactTask $TaskName
    Assert-ReminderPreviousTask $PreviousTask $OriginalUserSid
    if ($null -eq $Snapshot) {
      $PreviousXml = if ($null -ne $PreviousTask) {
        Export-ScheduledTask -TaskName $TaskName -TaskPath '\' -ErrorAction Stop
      } else { '' }
      $Snapshot = [pscustomobject]@{
        taskName = $TaskName; userSid = $OriginalUserSid; root = $Paths.RootPath
        existed = ($null -ne $PreviousTask); xml = [string]$PreviousXml
        enabled = $(if ($null -ne $PreviousTask) { [bool]$PreviousTask.Settings.Enabled } else { $false })
      }
      New-Item -ItemType Directory -Path $DataDirectory -Force | Out-Null
      $Bytes = [Text.UTF8Encoding]::new($false).GetBytes(($Snapshot | ConvertTo-Json -Depth 5 -Compress))
      $Stream = [IO.File]::Open($TransactionPath, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
      try { $Stream.Write($Bytes, 0, $Bytes.Length); $Stream.Flush($true) } finally { $Stream.Dispose() }
    } else {
      # A normal-permission attempt may leave a verified restored snapshot for
      # the elevated retry. Do not replace a task changed by somebody else.
      if ($Snapshot.existed -ne ($null -ne $PreviousTask)) { throw 'TASK_CHANGED_SINCE_SNAPSHOT' }
      if ($Snapshot.existed) {
        $CurrentXml = Export-ScheduledTask -TaskName $TaskName -TaskPath '\' -ErrorAction Stop
        if ((Get-ReminderComparableXml $CurrentXml) -ne (Get-ReminderComparableXml $Snapshot.xml)) {
          throw 'TASK_CHANGED_SINCE_SNAPSHOT'
        }
      }
    }
    $Action = New-ScheduledTaskAction -Execute $Paths.NodePath -Argument ('"' + $Paths.WorkerPath + '"') -WorkingDirectory $Paths.RootPath
    $Daily = New-ScheduledTaskTrigger -Daily -At ([datetime]::ParseExact($Time, 'HH:mm', $null))
    $Logon = New-ScheduledTaskTrigger -AtLogOn
    $Settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 20) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
    if ($null -ne $PreviousTask) {
      $Settings.Enabled = [bool]$Snapshot.enabled
      foreach ($Trigger in @($PreviousTask.Triggers)) {
        if ($Trigger.CimClass.CimClassName -eq 'MSFT_TaskDailyTrigger') { $Daily.Enabled = [bool]$Trigger.Enabled }
        if ($Trigger.CimClass.CimClassName -eq 'MSFT_TaskLogonTrigger') { $Logon.Enabled = [bool]$Trigger.Enabled }
      }
    }
    $Principal = New-ScheduledTaskPrincipal -UserId $OriginalUserSid -LogonType Interactive -RunLevel Limited
    $MutationAttempted = $true
    Register-ScheduledTask -TaskName $TaskName -TaskPath '\' -Action $Action -Trigger $Daily, $Logon -Settings $Settings -Principal $Principal -Force -ErrorAction Stop | Out-Null
    $Result = Get-ReminderTaskInspection -TaskName $TaskName -NodePath $Paths.NodePath -WorkerPath $Paths.WorkerPath -RootPath $Paths.RootPath -Time $Time -ExpectedUserSid $OriginalUserSid
    if ($Result.status -ne 'current') { throw 'TASK_VALIDATION_FAILED' }
  }
  $ResultJson = $Result | ConvertTo-Json -Compress
  if ($ResultPath) { [IO.File]::WriteAllText($ResultPath, $ResultJson, [Text.UTF8Encoding]::new($false)) }
  else { $ResultJson }
  if ($OwnSnapshot) { Remove-Item -LiteralPath $TransactionPath -Force }
} catch {
  $Failure = $_
  if ($MutationAttempted) {
    try { Restore-ReminderTaskSnapshot $Snapshot $TaskName $OriginalUserSid }
    catch {
      [Console]::Error.WriteLine('ANTHROPOLOGY_CANTEEN_SCHEDULER_ROLLBACK_FAILED')
      exit 3
    }
  }
  $Detail = @([string]$Failure.Exception.Message, [string]$Failure.FullyQualifiedErrorId,
    [string]$Failure.CategoryInfo.Reason, [string]$Failure.Exception.HResult) -join ' '
  if ($Detail -match '(?i)access\s*denied|permissiondenied|unauthorized|0x80070005|0x80041003|-2147024891') {
    [Console]::Error.WriteLine('ANTHROPOLOGY_CANTEEN_SCHEDULER_PERMISSION_DENIED')
    exit 5
  }
  if ($Mode -eq 'Restore') {
    [Console]::Error.WriteLine('ANTHROPOLOGY_CANTEEN_SCHEDULER_ROLLBACK_FAILED')
    exit 3
  }
  if ($MutationAttempted) {
    [Console]::Error.WriteLine('ANTHROPOLOGY_CANTEEN_SCHEDULER_UPDATE_FAILED_RESTORED')
    exit 2
  }
  [Console]::Error.WriteLine('ANTHROPOLOGY_CANTEEN_SCHEDULER_SNAPSHOT_FAILED')
  exit 1
}
