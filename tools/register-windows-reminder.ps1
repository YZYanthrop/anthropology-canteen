[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$TaskName,
  [Parameter(Mandatory = $true)][string]$NodePath,
  [Parameter(Mandatory = $true)][string]$WorkerPath,
  [Parameter(Mandatory = $true)][string]$RootPath,
  [Parameter(Mandatory = $true)][string]$Time,
  [string]$OriginalUserSid = "",
  [string]$ResultPath = ""
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "windows-reminder-task-common.ps1")

try {
  $ValidationParameters = @{
    TaskName = $TaskName
    NodePath = $NodePath
    WorkerPath = $WorkerPath
    RootPath = $RootPath
    Time = $Time
  }
  $Paths = Assert-ReminderTaskArguments @ValidationParameters
  if ([string]::IsNullOrWhiteSpace($OriginalUserSid)) {
    $OriginalUserSid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
  }
  if ($OriginalUserSid -notmatch '^S-1-\d+(?:-\d+)+$') {
    throw "INVALID_ORIGINAL_USER"
  }
  if ($ResultPath) {
    $ResolvedResult = [System.IO.Path]::GetFullPath($ResultPath)
    $ExpectedResultDirectory = [System.IO.Path]::GetFullPath((
      Join-Path $Paths.RootPath "data"
    )).TrimEnd('\') + '\'
    if (-not $ResolvedResult.StartsWith(
          $ExpectedResultDirectory,
          [System.StringComparison]::OrdinalIgnoreCase
        ) -or
        [System.IO.Path]::GetFileName($ResolvedResult) -notmatch '^\.scheduler-result-[a-f0-9]{32}\.json$') {
      throw "INVALID_RESULT_PATH"
    }
  }

  $PreviousTask = Get-ScheduledTask -TaskName $TaskName -TaskPath "\" `
    -ErrorAction SilentlyContinue
  $PreviousXml = if ($null -ne $PreviousTask) {
    Export-ScheduledTask -TaskName $TaskName -TaskPath "\" -ErrorAction Stop
  } else {
    ""
  }

  $action = New-ScheduledTaskAction -Execute $Paths.NodePath `
    -Argument "`"$($Paths.WorkerPath)`"" -WorkingDirectory $Paths.RootPath
  $daily = New-ScheduledTaskTrigger -Daily `
    -At ([datetime]::ParseExact($Time, "HH:mm", $null))
  $logon = New-ScheduledTaskTrigger -AtLogOn
  $settings = New-ScheduledTaskSettingsSet `
    -StartWhenAvailable `
    -MultipleInstances IgnoreNew `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 20) `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries
  $principal = New-ScheduledTaskPrincipal `
    -UserId $OriginalUserSid `
    -LogonType Interactive `
    -RunLevel Limited

  Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $action `
    -Trigger $daily, $logon `
    -Settings $settings `
    -Principal $principal `
    -Force | Out-Null

  $Inspection = Get-ReminderTaskInspection -TaskName $TaskName `
    -NodePath $Paths.NodePath -WorkerPath $Paths.WorkerPath `
    -RootPath $Paths.RootPath -Time $Time -ExpectedUserSid $OriginalUserSid
  if ($Inspection.status -ne "current") {
    try {
      if ($PreviousXml) {
        Register-ScheduledTask -TaskName $TaskName -TaskPath "\" `
          -Xml $PreviousXml -Force | Out-Null
      } else {
        Unregister-ScheduledTask -TaskName $TaskName -TaskPath "\" `
          -Confirm:$false -ErrorAction Stop
      }
    } catch {
      [Console]::Error.WriteLine("ANTHROPOLOGY_CANTEEN_SCHEDULER_ROLLBACK_FAILED")
      exit 3
    }
    [Console]::Error.WriteLine("ANTHROPOLOGY_CANTEEN_SCHEDULER_VALIDATION_FAILED")
    exit 2
  }
  $InspectionJson = $Inspection | ConvertTo-Json -Compress
  if ($ResultPath) {
    try {
      $Encoding = New-Object System.Text.UTF8Encoding($false)
      [System.IO.File]::WriteAllText($ResolvedResult, $InspectionJson, $Encoding)
    } catch {
      try {
        if ($PreviousXml) {
          Register-ScheduledTask -TaskName $TaskName -TaskPath "\" `
            -Xml $PreviousXml -Force | Out-Null
        } else {
          Unregister-ScheduledTask -TaskName $TaskName -TaskPath "\" `
            -Confirm:$false -ErrorAction Stop
        }
      } catch {
        [Console]::Error.WriteLine("ANTHROPOLOGY_CANTEEN_SCHEDULER_ROLLBACK_FAILED")
        exit 3
      }
      throw "TASK_RESULT_WRITE_FAILED"
    }
  } else {
    $InspectionJson
  }
} catch {
  $detail = @(
    [string]$_.Exception.Message,
    [string]$_.FullyQualifiedErrorId,
    [string]$_.CategoryInfo.Reason,
    [string]$_.Exception.HResult
  ) -join " "
  if ($detail -match '(?i)access\s*denied|permissiondenied|unauthorized|0x80070005|0x80041003|-2147024891') {
    [Console]::Error.WriteLine("ANTHROPOLOGY_CANTEEN_SCHEDULER_PERMISSION_DENIED")
    exit 5
  }
  [Console]::Error.WriteLine(
    "ANTHROPOLOGY_CANTEEN_SCHEDULER_ERROR: " + [string]$_.Exception.Message
  )
  exit 1
}
