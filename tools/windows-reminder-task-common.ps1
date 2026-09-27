Set-StrictMode -Version Latest

function Get-ReminderExactTask {
  param([string]$TaskName)
  $Tasks = @(Get-ScheduledTask -ErrorAction Stop | Where-Object {
    $_.TaskPath -eq '\' -and $_.TaskName -eq $TaskName
  })
  if ($Tasks.Count -gt 1) { throw 'AMBIGUOUS_TASK_IDENTITY' }
  if ($Tasks.Count -eq 1) { return $Tasks[0] }
  return $null
}

function Assert-ReminderPreviousTask {
  param($Task, [string]$ExpectedUserSid)
  if ($null -eq $Task) { return }
  if ((Resolve-ReminderTaskSid ([string]$Task.Principal.UserId)) -ne $ExpectedUserSid -or
      [string]$Task.Principal.LogonType -ne 'Interactive' -or
      [string]$Task.Principal.RunLevel -ne 'Limited') { throw 'UNSAFE_PREVIOUS_TASK_IDENTITY' }
  $Actions = @($Task.Actions)
  if ($Actions.Count -ne 1) { throw 'UNSAFE_PREVIOUS_TASK_ACTION' }
  $PreviousRoot = [IO.Path]::GetFullPath([string]$Actions[0].WorkingDirectory)
  if ([IO.Path]::GetFullPath([string]$Actions[0].Execute) -ne
      [IO.Path]::GetFullPath((Join-Path $PreviousRoot 'runtime\node.exe')) -or
      [string]$Actions[0].Arguments -ne ('"' + (Join-Path $PreviousRoot 'reminder-worker.mjs') + '"')) {
    throw 'UNSAFE_PREVIOUS_TASK_ACTION'
  }
}

function Get-ReminderComparableXml {
  param([string]$Xml)
  $Document = New-Object System.Xml.XmlDocument
  $Document.XmlResolver = $null
  $Document.LoadXml($Xml)
  foreach ($User in $Document.GetElementsByTagName('UserId')) {
    $User.InnerText = Resolve-ReminderTaskSid $User.InnerText
  }
  return $Document.DocumentElement.OuterXml
}

function Restore-ReminderTaskSnapshot {
  param($Snapshot, [string]$TaskName, [string]$OriginalUserSid)
  if ($Snapshot.taskName -ne $TaskName -or $Snapshot.userSid -ne $OriginalUserSid) {
    throw 'INVALID_TASK_SNAPSHOT_IDENTITY'
  }
  $Current = Get-ReminderExactTask $TaskName
  Assert-ReminderPreviousTask $Current $OriginalUserSid
  if ($Snapshot.existed) {
    $PreviousXml = [string]$Snapshot.xml
    $Document = New-Object System.Xml.XmlDocument
    $Document.XmlResolver = $null
    $Document.LoadXml($PreviousXml)
    $Principals = @($Document.GetElementsByTagName('Principal'))
    # Task Scheduler omits RunLevel when it has the schema default,
    # LeastPrivilege. Do not treat a native export with that omission as an
    # unsafe principal (or access a missing XML property under StrictMode).
    $RunLevels = @($Document.GetElementsByTagName('RunLevel'))
    $Limited = $RunLevels.Count -eq 0 -or
      ($RunLevels.Count -eq 1 -and $RunLevels[0].InnerText -eq 'LeastPrivilege')
    if ($Principals.Count -ne 1 -or
        (Resolve-ReminderTaskSid ([string]$Principals[0].UserId)) -ne $OriginalUserSid -or
        -not $Limited -or
        [string]$Principals[0].LogonType -ne 'InteractiveToken') { throw 'UNSAFE_SNAPSHOT_PRINCIPAL' }
    $Actions = @($Document.GetElementsByTagName('Actions'))
    if ($Actions.Count -ne 1 -or $Actions[0].ChildNodes.Count -ne 1 -or
        $Actions[0].FirstChild.LocalName -ne 'Exec') { throw 'UNSAFE_SNAPSHOT_ACTION' }
    $Exec = $Actions[0].FirstChild
    Assert-ReminderPreviousTask ([pscustomobject]@{
      Principal = [pscustomobject]@{ UserId = $OriginalUserSid; LogonType = 'Interactive'; RunLevel = 'Limited' }
      Actions = @([pscustomobject]@{ Execute = [string]$Exec.Command; Arguments = [string]$Exec.Arguments; WorkingDirectory = [string]$Exec.WorkingDirectory })
    }) $OriginalUserSid
    $Matches = $false
    if ($null -ne $Current) {
      $ActualXml = Export-ScheduledTask -TaskName $TaskName -TaskPath '\' -ErrorAction Stop
      $Matches = (Get-ReminderComparableXml $ActualXml) -eq (Get-ReminderComparableXml $PreviousXml)
    }
    if (-not $Matches) {
      if ($null -ne $Current -and
          [IO.Path]::GetFullPath([string]$Current.Actions[0].WorkingDirectory) -ne
          [IO.Path]::GetFullPath([string]$Snapshot.root)) { throw 'TASK_CHANGED_OUTSIDE_UPDATE' }
      Register-ScheduledTask -TaskName $TaskName -TaskPath '\' -Xml $PreviousXml -Force -ErrorAction Stop | Out-Null
    }
    $Restored = Get-ReminderExactTask $TaskName
    Assert-ReminderPreviousTask $Restored $OriginalUserSid
    if ($null -eq $Restored -or [bool]$Restored.Settings.Enabled -ne [bool]$Snapshot.enabled) {
      throw 'TASK_RESTORE_STATE_MISMATCH'
    }
    $RestoredXml = Export-ScheduledTask -TaskName $TaskName -TaskPath '\' -ErrorAction Stop
    if ((Get-ReminderComparableXml $RestoredXml) -ne (Get-ReminderComparableXml $PreviousXml)) {
      throw 'TASK_RESTORE_DEFINITION_MISMATCH'
    }
  } else {
    if ($null -ne $Current) {
      if ([IO.Path]::GetFullPath([string]$Current.Actions[0].WorkingDirectory) -ne
          [IO.Path]::GetFullPath([string]$Snapshot.root)) { throw 'TASK_CHANGED_OUTSIDE_UPDATE' }
      Unregister-ScheduledTask -TaskName $TaskName -TaskPath '\' -Confirm:$false -ErrorAction Stop
    }
    if ($null -ne (Get-ReminderExactTask $TaskName)) { throw 'NEW_TASK_CLEANUP_FAILED' }
  }
}

