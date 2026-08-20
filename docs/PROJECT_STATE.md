# Anthropology Canteen project state

Last updated: 2026-08-20

## Stable baseline

- Current public product version: `v1.3.1`.
- Stable Git tag: `v1.3.1`; Windows x64, macOS arm64, and macOS x64 artifacts
  are built from that one immutable tag.
- Local data schema: version 8; v1.3.0 public packages used version 7.
- Local API-key and reminder settings schema: version 3; the main research data
  schema becomes version 8 in v1.3.1 while settings remain version 3.
- Version 5 and 6 data are migrated defensively: previously auto-merged author
  IDs are quarantined while subscriptions and user states are preserved.
- Current published distributions: Windows x64 plus unsigned macOS Apple
  Silicon arm64 and Intel x64 portable ZIPs in one
  [v1.3.1 Release](https://github.com/YZYanthrop/anthropology-canteen/releases/tag/v1.3.1).
- macOS bootstrap tag: `macos-v1.1.1-beta.1` at the validated build commit
  `c2ec6d1`; its GitHub Pre-release is
  [published here](https://github.com/YZYanthrop/anthropology-canteen/releases/tag/macos-v1.1.1-beta.1).
- The Windows package includes a bundled Node.js runtime and starts through
  `Anthropology Canteen.vbs`; `start-local.cmd` remains the diagnostic path.
- Source development requires Node.js 22.13 or newer and pnpm 11.9. The current
  Windows share package pins Node.js 24.14.0.

The `v1.1.1`, `macos-v1.1.1-beta.1`, `v1.2.0`, `v1.3.0`, and `v1.3.1` tags are immutable.

## v1.2.0 release baseline

- This release aligns Windows x64, macOS Apple Silicon arm64, and macOS Intel
  x64 on the same source commit and product version. It does not create separate
  platform products or branches.
- The only user-visible source change is removal of the Ruth Benedict quotation
  from the right rail. The application architecture and feature set are
  otherwise unchanged.
- Local data remains version 7 and the v1.2.0 API-key settings remain version 2.
- The unified portable workflow remains build-only. A normal version tag starts
  the build, and a manual dispatch can rerun an existing normal tag. Both paths may
  build, test, and retain candidate artifacts for all three targets, but the
  workflow does not create a tag, GitHub Release, signature, notarization, or
  public publication.
- The first `v1.2.0` tag run (`31301297604`) exposed a CI-shell false negative:
  the Windows package completed every smoke assertion and printed its pass marker,
  but an expected rejected-import probe left `$LASTEXITCODE=1` in the parent
  shell. The immutable tag was not moved. Its remediation is harness-only: a
  reviewed `main` workflow runs the tagged smoke in an independent PowerShell
  process while every application, packaging, and archive input remains locked
  to tag commit `aa8e3a25dcbe59cd57b83ecd94898efd343d36d0`.
- The remediation run
  [#31305111585](https://github.com/YZYanthrop/anthropology-canteen/actions/runs/31305111585)
  completed successfully: tag validation, shared verification, Windows x64,
  native macOS arm64, native macOS x64, and the clean source archive all passed.
  The published ZIPs and sidecars were then downloaded from the public Release
  and rechecked against SHA-256.
- Published product SHA-256 values are Windows
  `779DA709836840745AF6829A4413D457FAA2E14EC51DC71E578107BE6F8B6BEA`,
  macOS arm64 `FA43E0E42BEEB611C74E62EF8DE52496FF9DFBF834935F0AEB297F842A01F539`,
  and macOS x64 `FC2B6C02714B3C2A9165B43848D8B542D3B6AC7413F770204D58ED2619DDD306`.
- Windows and macOS packages use the same transactional import implementation.
  It validates data/settings before changing files, refuses import while the
  local server is active, backs up replaced files, and rolls back a failed
  installation.
- Release verification covers lint, production build, all 31 deterministic
  tests, reproducible packaging, blank-data privacy inspection, native launcher
  startup, folder-local persistence, import, restart, and automatic shutdown.

## v1.3.0 release baseline

- v1.3.0 adds an opt-in local SMTP reminder worker. It runs once from the
  current-user Windows Task Scheduler or macOS LaunchAgent and exits after the
  check; no hosted service or account is required.
- Main research data remains version 7 and settings are version 3. Existing
  subscriptions, saved states, translations, caches, API keys, reminder
  baselines, and encrypted credentials migrate through the transactional
  importer without partial replacement.
- Windows DPAPI, macOS Keychain, scheduler registration, offline worker runs,
  native startup, persistence, import, automatic shutdown, and blank-archive
  privacy are part of the final-package smoke coverage.
- The three public platform ZIPs are built from the immutable `v1.3.0` tag;
  macOS artifacts remain unsigned and unnotarized.

## v1.3.1 release baseline

- Harden loopback APIs against DNS rebinding and cross-origin requests; all folder-local data and settings calls require the process session token.
- Replace whole-document browser saves with field-level patches and isolate data, settings, and reminder locks. JSON writes retain a last-known-good backup.
- Upgrade main data to version 8 and reminder state to version 2 without changing settings version 3. Version 2–7 research data and version 1 reminder state remain importable.
- Track reminder baselines by stable subscription ID or ISSN, retain late-indexed works, and do not advance failed subscription scopes.
- Treat total feed failure as an error so the UI and worker preserve prior cache and cursors.
- Permit automatic author consolidation only from ORCID, a shared provider ID, or a shared DOI. Institutional pages are saved as manual evidence links and are not fetched automatically.
- Update direct production dependencies and expand deterministic regression coverage. No account, cloud service, new provider, or hosted scheduler is added.
- The immutable tag points to `7695e3a2e2620aa28c78958f9547d9e06f63e6f4`.
  Formal run [#32341349020](https://github.com/YZYanthrop/anthropology-canteen/actions/runs/32341349020)
  passed tag validation, shared verification, Windows x64, native macOS arm64,
  native macOS x64, and the source archive. Public ZIP sizes and SHA-256 values
  are recorded in `CHANGELOG.md` and the GitHub Release.

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
- The product remains local-only. Accounts, hosted databases, cloud
  synchronization, and hosted notification services remain out of scope.
  v1.3.0 adds an opt-in local SMTP reminder worker only; it uses current-user
  Windows Task Scheduler or macOS LaunchAgent and keeps delivery state in the
  extracted folder.

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

The v1.3.0 local-reminder milestone is complete. The v1.3.1 stabilization milestone is complete:

1. Security, persistence, provider-degradation, identity and reminder-ledger regressions are covered by deterministic tests.
2. All three v1.3.1 packages are built from one immutable tag and pass native package smoke tests.
3. Existing v1.3.0 tags and public artifacts remain immutable.
4. Signing and notarization remain optional and separately authorized; current macOS packages are unsigned and unnotarized.

The v1.3.0 release also treats the stable friendly localhost origin as an
upgrade boundary: launchers use a per-launch query, portable HTML responses are
not cacheable, and package smoke tests request the compiled CSS and JavaScript.
Neighboring-version migration is retried while the new local-data file remains
empty, including when an earlier first launch already created that blank file.

## v1.3.0 release status

- The shared 1.3.0 source, package metadata, launchers, packaging definitions,
  and tests use one product version. Lint, production build, and all 35
  deterministic tests pass locally.
- The user confirmed the corrected Windows test package works normally and has
  confirmed a real SMTP test message was received. No mailbox, provider,
  address, or credential is recorded here.
- The formal tag run rebuilds Windows x64, macOS arm64, and macOS x64 from the
  same immutable commit. Native smoke covers CSS/JavaScript, neighboring
  migration, persistence, transactional import, automatic close, DPAPI,
  Task Scheduler, Keychain, LaunchAgent, offline reminder worker, archive
  privacy, and package-root identity.
- The immutable tag points to `218d1d75f4f82eadbb991f637f562aec6cc57bb9`.
  Formal run [#32140570991](https://github.com/YZYanthrop/anthropology-canteen/actions/runs/32140570991)
  passed all six jobs. The public Release records the three ZIP sizes and
  SHA-256 values; its macOS packages remain unsigned and unnotarized.
- macOS packages remain unsigned and unnotarized; signing and notarization are
  separate, explicitly authorized work.

## Update discipline

- Update this file whenever the stable baseline, data schema, active milestone,
  supported platform, or major architectural constraint changes.
- Completed milestone details belong in `CHANGELOG.md`; repeatable release
  mechanics belong in `docs/RELEASING.md`.
