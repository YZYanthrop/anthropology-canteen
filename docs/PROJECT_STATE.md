# Anthropology Canteen project state

Last updated: 2026-08-09

## Stable baseline

- Current public product version: `v1.2.0`.
- Stable Git tag: `v1.2.0`; Windows x64, macOS arm64, and macOS x64 artifacts
  are built from that one immutable tag.
- Local data schema: version 7.
- Local API-key settings schema: version 2.
- Version 5 and 6 data are migrated defensively: previously auto-merged author
  IDs are quarantined while subscriptions and user states are preserved.
- Current published distributions: Windows x64 plus unsigned macOS Apple
  Silicon arm64 and Intel x64 portable ZIPs in one `v1.2.0` Release.
- macOS bootstrap tag: `macos-v1.1.1-beta.1` at the validated build commit
  `c2ec6d1`; its GitHub Pre-release is
  [published here](https://github.com/YZYanthrop/anthropology-canteen/releases/tag/macos-v1.1.1-beta.1).
- The Windows package includes a bundled Node.js runtime and starts through
  `Anthropology Canteen.vbs`; `start-local.cmd` remains the diagnostic path.
- Source development requires Node.js 22.13 or newer and pnpm 11.9. The current
  Windows share package pins Node.js 24.14.0.

The `v1.1.1`, `macos-v1.1.1-beta.1`, and `v1.2.0` tags are immutable.

## v1.2.0 release baseline

- This release aligns Windows x64, macOS Apple Silicon arm64, and macOS Intel
  x64 on the same source commit and product version. It does not create separate
  platform products or branches.
- The only user-visible source change is removal of the Ruth Benedict quotation
  from the right rail. The application architecture and feature set are
  otherwise unchanged.
- Local data remains version 7 and local API-key settings remain version 2. No
  v1.2.0-specific data migration is required.
- The unified portable workflow remains build-only. A normal version tag starts
  the build, and a manual dispatch can rerun an existing normal tag. Both paths may
  build, test, and retain candidate artifacts for all three targets, but the
  workflow does not create a tag, GitHub Release, signature, notarization, or
  public publication.
- Windows and macOS packages use the same transactional import implementation.
  It validates data/settings before changing files, refuses import while the
  local server is active, backs up replaced files, and rolls back a failed
  installation.
- Release verification covers lint, production build, all 31 deterministic
  tests, reproducible packaging, blank-data privacy inspection, native launcher
  startup, folder-local persistence, import, restart, and automatic shutdown.

## Current product contract

- The app follows scholars first, journals second, and keyword families third.
- Keyword families highlight matches in titles, abstracts, and keywords; they
  are not an unrestricted global feed.
- Scholar search uses stable provider records and evidence-gated supplements.
  It must not merge people merely because their names match.
- Followed or opened scholar profiles and publication history are cached in the
  local data file. Historical works remain visible but unread counts start at
  the actual follow date.
- User data and optional API keys stay in the extracted program folder under
  `data/`; blank share archives contain no `data/` directory.
- The product remains local-only. Accounts, hosted databases, email reminders,
  and cloud synchronization are out of scope unless explicitly approved later.

## Current architecture

- `app/`: shared React/Vinext interface and API routes.
- `app/lib/scholar-search.ts`: scholar discovery and profile aggregation.
- `portable-server.mjs`: shared local HTTP server, local-data/settings APIs,
  migration, static assets, browser-session tracking, and automatic shutdown.
- `tests/`: deterministic regression and portable-server tests.
- Windows-only launch helpers live at the repository root.
- `packaging/shared/import-data.mjs` is the transactional import implementation
  packaged behind both platform-specific import launchers.
- `packaging/windows/` provides reproducible Windows x64 runtime assembly,
  archive privacy checks, and a native startup/persistence/shutdown smoke test.
- `.github/workflows/ci.yml` continues to provide the ordinary source
  regression check.
- `packaging/macos/` contains the macOS packaging layer: a reliable
  Finder-double-clickable command launcher, diagnostics, native build/privacy
  checks, and native smoke tests. The unsigned
  beta intentionally has no `.app` wrapper because App Translocation can break
  access to sibling runtime files.
- The historical macOS beta workflow established native arm64 and x64 package
  validation. v1.2.0 extends that model into one build-only
  `.github/workflows/portable-release.yml` workflow for Windows x64 and both
  macOS architectures; publication remains a separate authorized operation.

GitHub Actions run
[#31290870084](https://github.com/YZYanthrop/anthropology-canteen/actions/runs/31290870084)
completed successfully on 2026-08-09: the Windows regression and both native
Mac package/smoke jobs passed, and the two unsigned beta artifacts were
retained for 14 days. An Apple Silicon M2 user subsequently confirmed normal
launch and use. Intel has native CI coverage but no recorded human test.

See `docs/ARCHITECTURE.md` and `docs/PLATFORMS.md` for boundaries.

## Active milestone

The one-time macOS 1.1.1 bootstrap remains complete historical work: the native
matrix passed, the Apple Silicon M2 human check passed, the immutable beta tag
points to the exact build commit, and both architecture packages were
published with SHA-256 files. The product displayed by that beta remains 1.1.1,
and Intel has no recorded human test.

The active milestone is v1.2.x maintenance:

1. Keep Windows x64, macOS Apple Silicon, and macOS Intel on one source commit,
   one product version, and one build-only workflow.
2. Preserve folder-local data, blank-archive privacy, migration compatibility,
   transactional import, and automatic shutdown on every platform.
3. Collect an Intel Mac human first-launch test when available; native Intel CI
   is required for every published version even without that optional report.
4. Keep signing and notarization optional and separately authorized; current
   macOS packages remain unsigned and unnotarized.

## Update discipline

- Update this file whenever the stable baseline, data schema, active milestone,
  supported platform, or major architectural constraint changes.
- Completed milestone details belong in `CHANGELOG.md`; repeatable release
  mechanics belong in `docs/RELEASING.md`.
