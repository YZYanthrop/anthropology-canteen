[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$TaskName,
  [Parameter(Mandatory = $true)][string]$NodePath,
  [Parameter(Mandatory = $true)][string]$WorkerPath,
  [Parameter(Mandatory = $true)][string]$RootPath,
  [Parameter(Mandatory = $true)][string]$Time,
  [string]$TransactionPath = '',
  [ValidateSet('Register', 'Restore')][string]$Mode = 'Register',
  [switch]$Reenable
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "windows-reminder-task-common.ps1")

function Quote-ReminderArgument {
  param([Parameter(Mandatory = $true)][string]$Value)
  if ($Value.Contains('"')) { throw "INVALID_TASK_ARGUMENT" }
  return '"' + $Value + '"'
}

try {
  $Paths = Assert-ReminderTaskArguments -TaskName $TaskName -NodePath $NodePath -WorkerPath $WorkerPath -RootPath $RootPath -Time $Time
  $RegisterScript = [System.IO.Path]::GetFullPath((
    Join-Path $Paths.RootPath "tools\register-windows-reminder.ps1"
  ))
  if ($RegisterScript -ne [System.IO.Path]::GetFullPath((
        Join-Path $PSScriptRoot "register-windows-reminder.ps1"
      )) -or -not (Test-Path -LiteralPath $RegisterScript -PathType Leaf)) {
    throw "INVALID_TASK_HELPER"
  }

  $OriginalUserSid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
  $ResultDirectory = Join-Path $Paths.RootPath "data"
  New-Item -ItemType Directory -Path $ResultDirectory -Force | Out-Null
  $ResultPath = Join-Path $ResultDirectory (
    ".scheduler-result-" + [guid]::NewGuid().ToString("N") + ".json"
  )
  $ArgumentList = @(
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy", "Bypass",
    "-File", (Quote-ReminderArgument $RegisterScript),
    "-TaskName", (Quote-ReminderArgument $TaskName),
    "-NodePath", (Quote-ReminderArgument $Paths.NodePath),
    "-WorkerPath", (Quote-ReminderArgument $Paths.WorkerPath),
    "-RootPath", (Quote-ReminderArgument $Paths.RootPath),
    "-Time", (Quote-ReminderArgument $Time),
    "-OriginalUserSid", (Quote-ReminderArgument $OriginalUserSid),
    "-ResultPath", (Quote-ReminderArgument $ResultPath),
    "-Mode", (Quote-ReminderArgument $Mode)
  )
  if ($TransactionPath) {
    $ArgumentList += @('-TransactionPath', (Quote-ReminderArgument $TransactionPath))
  }
  if ($Reenable) { $ArgumentList += '-Reenable' }
  $ArgumentList = $ArgumentList -join ' '
  try {
    $Process = Start-Process -FilePath "powershell.exe" -ArgumentList $ArgumentList `
      -Verb RunAs -WindowStyle Hidden -Wait -PassThru
    if ($Process.ExitCode -ne 0) {
      switch ($Process.ExitCode) {
        2 { [Console]::Error.WriteLine("ANTHROPOLOGY_CANTEEN_SCHEDULER_UPDATE_FAILED_RESTORED") }
        3 { [Console]::Error.WriteLine("ANTHROPOLOGY_CANTEEN_SCHEDULER_ROLLBACK_FAILED") }
        5 { [Console]::Error.WriteLine("ANTHROPOLOGY_CANTEEN_SCHEDULER_PERMISSION_DENIED") }
        default { [Console]::Error.WriteLine("ANTHROPOLOGY_CANTEEN_SCHEDULER_ELEVATION_FAILED") }
      }
      exit $Process.ExitCode
    }
    if (-not (Test-Path -LiteralPath $ResultPath -PathType Leaf)) {
      throw "MISSING_TASK_RESULT"
    }
    $Result = Get-Content -LiteralPath $ResultPath -Raw -Encoding UTF8 | ConvertFrom-Json
    if (($Mode -eq 'Register' -and (-not $Result.definitionValid -or ($Reenable -and $Result.status -ne 'current'))) -or
        ($Mode -eq 'Restore' -and $Result.status -ne 'restored')) {
      throw "INVALID_TASK_RESULT"
    }
    $Result | ConvertTo-Json -Compress
  } finally {
    Remove-Item -LiteralPath $ResultPath -Force -ErrorAction SilentlyContinue
  }
} catch {
  $Detail = @(
    [string]$_.Exception.Message,
    [string]$_.FullyQualifiedErrorId,
    [string]$_.CategoryInfo.Category,
    [string]$_.Exception.HResult
  ) -join " "
  if ($Detail -match '(?i)cancel|canceled|cancelled|1223|-2147023673|InvalidOperation.*-2146233079') {
    [Console]::Error.WriteLine("ANTHROPOLOGY_CANTEEN_SCHEDULER_ELEVATION_CANCELLED")
    exit 6
  }
  [Console]::Error.WriteLine("ANTHROPOLOGY_CANTEEN_SCHEDULER_ELEVATION_FAILED")
  exit 1
}
