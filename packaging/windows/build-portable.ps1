[CmdletBinding()]
param(
  [string]$OutputDirectory
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$NodeVersion = "24.14.0"
$ScriptDirectory = Split-Path -Parent $PSCommandPath
$RepositoryRoot = [System.IO.Path]::GetFullPath(
  (Join-Path $ScriptDirectory "..\..")
)

if (-not [System.Environment]::Is64BitOperatingSystem) {
  throw "Windows x64 packages must be built and tested on a 64-bit Windows runner."
}

if ([string]::IsNullOrWhiteSpace($OutputDirectory)) {
  $OutputDirectory = Join-Path $RepositoryRoot "outputs"
} elseif (-not [System.IO.Path]::IsPathRooted($OutputDirectory)) {
  $OutputDirectory = Join-Path $RepositoryRoot $OutputDirectory
}
$OutputDirectory = [System.IO.Path]::GetFullPath($OutputDirectory)

$ClientBuild = Join-Path $RepositoryRoot "dist\client"
$ServerBuild = Join-Path $RepositoryRoot "dist\server"
if (-not (Test-Path -LiteralPath $ClientBuild -PathType Container) -or
    -not (Test-Path -LiteralPath $ServerBuild -PathType Container)) {
  throw "Run pnpm build before packaging."
}

$PackageMetadata = Get-Content -LiteralPath (
  Join-Path $RepositoryRoot "package.json"
) -Raw -Encoding UTF8 | ConvertFrom-Json
$ProductVersion = [string]$PackageMetadata.version
if ($ProductVersion -notmatch '^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$') {
  throw "package.json contains an invalid product version."
}

$RootName = "Anthropology-Canteen-Windows-x64-v$ProductVersion"
$StageRoot = Join-Path $OutputDirectory $RootName
$ZipPath = Join-Path $OutputDirectory "$RootName.zip"
$ShaPath = "$ZipPath.sha256"
$WorkRoot = Join-Path (
  [System.IO.Path]::GetTempPath()
) ("anthropology-canteen-windows-" + [guid]::NewGuid().ToString("N"))

function Assert-ChildPath {
  param(
    [Parameter(Mandatory = $true)][string]$Parent,
    [Parameter(Mandatory = $true)][string]$Child
  )
  $Separator = [System.IO.Path]::DirectorySeparatorChar
  $Prefix = $Parent.TrimEnd($Separator) + $Separator
  if (-not $Child.StartsWith(
    $Prefix,
    [System.StringComparison]::OrdinalIgnoreCase
  )) {
    throw "Refusing to modify a path outside the selected output directory."
  }
}

function Write-Utf8WithoutBom {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$Value
  )
  $Encoding = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($Path, $Value, $Encoding)
}

