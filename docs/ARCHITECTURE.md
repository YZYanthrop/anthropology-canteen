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
- `GET` and `PUT /api/local-data`;
- local API-key settings without returning complete keys to the browser;
- data migration and neighboring-version import support;
- `/api/runtime-status` for launchers and smoke tests;
- `/api/browser-session` tracking so `--auto-close` stops the process after the
  last application page closes.

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
- `data/anthropology-canteen-server.pid`: ephemeral runtime PID.

These files are never build inputs and never belong in Git or a share archive.
The same JSON formats must work on Windows and macOS so a user can migrate by
copying or importing the `data/` directory.

An empty first run creates a blank version 7 data structure. Manual import must
validate the JSON, back up an existing destination, and bring the neighboring
settings file only when present. Automatic neighboring-version migration keeps
the newest data by `savedAt` and chooses settings independently by file time.

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
  cloud database, or email scheduler.
- No automatic code signing or notarization until the user supplies an Apple
  Developer identity and explicitly authorizes secret configuration and
  publication.
