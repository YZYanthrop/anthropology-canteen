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
  $Importer = Join-Path $ExtractedRoot "tools\import-data.mjs"
  foreach ($Required in @($Node, $Server, $Launcher, $Importer)) {
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
  if ([System.IO.Path]::GetFullPath([string]$EntryStatus.packageRoot) -ne
      [System.IO.Path]::GetFullPath($ExtractedRoot)) {
    throw "The VBS launcher connected to a different extracted copy."
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
  if ($HomeResponse.Headers.'Cache-Control' -notmatch 'no-store') {
    throw "The portable HTML shell can be reused from an older browser cache."
  }
  $AssetPaths = @(
    [regex]::Matches($HomeResponse.Content, '(?:href|src)="(?<path>/assets/[^"]+)"') |
      ForEach-Object { $_.Groups['path'].Value } |
      Sort-Object -Unique
  )
  if ($AssetPaths.Count -lt 2) {
    throw "The home page did not reference its compiled CSS and JavaScript assets."
  }
  $SawCss = $false
  $SawJavaScript = $false
  foreach ($AssetPath in $AssetPaths) {
    $AssetResponse = Invoke-WebRequest -UseBasicParsing `
      -Uri "$BaseUrl$AssetPath" -TimeoutSec 5
    if ($AssetResponse.StatusCode -ne 200) {
      throw "A compiled page asset did not return HTTP 200: $AssetPath"
    }
    $AssetType = [string]$AssetResponse.Headers.'Content-Type'
    if ($AssetType -match '^text/css') { $SawCss = $true }
    if ($AssetType -match 'javascript') { $SawJavaScript = $true }
  }
  if (-not $SawCss -or -not $SawJavaScript) {
    throw "The final package did not serve both CSS and JavaScript assets."
  }
  $Blank = Invoke-RestMethod -UseBasicParsing -Uri "$BaseUrl/api/local-data"
  if ($Blank.version -ne 7 -or
      $Blank.subscriptions.journal.Count -ne 0 -or
      $Blank.subscriptions.scholar.Count -ne 0 -or
      $Blank.subscriptions.keyword.Count -ne 0) {
    throw "The first local-data response is not a blank version 7 structure."
  }
  $SiblingRoot = Join-Path $ExtractDirectory "Anthropology-Canteen-Windows-x64-v1.2.0"
  $SiblingData = Join-Path $SiblingRoot "data"
  New-Item -ItemType Directory -Path $SiblingData -Force | Out-Null
  [ordered]@{
    version = 7
    savedAt = "2026-08-17T00:00:00.000Z"
    subscriptions = [ordered]@{
      journal = @()
      scholar = @([ordered]@{
        label = "Migration Test Scholar"
        subscriptionId = "migration-test-scholar"
        followedAt = "2026-08-01T00:00:00.000Z"
      })
      keyword = @()
    }
    states = [ordered]@{}
    feed = $null
    translations = [ordered]@{}
    scholarProfiles = [ordered]@{}
  } | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath (
    Join-Path $SiblingData "anthropology-canteen-data.json"
  ) -Encoding UTF8
  $Migrated = Invoke-RestMethod -UseBasicParsing -Uri "$BaseUrl/api/local-data"
  if ($Migrated.subscriptions.scholar.Count -ne 1 -or
      $Migrated.subscriptions.scholar[0].label -ne "Migration Test Scholar") {
    throw "An already-created blank data file did not retry neighboring-version migration."
  }
  Remove-Item -LiteralPath $SiblingRoot -Recurse -Force
  $Blank = $Migrated
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

  $ImportSource = Join-Path $TemporaryRoot "old-data"
  $TargetData = Join-Path $ExtractedRoot "data"
  New-Item -ItemType Directory -Path $ImportSource -Force | Out-Null
  $ImportData = [ordered]@{
    version = 7
    subscriptions = [ordered]@{ journal = @(); scholar = @(); keyword = @() }
    states = [ordered]@{ "imported-record" = [ordered]@{ read = $true } }
  }
  $ImportSettings = [ordered]@{
    version = 3
    openAlexApiKey = "smoke-openalex-key"
    semanticScholarApiKey = ""
    reminders = [ordered]@{
      installationId = "windows-smoke-reminder-id"
      provider = "qq"
      sender = "sender@example.com"
      recipient = "recipient@example.com"
    }
  }
  $ImportData | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath (
    Join-Path $ImportSource "anthropology-canteen-data.json"
  ) -Encoding UTF8
  $ImportSettings | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath (
    Join-Path $ImportSource "anthropology-canteen-settings.json"
  ) -Encoding UTF8
  [ordered]@{
    version = 1
    baselines = [ordered]@{}
    items = [ordered]@{}
  } | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath (
    Join-Path $ImportSource "anthropology-canteen-reminder-state.json"
  ) -Encoding UTF8
  [ordered]@{
    version = 1
    ciphertext = "smoke-dpapi-ciphertext"
  } | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath (
    Join-Path $ImportSource "anthropology-canteen-reminder-secret.json"
  ) -Encoding UTF8
  '{"version":2,"openAlexApiKey":"original-key"}' | Set-Content `
    -LiteralPath (Join-Path $TargetData "anthropology-canteen-settings.json") `
    -Encoding UTF8

  & $Node $Importer --source $ImportSource --target-root $ExtractedRoot
  if ($LASTEXITCODE -ne 0) { throw "The packaged data importer failed." }
  $ImportedData = Get-Content -LiteralPath (
    Join-Path $TargetData "anthropology-canteen-data.json"
  ) -Raw | ConvertFrom-Json
  $ImportedSettings = Get-Content -LiteralPath (
    Join-Path $TargetData "anthropology-canteen-settings.json"
  ) -Raw | ConvertFrom-Json
  $ImportedReminderState = Get-Content -LiteralPath (
    Join-Path $TargetData "anthropology-canteen-reminder-state.json"
  ) -Raw | ConvertFrom-Json
  $ImportedReminderSecret = Get-Content -LiteralPath (
    Join-Path $TargetData "anthropology-canteen-reminder-secret.json"
  ) -Raw | ConvertFrom-Json
  if (-not $ImportedData.states.'imported-record'.read -or
      $ImportedSettings.openAlexApiKey -ne "smoke-openalex-key" -or
      $ImportedSettings.reminders.installationId -ne "windows-smoke-reminder-id" -or
      $ImportedReminderState.version -ne 1 -or
      $ImportedReminderSecret.ciphertext -ne "smoke-dpapi-ciphertext") {
    throw "The packaged data importer did not install validated files."
  }
  if ($null -eq (Get-ChildItem -LiteralPath $TargetData -File | Where-Object {
        $_.Name -like "anthropology-canteen-data.backup-*.json"
      } | Select-Object -First 1) -or
      $null -eq (Get-ChildItem -LiteralPath $TargetData -File | Where-Object {
        $_.Name -like "anthropology-canteen-settings.backup-*.json"
      } | Select-Object -First 1)) {
    throw "The packaged data importer did not back up existing files."
  }

  $ImportedDataText = Get-Content -LiteralPath (
    Join-Path $TargetData "anthropology-canteen-data.json"
  ) -Raw
  "not-json" | Set-Content -LiteralPath (
    Join-Path $ImportSource "anthropology-canteen-settings.json"
  ) -Encoding UTF8
  & $Node $Importer --source $ImportSource --target-root $ExtractedRoot
  $RejectedImportExitCode = $LASTEXITCODE
  if ($RejectedImportExitCode -ne 1) {
    throw "The packaged data importer returned unexpected exit code $RejectedImportExitCode for invalid settings."
  }
  # This non-zero exit is the expected result of the negative import probe.
  # Clear it after the rejection assertion so pwsh does not report a false
  # failure after the remaining PowerShell-only checks complete successfully.
  $global:LASTEXITCODE = 0
  if ((Get-Content -LiteralPath (
        Join-Path $TargetData "anthropology-canteen-data.json"
      ) -Raw) -ne $ImportedDataText) {
    throw "A failed packaged import changed existing data."
  }

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
