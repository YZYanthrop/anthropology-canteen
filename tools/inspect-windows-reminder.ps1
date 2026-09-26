[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$TaskName,
  [Parameter(Mandatory = $true)][string]$NodePath,
  [Parameter(Mandatory = $true)][string]$WorkerPath,
  [Parameter(Mandatory = $true)][string]$RootPath,
  [Parameter(Mandatory = $true)][string]$Time
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "windows-reminder-task-common.ps1")

try {
  $Paths = Assert-ReminderTaskArguments @PSBoundParameters
  $CurrentSid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
  $Inspection = Get-ReminderTaskInspection -TaskName $TaskName `
    -NodePath $Paths.NodePath -WorkerPath $Paths.WorkerPath `
    -RootPath $Paths.RootPath -Time $Time -ExpectedUserSid $CurrentSid
  $Inspection | ConvertTo-Json -Compress
} catch {
  $Detail = @(
    [string]$_.Exception.Message,
    [string]$_.FullyQualifiedErrorId,
    [string]$_.CategoryInfo.Reason,
    [string]$_.Exception.HResult
  ) -join " "
  if ($Detail -match '(?i)access\s*denied|permissiondenied|unauthorized|0x80070005|0x80041003|-2147024891') {
    [Console]::Error.WriteLine("ANTHROPOLOGY_CANTEEN_SCHEDULER_PERMISSION_DENIED")
    exit 5
  }
  [Console]::Error.WriteLine("ANTHROPOLOGY_CANTEEN_SCHEDULER_INSPECTION_FAILED")
  exit 1
}
