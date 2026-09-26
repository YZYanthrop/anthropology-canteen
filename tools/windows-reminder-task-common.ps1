Set-StrictMode -Version Latest

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
