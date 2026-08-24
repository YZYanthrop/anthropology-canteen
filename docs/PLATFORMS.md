# Platform support

## Support matrix

| Target | Status | Runtime | Launcher | Data location |
| --- | --- | --- | --- | --- |
| Windows x64 | v1.3.2 released; native package and reminder smoke passed | bundled `node.exe` | VBS, with CMD diagnostics | extracted folder `data/` |
| macOS Apple Silicon | v1.3.2 released; unsigned native package and reminder smoke passed | bundled `darwin-arm64` Node.js 24.14.0 | Finder command launcher and diagnostics | extracted folder `data/` |
| macOS Intel | v1.3.2 released; unsigned native package and reminder smoke passed | bundled `darwin-x64` Node.js 24.14.0 | Finder command launcher and diagnostics | extracted folder `data/` |

The local v1.3.2 Windows trial package was built on 2026-08-23. Its extracted
final-package smoke passed archive privacy, checksum, VBS launch, compiled
assets, neighboring migration, restart persistence, transactional import,
subscription and complete reminder-file preservation, DPAPI decryptability,
offline reminder worker, and automatic close. This desktop session could not
register the temporary current-user smoke task (`Access is denied`). The user
later completed the native manual check on Windows by running `start-local.cmd`
once as administrator: the task registered, step 3 turned green, and the
immediate check email arrived. The earlier ZIP remains a local trial artifact,
not a final release package.

The v1.3.2 Windows registration follow-up changes activation to register the
task before the first check. Permission failures therefore cannot send a
one-time message or leave an enabled config/marker. `PermissionDenied`,
`Access is denied`, and `0x80070005` are reduced to a path-free Chinese hint:
close all app pages, wait about 10 seconds, then right-click `start-local.cmd`
and run it once as administrator before retrying registration or migration.
The task principal remains the current user with `RunLevel Limited`; normal
launches do not need elevation. The UI is active only when step 3 is green and
shows “后台提醒已开启”, and a check with no new articles sends no mail.

