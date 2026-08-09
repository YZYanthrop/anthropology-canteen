# Anthropology Canteen project state

Last updated: 2026-08-09

## Stable baseline

- Current public product version: `v1.1.1`.
- Stable Git tag: `v1.1.1` at commit `a03a32c`.
- Local data schema: version 7.
- Local API-key settings schema: version 2.
- Version 5 and 6 data are migrated defensively: previously auto-merged author
  IDs are quarantined while subscriptions and user states are preserved.
- Current published distributions: the stable Windows portable ZIP and an
  unsigned macOS 1.1.1 beta Pre-release for Apple Silicon and Intel.
- macOS bootstrap tag: `macos-v1.1.1-beta.1` at the validated build commit
  `c2ec6d1`; its GitHub Pre-release is
  [published here](https://github.com/YZYanthrop/anthropology-canteen/releases/tag/macos-v1.1.1-beta.1).
- The Windows package includes a bundled Node.js runtime and starts through
  `Anthropology Canteen.vbs`; `start-local.cmd` remains the diagnostic path.
- Source development requires Node.js 22.13 or newer and pnpm 11.9. The current
  Windows share package pins Node.js 24.14.0.

The `v1.1.1` tag is immutable. macOS bootstrap work must not move or replace
that tag.

## Prepared v1.2.0 candidate

- The repository now prepares product version `1.2.0` as an unpublished source
  candidate. The current public version and stable tag remain `v1.1.1`.
- This is a release-alignment milestone: Windows x64, macOS Apple Silicon
  arm64, and macOS Intel x64 are built from the same source commit and product
  version. It does not create separate platform products or branches.
- The only user-visible source change is removal of the Ruth Benedict quotation
  from the right rail. The application architecture and feature set are
  otherwise unchanged.
- Local data remains version 7 and local API-key settings remain version 2. No
  v1.2.0-specific data migration is required.
- The unified portable workflow is build-only. A normal version tag starts the
  build, and a manual dispatch can rerun an existing normal tag. Both paths may
  build, test, and retain candidate artifacts for all three targets, but the
  workflow does not create a tag, GitHub Release, signature, notarization, or
  public publication.
- Creating or pushing `v1.2.0` and publishing its three platform artifacts is
  deferred to a separate task with explicit authorization.
- Local preparation verification passed on Windows: lint, production build,
  all 31 deterministic tests, reproducible Windows x64 packaging, blank-data
  privacy inspection, launcher startup, folder-local persistence, restart, and
  automatic shutdown. The v1.2.0 macOS packages still require their native
  arm64/x64 workflow jobs before publication.

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
- Windows-only launch and migration helpers currently live at the repository
  root.
- `packaging/windows/` provides reproducible Windows x64 runtime assembly,
  archive privacy checks, and a native startup/persistence/shutdown smoke test.
- `.github/workflows/ci.yml` continues to provide the ordinary source
  regression check.
- `packaging/macos/` now contains the shared macOS packaging layer: a reliable
  Finder-double-clickable command launcher, diagnostics, transactional data
  import, native build/privacy checks, and native smoke tests. The unsigned
  beta intentionally has no `.app` wrapper because App Translocation can break
  access to sibling runtime files.
- The historical macOS beta workflow established native arm64 and x64 package
  validation. The v1.2.0 candidate extends that model into one build-only
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

The active milestone is the unpublished v1.2.0 source candidate:

1. Keep Windows x64, macOS Apple Silicon, and macOS Intel on one source commit,
   one product version, and one build-only workflow.
2. Complete source verification and prepare a clean source archive without
   user data, secrets, dependencies, generated output, or personal paths.
3. In a separately authorized publication task, create and push the immutable
   `v1.2.0` tag, inspect all three native build results, and publish them to one
   GitHub Release only after every required job passes.
4. Preserve folder-local data, blank-archive privacy, migration compatibility,
   and current automatic-shutdown behavior on every platform.
5. Keep signing and notarization optional and separately authorized; the
   published 1.1.1 Mac beta remains unsigned and unnotarized.

## Update discipline

- Update this file whenever the stable baseline, data schema, active milestone,
  supported platform, or major architectural constraint changes.
- Completed milestone details belong in `CHANGELOG.md`; repeatable release
  mechanics belong in `docs/RELEASING.md`.
