# Anthropology Canteen project state

Last updated: 2026-09-28

## Current implementation

[v1.3.4 A–D](plans/v1.3.4-reminder-and-migration-safety.md) implementation and
regression test code are locally committed on `codex/v1.3.4-slice-a`, based on
`f88bc46` in the existing isolated worktree. A: `0809a1b` / `c8d68db`; B:
`dd07d9d`; C: `f15b63c`; D: `5ae4aee`; static-review fixes: `08641db`.
The packet remains In progress, not Verified. Per the September 28 authorization,
execution of lint/build/Node/UI/native verification is deferred to an independent
task using the [unified checklist](handoffs/v1.3.4-unified-verification.md).
A's historical results do not verify B–D or the current combined revision.
The original checkout's dirty documents remain preserved. v1.4.0 is not started.
Merge, push, tags, packaging and publication are not authorized. Product metadata
stays at 1.3.3 until a separately authorized version freeze; schemas remain 8/2/3.

## Stable baseline

- Current public product version: `v1.3.3`.
- Stable Git tag: `v1.3.3`; Windows x64, macOS arm64, and macOS x64 artifacts
  are built from that one immutable tag.
- Local data schema: version 8; v1.3.0 public packages used version 7.
- Local API-key and reminder settings schema: version 3; the main research data
  schema becomes version 8 in v1.3.1 while settings remain version 3.
- Version 5 and 6 data are migrated defensively: previously auto-merged author
  IDs are quarantined while subscriptions and user states are preserved.
