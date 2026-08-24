# Current project snapshot

Last updated: 2026-08-24

This is the lightweight entry point for a new Codex task. Chat history is not
required. Read this file and `docs/work/ACTIVE.md` first, then follow the
document router below.

## Stable product

- Public version and immutable tag: `v1.3.2` at
  `f89936b8e4854928142fb028de869794639fed3d`.
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

- v1.3.2 implementation, Windows reminder-registration correction, candidate
  gate, immutable tag build, and public release are complete.
- Candidate run
  [#32683536380](https://github.com/YZYanthrop/anthropology-canteen/actions/runs/32683536380)
  and formal tag run
  [#32687638516](https://github.com/YZYanthrop/anthropology-canteen/actions/runs/32687638516)
  passed Windows x64 and both native macOS architectures.
- The three public ZIPs and their sidecars are available from the
  [v1.3.2 Release](https://github.com/YZYanthrop/anthropology-canteen/releases/tag/v1.3.2);
  post-publication SHA-256 verification passed for every platform.
- Existing local trial and candidate ZIPs are not release files. Published tags
  and Release attachments are immutable.

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
