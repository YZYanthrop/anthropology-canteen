# Anthropology Canteen project state

Last updated: 2026-08-09

## Stable baseline

- Current public product version: `v1.1.1`.
- Stable Git tag: `v1.1.1` at commit `a03a32c`.
- Local data schema: version 7.
- Local API-key settings schema: version 2.
- Version 5 and 6 data are migrated defensively: previously auto-merged author
  IDs are quarantined while subscriptions and user states are preserved.
- Current published distribution: Windows portable ZIP.
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

See `docs/ARCHITECTURE.md` and `docs/PLATFORMS.md` for boundaries.

## Active milestone

Create a macOS portable beta for the existing 1.1.1 application without
forking the product code:

1. Keep folder-local `data/` as the default on both systems. Add a configurable
   data root only if the final macOS package layout genuinely requires it, and
   keep the Windows default unchanged.
2. Add macOS Apple Silicon and Intel runtime packaging and launch/import
   helpers.
3. Preserve the “close the last Anthropology Canteen page, then stop the local
   server” behavior.
4. Add native macOS CI smoke tests and automated GitHub release packaging,
   using the same pinned Node.js release as Windows unless a documented
   compatibility reason requires otherwise.
5. Produce blank, unsigned beta artifacts first. Signing and notarization are a
   later optional stage requiring explicit credentials and authorization.

Use a short-lived worktree branch named `codex/macos-portable-v1.1.1`. The
initial test tag may be named `macos-v1.1.1-beta.1`; the product displayed by
that beta remains 1.1.1. After the packaging infrastructure is merged, every
normal product tag must generate all supported platform artifacts.

## Update discipline

- Update this file whenever the stable baseline, data schema, active milestone,
  supported platform, or major architectural constraint changes.
- Completed milestone details belong in `CHANGELOG.md`; repeatable release
  mechanics belong in `docs/RELEASING.md`.