The v1.3.2 pre-tag candidate and formal immutable-tag run came from frozen
commit `f89936b8e4854928142fb028de869794639fed3d`. Candidate run
[#32683536380](https://github.com/YZYanthrop/anthropology-canteen/actions/runs/32683536380)
and tag run
[#32687638516](https://github.com/YZYanthrop/anthropology-canteen/actions/runs/32687638516)
passed Windows x64 and both native macOS architectures. Only the formal tag
artifacts were published; existing local trial and candidate ZIPs were excluded.

The macOS v1.3.2 packages require macOS 13.5 or newer, matching the minimum
supported version of the bundled Node.js 24.14.0 runtime. Older macOS releases
are not supported by these portable archives.

## v1.3.0 local reminder capability

The v1.3.0 release adds an optional local reminder worker. Windows uses a
current-user Task Scheduler task and macOS uses a per-user LaunchAgent. Both
invoke the same one-shot worker once per day; the worker decides whether a
weekly or monthly digest is due. `RunAtLoad`/`StartWhenAvailable` provide a
best-effort catch-up after login or wake, but a powered-off or offline computer
cannot send on time. The web page and server still close normally after the
last browser page is closed.

SMTP authorization codes never enter browser responses, logs, process
arguments, or archives. Windows stores encrypted DPAPI ciphertext in `data/`;
macOS stores the secret in Keychain. Outlook/Hotmail/Live are supported as
recipients; v1.3.0 does not implement Outlook sender OAuth.

## v1.3.1 compatibility

The v1.3.1 release keeps the same Windows x64 and macOS arm64/x64 launchers,
bundled runtime, folder-local storage, secure credential stores, and current-user
schedulers. Main data is upgraded to version 8 and reminder state to version 2;
the shared importer accepts the previous version 7 data and version 1 reminder
state. Native package smoke obtains the per-process session token before
reading or writing protected local APIs and must still verify blank archives,
neighbor migration, persistence, reminders and automatic shutdown.

## v1.2.0 unified release

Version 1.2.0 publishes Windows x64, macOS Apple Silicon arm64, and macOS Intel
x64 from one source commit, one `package.json` version, one compiled application,
and the same local data/settings formats in the
[public v1.2.0 Release](https://github.com/YZYanthrop/anthropology-canteen/releases/tag/v1.2.0).

The unified workflow is build-only. A normal version tag builds and
tests all three targets on native runners; manual dispatch can rerun an existing
normal tag. It may upload temporary workflow artifacts and SHA-256 files, but it
must not create or move tags, create a GitHub Release, sign, notarize, or publish
files.

v1.2.0 does not change data schema version 7 or API-key settings
schema version 2. Existing v1.1.1 data remains compatible on every target.

## v1.3.0 native release validation

The v1.3.0 workflow keeps the same build-only publication boundary. Before the
immutable tag is created, a manual `candidate_sha` run may build and test the
exact final `main` commit on all native runners. The normal tag push then
rebuilds from `refs/tags/v1.3.0`; a manual `tag` input is reserved for rerunning
an existing immutable tag. Exactly one source selector is accepted.

The final-package smoke tests exercise Windows DPAPI and current-user Task
Scheduler registration, macOS Keychain and per-user LaunchAgent registration,
and an offline reminder worker run. All temporary credentials, scheduler
entries, plist files, and reminder state are removed before each job ends.

## Shared files

The following must remain identical across platforms:

- `app/`
- `portable-server.mjs`, except for shared cross-platform options
- `reminder-worker.mjs`, `reminder-mail.mjs`, `reminder-utils.mjs`, and
  `reminder-scheduler.mjs`
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
- `tools/register-windows-reminder.ps1`, `tools/unregister-windows-reminder.ps1`,
  and `tools/dpapi-helper.ps1`

`packaging/windows/` assembles the versioned x64 ZIP from the shared build,
downloads and checksum-verifies the pinned runtime, and smoke-tests the final
archive rather than the staging directory.

The Windows import launcher calls the same
`packaging/shared/import-data.mjs` transaction used by macOS. The final-package
smoke test verifies validated data/settings import, backups, and that invalid
settings cannot partially replace existing data.

Windows launch and persistence behavior remains unchanged in v1.2.0. The share
package pins Node.js 24.14.0. Its hidden VBS launch uses `--auto-close`; the
diagnostic CMD intentionally does not.

For v1.3.0, Windows and macOS launchers append a per-launch query value to the
friendly localhost URL. Together with non-cacheable HTML responses, this keeps
a browser from displaying an older unstyled shell after a portable upgrade.
The Windows final-package smoke test requests the actual compiled CSS and
JavaScript and verifies a late neighboring-data migration after a blank first
launch.
Launchers also compare the running server's package root with their own folder.
If an older extracted copy is still using the default port, the current copy
selects a later local port instead of silently opening the older program.

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
- a small Swift Keychain helper used by the optional reminder worker; the
  helper receives a secret through stdin rather than command-line arguments.

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
- A share archive contains no SMTP credential, reminder state, scheduler plist,
  Task Scheduler registration, or email address.
- Final artifact names include the product version and target architecture.
- Windows and macOS artifacts for a normal release come from the same commit
  and tag.
- Normally, a tag run and a manual rerun use the same build definitions, and
  neither path publishes a GitHub Release automatically. A pre-tag
  `candidate_sha` run is an explicit safety gate; it builds the exact final
  commit before a normal tag exists, while the formal tag run remains the only
  source of publishable attachments. The documented
  `v1.2.0` harness-only remediation is narrower: the manual run uses the reviewed
  `main` workflow solely to launch the old tagged Windows smoke in an independent
  PowerShell process, while all application, packaging, runtime, and archive
  inputs are checked out from the immutable tag commit `aa8e3a25dcbe59cd57b83ecd94898efd343d36d0`.
- The one-time `macos-v1.1.1-beta.1` bootstrap tag is an explicit exception:
  it leaves the formal `v1.1.1` tag untouched and must also rerun the Windows
  regression suite before publishing Mac beta artifacts.
- The release process records a SHA-256 digest for every published artifact.
- v1.3.0 is published from tag commit `218d1d75f4f82eadbb991f637f562aec6cc57bb9`.
  The formal native run [#32140570991](https://github.com/YZYanthrop/anthropology-canteen/actions/runs/32140570991)
  passed all six jobs; the public Release lists the three platform ZIP sizes
  and SHA-256 values.
- v1.3.1 is published from tag commit `7695e3a2e2620aa28c78958f9547d9e06f63e6f4`.
  The formal native run [#32341349020](https://github.com/YZYanthrop/anthropology-canteen/actions/runs/32341349020)
  passed all six jobs; the public Release lists the three platform ZIP sizes
  and SHA-256 values.
- v1.3.2 is published from tag commit `f89936b8e4854928142fb028de869794639fed3d`.
  The formal native run [#32687638516](https://github.com/YZYanthrop/anthropology-canteen/actions/runs/32687638516)
  passed all six jobs. Public downloads from the
  [v1.3.2 Release](https://github.com/YZYanthrop/anthropology-canteen/releases/tag/v1.3.2)
  matched their sidecars: Windows x64 43,294,718 bytes
  (`9F51687B1B750614FB3547A4F5C5626DAD263ED43DD6D200F980FCD4D9D08D95`),
  macOS arm64 46,512,921 bytes
  (`0BF239A5871E5CFDE15B56546362F27D5110D94AB8AA24EFEAC6E3AFF87AC960`),
  and macOS x64 47,717,149 bytes
  (`7E54A8EE4652A00F8E0A21C9A4175E645F90CC9CB36FCBA1628E3A670AE472A6`).

## Validation limits

GitHub-hosted macOS runners can verify native execution, architecture,
permissions, HTTP endpoints, persistence, shutdown, and archive contents. They
cannot fully replace a person's first-launch Finder, Gatekeeper, default-browser,
and visual-font experience. The first beta requires one real Apple Silicon user
test; an Intel user test is strongly preferred before calling Intel stable.

The formal v1.2.0 remediation run, GitHub Actions
[#31305111585](https://github.com/YZYanthrop/anthropology-canteen/actions/runs/31305111585),
passed shared verification, Windows x64 package/smoke, native Apple Silicon
package/smoke, native Intel package/smoke, and the clean source archive. All
three public product ZIPs and their sidecars were downloaded again after
publication and matched the SHA-256 values in `CHANGELOG.md`.

The first native matrix run, GitHub Actions
[#31290870084](https://github.com/YZYanthrop/anthropology-canteen/actions/runs/31290870084),
passed the Windows regression, Apple Silicon package/smoke job, and Intel
package/smoke job on 2026-08-09.

An Apple Silicon M2 user subsequently confirmed that the unsigned portable
beta could be launched and used normally. The packages were published under
the immutable bootstrap tag `macos-v1.1.1-beta.1` in the
[macOS v1.1.1 Beta 1 Pre-release](https://github.com/YZYanthrop/anthropology-canteen/releases/tag/macos-v1.1.1-beta.1).
An Intel human test remains recommended and is not yet recorded.
