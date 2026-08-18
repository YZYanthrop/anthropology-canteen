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

$action = New-ScheduledTaskAction -Execute $NodePath -Argument "`"$WorkerPath`"" -WorkingDirectory $RootPath
$daily = New-ScheduledTaskTrigger -Daily -At ([datetime]::ParseExact($Time, "HH:mm", $null))
$logon = New-ScheduledTaskTrigger -AtLogOn
$settings = New-ScheduledTaskSettingsSet `
  -StartWhenAvailable `
  -MultipleInstances IgnoreNew `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 20) `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries
$principal = New-ScheduledTaskPrincipal `
  -UserId ([System.Security.Principal.WindowsIdentity]::GetCurrent().Name) `
  -LogonType Interactive `
  -RunLevel Limited

Register-ScheduledTask `
  -TaskName $TaskName `
  -Action $action `
  -Trigger $daily, $logon `
  -Settings $settings `
  -Principal $principal `
  -Force | Out-Null
