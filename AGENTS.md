# Anthropology Canteen repository guidance

## Start here

- Every task first reads `docs/CURRENT.md` and `docs/work/ACTIVE.md`. Then read
  the exact approved plan linked by the active packet, when one exists.
- Read longer documents only when the task needs their domain:
  - app behavior, persistence, providers, or migration: `docs/ARCHITECTURE.md`;
  - launchers, packaging, or OS integration: `docs/PLATFORMS.md`;
  - versions, tags, CI artifacts, or publication: `docs/RELEASING.md` and
    `docs/PROJECT_STATE.md`.
- `docs/WORKFLOW.md` defines planning, implementation, handoff, and release task
  boundaries. Treat the repository and these files as the source of truth;
  never require an old chat or cached conversation to continue work.
- Preserve the existing pnpm/Vinext structure and `.openai/hosting.json`.

## Product invariants

- Anthropology Canteen is a local, portable academic-tracking web app. It does
  not require an account, cloud database, paid server, or browser storage for
  its normal data path. Optional email reminders run only on the user's own
  computer through the operating-system scheduler.
- Keep one shared application and server implementation for every platform.
  Platform-specific code belongs only in launchers, runtime packaging, import
  helpers, and release scripts.
- User data belongs in the extracted copy's `data/` directory. Never put user
  data, API keys, generated settings, PID files, caches, or personal paths in a
  release archive or Git commit.
- Preserve existing subscriptions, follow dates, saved states, translations,
  and cached records across compatible data migrations. A failed migration or
  identity check must keep the old data intact.
- Do not reintroduce automatic author merging based only on a name,
  institution, broad topic, or coauthor.
- Keep product versions identical across Windows and macOS artifacts built from
  the same Git commit and tag.

## Development and verification

- Create a short-lived branch for each bounded change. Keep `main` releasable;
  do not maintain permanent Windows and macOS product branches.
- A Codex task name or chat is not persistent project state. Before archiving
  or deleting a temporary task, verify that its changes are committed, its
  branch is merged or intentionally retained, and the applicable project
  documents and handoff are updated.
- Use `pnpm lint`, `pnpm build`, and `node --test tests/*.test.mjs` as the base
  verification set. Packaging changes also require a platform-specific startup
  smoke test, local-data persistence test, and blank-archive privacy check.
- Add a regression test when fixing a reported bug. Avoid live public APIs in
  deterministic tests; mock provider responses and test provider degradation.
- Update `docs/PROJECT_STATE.md` after architectural or milestone changes,
  `docs/PLATFORMS.md` after packaging changes, `docs/RELEASING.md` after release
  workflow changes, and `CHANGELOG.md` for user-visible changes. Keep
  `docs/CURRENT.md` and `docs/work/ACTIVE.md` short and current at every task
  handoff.
- Do not move, rewrite, or reuse an existing release tag. Do not push, publish,
  deploy, sign, notarize, or create a GitHub Release unless the user explicitly
  authorizes that external action.

## Release boundaries

- `release/`, `outputs/`, `dist/`, `data/`, dependencies, secrets, and local
  caches are generated or private and stay out of Git.
- A blank share archive must contain the compiled app, the appropriate runtime,
  launch/import helpers, documentation, notices, and no `data/` directory.
- Windows and macOS packages must be generated from the same source tag. macOS
  Apple Silicon and Intel builds must be tested natively in their respective
  GitHub-hosted runners before publication.
