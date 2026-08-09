[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$PackageRoot,
  [Parameter(Mandatory = $true)][string]$ZipPath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$PackageRoot = [System.IO.Path]::GetFullPath($PackageRoot)
$ZipPath = [System.IO.Path]::GetFullPath($ZipPath)
if (-not (Test-Path -LiteralPath $PackageRoot -PathType Container) -or
    -not (Test-Path -LiteralPath $ZipPath -PathType Leaf)) {
  throw "Usage: smoke-test.ps1 -PackageRoot <folder> -ZipPath <zip>"
}
if (-not [System.Environment]::Is64BitOperatingSystem) {
  throw "The Windows portable smoke test requires Windows x64."
}

$TemporaryRoot = Join-Path (
  [System.IO.Path]::GetTempPath()
) ("anthropology-canteen-windows-smoke-" + [guid]::NewGuid().ToString("N"))
$ServerProcess = $null
$EntryProcessId = $null

function Test-ProcessAlive {
  param([Parameter(Mandatory = $true)][int]$ProcessId)
  return $null -ne (Get-Process -Id $ProcessId -ErrorAction SilentlyContinue)
}

function Stop-TestProcess {
  if ($null -ne $script:ServerProcess -and
      -not $script:ServerProcess.HasExited) {
    Stop-Process -Id $script:ServerProcess.Id -Force -ErrorAction SilentlyContinue
    $script:ServerProcess.WaitForExit(10000) | Out-Null
  }
  $script:ServerProcess = $null
}

function Wait-Ready {
  param([Parameter(Mandatory = $true)][string]$BaseUrl)
  for ($Attempt = 0; $Attempt -lt 90; $Attempt += 1) {
    try {
      $Status = Invoke-RestMethod -UseBasicParsing `
        -Uri "$BaseUrl/api/runtime-status" -TimeoutSec 2
      if ($Status.app -eq "anthropology-canteen") { return }
    } catch {
      Start-Sleep -Seconds 1
    }
  }
  throw "The portable server did not become ready."
}

function Start-TestServer {
  param(
    [Parameter(Mandatory = $true)][string]$Node,
    [Parameter(Mandatory = $true)][string]$Server,
    [Parameter(Mandatory = $true)][int]$Port,
    [switch]$AutoClose
  )
  $StartInfo = New-Object System.Diagnostics.ProcessStartInfo
  $StartInfo.FileName = $Node
  $StartInfo.Arguments = '"' + $Server + '"'
  if ($AutoClose) { $StartInfo.Arguments += " --auto-close" }
  $StartInfo.WorkingDirectory = Split-Path -Parent $Server
  $StartInfo.UseShellExecute = $false
  $StartInfo.CreateNoWindow = $true
  $StartInfo.WindowStyle = [System.Diagnostics.ProcessWindowStyle]::Hidden
  $StartInfo.EnvironmentVariables["PORT"] = [string]$Port
  $Process = New-Object System.Diagnostics.Process
  $Process.StartInfo = $StartInfo
  if (-not $Process.Start()) {
    throw "The portable server process could not start."
  }
  $script:ServerProcess = $Process
}

function Invoke-JsonPut {
  param(
    [Parameter(Mandatory = $true)][string]$Uri,
    [Parameter(Mandatory = $true)][object]$Body
  )
  return Invoke-RestMethod -UseBasicParsing -Uri $Uri -Method Put `
    -ContentType "application/json" -Body ($Body | ConvertTo-Json -Depth 100)
}

New-Item -ItemType Directory -Path $TemporaryRoot -Force | Out-Null
try {
  if (Test-Path -LiteralPath (Join-Path $PackageRoot "data")) {
    throw "The blank staging package already contains data."
  }

  Add-Type -AssemblyName System.IO.Compression.FileSystem
  Add-Type -AssemblyName System.Net.Http
  $Archive = [System.IO.Compression.ZipFile]::OpenRead($ZipPath)
  try {
    $Entries = @($Archive.Entries | ForEach-Object {
      $_.FullName.Replace('\', '/')
    })
  } finally {
    $Archive.Dispose()
  }
  $Roots = @($Entries | Where-Object { $_ } | ForEach-Object {
    ($_ -split '/')[0]
  } | Sort-Object -Unique)
  if ($Roots.Count -ne 1) { throw "ZIP does not have exactly one root directory." }
  $ProhibitedPattern = '(^|/)(data|node_modules|__MACOSX|\.DS_Store|\.env[^/]*|[^/]*settings[^/]*\.json|[^/]*\.pid|\.pnpm-store|\.next|\.vinext|\.wrangler)(/|$)'
  if ($null -ne ($Entries | Where-Object { $_ -match $ProhibitedPattern } | Select-Object -First 1)) {
    throw "ZIP contains a prohibited private or generated path."
  }

  $ShaPath = "$ZipPath.sha256"
  if (-not (Test-Path -LiteralPath $ShaPath -PathType Leaf)) {
    throw "The SHA-256 sidecar is missing."
  }
  $ExpectedHash = ((Get-Content -LiteralPath $ShaPath -Raw).Trim() -split '\s+')[0]
  $ActualHash = (Get-FileHash -LiteralPath $ZipPath -Algorithm SHA256).Hash
  if ($ExpectedHash.ToUpperInvariant() -ne $ActualHash) {
    throw "The ZIP SHA-256 does not match its sidecar."
  }

  $ExtractDirectory = Join-Path $TemporaryRoot "archive"
  Expand-Archive -LiteralPath $ZipPath -DestinationPath $ExtractDirectory
  $ExtractedRoot = Join-Path $ExtractDirectory $Roots[0]
  $Node = Join-Path $ExtractedRoot "runtime\node.exe"
  $Server = Join-Path $ExtractedRoot "portable-server.mjs"
  $Launcher = Join-Path $ExtractedRoot "Anthropology Canteen.vbs"
  foreach ($Required in @($Node, $Server, $Launcher)) {
    if (-not (Test-Path -LiteralPath $Required -PathType Leaf)) {
      throw "The extracted package is incomplete: $Required"
    }
  }
  if (Test-Path -LiteralPath (Join-Path $ExtractedRoot "data")) {
    throw "The blank extracted package already contains data."
  }
  if ((& $Node -p "process.arch").Trim() -ne "x64") {
    throw "The bundled Node.js runtime is not Windows x64."
  }
  if ((& $Node --version).Trim() -ne "v24.14.0") {
    throw "The bundled Node.js runtime version is not v24.14.0."
  }

  $EntryPort = Get-Random -Minimum 31000 -Maximum 39999
  $PreviousPort = $env:PORT
  $PreviousSkipOpen = $env:ANTHROPOLOGY_CANTEEN_SKIP_OPEN
  $env:PORT = [string]$EntryPort
  $env:ANTHROPOLOGY_CANTEEN_SKIP_OPEN = "1"
  try {
    & "$env:SystemRoot\System32\cscript.exe" //nologo $Launcher
    if ($LASTEXITCODE -ne 0) { throw "The VBS launcher returned an error." }
  } finally {
    $env:PORT = $PreviousPort
    $env:ANTHROPOLOGY_CANTEEN_SKIP_OPEN = $PreviousSkipOpen
  }
  $EntryUrl = "http://127.0.0.1:$EntryPort"
  Wait-Ready -BaseUrl $EntryUrl
  $EntryStatus = Invoke-RestMethod -UseBasicParsing `
    -Uri "$EntryUrl/api/runtime-status" -TimeoutSec 5
  if ($EntryStatus.autoClose -ne $true) {
    throw "The VBS launcher did not enable automatic shutdown."
  }
  $PidFile = Join-Path $ExtractedRoot "data\anthropology-canteen-server.pid"
  for ($Attempt = 0; $Attempt -lt 20 -and
      -not (Test-Path -LiteralPath $PidFile); $Attempt += 1) {
    Start-Sleep -Milliseconds 250
  }
  if (-not (Test-Path -LiteralPath $PidFile)) {
    throw "The VBS launcher did not create its PID file."
  }
  $EntryProcessId = [int](Get-Content -LiteralPath $PidFile -Raw).Trim()
  if (-not (Test-ProcessAlive -ProcessId $EntryProcessId)) {
    throw "The VBS launcher process is not alive."
  }
  Stop-Process -Id $EntryProcessId -Force
  for ($Attempt = 0; $Attempt -lt 40 -and
      (Test-ProcessAlive -ProcessId $EntryProcessId); $Attempt += 1) {
    Start-Sleep -Milliseconds 250
  }
  if (Test-ProcessAlive -ProcessId $EntryProcessId) {
    throw "The VBS launcher process did not stop."
  }
  $EntryProcessId = $null
  Remove-Item -LiteralPath (Join-Path $ExtractedRoot "data") -Recurse -Force

  $Port = Get-Random -Minimum 41000 -Maximum 49999
  $BaseUrl = "http://127.0.0.1:$Port"
  Start-TestServer -Node $Node -Server $Server -Port $Port
  Wait-Ready -BaseUrl $BaseUrl
  $HomeResponse = Invoke-WebRequest -UseBasicParsing `
    -Uri "$BaseUrl/" -TimeoutSec 5
  if ($HomeResponse.StatusCode -ne 200) {
    throw "The home page did not return HTTP 200."
  }
  $Blank = Invoke-RestMethod -UseBasicParsing -Uri "$BaseUrl/api/local-data"
  if ($Blank.version -ne 7 -or
      $Blank.subscriptions.journal.Count -ne 0 -or
      $Blank.subscriptions.scholar.Count -ne 0 -or
      $Blank.subscriptions.keyword.Count -ne 0) {
    throw "The first local-data response is not a blank version 7 structure."
  }
  $Blank.states | Add-Member -NotePropertyName "smoke-record" `
    -NotePropertyValue ([pscustomobject]@{ saved = $true }) -Force
  $Saved = Invoke-JsonPut -Uri "$BaseUrl/api/local-data" -Body $Blank
  if (-not $Saved.states.'smoke-record'.saved) { throw "Local-data PUT failed." }
  Stop-TestProcess

  Start-TestServer -Node $Node -Server $Server -Port $Port
  Wait-Ready -BaseUrl $BaseUrl
  $Persisted = Invoke-RestMethod -UseBasicParsing -Uri "$BaseUrl/api/local-data"
  if (-not $Persisted.states.'smoke-record'.saved) {
    throw "Local data did not persist after restart."
  }
  Stop-TestProcess

  Remove-Item -LiteralPath (Join-Path $ExtractedRoot "data") -Recurse -Force
  $AutoClosePort = Get-Random -Minimum 51000 -Maximum 59999
  $AutoCloseUrl = "http://127.0.0.1:$AutoClosePort"
  Start-TestServer -Node $Node -Server $Server -Port $AutoClosePort -AutoClose
  Wait-Ready -BaseUrl $AutoCloseUrl
  $HttpClient = New-Object System.Net.Http.HttpClient
  try {
    $Stream = $HttpClient.GetStreamAsync(
      "$AutoCloseUrl/api/browser-session"
    ).GetAwaiter().GetResult()
    Start-Sleep -Seconds 2
    $Stream.Dispose()
  } finally {
    $HttpClient.Dispose()
  }
  $ShutdownStarted = Get-Date
  for ($Attempt = 0; $Attempt -lt 20 -and
      -not $ServerProcess.HasExited; $Attempt += 1) {
    Start-Sleep -Seconds 1
    $ServerProcess.Refresh()
  }
  if (-not $ServerProcess.HasExited) {
    throw "The server did not stop after the final browser session closed."
  }
  $ShutdownSeconds = ((Get-Date) - $ShutdownStarted).TotalSeconds
  if ($ShutdownSeconds -lt 6 -or $ShutdownSeconds -gt 15) {
    throw "Automatic shutdown was not approximately eight seconds."
  }
  $ServerProcess = $null

  Write-Output "Windows x64 portable smoke test passed."
} finally {
  Stop-TestProcess
  if ($null -ne $EntryProcessId -and
      (Test-ProcessAlive -ProcessId $EntryProcessId)) {
    Stop-Process -Id $EntryProcessId -Force -ErrorAction SilentlyContinue
  }
  if (Test-Path -LiteralPath $TemporaryRoot) {
    Remove-Item -LiteralPath $TemporaryRoot -Recurse -Force
  }
}
