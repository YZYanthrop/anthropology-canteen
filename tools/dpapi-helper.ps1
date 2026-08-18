[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidateSet("protect", "unprotect")]
  [string]$Mode
)

# The PowerShell Security module is not present in every portable Windows
# installation.  Call DPAPI directly instead, so the credential remains tied
# to the current Windows user and never needs to pass through a command line.
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

public static class AnthropologyCanteenDpapi {
    [StructLayout(LayoutKind.Sequential)]
    public struct DATA_BLOB {
        public int cbData;
        public IntPtr pbData;
    }

    [DllImport("Crypt32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    public static extern bool CryptProtectData(
        ref DATA_BLOB pDataIn,
        string szDataDescr,
        IntPtr pOptionalEntropy,
        IntPtr pvReserved,
        IntPtr pPromptStruct,
        int dwFlags,
        out DATA_BLOB pDataOut);

    [DllImport("Crypt32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    public static extern bool CryptUnprotectData(
        ref DATA_BLOB pDataIn,
        IntPtr ppszDataDescr,
        IntPtr pOptionalEntropy,
        IntPtr pvReserved,
        IntPtr pPromptStruct,
        int dwFlags,
        out DATA_BLOB pDataOut);

    [DllImport("Kernel32.dll")]
    public static extern IntPtr LocalFree(IntPtr hMem);
}
"@

function Convert-BytesToBlob([byte[]]$Bytes) {
  $Blob = New-Object AnthropologyCanteenDpapi+DATA_BLOB
  $Blob.cbData = $Bytes.Length
  $Blob.pbData = [Runtime.InteropServices.Marshal]::AllocHGlobal($Bytes.Length)
  [Runtime.InteropServices.Marshal]::Copy($Bytes, 0, $Blob.pbData, $Bytes.Length)
  return $Blob
}

function Convert-BlobToBytes($Blob) {
  if ($Blob.cbData -le 0 -or $Blob.pbData -eq [IntPtr]::Zero) { return [byte[]]@() }
  $Bytes = New-Object byte[] $Blob.cbData
  [Runtime.InteropServices.Marshal]::Copy($Blob.pbData, $Bytes, 0, $Blob.cbData)
  return $Bytes
}

$InputText = [Console]::In.ReadToEnd()
$InputBytes = [Text.Encoding]::UTF8.GetBytes($InputText)
$InputBlob = Convert-BytesToBlob $InputBytes
$OutputBlob = New-Object AnthropologyCanteenDpapi+DATA_BLOB
try {
  if ($Mode -eq "protect") {
    $Success = [AnthropologyCanteenDpapi]::CryptProtectData(
      [ref]$InputBlob,
      "Anthropology Canteen SMTP credential",
      [IntPtr]::Zero,
      [IntPtr]::Zero,
      [IntPtr]::Zero,
      0,
      [ref]$OutputBlob)
    if (-not $Success) { throw "Windows DPAPI encryption failed (error $([Runtime.InteropServices.Marshal]::GetLastWin32Error()))." }
    [Convert]::ToBase64String((Convert-BlobToBytes $OutputBlob))
  } else {
    $CipherBytes = [Convert]::FromBase64String($InputText.Trim())
    [Runtime.InteropServices.Marshal]::FreeHGlobal($InputBlob.pbData)
    $InputBlob = Convert-BytesToBlob $CipherBytes
    $Success = [AnthropologyCanteenDpapi]::CryptUnprotectData(
      [ref]$InputBlob,
      [IntPtr]::Zero,
      [IntPtr]::Zero,
      [IntPtr]::Zero,
      [IntPtr]::Zero,
      0,
      [ref]$OutputBlob)
    if (-not $Success) { throw "Windows DPAPI decryption failed (error $([Runtime.InteropServices.Marshal]::GetLastWin32Error()))." }
    [Text.Encoding]::UTF8.GetString((Convert-BlobToBytes $OutputBlob))
  }
} finally {
  if ($InputBlob.pbData -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::FreeHGlobal($InputBlob.pbData) }
  if ($OutputBlob.pbData -ne [IntPtr]::Zero) { [AnthropologyCanteenDpapi]::LocalFree($OutputBlob.pbData) | Out-Null }
}
