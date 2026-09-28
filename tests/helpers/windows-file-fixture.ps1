param(
  [Parameter(Mandatory = $true)][string]$FixtureRoot,
  [Parameter(Mandatory = $true)][string]$Target,
  [Parameter(Mandatory = $true)][ValidateSet('Lock', 'DenyList', 'AllowList', 'DenyRead', 'AllowRead')][string]$Mode
)
$ErrorActionPreference = 'Stop'
$FixtureRoot = [IO.Path]::GetFullPath($FixtureRoot).TrimEnd('\')
$Target = [IO.Path]::GetFullPath($Target).TrimEnd('\')
$TempPrefix = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
if (-not $FixtureRoot.StartsWith($TempPrefix, [StringComparison]::OrdinalIgnoreCase) -or
    [IO.Path]::GetFileName($FixtureRoot) -notmatch '^canteen-(migration|discovery)-' -or
    ($Target -ne $FixtureRoot -and -not $Target.StartsWith($FixtureRoot + '\', [StringComparison]::OrdinalIgnoreCase))) {
  throw 'Refusing filesystem fixture outside unique temporary directory'
}
if ($Mode -eq 'Lock') {
  $Handle = [IO.File]::Open($Target, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
  try { [Console]::Out.WriteLine('ready'); [Console]::Out.Flush(); [Console]::In.ReadLine() | Out-Null }
  finally { $Handle.Dispose() }
  exit
}
$Sid = [Security.Principal.WindowsIdentity]::GetCurrent().User
$Rights = if ($Mode -in @('DenyList', 'AllowList')) { [Security.AccessControl.FileSystemRights]::ListDirectory } else { [Security.AccessControl.FileSystemRights]::ReadData }
$Rule = [Security.AccessControl.FileSystemAccessRule]::new($Sid, $Rights, [Security.AccessControl.InheritanceFlags]::None, [Security.AccessControl.PropagationFlags]::None, [Security.AccessControl.AccessControlType]::Deny)
$IsDirectory = $Mode -in @('DenyList', 'AllowList')
$Acl = if ($IsDirectory) { [IO.Directory]::GetAccessControl($Target) } else { [IO.File]::GetAccessControl($Target) }
if ($Mode.StartsWith('Deny')) { $Acl.AddAccessRule($Rule) } else { $Acl.RemoveAccessRuleSpecific($Rule) }
if ($IsDirectory) { [IO.Directory]::SetAccessControl($Target, $Acl) } else { [IO.File]::SetAccessControl($Target, $Acl) }
