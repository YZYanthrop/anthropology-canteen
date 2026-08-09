# Platform support

## Support matrix

| Target | Status | Runtime | Launcher | Data location |
| --- | --- | --- | --- | --- |
| Windows x64 | Stable in v1.1.1 | bundled `node.exe` | VBS, with CMD diagnostics | extracted folder `data/` |
| macOS Apple Silicon | Unsigned beta; native CI passed, human validation pending | bundled `darwin-arm64` Node.js 24.14.0 | Finder command launcher and diagnostics | extracted folder `data/` |
| macOS Intel | Unsigned beta; native CI passed, human validation pending | bundled `darwin-x64` Node.js 24.14.0 | Finder command launcher and diagnostics | extracted folder `data/` |

The first macOS beta requires macOS 13.5 or newer, matching the minimum
supported version of the bundled Node.js 24.14.0 runtime. Older macOS releases
are not supported by these beta archives.

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

Windows behavior must remain unchanged when macOS support is added. The current
share package pins Node.js 24.14.0. Its hidden VBS launch uses `--auto-close`;
the diagnostic CMD intentionally does not.

## macOS layer

The macOS beta packaging layer provides:

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