function Invoke-Download {
  param(
    [Parameter(Mandatory = $true)][string]$Uri,
    [Parameter(Mandatory = $true)][string]$Destination,
    [int]$TimeoutSeconds = 300
  )

  $LastError = $null
  for ($Attempt = 1; $Attempt -le 3; $Attempt += 1) {
    try {
      Invoke-WebRequest -UseBasicParsing -Uri $Uri -OutFile $Destination `
        -TimeoutSec $TimeoutSeconds
      return
    } catch {
      $LastError = $_
      Remove-Item -LiteralPath $Destination -Force -ErrorAction SilentlyContinue
      if ($Attempt -lt 3) { Start-Sleep -Seconds 2 }
    }
  }
  throw $LastError
}

function Assert-BlankPortableTree {
  param([Parameter(Mandatory = $true)][string]$Root)

  $ProhibitedDirectoryNames = @(
    "data", "node_modules", "__MACOSX", ".pnpm-store", ".next",
    ".vinext", ".wrangler"
  )
  $Prohibited = Get-ChildItem -LiteralPath $Root -Recurse -Force | Where-Object {
    ($_.PSIsContainer -and $ProhibitedDirectoryNames -contains $_.Name) -or
    (-not $_.PSIsContainer -and (
      $_.Name -eq ".DS_Store" -or
      $_.Name -like ".env*" -or
      $_.Name -like "*settings*.json" -or
      $_.Name -like "*.pid"
    )) -or
    (($_.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0)
  } | Select-Object -First 1
  if ($null -ne $Prohibited) {
    throw "A prohibited generated, private, or linked path entered the staging folder: $($Prohibited.FullName)"
  }

  $TextExtensions = @(
    ".txt", ".md", ".cmd", ".vbs", ".mjs", ".js", ".json", ".css", ".html"
  )
  foreach ($File in Get-ChildItem -LiteralPath $Root -Recurse -File -Force) {
    if ($TextExtensions -notcontains $File.Extension.ToLowerInvariant()) { continue }
    $Text = Get-Content -LiteralPath $File.FullName -Raw -ErrorAction Stop
    if ($Text -match '[A-Za-z]:\\Users\\[^\\]+' -or $Text -match '/Users/[^/]+') {
      throw "A personal absolute path entered the staging folder: $($File.FullName)"
    }
  }
}

Assert-ChildPath -Parent $OutputDirectory -Child $StageRoot
Assert-ChildPath -Parent $OutputDirectory -Child $ZipPath
Assert-ChildPath -Parent $OutputDirectory -Child $ShaPath
New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
if (Test-Path -LiteralPath $StageRoot) {
  Remove-Item -LiteralPath $StageRoot -Recurse -Force
}
foreach ($OldOutput in @($ZipPath, $ShaPath)) {
  Remove-Item -LiteralPath $OldOutput -Force -ErrorAction SilentlyContinue
}
New-Item -ItemType Directory -Path $WorkRoot -Force | Out-Null

try {
  $NodeArchiveName = "node-v$NodeVersion-win-x64.zip"
  $NodeBaseUrl = "https://nodejs.org/dist/v$NodeVersion"
  $NodeArchivePath = Join-Path $WorkRoot $NodeArchiveName
  $ChecksumPath = Join-Path $WorkRoot "SHASUMS256.txt"
  Invoke-Download -Uri "$NodeBaseUrl/$NodeArchiveName" `
    -Destination $NodeArchivePath
  Invoke-Download -Uri "$NodeBaseUrl/SHASUMS256.txt" `
    -Destination $ChecksumPath -TimeoutSeconds 60

  $ChecksumPattern = '^(?<hash>[0-9a-fA-F]{64})\s+\*?' +
    [regex]::Escape($NodeArchiveName) + '$'
  $ExpectedHash = $null
  foreach ($Line in Get-Content -LiteralPath $ChecksumPath) {
    if ($Line -match $ChecksumPattern) {
      $ExpectedHash = $Matches.hash.ToUpperInvariant()
      break
    }
  }
  $ActualHash = (Get-FileHash -LiteralPath $NodeArchivePath -Algorithm SHA256).Hash
  if ([string]::IsNullOrWhiteSpace($ExpectedHash) -or
      $ActualHash -ne $ExpectedHash) {
    throw "Node.js runtime checksum verification failed."
  }

  Expand-Archive -LiteralPath $NodeArchivePath -DestinationPath $WorkRoot
  $NodeRoot = Join-Path $WorkRoot "node-v$NodeVersion-win-x64"
  foreach ($Directory in @("runtime", "tools")) {
    New-Item -ItemType Directory -Path (
      Join-Path $StageRoot $Directory
    ) -Force | Out-Null
  }

  Copy-Item -LiteralPath (Join-Path $RepositoryRoot "dist") `
    -Destination $StageRoot -Recurse
  foreach ($Name in @(
    "portable-server.mjs", "Anthropology Canteen.vbs", "start-local.cmd",
    "import-data-from-old-version.cmd", "LICENSE"
  )) {
    Copy-Item -LiteralPath (Join-Path $RepositoryRoot $Name) `
      -Destination (Join-Path $StageRoot $Name)
  }
  Copy-Item -LiteralPath (Join-Path $ScriptDirectory "RUNTIME-NOTICE.txt") `
    -Destination (Join-Path $StageRoot "RUNTIME-NOTICE.txt")
  Copy-Item -LiteralPath (
    Join-Path $RepositoryRoot "packaging\shared\import-data.mjs"
  ) -Destination (Join-Path $StageRoot "tools\import-data.mjs")
  Copy-Item -LiteralPath (Join-Path $NodeRoot "node.exe") `
    -Destination (Join-Path $StageRoot "runtime\node.exe")
  Copy-Item -LiteralPath (Join-Path $NodeRoot "LICENSE") `
    -Destination (Join-Path $StageRoot "runtime\LICENSE")

  $ReadmeTemplate = Get-Content -LiteralPath (
    Join-Path $ScriptDirectory "README-Windows.txt"
  ) -Raw -Encoding UTF8
  $Readme = $ReadmeTemplate.Replace("@PRODUCT_VERSION@", $ProductVersion)
  Write-Utf8WithoutBom -Path (Join-Path $StageRoot "README-Windows.txt") `
    -Value $Readme

  Assert-BlankPortableTree -Root $StageRoot
  Compress-Archive -LiteralPath $StageRoot -DestinationPath $ZipPath `
    -CompressionLevel Optimal
  $ArchiveHash = (Get-FileHash -LiteralPath $ZipPath -Algorithm SHA256).Hash
  Write-Utf8WithoutBom -Path $ShaPath `
    -Value "$ArchiveHash  $([System.IO.Path]::GetFileName($ZipPath))`n"

  Write-Output "Created $ZipPath"
  Write-Output "Created $ShaPath"
} finally {
  if (Test-Path -LiteralPath $WorkRoot) {
    Remove-Item -LiteralPath $WorkRoot -Recurse -Force
  }
}
