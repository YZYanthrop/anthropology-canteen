# Current project snapshot

Last updated: 2026-08-24

This is the lightweight entry point for a new Codex task. Chat history is not
required. Read this file and `docs/work/ACTIVE.md` first, then follow the
document router below.

## Stable product

- Public version and immutable tag: `v1.3.1`.
- Targets: Windows x64, macOS arm64, and macOS x64 from one source tag.
- Main local-data schema: version 8.
- Reminder-state schema: version 2.
- Settings schema: version 3.
- User data stays in the extracted package's `data/` directory.
- Optional email reminders are local OS-scheduled jobs; there is no hosted
  account, database, or notification server.

## Non-negotiable product rules

- Scholars first, journals second, keyword families third.
- Keyword families highlight followed scholars' and journals' works; they do
  not create an unrestricted global keyword feed.
- Never merge scholars from a name, institution, topic, or coauthor alone.
- Preserve subscriptions, follow dates, article states, translations, caches,
  reminder ledgers, and settings during compatible migration.
- Never commit or package `data/`, credentials, personal paths, caches, build
  output, or scheduler state.
- Windows and both macOS builds remain one shared product and version.

## Active work

- The approved v1.3.2 UI interaction-test prerequisite is merged into the local
  `main` baseline.
- Slice A was reviewed without blockers and is merged into local `main` at
  `531e04e`.
- Slice B was reviewed without blockers and is merged into local `main` at
  `a42e134`.
- Slice C was reviewed without blockers and is merged into local `main` at
  `2f392c6`. All approved v1.3.2 implementation slices are now merged locally.
- A Windows x64 v1.3.2 local-trial ZIP has been built from the short-lived
  `codex/v1.3.2-windows-local-trial` branch. Its final-package smoke passed
  with current-user Task Scheduler registration skipped because this desktop
  session returned `Access is denied`; no push, tag, or publication occurred.
- The follow-up `codex/v1.3.2-windows-reminder-registration` branch fixes that
  failure path: registration now precedes enablement and the first check,
  permission errors return a safe Chinese administrator hint, and first-check
  failure rolls back the new task, config, and ledger without touching SMTP
  credentials. Deterministic tests pass; native registration is still blocked
  by this desktop session and is not recorded as passed.
- Published v1.3.1 artifacts and tags are immutable.

## Read only what the task needs

- Every task: `AGENTS.md`, this file, and `docs/work/ACTIVE.md`.
- Planning: the proposed plan plus only the domain document needed to judge it.
- App behavior, persistence, providers, or data migration:
  `docs/ARCHITECTURE.md`.
- Launchers, packaging, OS integration, or platform support:
  `docs/PLATFORMS.md`.
- Versioning, tags, CI artifacts, or publication: `docs/RELEASING.md`,
  `docs/PROJECT_STATE.md`, and the relevant `CHANGELOG.md` section.
- Day-to-day task mechanics and ready-to-copy prompts: `docs/WORKFLOW.md`.

Historical release detail remains in the longer project documents, but a new
implementation task must not read old conversations or all historical sections
unless the current work actually depends on them.
