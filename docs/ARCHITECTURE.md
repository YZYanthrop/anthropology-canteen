# Architecture

## One product, multiple packaging layers

Anthropology Canteen has one shared application and one shared portable server.
Windows and macOS are distribution targets, not separate products or forks.

```text
shared source
  app/ + portable-server.mjs + tests/
                 |
                 +-- Windows launcher/runtime/package
                 +-- macOS arm64 launcher/runtime/package
                 +-- macOS x64 launcher/runtime/package
```

No platform branch may copy and independently evolve `app/` or the local data
model. Platform code may select a runtime, open the browser, choose the local
data root, import old data, and assemble an archive.

## Shared application layer

- `app/page.tsx` owns client state, views, follow actions, cached profiles, and
  local persistence calls.
- `app/api/` owns feed, search (including journal and scholar discovery),
  scholar-profile, and translation routes.
- `app/lib/scholar-search.ts` normalizes scholar identities and publications.
- The production build creates `dist/client` and `dist/server`, which are shared
  by every desktop package.

## Portable server layer

`portable-server.mjs` runs only on loopback and provides:

- compiled application and static assets;
- authenticated `GET`, `PUT`, and field-level `PATCH /api/local-data`;
- local API-key settings without returning complete keys to the browser;
- data migration and neighboring-version import support;
- `/api/runtime-status` for launchers and smoke tests;
- `/api/browser-session` tracking so `--auto-close` stops the process after the
  last application page closes.

The portable server accepts only the expected loopback hostnames. Local data,
settings, and reminder requests require the per-process session token; API
requests with a foreign browser Origin are rejected. Request bodies have an
explicit 32 MiB ceiling and responses carry same-origin framing, MIME, referrer,
and content-policy protections.

The default local data root is the directory `data/` beside
`portable-server.mjs`. That path is already cross-platform and should remain the
macOS default when the package is an ordinary portable folder. Add an explicit
environment variable or command option only if a later app-bundle layout needs
it; the Windows default must remain backward compatible and all resolved paths
must remain inside the user-selected portable folder.

## Local persistence contract

- `data/anthropology-canteen-data.json`: subscriptions, read/saved/ignored
  state, article and scholar caches, and translations.
- `data/anthropology-canteen-settings.json`: optional provider API keys.
- `data/anthropology-canteen-reminder-state.json`: reminder baselines,
  pending outbox and delivery ledger (version 2).
- `data/anthropology-canteen-reminder-secret.json`: Windows DPAPI ciphertext;
  macOS keeps the equivalent secret in the user Keychain.
- `data/anthropology-canteen-server.pid`: ephemeral runtime PID.

These files are never build inputs and never belong in Git or a share archive.
The main data schema is version 8 and carries a monotonic revision. Browser
saves use top-level field patches so a reminder feed refresh cannot overwrite a
simultaneous subscription, article-state, translation, or profile change.
Data, settings, and reminder state have separate owner-token locks; writes use
temporary files, fsync, atomic replacement, and a last-known-good backup. User
records are never silently removed to satisfy an in-memory item cap.

The same JSON formats must work on Windows and macOS so a user can migrate by
copying or importing the `data/` directory.

Optional reminders are deliberately local. A one-shot `reminder-worker.mjs`
uses the same feed aggregation as the web app, sends through an authenticated
SMTP connection, and exits. Windows registers a current-user Task Scheduler
task; macOS registers a user LaunchAgent. The web server does not need to stay
open. Reminder delivery state is separate from article read state, and writes
use the reminder lock plus atomic replacement so a background run does not
leave a partial JSON file.

An empty first run creates a blank version 8 data structure. While that file
remains empty, automatic neighboring-version migration is retried so an old
portable folder placed beside the new one after the first launch can still be
found. Manual import must
validate the JSON, back up an existing destination, and bring the neighboring
settings file only when present. Automatic neighboring-version migration keeps
the newest data by `savedAt` and chooses settings independently by file time.

Because every version opens on the same friendly localhost origin, launchers
add a per-launch query value and the portable server marks HTML as `no-store`.
Hashed `/assets/` files may be cached immutably. This prevents an older HTML
shell from requesting asset names that no longer exist after an upgrade.
`/api/runtime-status` also reports the active package root. Launchers reuse a
running server only when it belongs to their own extracted folder; another
portable copy on the default port causes the new copy to choose a later port.

`packaging/shared/import-data.mjs` implements the manual-import transaction for
both platforms. Windows and macOS provide different interactive launchers, but
validation, live-PID refusal, backups, settings allowlisting, and rollback stay
identical.

## External academic data

The server-side routes use OpenAlex, Semantic Scholar, Crossref, Open Library,
and other configured public metadata sources. A provider failure or rate limit
must degrade independently. Tests use deterministic mocks rather than consuming
public quotas.

## Build and release

- Source verification runs lint, production build, and offline regression
  tests.
- Platform packaging adds the pinned Node.js 24.14.0 runtime, platform launch/import
  helpers, notices, and compiled `dist` output.
- Native runners start the final package on an isolated port, verify the home
  page and runtime/local-data endpoints, restart to verify persistence, and
  inspect the archive for prohibited files.
- A product release tag is the only source for all platform artifacts. GitHub
  Actions may publish artifacts only after every required platform job passes.

## Deliberate non-goals

- No Electron or Tauri rewrite for the initial macOS port.
- No GitHub Pages conversion, browser-local primary storage, account system,
  cloud database, hosted notification service, or email-reading capability.
- No automatic code signing or notarization until the user supplies an Apple
  Developer identity and explicitly authorizes secret configuration and
  publication.