- Current published distributions: Windows x64 plus unsigned macOS Apple
  Silicon arm64 and Intel x64 portable ZIPs in one
  [v1.3.3 Release](https://github.com/YZYanthrop/anthropology-canteen/releases/tag/v1.3.3).
- macOS bootstrap tag: `macos-v1.1.1-beta.1` at the validated build commit
  `c2ec6d1`; its GitHub Pre-release is
  [published here](https://github.com/YZYanthrop/anthropology-canteen/releases/tag/macos-v1.1.1-beta.1).
- The Windows package includes a bundled Node.js runtime and starts through
  `Anthropology Canteen.vbs`; `start-local.cmd` remains the diagnostic path.
- Source development requires Node.js 22.13 or newer and pnpm 11.9. The current
  Windows share package pins Node.js 24.14.0.

The `v1.1.1`, `macos-v1.1.1-beta.1`, `v1.2.0`, `v1.3.0`, `v1.3.1`,
`v1.3.2`, and `v1.3.3` tags are immutable.

## v1.3.3 release baseline

- Slices A–E are included in one release candidate. Product metadata and
  provider User-Agent values are `1.3.3`; release date is 2026-09-26.
- Desktop sidebar scrolling, visible touch actions, plain-language update
  results, reminder-data preservation on upgrade, and recoverable Windows
  scheduler updates are documented in `CHANGELOG.md`.
- Main data remains format 8, reminder state 2, and settings 3. No account,
  cloud service, new platform, installer, or email-provider integration is added.
- The immutable tag points to `a853e712a84156b5cc5575a828d2295298b35beb`. Candidate run
  [#36212326375](https://github.com/YZYanthrop/anthropology-canteen/actions/runs/36212326375)
  and formal tag run [#36212646270](https://github.com/YZYanthrop/anthropology-canteen/actions/runs/36212646270)
  passed shared checks, Windows x64, both native macOS architectures and source privacy.
  All three public ZIPs were re-downloaded and matched their SHA-256 sidecars.
  macOS archives remain unsigned and unnotarized.

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

## v1.3.2 release baseline

- The formal release date is 2026-08-24. Product metadata and every OpenAlex,
  Semantic Scholar, and Crossref product User-Agent are aligned at `1.3.2`.
- The UI-test prerequisite, Slice A, Slice B, Slice C, and the Windows
  reminder-registration correction are reviewed and merged. Version 8 research
  data, reminder state version 2, and settings version 3 remain compatible.
- The immutable tag points to
  `f89936b8e4854928142fb028de869794639fed3d`. Pre-tag candidate run
  [#32683536380](https://github.com/YZYanthrop/anthropology-canteen/actions/runs/32683536380)
  and formal tag run
  [#32687638516](https://github.com/YZYanthrop/anthropology-canteen/actions/runs/32687638516)
  passed shared verification, Windows x64, native macOS arm64, native macOS
  x64, and the source-archive job.
- Windows smoke covers Task Scheduler registration, VBS startup, persistence,
  migration, DPAPI, the reminder worker, and blank-archive privacy. The task
  remains current-user `RunLevel Limited`; only first registration or update
  migration may require one administrator-assisted `start-local.cmd` launch.
- Both macOS architectures passed native LaunchAgent, Keychain, startup,
  persistence, migration, worker, and privacy smoke. Their public archives are
  unsigned and unnotarized.
- The three platform ZIPs and sidecars are published in the
  [v1.3.2 Release](https://github.com/YZYanthrop/anthropology-canteen/releases/tag/v1.3.2).
  Post-publication downloads matched every sidecar: Windows x64
  `9F51687B1B750614FB3547A4F5C5626DAD263ED43DD6D200F980FCD4D9D08D95`,
  macOS arm64
  `0BF239A5871E5CFDE15B56546362F27D5110D94AB8AA24EFEAC6E3AFF87AC960`,
  and macOS x64
  `7E54A8EE4652A00F8E0A21C9A4175E645F90CC9CB36FCBA1628E3A670AE472A6`.

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

[v1.3.3 普通中文与左栏可用性](plans/v1.3.3-language-and-sidebar-usability.md) A–D
已在本地合并；Slice D 实现同源提醒资料自动迁移、事务恢复和准确授权码状态。
[Slice E](plans/v1.3.3-windows-reminder-task-migration.md) 已在短期分支完成，只在 Windows
拒绝普通更新时提升任务小工具；同一身份重复更新保持一项，来源不明的旧任务不删除。
lint、构建、57 项离线、26 项界面、12 个 Edge 合成场景及完整 Windows v1.3.3 临时包
smoke 通过。主数据格式 8、提醒状态 2、设置 3 不变；标准用户使用另一管理员账户及 macOS
钥匙串仍需各自环境验收。目标版本为 v1.3.3，正式版本号仍待冻结；尚未合并、推送、打标签或发布。
[v1.4.0 路线图](plans/v1.4.0-roadmap.md) 保持 `Proposed`。
稳定公开版本仍是 v1.3.2；主数据格式 8、提醒状态 2、设置 3 及三平台支持均不变。

The v1.3.0 local-reminder, v1.3.1 stabilization, and v1.3.2 usability and
recoverability milestones are complete:

1. Security, persistence, provider-degradation, identity and reminder-ledger regressions are covered by deterministic tests.
2. All three v1.3.2 packages are built from one immutable tag and pass native package smoke tests.
3. Existing release tags and public artifacts remain immutable.
4. Signing and notarization remain optional and separately authorized; current macOS packages are unsigned and unnotarized.

The approved v1.3.2 usability and recoverability implementation is complete. Its
UI interaction-test prerequisite and Slice A are merged into the local `main`
baseline. Slice A provides reversible ignored-state recovery, uncapped
version-8 article snapshots, and explicit publication-date precision without
changing the schema number. Slice B adds one complete return-to-overview path,
scholar-scoped new-item actions, native card controls, and real subscription and
provider update health while preserving the last successful feed after total
failure. Slice C adds explicit saved-versus-edited reminder state, discard
confirmation, keyboard-safe dialogs and feedback semantics, a persistent
narrow-screen search row, and minimum text sizes for core metadata and controls.
All v1.3.2 implementation slices and the Windows reminder-registration follow-up
are merged and published from the frozen `f89936b8e4854928142fb028de869794639fed3d`
commit. Candidate and immutable-tag native runs passed, and the three public ZIP
downloads matched their SHA-256 sidecars.

A local Windows x64 v1.3.2 trial package has now been built without pushing,
tagging, or publishing. The package-level update smoke proves exact preservation
of subscriptions, the complete reminder settings file, the reminder delivery
ledger, and a real current-user DPAPI ciphertext that remains decryptable after
import into the new extracted folder. Its automated package probes passed except
temporary Task Scheduler registration, which this desktop session denied. The
user has since passed the administrator-assisted Windows registration trial;
the later native candidate and formal tag smoke also passed.

The Windows reminder-registration follow-up was reviewed without blockers and
merged into local `main` at `6718d6a`. It makes enablement transactional: Task
Scheduler registration precedes both `enabled=true` and the first worker run,
while a first-check failure restores the previous disabled config and ledger
and removes the new task. Windows permission errors are translated to a short
administrator-launch instruction without PowerShell stacks or personal paths.
The user confirmed on Windows that the one-time administrator launch registered
the task, turned step 3 green, and completed the immediate check email. The task
continues to use the current user and `RunLevel Limited`; schemas, DPAPI,
imports, and other v1.3.2 behavior are unchanged. Existing Windows ZIPs remain
local trial artifacts rather than final release packages.

Project continuation no longer depends on a permanent Codex conversation.
`docs/CURRENT.md` is the lightweight entry point, `docs/WORKFLOW.md` defines the
short planning/implementation/release task model, and `docs/handoffs/` records
completed implementation evidence.

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
