[CmdletBinding()]
param([Parameter(Mandatory = $true)][string]$TaskName)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
