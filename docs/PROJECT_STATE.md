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
- `.github/workflows/ci.yml` currently verifies Windows only and has no tag,
  packaging, artifact, or GitHub Release job.
- `packaging/macos/` now contains the shared macOS packaging layer: a reliable
  Finder-double-clickable command launcher, diagnostics, transactional data
  import, native build/privacy checks, and native smoke tests. The unsigned
  beta intentionally has no `.app` wrapper because App Translocation can break
  access to sibling runtime files.
- `.github/workflows/macos-portable.yml` reruns Windows shared-code regression
  and builds/tests arm64 on `macos-15` plus x64 on `macos-15-intel`. Manual
  dispatch uploads beta workflow artifacts only; it does not tag or publish a
  GitHub Release.

GitHub Actions run
[#31290870084](https://github.com/YZYanthrop/anthropology-canteen/actions/runs/31290870084)
completed successfully on 2026-08-09: the Windows regression and both native
Mac package/smoke jobs passed, and the two unsigned beta artifacts were
retained for 14 days. An Apple Silicon M2 user subsequently confirmed normal
launch and use. Intel has native CI coverage but no recorded human test.

See `docs/ARCHITECTURE.md` and `docs/PLATFORMS.md` for boundaries.

## Active milestone

The one-time macOS 1.1.1 bootstrap is complete: the native matrix passed, the
Apple Silicon M2 human check passed, the immutable beta tag points to the exact
build commit, and both architecture packages are published with SHA-256 files.
The product displayed by this beta remains 1.1.1, and Intel remains explicitly
beta until an Intel human test is recorded.

The next milestone is one normal tag-driven release workflow for later product
versions:

1. Build and test Windows x64, macOS Apple Silicon, and macOS Intel from the
   same source commit and normal `vX.Y.Z` tag.
2. Publish all three platform archives and their SHA-256 values to one GitHub
   Release only after every required job passes.
3. Preserve folder-local data, blank-archive privacy, migration compatibility,
   and current automatic-shutdown behavior on every platform.
4. Keep signing and notarization optional and separately authorized; the
   published 1.1.1 Mac beta remains unsigned and unnotarized.

## Update discipline

- Update this file whenever the stable baseline, data schema, active milestone,
  supported platform, or major architectural constraint changes.
- Completed milestone details belong in `CHANGELOG.md`; repeatable release
  mechanics belong in `docs/RELEASING.md`.