function Resolve-ReminderTaskSid {
  param([Parameter(Mandatory = $true)][string]$UserId)

  if ($UserId -match '^S-1-\d+(?:-\d+)+$') { return $UserId }
  try {
    return (New-Object System.Security.Principal.NTAccount($UserId)).Translate(
      [System.Security.Principal.SecurityIdentifier]
    ).Value
  } catch {
    return ""
  }
}

function Assert-ReminderTaskArguments {
  param(
    [Parameter(Mandatory = $true)][string]$TaskName,
    [Parameter(Mandatory = $true)][string]$NodePath,
    [Parameter(Mandatory = $true)][string]$WorkerPath,
    [Parameter(Mandatory = $true)][string]$RootPath,
    [Parameter(Mandatory = $true)][string]$Time
  )

  if ($TaskName -notmatch '^Anthropology Canteen Reminder [A-Za-z0-9-]{1,12}$') {
    throw "INVALID_TASK_NAME"
  }
  if ($Time -notmatch '^(?:[01]\d|2[0-3]):[0-5]\d$') {
    throw "INVALID_TASK_TIME"
  }
  foreach ($Value in @($NodePath, $WorkerPath, $RootPath)) {
    if ([string]::IsNullOrWhiteSpace($Value) -or $Value.Contains('"')) {
      throw "INVALID_TASK_PATH"
    }
  }

  $ResolvedRoot = [System.IO.Path]::GetFullPath($RootPath).TrimEnd('\')
  $ResolvedNode = [System.IO.Path]::GetFullPath($NodePath)
  $ResolvedWorker = [System.IO.Path]::GetFullPath($WorkerPath)
  if ($ResolvedNode -ne [System.IO.Path]::GetFullPath((Join-Path $ResolvedRoot 'runtime\node.exe')) -or
      $ResolvedWorker -ne [System.IO.Path]::GetFullPath((Join-Path $ResolvedRoot 'reminder-worker.mjs')) -or
      -not (Test-Path -LiteralPath $ResolvedRoot -PathType Container) -or
      -not (Test-Path -LiteralPath $ResolvedNode -PathType Leaf) -or
      -not (Test-Path -LiteralPath $ResolvedWorker -PathType Leaf)) {
    throw "INVALID_TASK_PATH"
  }

  return [pscustomobject]@{
    RootPath = $ResolvedRoot
    NodePath = $ResolvedNode
    WorkerPath = $ResolvedWorker
  }
}

function Test-ReminderTaskDefinition {
  param(
    [Parameter(Mandatory = $true)]$Task,
    [Parameter(Mandatory = $true)][string]$NodePath,
    [Parameter(Mandatory = $true)][string]$WorkerPath,
    [Parameter(Mandatory = $true)][string]$RootPath,
    [Parameter(Mandatory = $true)][string]$Time,
    [Parameter(Mandatory = $true)][string]$ExpectedUserSid
  )

  $Reasons = New-Object System.Collections.Generic.List[string]
  $Actions = @($Task.Actions)
  if ($Actions.Count -ne 1) {
    $Reasons.Add("action-count")
  } else {
    $Action = $Actions[0]
    $ExpectedArguments = '"' + $WorkerPath + '"'
    $ActualExecute = try {
      [System.IO.Path]::GetFullPath([string]$Action.Execute)
    } catch { "" }
    $ActualWorkingDirectory = try {
      [System.IO.Path]::GetFullPath([string]$Action.WorkingDirectory)
    } catch { "" }
    if ($ActualExecute -ne $NodePath) {
      $Reasons.Add("executable")
    }
    if ([string]$Action.Arguments -ne $ExpectedArguments) {
      $Reasons.Add("worker")
    }
    if ($ActualWorkingDirectory -ne $RootPath) {
      $Reasons.Add("working-directory")
    }
  }

  $DailyTrigger = @($Task.Triggers | Where-Object {
    $_.CimClass.CimClassName -eq "MSFT_TaskDailyTrigger"
  })
  $LogonTrigger = @($Task.Triggers | Where-Object {
    $_.CimClass.CimClassName -eq "MSFT_TaskLogonTrigger"
  })
  if ($DailyTrigger.Count -ne 1 -or
      [int]$DailyTrigger[0].DaysInterval -ne 1 -or
      ([datetime]$DailyTrigger[0].StartBoundary).ToString("HH:mm") -ne $Time -or
      $LogonTrigger.Count -ne 1) {
    $Reasons.Add("triggers")
  }

  $ActualSid = Resolve-ReminderTaskSid -UserId ([string]$Task.Principal.UserId)
  if ($ActualSid -ne $ExpectedUserSid -or
      [string]$Task.Principal.LogonType -ne "Interactive") {
    $Reasons.Add("principal")
  }
  if ([string]$Task.Principal.RunLevel -ne "Limited") {
    $Reasons.Add("run-level")
  }

  return @($Reasons)
}

function Get-ReminderTaskInspection {
  param(
    [Parameter(Mandatory = $true)][string]$TaskName,
    [Parameter(Mandatory = $true)][string]$NodePath,
    [Parameter(Mandatory = $true)][string]$WorkerPath,
    [Parameter(Mandatory = $true)][string]$RootPath,
    [Parameter(Mandatory = $true)][string]$Time,
    [Parameter(Mandatory = $true)][string]$ExpectedUserSid
  )

  $ProductPattern = '^Anthropology Canteen Reminder (?<id>[A-Za-z0-9-]{1,12})$'
  $ProductTasks = @(Get-ScheduledTask -ErrorAction Stop | Where-Object {
    $_.TaskPath -eq '\' -and $_.TaskName -match $ProductPattern
  })
  $Current = @($ProductTasks | Where-Object { $_.TaskName -eq $TaskName })
  $OtherIds = @($ProductTasks | Where-Object { $_.TaskName -ne $TaskName } | ForEach-Object {
    if ($_.TaskName -match $ProductPattern) { $Matches.id }
  } | Sort-Object -Unique)

  if ($Current.Count -eq 0) {
    return [pscustomobject]@{
      status = "missing"
      installed = $false
      reasonCodes = @("task-missing")
      ambiguousTaskCount = $OtherIds.Count
      ambiguousTaskIds = $OtherIds
    }
  }
  if ($Current.Count -ne 1) {
    return [pscustomobject]@{
      status = "ambiguous"
      installed = $false
      reasonCodes = @("duplicate-current-name")
      ambiguousTaskCount = $OtherIds.Count + $Current.Count
      ambiguousTaskIds = $OtherIds
    }
  }

  $Reasons = @(Test-ReminderTaskDefinition -Task $Current[0] `
    -NodePath $NodePath -WorkerPath $WorkerPath -RootPath $RootPath `
    -Time $Time -ExpectedUserSid $ExpectedUserSid)
  return [pscustomobject]@{
    status = $(if ($Reasons.Count -eq 0) { "current" } else { "stale" })
    installed = ($Reasons.Count -eq 0)
    reasonCodes = $Reasons
    ambiguousTaskCount = $OtherIds.Count
    ambiguousTaskIds = $OtherIds
  }
}
