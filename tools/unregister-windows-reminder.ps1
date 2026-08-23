[CmdletBinding()]
param([Parameter(Mandatory = $true)][string]$TaskName)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
try {
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction Stop
} catch {
  $detail = @(
    [string]$_.Exception.Message,
    [string]$_.FullyQualifiedErrorId
  ) -join " "
  if ($detail -match '(?i)no MSFT_ScheduledTask objects found|CmdletizationQuery_NotFound|ObjectNotFound') {
    exit 0
  }
  throw
}
