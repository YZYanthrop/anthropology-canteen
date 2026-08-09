# Platform support

## Support matrix

| Target | Status | Runtime | Launcher | Data location |
| --- | --- | --- | --- | --- |
| Windows x64 | Stable in v1.1.1 | bundled `node.exe` | VBS, with CMD diagnostics | extracted folder `data/` |
| macOS Apple Silicon | Unsigned beta published; native CI and M2 human validation passed | bundled `darwin-arm64` Node.js 24.14.0 | Finder command launcher and diagnostics | extracted folder `data/` |
| macOS Intel | Unsigned beta published; native CI passed, human validation pending | bundled `darwin-x64` Node.js 24.14.0 | Finder command launcher and diagnostics | extracted folder `data/` |

The first macOS beta requires macOS 13.5 or newer, matching the minimum
supported version of the bundled Node.js 24.14.0 runtime. Older macOS releases
are not supported by these beta archives.

## v1.2.0 release candidate

Version 1.2.0 is prepared in the repository but is not yet public. Its Windows
x64, macOS Apple Silicon arm64, and macOS Intel x64 targets share one source
commit, one `package.json` version, one compiled application, and the same local
data/settings formats. The current public support statuses in the table above
remain unchanged until an authorized publication task creates the `v1.2.0` tag
and GitHub Release.

The candidate's unified workflow is build-only. A normal version tag builds and
tests all three targets on native runners; manual dispatch can rerun an existing
normal tag. It may upload temporary workflow artifacts and SHA-256 files, but it
must not create or move tags, create a GitHub Release, sign, notarize, or publish
files.

The v1.2.0 candidate does not change data schema version 7 or API-key settings
schema version 2. Existing v1.1.1 data remains compatible on every target.

## Shared files

The following must remain identical across platforms:

- `app/`
- `portable-server.mjs`, except for shared cross-platform options
- compiled `dist/`
- data and settings schemas
- provider behavior and regression tests
- version number and user-visible feature set

## Windows layer

Current Windows-only files:

- `Anthropology Canteen.vbs`
- `start-local.cmd`
- `import-data-from-old-version.cmd`
- packaged `runtime/node.exe`

`packaging/windows/` assembles the versioned x64 ZIP from the shared build,
downloads and checksum-verifies the pinned runtime, and smoke-tests the final
archive rather than the staging directory.

Windows behavior remains unchanged in the v1.2.0 candidate. The current share
package pins Node.js 24.14.0. Its hidden VBS launch uses `--auto-close`; the
diagnostic CMD intentionally does not.

## macOS layer

The macOS packaging layer, first validated by the v1.1.1 beta, provides:

- architecture-specific packages with a Finder-double-clickable command that
  starts the bundled Node.js in the background, waits for
  `/api/runtime-status`, and opens the default browser;
- a diagnostic launcher when the background launch fails;
- an old-version data import helper that copies only the approved local data
  files and never overwrites newer data silently;
- packaging scripts that preserve executable permissions;
- Apple Silicon and Intel native smoke tests in GitHub Actions.

The Mac runtime should initially pin Node.js 24.14.0 to match Windows and ship
the same Node license/notice obligations. Auto-close parity means a 90-second
startup timeout when no browser session connects and shutdown about eight
seconds after the final SSE browser session closes. The diagnostic path may
remain foreground-running.

The Mac import helper must validate the chosen JSON, back up existing local
data, and copy settings only when they are present beside the selected data.

The recommended `.command` briefly shows Terminal; the diagnostic command stays
in Terminal intentionally. The unsigned beta intentionally has no `.app`
wrapper because App Translocation may separate a downloaded app from the
sibling runtime and compiled files it needs. Documentation explains approval
of the specific downloaded item and never recommends disabling Gatekeeper or
system-wide security.

## Artifact rules

- Every platform archive begins with one versioned root directory.
- A share archive contains no `data/`, `.env`, API key, personal path,
  `node_modules`, package-manager store, source cache, or old generated output.
- Final artifact names include the product version and target architecture.
- Windows and macOS artifacts for a normal release come from the same commit
  and tag.
- A normal tag run and a manual rerun of that tag use the same build definitions;
  neither path publishes a GitHub Release automatically.
- The one-time `macos-v1.1.1-beta.1` bootstrap tag is an explicit exception:
  it leaves the formal `v1.1.1` tag untouched and must also rerun the Windows
  regression suite before publishing Mac beta artifacts.
- The release process records a SHA-256 digest for every published artifact.

## Validation limits

GitHub-hosted macOS runners can verify native execution, architecture,
permissions, HTTP endpoints, persistence, shutdown, and archive contents. They
cannot fully replace a person's first-launch Finder, Gatekeeper, default-browser,
and visual-font experience. The first beta requires one real Apple Silicon user
test; an Intel user test is strongly preferred before calling Intel stable.

The first native matrix run, GitHub Actions
[#31290870084](https://github.com/YZYanthrop/anthropology-canteen/actions/runs/31290870084),
passed the Windows regression, Apple Silicon package/smoke job, and Intel
package/smoke job on 2026-08-09.

An Apple Silicon M2 user subsequently confirmed that the unsigned portable
beta could be launched and used normally. The packages were published under
the immutable bootstrap tag `macos-v1.1.1-beta.1` in the
[macOS v1.1.1 Beta 1 Pre-release](https://github.com/YZYanthrop/anthropology-canteen/releases/tag/macos-v1.1.1-beta.1).
An Intel human test remains recommended and is not yet recorded.
