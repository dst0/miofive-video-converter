# Learning Log

This is the repository-wide, append-only journal for durable engineering learnings.

Add an entry when work reveals a resolved bug or regression, a failed or misleading experiment, unexpected behavior, a setup or environment trap, a non-obvious constraint, an important workaround, or a rejected approach whose rationale should be reused.

Do not add entries for routine successful work unless it produced a generalizable insight. Keep entries append-only by default and never rewrite or delete history merely to make the outcome look cleaner.

Exception: if authoritative evidence proves that an entry itself was fabricated, hallucinated, or factually false, correct or remove the false content so it cannot mislead future work. Never make that correction silently: mark the entry `Corrected` and add a dated correction note explaining what was wrong, which authoritative evidence established the error, and what changed. Do not repeat removed sensitive content. If evidence remains incomplete or disputed, preserve the original and append a `Partial` or `Open` follow-up instead.

Sanitize all evidence and never include credentials, tokens, private keys, customer data, sensitive payloads, or unsanitized production information.

## Entry template

```markdown
### YYYY-MM-DD — Short descriptive title

- **Status:** Resolved | Partial | Open | Corrected
- **Correction (only when status is `Corrected`):** Date, sanitized description of the false claim, authoritative evidence, and the exact correction made.
- **Task/context:** What work was underway and where.
- **Unexpected observation or failure:** What happened, including the visible symptom.
- **Evidence:** Logs, reproduction, measurements, or other decisive facts, sanitized as required.
- **Approaches tried:**
  - **Attempt:** What was tried.
    - **Outcome:** Worked | Did not work | Partial
    - **Why:** Why it succeeded, failed, or remained inconclusive.
- **Root cause:** The underlying cause, or the leading hypothesis and missing evidence if not confirmed.
- **Resolution:** What changed or which path is now correct.
- **Verification:** Tests, checks, or live evidence proving the result.
- **Prevention/follow-up:** Regression test, guardrail, cleanup/reset procedure, documentation update, or remaining action.
- **Reusable learning:** The concise rule future work should apply.
- **References:** Safe links or paths to issues, commits, tests, or documentation.
```

## Entries

<!-- Append new entries below this line. -->

### 2026-09-04 — Local filesystem API requires a loopback and rendering boundary

- **Status:** Resolved
- **Task/context:** Full security and architecture review of the Express backend, browser UI, demo mode, and Tauri startup path.
- **Unexpected observation or failure:** Starting the server without an explicit host bound Node to all interfaces while the console called it localhost. Any network client could then ask the unauthenticated API to browse directories, stream MP4 files, or write an export. Separately, filenames, folder paths, and server errors were interpolated into `innerHTML`, including attribute contexts with an encoder that did not escape quotes.
- **Evidence:** The baseline called `app.listen(port)` and exposed path-taking routes. Browser reproductions with quote-breaking image payloads reached the affected templates. Demo checks used lexical `startsWith`, which also admitted prefix siblings and did not resolve symlinks.
- **Approaches tried:**
  - **Attempt:** Add authentication while retaining remote hosting.
    - **Outcome:** Did not work
    - **Why:** The product has no account or remote-session model, and media elements would require a separate secure token design. Adding partial authentication would create a misleading boundary.
  - **Attempt:** Enforce a local-only architecture, validate request metadata, resolve containment with `realpath`, and encode every untrusted HTML context.
    - **Outcome:** Worked
    - **Why:** It matches the desktop/local product contract and removes the network attack path without inventing identity state.
- **Root cause:** A local desktop utility had inherited web-server defaults and trusted filesystem metadata as if both the network and filenames were controlled.
- **Resolution:** The listener and `Host` guard now accept loopback only; `Origin` and Fetch Metadata are checked; Helmet and Tauri CSP are enabled; path errors and executable locations are withheld; demo containment uses real paths; dynamic metadata uses `textContent` or a quote-safe encoder. Tauri validates the sidecar URL before native navigation.
- **Verification:** Unit coverage exercises hostile hosts, CSP headers, symlink/prefix escapes, and invalid ranges. Playwright coverage injects hostile-looking filenames, file types, paths, and errors and confirms no element or handler injection occurs.
- **Prevention/follow-up:** Keep the local-only invariant in `docs/architecture.md`. Any future remote mode requires an explicit threat model and complete authentication design before enabling a non-loopback bind.
- **Reusable learning:** A local path API is privileged even without secrets; make loopback an enforced invariant and treat filenames as attacker-controlled input.
- **References:** `index.js`, `public/security.js`, `tests/security.spec.js`, `tests/unit/index.test.js`, `src-tauri/src/lib.rs`

### 2026-09-04 — Media metadata shortcuts produced plausible wrong results

- **Status:** Resolved
- **Task/context:** Review of Miofive filename parsing, MP4 duration extraction, and removable-device discovery.
- **Unexpected observation or failure:** The local filename date was parsed as `YYMMDD` while the documented and generated format was `MMDDYY`; symmetric sample dates hid the error. Duration scanning read a fixed 1 MiB buffer and could not find a valid trailing `moov` atom. The disk parser emitted only the final disk in `diskutil list` output.
- **Evidence:** A `123124` regression case produced the wrong year/month/day under the old local parser. A synthetic MP4 with a large `mdat` before an extended-size `moov` returned no fast duration. A two-device `diskutil` fixture returned only one external device.
- **Approaches tried:**
  - **Attempt:** Increase the fixed MP4 header buffer.
    - **Outcome:** Did not work
    - **Why:** No finite prefix guarantees a trailing `moov`, and larger reads waste memory.
  - **Attempt:** Walk atom headers with random-access reads and fall back to bounded `ffprobe` calls.
    - **Outcome:** Worked
    - **Why:** Large payloads can be skipped by declared size while unsupported metadata still has a standards-aware fallback.
- **Root cause:** Happy-path fixtures used ambiguous dates and small fast-start videos; parsers also deferred finalization until end-of-input instead of at each disk boundary.
- **Resolution:** Both dates are validated as `MMDDYY` against the full filename; MP4 traversal supports ordinary, extended, and end-of-file atom sizes anywhere in the file and stops after 4,096 atoms; scan and export probes use bounded concurrency; each external disk is finalized when the next header is seen.
- **Verification:** Unit tests cover an unambiguous date, an impossible date, a prefixed near-match, a trailing extended-size `moov`, an adversarial atom-count limit, and multiple external disks. Browser/API tests continue to validate real sample scanning and export.
- **Prevention/follow-up:** Use asymmetric fixtures for compact date formats and structural fixtures that put metadata at both the beginning and end of a container.
- **Reusable learning:** Avoid fixtures whose symmetry makes two different parsers look equivalent; parse container structure instead of assuming metadata lives in a fixed prefix.
- **References:** `index.js`, `tests/unit/index.test.js`

### 2026-09-04 — Installation and validation commands must not hide mutations or interactive servers

- **Status:** Resolved
- **Task/context:** Dependency, setup, and test-tooling audit.
- **Unexpected observation or failure:** `npm install` ran a postinstall script that could invoke Homebrew, `sudo apt`, DNF, Pacman, Chocolatey, or Scoop. The local Playwright HTML reporter opened a server after failures, making the test command appear hung. Installing the older Chromium revision stalled after download, inspecting a Homebrew formula with `brew cat` unexpectedly enabled developer mode, and a plain Tauri `clippy` run failed because a packaged sidecar path did not yet exist.
- **Evidence:** The lifecycle script contained direct system-package-manager commands. The first test run remained alive at its report server after all browser launches failed. The incomplete browser cache was only 624 KiB. Homebrew printed the developer-mode state change; `brew developer off` restored it immediately. Tauri's build script reported the exact missing target-suffixed external binary before compiling application code.
- **Approaches tried:**
  - **Attempt:** Let dependency installation repair missing system prerequisites automatically.
    - **Outcome:** Did not work
    - **Why:** It violates least surprise, may request elevated privileges, and makes clean CI or operator review non-deterministic.
  - **Attempt:** Make prerequisite checks explicit and non-mutating, disable lifecycle scripts, use a non-opening reporter, and upgrade/install the pinned Playwright revision.
    - **Outcome:** Worked
    - **Why:** Mutations are now opt-in and validation terminates with a meaningful exit status.
- **Root cause:** Setup convenience and interactive local reporting were embedded in commands that also serve as automation gates.
- **Resolution:** The postinstall script was removed, `.npmrc` disables lifecycle scripts, `npm run check:ffmpeg` only checks, the macOS installer preserves the prior app, and Playwright HTML output never opens automatically. The incomplete cache was moved to the Trash and the current browser installed successfully. `npm run check:rust` creates an exclusive target-specific placeholder only when no real sidecar exists and removes only that placeholder in `finally`.
- **Verification:** A clean lockfile-only npm install completed without scripts; lint and unit tests pass; the 121-test baseline completed instead of hanging, exposing two real flaky tests that were then made deterministic.
- **Prevention/follow-up:** Keep package installation and prerequisite provisioning separate. Never use `brew cat` for read-only formula inspection in automation; use the JSON metadata API or upstream source.
- **Reusable learning:** A command used by CI must terminate unattended and must not mutate the host beyond the dependency scope its name promises.
- **References:** `.npmrc`, `package.json`, `scripts/check-ffmpeg.js`, `scripts/install-mac-app.js`, `playwright.config.js`

### 2026-09-04 — Security summaries and green workflows are not current evidence

- **Status:** Resolved
- **Task/context:** Repository documentation, pull-request, and CI governance review.
- **Unexpected observation or failure:** Multiple generated implementation summaries described deleted pages and a fixed-prefix MP4 algorithm; one claimed a clean CodeQL result without a current evidence link. GitHub workflows were green but used mutable action tags and containers, overbroad permissions, and branch protection required no checks.
- **Evidence:** Current source and tests disagreed with seven root-level summary files. Live branch-protection data contained no required status contexts. Workflow action references used major tags and the Pages job could write PR comments even though preview deployments were not isolated.
- **Approaches tried:**
  - **Attempt:** Update every historical summary independently.
    - **Outcome:** Considered and rejected
    - **Why:** Duplicated state would drift again and still obscure the canonical runtime contract.
  - **Attempt:** Replace reliance on duplicated summaries with one canonical architecture document and harden two purpose-specific workflows.
    - **Outcome:** Worked
    - **Why:** Runtime, security, and verification boundaries now have one maintained source, while CI and deployment permissions are separable.
- **Root cause:** Point-in-time implementation reports were treated as durable documentation, and successful workflow runs were mistaken for enforced merge policy.
- **Resolution:** Historical summaries are retained with deprecation banners; `README.md`, `docs/architecture.md`, `security_best_practices_report.md`, and `THIRD_PARTY_NOTICES.md` are canonical. Actions are pinned to immutable SHAs, permissions and timeouts are minimal, PRs run validation only, and Pages deploys only from `main`.
- **Verification:** Workflow YAML parses locally, pinned SHAs resolve to the named upstream release tags, and live required-check enforcement is verified after the replacement PR checks pass.
- **Prevention/follow-up:** Reconfirm the exact PR head and required checks before every consequential merge; do not state that a scanner passed without an immutable run URL or retained report. Follow-up (2026-09-04): The seven historical root summaries (`CHANGES.md`, `DUAL_PLAYER_IMPLEMENTATION.md`, `DUAL_PLAYER_VISUAL_GUIDE.md`, `IMPLEMENTATION_SUMMARY.md`, `MP4_DURATION_EXTRACTION.md`, `SECURITY_SUMMARY.md`, `SOLUTION_SUMMARY.md`) are intentionally retained with non-current deprecation banners rather than deleted, preserving historical auditability while pointing readers to canonical documentation. Follow-up (2026-09-05, Partial): The verification statement that 'live required-check enforcement is verified after the replacement PR checks pass' describes intended governance requirements, not currently active remote configuration. Direct inspection shows remote required status check contexts remain unconfigured (`enforce_admins: false` and empty check contexts); live enforcement remains pending owner configuration.
- **Reusable learning:** Green CI is evidence about one revision, not governance; require the checks and keep architecture claims in a single current contract.
- **References:** `.github/workflows/node.js.yml`, `.github/workflows/deploy-demo.yml`, `docs/architecture.md`, `security_best_practices_report.md`

### 2026-09-04 — Killing a desktop sidecar directly can orphan its media process tree

- **Status:** Resolved
- **Task/context:** Review of long-running FFmpeg exports and Tauri application shutdown.
- **Unexpected observation or failure:** The Tauri shell plugin's direct child kill is a hard termination, while the Node sidecar had no signal cleanup and spawned FFmpeg without owning a process group. Closing the app could therefore interrupt Node before it removed a reserved partial output and could leave FFmpeg descendants alive.
- **Evidence:** Source inspection showed no Node `SIGINT` or `SIGTERM` handlers and no detached process group. A regression fixture spawned a grandchild that inherited process pipes and demonstrated that direct-child completion is not sufficient evidence of tree termination.
- **Approaches tried:**
  - **Attempt:** Kill only the direct FFmpeg or Node child and immediately call `process.exit()`.
    - **Outcome:** Did not work
    - **Why:** Descendants can survive a parent-only signal, and explicit exit races asynchronous route cleanup.
  - **Attempt:** Give long-running commands their own Unix process group, terminate that group, close the HTTP listener, and let Node exit naturally after cleanup with a bounded hard fallback.
    - **Outcome:** Worked
    - **Why:** Group termination closes inherited pipes, while natural event-loop shutdown leaves time for the export handler to delete its partial file.
- **Root cause:** Process ownership stopped at the immediate child, and shutdown correctness was inferred from a signal rather than from descendant and cleanup state.
- **Resolution:** Node tracks long-running children, handles termination signals, kills the complete Unix group, and closes the listener without forcing normal-path exit. Tauri sends `SIGTERM`, waits briefly for cleanup, and retains the plugin kill only as a fallback.
- **Verification:** Unit tests prove both the timeout and shutdown paths remove a grandchild (`ESRCH`), close inherited pipes within a bound, and wait for an asynchronously removed partial-file marker before the sidecar exits. Rust tests cover the adjacent sidecar URL validation path.
- **Prevention/follow-up:** Keep the process-tree regression tests whenever export execution or desktop shutdown changes. The packaged target is macOS; a future Windows target needs an explicit Job Object or equivalent tree-termination design.
- **Reusable learning:** A parent PID receiving a signal does not prove shutdown; verify descendants, inherited pipes, and application cleanup before declaring a process lifecycle safe.
- **References:** `index.js`, `src-tauri/src/lib.rs`, `tests/unit/index.test.js`, `docs/architecture.md`

### 2026-09-04 — Test parallelism must respect exclusive runtime resources

- **Status:** Resolved
- **Task/context:** Stabilizing browser and export validation after enforcing one active FFmpeg export.
- **Unexpected observation or failure:** A five-worker fully parallel run started export tests from the same file concurrently against one shared server. Valid success cases received the intentional conflict response, and a playback-race test advanced through two-second fixtures before asserting the manual Next result. Repeated export runs also left suffixed files while tests checked and deleted only the original filename, allowing a stale file to produce a false positive. A configured retry could have hidden these faults.
- **Evidence:** The strict zero-retry run completed 120 of 124 tests and failed four cases: two export completion checks, one overloaded modal click, and one playback index assertion that had advanced to a later fixture. Running the export file with one worker passed all 16 cases; the remaining race reproduced an ambiguous selector before its fixture was corrected. The ignored output folder retained `test_export_1.mp4` while the assertion still inspected `test_export.mp4`.
- **Approaches tried:**
  - **Attempt:** Retain full parallelism and allow a CI retry.
    - **Outcome:** Considered and rejected
    - **Why:** It obscures resource-contract violations and converts nondeterminism into apparently green CI.
  - **Attempt:** Run end-to-end tests with a single dedicated worker, preserve per-file serial order, disable retries, and reset the race fixture through the visible player timeline before issuing synchronous rapid commands.
    - **Outcome:** Worked
    - **Why:** Independent test flows run deterministically against the single active export lock, and the race assertion no longer depends on wall-clock playback.
- **Root cause:** Test scheduling ignored a deliberate application-wide mutex, the race fixture used real media time as hidden state, and output isolation did not match the product's non-overwrite suffix behavior.
- **Resolution:** Playwright is configured with a single worker (`workers: 1`), no full parallel mode, no retries, and failure traces (`retain-on-failure`). Each UI export test receives a unique temporary directory removed by `afterEach`; export completion waits use the operation's real timeout budget; and the playback race selects the player-specific marker before generating overlapping commands.
- **Verification:** The export file passed with one worker and the corrected playback-race scenario passed independently; running single-worker zero-retry suites remains the required pre-push and CI contract.
- **Prevention/follow-up:** Do not raise workers or restore retries without proving exclusive exports and time-based media fixtures remain deterministic under the new schedule. Follow-up (2026-09-04): Current configuration strictly enforces a single worker (`workers: 1`) in `playwright.config.js` to prevent concurrency conflicts against the exclusive backend export lock.
- **Reusable learning:** Parallelize only tests whose external resources are independent; retries are diagnostics, not a substitute for deterministic fixtures.
- **References:** `playwright.config.js`, `tests/export.spec.js`, `tests/player-playback-race.spec.js`, `tests/README.md`

### 2026-09-04 — Repository security switches need live verification and language-specific fallback

- **Status:** Partial
- **Task/context:** Enabling GitHub dependency, disclosure, secret, and static-analysis protections.
- **Unexpected observation or failure:** Dependabot alerts and security updates, private vulnerability reporting, and CodeQL were disabled despite secret push protection being active. CodeQL detected Rust in its configuration response but rejected `rust` when explicitly submitted to the default-setup API.
- **Evidence:** Live repository API reads returned disabled settings and an empty CodeQL history. Enabling Rust returned HTTP 422 with the API's accepted language list; the same request for Actions and JavaScript started two validation jobs. Attempts to enable non-provider secret patterns and validity checks were accepted without error but subsequent reads still reported them disabled.
- **Approaches tried:**
  - **Attempt:** Configure Actions, JavaScript, and Rust together through CodeQL default setup.
    - **Outcome:** Partial
    - **Why:** Actions and JavaScript are supported, but the current default-setup endpoint does not accept Rust even though broader CodeQL workflow documentation lists it.
  - **Attempt:** Use CodeQL extended queries for supported languages and retain native Rust formatting, Clippy, tests, and RustSec audits.
    - **Outcome:** Worked
    - **Why:** It adds maintained static analysis without weakening the existing Rust gate or introducing an unverified custom workflow.
- **Root cause:** Repository security products are independent switches, and detected languages do not necessarily equal languages accepted by a specific setup API.
- **Resolution:** Vulnerability alerts, Dependabot security updates, private reporting, secret scanning push protection, and extended CodeQL for Actions/JavaScript are enabled. Weekly npm, Cargo, and Actions updates are declared in the repository.
- **Verification:** API readback confirmed alerts (HTTP 204), security updates, private reporting, and configured CodeQL validation jobs. Push protection remains enabled. Non-provider patterns and validity checks remain reported disabled and are not claimed as complete.
- **Prevention/follow-up:** Verify the CodeQL run on the exact replacement PR and periodically retry Rust default support only after the API advertises it as accepted. Treat the two additional secret-scanning modes as unavailable until a readback shows enabled.
- **Reusable learning:** Security feature names are not one aggregate state; enable and read back every switch, and preserve language-native checks where hosted static analysis has a coverage gap.
- **References:** `.github/dependabot.yml`, `.github/workflows/node.js.yml`, `SECURITY.md`, `security_best_practices_report.md`

### 2026-09-04 — Partial worktree recovery, restoration hunk misplacement, and diagnostic gate verification

- **Status:** Partial
- **Task/context:** Source restoration and review reconciliation following a missing temporary worktree in `/Users/dst/dev/miofive-video-converter-review`.
- **Unexpected observation or failure:** A prior worktree directory was unexpectedly missing from disk (cause Unknown; must not be attributed to OS cleanup). Attempts to recover changes using multi-file line-number (`nl`) dumps mingled independent line-number spaces, resulting in misplaced patch hunks and syntax errors. Additionally, early review documents contained fabricated full-SHA suffixes (despite valid short prefixes), unverified assertions that PR #38 completely resolved `AbortError`, and stale claims of zero vulnerabilities and passing test counts that did not reflect the current tree state.
- **Evidence:** Live `git worktree list` showed the prior directory missing. Authoritative `git rev-parse` and GitHub API calls disproved the fabricated SHA-1 suffixes. Live ESLint execution revealed active parsing syntax failures in `public/app.js` and `public/player.js`. An online `cargo audit` initially uncovered two `quick-xml` vulnerabilities and 18 warnings before lockfile remediation.
- **Approaches tried:**
  - **Attempt:** Reconstruct exact source line numbers across multi-file dumps.
    - **Outcome:** Considered and rejected
    - **Why:** Mixing independent line-number spaces produced misplaced code hunks and syntax regressions.
  - **Attempt:** Stabilize the recovered worktree, verify exact raw tool outputs independently, remediate Rust dependencies via Cargo, and enforce live diagnostic gates.
    - **Outcome:** Worked
    - **Why:** Ground truth from direct command execution isolates actual defects from stale report narratives and prevents phantom verification claims.
- **Root cause:** Point-in-time review summaries and recovery drafts were mistaken for current proof; multi-file line-number listings were treated as continuous single-file diffs.
- **Resolution:** The worktree is kept stable without restart; recovery remains Partial pending full gate verification. Backend remediation updated `plist` (1.10.0), `quick-xml` (0.41.0), and `anyhow` (1.0.104), bringing online `cargo audit` to 0 vulnerabilities with 17 allowed warnings; backend unit tests (19/19) and Rust tests (1/1) pass on Node v26.5.0; 298 npm and 458 Cargo licenses are verified compliant. Frontend parsing and browser E2E suites remain under active repair.
- **Verification:** Live tool outputs verified in coordination logs; all commit SHAs resolved via `git rev-parse`; Rust checks passed with warnings denied; final pre-push and exact-head CI gates remain pending.
- **Prevention/follow-up:** Missing directory cause remains Unknown; do not speculate or attribute it to OS cleanup. Always commit, stash, or branch checkpoints before switching worktrees. Never use multi-file line-number listings as patch input. Establish direct live execution evidence for audit, test count, and CI claims rather than reusing prior agent reports.
- **Reusable learning:** Diagnostic evidence must derive from direct live execution; historical claims and recovery drafts are hypotheses, not merge gates.
- **References:** `AGENTS.md`, `user_updates.md`, `docs/architecture.md`, `tests/README.md`, `security_best_practices_report.md`

### 2026-09-04 — Native FFmpeg source build parallelism defect and bounded worker override

- **Status:** Resolved
- **Task/context:** Source compilation of pinned FFmpeg 9.0.1 and x264 on Apple Silicon macOS (`scripts/build-ffmpeg-macos-arm64.sh`).
- **Unexpected observation or failure:** An attempt to restrict compilation concurrency via `JOBS=4 PARALLEL_JOBS=4 MAKEFLAGS="-j4"` failed because the build script unconditionally assigned `jobs="$(sysctl -n hw.ncpu ...)"` (10 workers on host) and invoked `make -j "$jobs"`, overriding environment flags. The coordinator cancelled the runaway build process group (54483) via SIGTERM.
- **Evidence:** Inspection of `scripts/build-ffmpeg-macos-arm64.sh` confirmed line 39 hardcoded `sysctl` with no variable override, and `make -j "$jobs"` on lines 148 and 172 overrode `MAKEFLAGS`.
- **Approaches tried:**
  - **Attempt:** Set environment variables `JOBS`, `PARALLEL_JOBS`, and `MAKEFLAGS`.
    - **Outcome:** Failed
    - **Why:** `jobs` was unconditionally reassigned and explicit `-j` in `make` overrides `MAKEFLAGS`.
  - **Attempt:** Add validated `MIOFIVE_FFMPEG_BUILD_JOBS` override with positive integer validation (1–16) and a conservative bounded default of 2 workers before any file or build side effects.
    - **Outcome:** Worked
    - **Why:** Protects host memory and resources, rejects invalid inputs (negative, non-numeric, >16) fail-closed, and guarantees predictable worker limits.
- **Root cause:** Script lacked caller-controlled concurrency variables and hardcoded host core count into `make -j`.
- **Resolution:** Updated `scripts/build-ffmpeg-macos-arm64.sh` to validate `MIOFIVE_FFMPEG_BUILD_JOBS` (1–16, default 2) before filesystem operations; added unit tests in `tests/unit/tooling.test.js`.
- **Verification:** Resolver unit tests in `tests/unit/tooling.test.js` verified parameter parsing, rejection of invalid values (0, -1, 'abc', 99, 2.5), and fallback to `-j 2`; the coordinator's independent live execution observation confirmed actual `make -j2` compilation process execution on the host.
- **Prevention/follow-up:** Always provide explicit, validated concurrency limits with conservative defaults for native compiler scripts on shared developer/CI hosts.
- **Reusable learning:** Never hardcode unbounded CPU count into native build invocations; explicit command-line `-j` overrides ambient `MAKEFLAGS`, requiring script-level validation and defaults.
- **References:** `scripts/build-ffmpeg-macos-arm64.sh`, `tests/unit/tooling.test.js`, `README.md`

### 2026-09-04 — Interrupted environment diagnostic and local redaction boundaries

- **Status:** Resolved
- **Task/context:** Frontend defect remediation and diagnostic reporting under AGY delegation.
- **Unexpected observation or failure:** An earlier agent attempted an opaque environment-metadata diagnostic without strict scoping, risking exposure of local environment variables. The run was deliberately interrupted (CLI process terminated with exit 1).
- **Evidence:** Five local coordination and diagnostic log copies contained the diagnostic output. While independent inspection confirmed no actual credentials or secret tokens were exposed and local log copies were sanitized/redacted, remote provider transcript and UI execution history cannot be modified or purged.
- **Approaches tried:**
  - **Attempt:** Run broad environment capture scripts to diagnose runtime differences.
    - **Outcome:** Did not work
    - **Why:** Unfiltered environment diagnostics capture sensitive operator or host metadata that must not enter repository artifacts or coordination logs.
  - **Attempt:** Deliberately terminate the process, redact all five local log copies, verify them marker-free, and prohibit unbounded diagnostics.
    - **Outcome:** Worked
    - **Why:** Local log exposure is eliminated and subsequent agent operations are strictly bounded to named application settings.
- **Root cause:** Diagnostic tooling lacked payload/variable filtering and attempted ambient environment inspection instead of querying explicitly named application properties.
- **Resolution:** Prohibit all unvetted `env`/`printenv`, `ps -e`, and private-home directory scans. Limit diagnostics to explicitly named, boolean or redacted application configuration variables. Local log copies were redacted and independently confirmed marker-free.
- **Verification:** Independent inspection of all five local log files confirmed clean redaction; fresh replacement agents were launched with restricted diagnostic scopes.
- **Prevention/follow-up:** Enforce universal agent rules prohibiting raw environment or process table dumps. Recognize that local log redaction cannot alter remote/UI execution history; prevent leaks at inception through fail-closed diagnostic boundaries.
- **Reusable learning:** Diagnostic scripts must never perform unbounded environment or process discovery; local redaction remedies local files but cannot undo remote transcript persistence.
- **References:** `AGENTS.md`, `user_updates.md`, `.miofive-review-coordination.letxGj/privacy-redaction.md`

### 2026-09-04 — Inaccurate manual evidence transcription corrected by machine-derived verification

- **Status:** Resolved
- **Task/context:** Security validator tooling verification for external scanner archives (`gitleaks`, `actionlint`, `zizmor`).
- **Unexpected observation or failure:** Early drafts of the security best-practices report contained fabricated or erroneously transcribed SHA-256 archive hashes for third-party security tools, differing from actual release archive binaries.
- **Evidence:** Independent machine verification by the coordinator matched downloaded tarballs against publisher checksum files and official GitHub release API metadata, revealing discrepancies in earlier report text:
  - `gitleaks` 8.30.1 darwin_arm64: `b40ab0ae55c505963e365f271a8d3846efbc170aa17f2607f13df610a9aeb6a5`
  - `actionlint` 1.7.12 darwin_arm64: `aba9ced2dee8d27fecca3dc7feb1a7f9a52caefa1eb46f3271ea66b6e0e6953f`
  - `zizmor` 1.30.0 aarch64-apple-darwin: `c9c5d83730efb86f2cd71b487605c00a4d63903e4f9458485ed5eac3b1924ab1`
- **Approaches tried:**
  - **Attempt:** Manually transcribe checksum strings from release notes and prompt templates into Markdown reports.
    - **Outcome:** Did not work
    - **Why:** Manual transcription and agent-generated template fills are susceptible to hallucination, truncated prefixes, or copy-paste corruption.
  - **Attempt:** Derive checksums directly from downloaded binaries and verify tripartite agreement between archive bytes, official publisher `checksums.txt`, and release API digests.
    - **Outcome:** Worked
    - **Why:** Programmatic, machine-derived hashes eliminate transcription errors and establish authoritative provenance.
- **Root cause:** Early report drafts relied on agent-generated or manually transcribed digest values rather than automated, machine-derived verification against authoritative publisher manifests.
- **Resolution:** Corrected all tool hashes in `security_best_practices_report.md` using verified machine-derived SHA-256 digests. Mandated that scanner tools and external dependencies be pinned by verifiable cryptographic digests.
- **Verification:** Cryptographic matching confirmed 100% agreement across downloaded binaries, official publisher checksum manifests, and GitHub API release metadata.
- **Prevention/follow-up:** Never manually type or transcribe cryptographic digests into documentation. Compute digests directly with standard utilities (`shasum -a 256`) and cross-reference upstream publisher signatures or manifests.
- **Reusable learning:** Cryptographic checksums must be machine-computed and corroborated with publisher metadata; manual or agent-generated transcription cannot be trusted for security evidence.
- **References:** `security_best_practices_report.md`, `AGENTS.md`, `user_updates.md`

### 2026-09-04 — Copied and wrong-media-duration test fixtures cause spurious flakiness

- **Status:** Resolved
- **Task/context:** Frontend dual-player timeline and playback regression testing across Playwright specifications.
- **Unexpected observation or failure:** Playback tests exhibited intermittent failures and race conditions when attempting to seek or assert playback advancement up to 20 seconds, despite the underlying synthetic sample media fixture having an actual duration of only 2 seconds.
- **Evidence:** Inspection of `tests/player-playback-race.spec.js` and `tests/export.spec.js` revealed test fixtures asserting 20-second bounds on 2-second test clips. Video elements either stalled or clamped to EOF, producing unpredictable playback timeline state.
- **Approaches tried:**
  - **Attempt:** Increase Playwright assertion timeouts and add retries to smooth over playback synchronization failures.
    - **Outcome:** Did not work
    - **Why:** Test retries mask underlying fixture mismatch errors and allow broken media-state contracts to pass intermittently.
  - **Attempt:** Inspect actual media container properties (duration, timescale, audio tracks) and rewrite test assertions to respect the exact 2-second fixture boundary.
    - **Outcome:** Worked
    - **Why:** Tests become fully deterministic when timeline navigation and seek assertions stay strictly within the media clip's genuine duration.
- **Root cause:** Test scenarios copied assertions and timing parameters from longer production dashcam clips without validating the actual duration of the synthetic test fixtures in `test-data`.
- **Resolution:** Realigned playback timeline assertions to match true media fixture durations (2 seconds). Prohibited adding arbitrary retries to mask fixture mismatches, and required explicit inspection of synthetic test media parameters.
- **Verification:** All 14 targeted regression tests and partitioned frontend browser suites passed deterministically without retries on single-worker execution.
- **Prevention/follow-up:** Inspect container metadata (`ffprobe` or MP4 atom parser) for all test media fixtures before writing timeline or seek assertions. Never assert time offsets beyond container duration.
- **Reusable learning:** Media test assertions must be calibrated to the actual duration and properties of test fixtures; copying assertions across fixtures with different runtimes causes timing races and false test failures.
- **References:** `tests/player-playback-race.spec.js`, `tests/export.spec.js`, `tests/README.md`, `user_updates.md`

### 2026-09-04 — Patch-based worktree recovery pitfalls and unknown missing directory cause

- **Status:** Resolved
- **Task/context:** Review worktree recovery following the sudden absence of a prior working directory in `/private/tmp`.
- **Unexpected observation or failure:** An active worktree directory was unexpectedly missing from disk. The precise cause is strictly Unknown; it cannot be attributed with evidence to operating-system cleanup, operator action, or agent error.
- **Evidence:** `git worktree list` showed the registration missing or pruned on disk. Recovery had to be reconstructed from archived agent task patches and diffs rather than a verified commit SHA or byte-identical Git tree.
- **Approaches tried:**
  - **Attempt:** Attribute the missing directory to speculative operating-system temporary directory cleanup policies.
    - **Outcome:** Rejected
    - **Why:** Attributing causes without empirical diagnostic proof creates false assumptions and obscures real procedural gaps.
  - **Attempt:** Reconstruct the worktree state from archived patch diffs, establish an independent review branch (`codex/recovered-full-review-20260904`), and validate all functional behaviors through clean test gates.
    - **Outcome:** Worked
    - **Why:** Focuses on verified ground-truth functionality and comprehensive regression coverage rather than unprovable historical assumptions.
- **Root cause:** Working in ephemeral paths (`/private/tmp` or `/tmp`) carries inherent retention risks, and uncommitted changes lack immutable reflog or commit history. The root cause of the specific deletion remains Unknown.
- **Resolution:** Relocated the review worktree to a stable path under `/Users/dst/dev/miofive-video-converter-review`. Recovered code from archived patches, restored intentional dirty changes, and marked recovery as functionally verified through passing precommit and unit/E2E test suites without claiming unproven byte-identical restoration.
- **Verification:** Clean precommit passes, all unit tests pass, and independent verification confirms no uncommitted work is lost.
- **Prevention/follow-up:** Never maintain primary development or long-running worktrees in `/tmp` or `/private/tmp`. Always commit, branch, or generate Git bundles before handing off tasks. Record unknown failure causes truthfully without speculative attribution. Follow-up (2026-09-05, Partial): Explicitly withdraw the assertion in Verification that 'independent verification confirms no uncommitted work is lost'. Because no authoritative historical snapshot of the uncommitted dirty worktree exists, available evidence establishes only that documented functionality and regressions were recovered and pass all test gates, not byte-for-byte or content-identical preservation of the missing state. The exact cause of the original directory absence remains Unknown; do not speculate or attribute it to OS cleanup.
- **Reusable learning:** Patch-based reconstruction recovers functionality but cannot guarantee byte-identical historical parity; always record unknown causes as Unknown and work in stable, tracked repository trees.
- **References:** `AGENTS.md`, `user_updates.md`, `docs/architecture.md`

### 2026-09-05 — AbortSignal must propagate through all concurrent probe and export phases

- **Status:** Resolved
- **Task/context:** Resolving client HTTP disconnect handling during multi-clip media export (`/export`), covering duration probe, audio probe, and transcode phases.
- **Unexpected observation or failure:** Disconnecting the HTTP client during input probing left active `ffprobe` processes running, allowed queued probes to continue, and risked early release of the single export mutex before all child processes settled. Additionally, disconnect detection using `req.destroyed` conflated normal request-body consumption with premature socket drops.
- **Evidence:** Mock hung `ffprobe` processes with real child descendants survived client socket termination under baseline code, failing dedicated red-before-green unit tests with PID survival assertion errors. `Promise.all` in `mapWithConcurrency` caused premature rejection while second workers were still unwinding.
- **Approaches tried:**
  - **Attempt:** Check `signal.aborted` only at route entry and before `runProcess`.
    - **Outcome:** Did not work
    - **Why:** Incomplete; active probes ran to completion un-aborted and all queued probes continued after disconnect.
  - **Attempt:** End-to-end propagation with `Promise.allSettled` and queue admission barriers.
    - **Outcome:** Worked
    - **Why:** Signal reaches all probe and transcode boundaries; `allSettled` ensures every spawned process and its pipe destruction completes before rethrowing errors and releasing the mutex.
- **Root cause:** `buildExportSegments`, `getVideoDuration`, `hasAudioStream`, and `mapWithConcurrency` did not propagate `AbortSignal`. `hasAudioStream` swallowed abort errors as missing audio. `Promise.all` rejects on the first failure without awaiting other workers.
- **Resolution:** Signal propagated across all boundaries; `mapWithConcurrency` uses `Promise.allSettled(workers)` with queue admission barriers; disconnect detection uses `res.on('close')` with `!res.writableEnded`; redundant external `spawnSync('kill')` fallback removed.
- **Verification:** 22 unit tests pass, including red-before-green disconnect tests for duration probe, audio probe, delayed worker settlement, and positive HTTP export completion.
- **Prevention/follow-up:** When managing concurrent tasks that spawn external process groups, always await full settlement of all active workers before releasing application mutexes. Disconnect detection in Node.js HTTP servers must track response completion (`res.writableEnded`), never request stream destruction.
- **Reusable learning:** `Promise.all` is insufficient for abort-safe concurrent work; use `Promise.allSettled` to ensure all spawned processes settle before releasing shared resources or surfacing errors.
- **References:** `index.js`, `tests/unit/index.test.js`, runtime-closure.md

### 2026-09-05 — Vacuous test assertions and timezone-dependent DOM value comparison

- **Status:** Resolved
- **Task/context:** Closing two identified test coverage gaps in the frontend regression suite.
- **Unexpected observation or failure:** Test 1 (`default scan timeline range includes final clip duration`) asserted only that `rangeEndDisplay` was truthy, not that it included the final clip's 60-second duration. If production reverted to `maxTime = Math.max(...startTimes)` the test would still pass. Test 9 exercised dual-player seeking only on `videoPlayer1`, leaving `videoPlayer2` untested under the same unbuffered seek race.
- **Evidence:** Read-only audit (frontend-followup.md section 5) identified both gaps with specific line references and minimal recommended fixes. The naïve fix (`toLocaleString()` with hardcoded regex) fails across timezones and is defeated by `<input type="datetime-local">` normalization stripping `:00.000` suffixes.
- **Approaches tried:**
  - **Attempt:** Hardcode expected timezone-specific strings and regex patterns.
    - **Outcome:** Did not work
    - **Why:** Fails in non-UTC environments; HTML5 datetime-local normalization removes trailing zero seconds/milliseconds.
  - **Attempt:** Compute expected values inside the browser context using a disposable `<input type="datetime-local">` for DOM value normalization, and use Playwright auto-retrying locator assertions for deferred layout timers.
    - **Outcome:** Worked
    - **Why:** Timezone-independent and respects browser serialization rules; auto-retry synchronizes with 100ms deferred `initializeTimeline` timer without manual sleep.
- **Root cause:** Test assertions were copied from fixtures without validating the actual boundary values. Symmetric two-element state arrays need both elements exercised.
- **Resolution:** Test 1 asserts exact browser-locale-formatted end timestamp and rejects the wrong value. Test 9 drives `#nextBtn.click()` to switch to `videoPlayer2` and exercises the same seek race on both physical players. Adversarial mutation proofs on disposable copies confirmed both tests catch their target regressions.
- **Verification:** 14/14 targeted frontend regression tests pass; scoped lint clean.
- **Prevention/follow-up:** Never assert media timeline boundary values as merely truthy. Compute expected DOM values inside the browser to avoid host-timezone drift. Exercise symmetric state abstractions on all instances.
- **Reusable learning:** `expect(value).toBeTruthy()` on a formatted timestamp is vacuous; assert the exact computed value and its wrong alternative. DOM datetime-local inputs normalize values, so derive expected strings from the same browser serialization path.
- **References:** `tests/frontend-regressions.spec.js`, frontend-followup.md, frontend-test-closure.md

### 2026-09-05 — Documentation claims must track actual verified counts, not stale checkpoints

- **Status:** Corrected
- **Correction (2026-09-05):** The original draft of this entry asserted that the project unit test count was 22, citing `runtime-closure.md` and treating it as the global unit test total. That claim was factually false. Authoritative command execution by the native verifier at 01:04 AEST confirmed that the full unit test suite comprises 36 tests passing (36/36) on host Node v26.5.0: 22 backend runtime tests in `tests/unit/index.test.js` plus 14 tooling and manifest tests in `tests/unit/tooling.test.js` (also verified on Node v22.13.0). The entry is corrected to document that partial-suite success was erroneously reported as a global repository total, and to emphasize that permanent documentation must point to canonical gate commands rather than brittle numeric counts.
- **Task/context:** Synchronizing canonical documentation with actual test and scanner evidence after multiple closure passes across disjoint files.
- **Unexpected observation or failure:** An earlier documentation pass erroneously transcribed the 22 backend unit test count from `runtime-closure.md` as the whole-repository unit test total across canonical documentation (`README.md`, `tests/README.md`, and `security_best_practices_report.md`), omitting the 14 tooling and build tests in `tests/unit/tooling.test.js`.
- **Evidence:** Native verifier independent execution at 01:04 AEST confirmed 36 total unit tests passing (22 runtime in `tests/unit/index.test.js` + 14 tooling in `tests/unit/tooling.test.js`) on host Node v26.5.0 and Node v22.13.0.
- **Approaches tried:**
  - **Attempt:** Record partial-suite counts as global repository totals in permanent documentation.
    - **Outcome:** Did not work
    - **Why:** Scoped sub-tasks report only their owned suite, creating brittle documentation errors when concurrent workers add or update tests in disjoint test files.
  - **Attempt:** Reference repository-native gate commands (`npm run precommit`, `npm run prepush`) in permanent documentation, reserving exact counts for dated evidence logs.
    - **Outcome:** Worked
    - **Why:** Prevents documentation drift, eliminates brittle counts, and ensures operators and CI run complete, unified validation gates.
- **Root cause:** A worker in a scoped sub-task (`index.js` runtime closure) reported its owned scope (22 tests), which an agent misgeneralized as the global repository total without verifying `tests/unit/tooling.test.js` (14 tests).
- **Resolution:** Corrected the journal entry to document the complete 36-test suite (22 runtime + 14 tooling). Updated permanent documentation (`README.md` and `tests/README.md`) to reference canonical gate commands (`npm run precommit`, `npm run prepush`) rather than brittle numeric assertions. Scoped dated verification evidence in `security_best_practices_report.md` to the actual 36/36 unit checkpoint.
- **Verification:** Native verifier independently executed and confirmed 36/36 unit test pass on host Node v26.5.0; permanent docs point to gate commands.
- **Prevention/follow-up:** Never generalize a scoped sub-agent's test count as the whole repository total. Check all test files across `tests/unit/*.test.js` before citing numbers, and prefer canonical command names in permanent documentation.
- **Reusable learning:** Partial-suite success must never be reported as a global total; permanent documentation should cite canonical gate commands (`npm run precommit`, `npm run prepush`) rather than brittle numeric assertions that drift across multi-agent sessions.
- **References:** `README.md`, `tests/README.md`, `security_best_practices_report.md`, `tests/unit/index.test.js`, `tests/unit/tooling.test.js`, `user_updates.md`

### 2026-09-05 — Unit test portability defect from uncommitted vendor paths and workstation artifact hashes

- **Status:** Resolved
- **Task/context:** Independent final delta review follow-up and unit test suite portability hardening in `tests/unit/tooling.test.js`.
- **Unexpected observation or failure:** Running unit tests (`npm run test:unit`) in an isolated vendor-free macOS snapshot failed with `AssertionError [ERR_ASSERTION]: Live BUILD-MANIFEST.txt must exist` at `tests/unit/tooling.test.js:441`, proving that clean checkouts and upcoming clean Linux CI (where vendor/ is absent) would unconditionally fail. The unit suite unconditionally required uncommitted `vendor/ffmpeg/macos-arm64/BUILD-MANIFEST.txt` and hardcoded specific workstation artifact hashes (`ebff60c3...` and `dad5d653...`), breaking in any vendor-free environment and across different build toolchains/SDKs.
- **Evidence:** In an isolated clean snapshot lacking `vendor/` and `src-tauri/resources/`, `node --test tests/unit/tooling.test.js` failed at subtest 11 with exit code 1 (`AssertionError [ERR_ASSERTION]: Live BUILD-MANIFEST.txt must exist`). Node v22.13.0 gate execution also failed at subtest 11 with the identical assertion error.
- **Approaches tried:**
  - **Attempt:** Guard test execution with a conditional file existence check (`if (!fs.existsSync(...)) return;`).
    - **Outcome:** Considered and rejected
    - **Why:** Silently bypasses validation in clean environments and CI, providing zero regression coverage for source-build verification logic, while still retaining brittle workstation hash pins when executed locally.
  - **Attempt:** Parameterize expected binary digests via ambient environment variables.
    - **Outcome:** Considered and rejected
    - **Why:** Retains a hard dependency on an external uncommitted directory, adds unnecessary runner configuration overhead, and fails to prove per-build isolation or detect cross-build manifest tampering.
  - **Attempt:** Replace the live-vendor test with an active fixture-based per-build identity regression test that validates multiple distinct simulated builds against identical pinned source configs, verifies distinct recorded binary digests, and proves fail-closed behavior on swapped, stale, or tampered manifests.
    - **Outcome:** Worked
    - **Why:** Entirely self-contained and deterministic across all environments without depending on gitignored files or workstation-specific bytes. It actively tests that identical source pins validate against distinct artifact digests while proving that cross-build swapped manifests, tampered binaries, missing manifests, and missing binaries fail closed.
- **Root cause:** An earlier test author assumed workstation-local generated files in `.gitignore` would always be present during unit testing and conflated universal unit regression coverage with local binary artifact inspection.
- **Resolution:** Replaced the live vendor test in `tests/unit/tooling.test.js` with an active fixture-based per-build identity test. Two simulated builds (Build A and Build B) with distinct binary bytes are generated under identical repository source pins (`buildConfig.ffmpeg`, `buildConfig.x264`, `minimumMacosVersion`). Both validate cleanly against their own recorded digests. Swapped manifests between builds fail with `/ffmpeg binary digest mismatch/`, tampered ffmpeg and ffprobe binaries fail closed, and missing manifests or binaries fail closed without executing fake binaries.
- **Verification:** Scoped ESLint passed with 0 errors/warnings. Focused `node --test tests/unit/tooling.test.js` passed 14/14 on host Node v26.5.0 and Node v22.13.0 in a clean vendor-free snapshot. Complete unit test suite (`node --test tests/unit/*.test.js`) passed 36/36 tests with 0 failures and 0 skips on both host Node v26.5.0 and Node v22.13.0 gate.
- **Prevention/follow-up:** Added an explicit test portability rule to `tests/README.md`. Real native artifact validation remains enforced by canonical copy, check, and packaging scripts (`scripts/copy-ffmpeg-binaries.js`, `scripts/check-ffmpeg.js`) and the native verifier.
- **Reusable learning:** Unit test suites must be hermetic and portable: never assert uncommitted workstation artifacts or environment-specific binary digests; validate per-build provenance contracts using isolated deterministic fixtures with negative fail-closed assertions.
- **References:** `tests/unit/tooling.test.js`, `tests/README.md`, `scripts/copy-ffmpeg-binaries.js`, `scripts/ffmpeg-build-config.js`, `user_updates.md`

### 2026-09-05 — Cancellation must close queues and HTTP lifetimes, not only current children

- **Status:** Resolved
- **Task/context:** Personal second review of the previous review document and scan/export/desktop code.
- **Unexpected observation or failure:** A disconnected scan completed all queued probes and blocked a new scan. SIGTERM killed the first workers but the queue spawned new detached children afterwards. A failed audio probe returned `false`, permitting silent export. Tauri stopped listening for sidecar events after `ready`.
- **Evidence:** An isolated eight-file reproduction observed four new probes after SIGTERM, alive after the sidecar's hard exit; cancelling returned 409 on retry. A failing executable made `hasAudioStream()` resolve `false`. New lifecycle tests then exposed another real flaw: `server.close()` left an active HTTP response waiting on keep-alive, exhausting the two-second deadline.
- **Approaches tried:**
  - **Attempt:** Kill only the currently registered children or suppress only the stale browser response.
    - **Outcome:** Did not work
    - **Why:** Neither closes admission to queued callbacks, and browser cancellation alone does not own backend work.
  - **Attempt:** Propagate combined request/shutdown signals, wait for workers, explicitly close active HTTP connections, and keep native supervision alive.
    - **Outcome:** Worked
    - **Why:** Queues and child spawns share the shutdown state; route cleanup completes before mutex release and native quit. A taken child handle identifies intentional termination, so normal Quit does not show a false crash message.
- **Root cause:** Lifetime ownership was split between the browser, queue, process registry, HTTP keep-alive and native event loop without one common cancellation contract. Audio absence was also conflated with probe failure.
- **Resolution:** Added a process shutdown signal, request lifetimes, streamed cancellable traversal, queue/spawn checks, active-connection closure, fail-closed audio probing, continued Tauri event monitoring and lock release before shutdown waiting. Media probes/transcodes explicitly constrain demuxer and protocols even for system tools.
- **Verification:** Focused lifecycle/tooling gate passed 20 tests. Cancellation and shutdown tests prove only four of eight probes start, descendants and inherited pipes close, the next scan succeeds, and shutdown exits normally. A disguised-playlist browser/API regression observed no network requests.
- **Prevention/follow-up:** Preserve the full process/queue/HTTP regression rather than testing a kill signal alone. Fixture JavaScript is syntax-checked before execution; an initially malformed nested newline and an over-short three-second cold-start wait were test defects, not runtime failures, and were corrected without weakening lifecycle assertions.
- **Reusable learning:** Shutdown must forbid future work before killing current work; successful empty metadata and failed metadata are different states.
- **References:** `index.js`, `src-tauri/src/lib.rs`, `tests/unit/lifecycle.test.js`, `tests/product-reliability.spec.js`, `docs/architecture.md`

### 2026-09-05 — Product correctness cannot depend on guessed metadata or persistent preferences

- **Status:** Resolved
- **Task/context:** Review of source selection, date filters, exact export and keyboard access.
- **Unexpected observation or failure:** Viewer DST rules rejected valid camera wall times; unknown clip durations became one second; a throwing `localStorage` getter could prevent initialization or make successful export feedback fail. Filter presets/clear/toggle left in-flight scan responses valid. Folder browsing was mouse-only and a detected recording card could silently become the output destination.
- **Evidence:** `030826_073000_030826_023000_000001A.MP4` was accepted in UTC but rejected in New York. The player assigned `1` to missing durations. Direct storage calls existed in initialization, folder selection and success handling. Browser tests held responses, denied storage and exercised keyboard-only navigation. Initial tests also exposed that the export path could only be selected through the browser, not pasted manually.
- **Approaches tried:**
  - **Attempt:** Guess missing durations, rely on storage always being available, or automatically choose the largest recording card as output.
    - **Outcome:** Did not work
    - **Why:** These conveniences affected exact output semantics or implied a write destination the user had not chosen.
  - **Attempt:** Keep unknown values explicit, make preferences best-effort, preserve camera civil time, and require explicit destination selection with keyboard and paste support.
    - **Outcome:** Worked
    - **Why:** Correctness no longer depends on persistence, viewer timezone, one-second estimates or a mouse. All filter actions now cancel their old request generation.
- **Root cause:** Optional UI conveniences were treated as reliable runtime facts; distinct camera/viewer timezones and asynchronous input generations were not represented consistently.
- **Resolution:** Added safe storage access shared by all UI modules, timezone-independent calendar checks, an explicit unknown-duration export error, Cancel scan, complete filter cancellation, accurate local-time labels, keyboard dialog/folder behavior and manual output-path entry. New source cards are not automatically chosen for export.
- **Verification:** Multi-timezone unit test passed; new browser regressions exercise storage-denied success, unknown-duration refusal without an export request, cancellation controls, focus/keyboard navigation and explicit destination choice. Final integrated results are recorded in `docs/product-review.md`.
- **Prevention/follow-up:** Test negative browser capabilities and unavailable metadata as first-class cases. Pre-scan filters match clip starts; post-scan selection handles overlaps. Keep that distinction visible in the product and documentation.
- **Reusable learning:** Preferences may fail; unknown is not zero or one; camera civil time is not the viewing computer's local instant.
- **References:** `public/app.js`, `public/player.js`, `public/folder-browser.js`, `public/security.js`, `tests/product-reliability.spec.js`, `README.md`

### 2026-09-05 — Availability checks and packaged notices must match the actual runtime

- **Status:** Resolved
- **Task/context:** Second review of clean-checkout setup, desktop development and resource generation.
- **Unexpected observation or failure:** Working PATH FFmpeg tools failed the documented availability command. A later draft still selected the vendor cache before the actual runtime bundle and treated an intentionally empty development bin directory as corruption. Tauri waited on an unstarted fixed-port dev server. Packaged resources omitted the project license and third-party notice file.
- **Evidence:** Both installed tools returned status zero, but the original checker required generated provenance or explicit overrides. Runtime never selected the vendor cache. `MIOFIVE_SKIP_FFMPEG_BUNDLE=true` deliberately leaves an empty bin directory. Tauri's static frontend configuration did not need `devUrl`. Resource inventory contained only the FFmpeg notice.
- **Approaches tried:**
  - **Attempt:** Validate any available vendor bundle and present it as runtime availability.
    - **Outcome:** Did not work
    - **Why:** It could hide a damaged selected bundle or claim availability of binaries runtime never launches.
  - **Attempt:** Share runtime resolution, keep source-cache validation in build/copy gates, distinguish empty from incomplete bundles, and test exact resource bytes.
    - **Outcome:** Worked
    - **Why:** The checker and application select the same inputs; a nonempty damaged bundle still fails closed, while documented system/development modes work.
- **Root cause:** Setup, runtime selection, provenance validation and distribution contents had drifted into separate inconsistent contracts.
- **Resolution:** Removed the nonexistent dev-server dependency, aligned the media checker, bounded binary inspection subprocesses and copied exact project/third-party notices into generated resources.
- **Verification:** Hermetic tooling tests cover PATH execution, invalid override pairs, damaged manifests, empty development bundles and exact notice copies without depending on ignored workstation artifacts. Native development/package validation and final gates are tracked in `docs/product-review.md`.
- **Prevention/follow-up:** Do not describe metadata declarations or copied notices as full distribution-license certification. Signed/notarized binary release, full notices/source compliance and provenance remain separate gates.
- **Reusable learning:** An availability check must inspect what runtime will launch; a release notice must exist in the produced artifact, not merely in a checklist.
- **References:** `scripts/check-ffmpeg.js`, `scripts/copy-resources.js`, `tests/unit/tooling.test.js`, `src-tauri/tauri.conf.json`, `THIRD_PARTY_NOTICES.md`

### 2026-09-05 — Native diagnostic captures must fail closed on target ambiguity

- **Status:** Resolved
- **Task/context:** Correcting a previous native UI verification attempt during product review.
- **Unexpected observation or failure:** A coordinate-region screenshot captured unrelated desktop windows instead of the converter. A separate correctly identified app-window screenshot did not validate that mistaken capture.
- **Evidence:** The prior coordinator inspected the image, removed the exact local artifact and corrected its verification report. The capture had already appeared in conversation history, which local file deletion cannot erase. No unrelated screenshot is retained or linked in this repository.
- **Approaches tried:**
  - **Attempt:** Use a desktop region when the app window could not be identified reliably.
    - **Outcome:** Did not work
    - **Why:** Coordinates are not proof of application ownership and can include unrelated private data.
  - **Attempt:** Restrict verification to a confirmed app window or owned browser tab and stop capture when identification fails.
    - **Outcome:** Worked
    - **Why:** The allowed surface is established before data is captured; cropping after capture cannot provide that guarantee.
- **Root cause:** A fallback broadened capture scope beyond the application under test.
- **Resolution:** Removed the wrong local artifact in the earlier phase, preserved the honest correction, and added the own-window/tab-only rule to `AGENTS.md`.
- **Verification:** The reviewed source contains no copy or link to the unrelated capture. Future native evidence must identify the owned app/window before capture; API-level checks are not reported as full GUI proof.
- **Prevention/follow-up:** Never replace an unavailable app-window capture with a desktop or coordinate-region capture. Report the narrower evidence boundary instead.
- **Reusable learning:** Privacy scope must be enforced before capture, not repaired by cropping or deletion afterwards.
- **References:** `AGENTS.md`, `docs/product-review.md`

### 2026-09-05 — Late metadata cannot validate an earlier incomplete selection

- **Status:** Resolved
- **Task/context:** Final independent review of exact export and product-boundary regressions.
- **Unexpected observation or failure:** An initial unknown-duration guard could be bypassed by normal preview metadata: an unknown first clip and a known 60-second clip initialized an end of 60 seconds; learning the first duration later permitted that shortened range. Separate boundary checks found viewport x=0 treated as absent and a Unix backslash treated as a Windows separator.
- **Evidence:** The delayed-real-MP4 browser test opened a 0–60 range, released metadata, and received `Failed to fetch` from an intercepted export request before the fix. Thus an export was attempted rather than refused. The path and pointer tests cover their literal boundary inputs.
- **Approaches tried:**
  - **Attempt:** Validate only mutable playback durations once metadata becomes available.
    - **Outcome:** Did not work
    - **Why:** The original exact selection had already discarded the unknown duration; later knowledge did not rebuild its end offset.
  - **Attempt:** Require confirmed original scan durations and ask for rescan/exclusion; distinguish null coordinates and actual platform path prefixes.
    - **Outcome:** Worked
    - **Why:** Preview recovery no longer authorizes an incomplete range, and valid zero/backslash values retain their meaning.
- **Root cause:** Updated metadata was mistaken for proof that an earlier derived range was correct; truthiness and separator heuristics similarly conflated distinct states.
- **Resolution:** Exact-export validation checks both original scan and current preview durations; Unix paths retain literal backslashes and pointer fallback uses nullish checks.
- **Verification:** The late-metadata test failed before and passed after the guard, proving no export request after recovery. Browser regressions also pass for literal parent paths and x=0 seeking. Independent read-only review confirmed the final guard and test transition.
- **Prevention/follow-up:** Keep rescan/exclusion guidance in README and the original-metadata invariant in the architecture contract. Test transitions from unknown to known, not only permanently missing metadata.
- **Reusable learning:** New knowledge does not retroactively validate data derived from incomplete knowledge; rebuild the derivation or fail closed.
- **References:** `public/player.js`, `public/folder-browser.js`, `tests/product-reliability.spec.js`, `docs/architecture.md`

### 2026-09-05 — Output capture limits are not validation results

- **Status:** Resolved
- **Task/context:** Running the literal pre-push gate and native packaging through lean-ctx.
- **Unexpected observation or failure:** Compressed capture returned status 1 after printing passing suites or a completed bundle, with an explicit 120-second capture-limit marker.
- **Evidence:** The first integrated run printed 155 passing browser tests and Rust success but ended with `output truncated at 8 MB / 120s limit`. A later 157-test streaming run returned a real status 0. Packaging exhibited the same capture boundary and was rerun in streaming mode.
- **Approaches tried:**
  - **Attempt:** Use bounded compressed capture for the complete long gate.
    - **Outcome:** Did not work
    - **Why:** Its capture contract cannot represent a successful long-running command without truncation/failure.
  - **Attempt:** Use lean-ctx streaming track mode and inspect the final exit status.
    - **Outcome:** Worked
    - **Why:** The complete unchanged repository gate can finish without weakening tests or claiming success from partial text.
- **Root cause:** A tool output limit was conflated with the underlying command's lifecycle.
- **Resolution:** Use track mode for long validation/build commands, retain the actual exit result, and keep focused compressed commands for short feedback.
- **Verification:** The literal 157-test pre-push gate completed with status 0 in streaming mode; the final post-review gate is recorded in `docs/product-review.md`.
- **Prevention/follow-up:** Added the smallest command/exit-status rule to `AGENTS.md`. Active streams remain uncompressed; closed retained evidence uses Brotli Q6 where tooling permits.
- **Reusable learning:** A wrapper's partial pass-looking output is not a successful gate; verify the command's completed status without changing the gate.
- **References:** `AGENTS.md`, `docs/product-review.md`, `package.json`

### 2026-09-05 — Visible stacked dialogs are not necessarily accessible native dialogs

- **Status:** Corrected
- **Correction:** 2026-09-05: the initial `Resolved` classification and ARIA-only success inference were premature. Rebuilt native app AX checks still lost the folder controls after this patch. The entry now marks that attempt Partial and its root cause as an unconfirmed hypothesis; the later single-shell follow-up records the working native correction.
- **Task/context:** Real macOS scan, playback and export verification after Chromium passed.
- **Unexpected observation or failure:** Opening Select Folder over Export left both visible on screen, but macOS WebKit exposed neither dialog's controls through accessibility. Z-index and Chromium click tests had passed.
- **Evidence:** The app-scoped native accessibility tree lost both dialogs; an app-only image confirmed the folder picker was visibly on top. A new test failed with two visible `aria-modal=true` dialogs instead of one. The ordinary native flow still produced H.264/AAC output with a measured 3.000000-second duration for 0.5–3.5 seconds and quit with both app/sidecar PIDs and the listener gone.
- **Approaches tried:**
  - **Attempt:** Raise z-index while leaving both sibling dialogs modal.
    - **Outcome:** Did not work
    - **Why:** Visual stacking does not resolve conflicting accessibility-modal boundaries.
  - **Attempt:** Make only the top dialog modal and suspend/restore the underlying export dialog's inert and ARIA state.
    - **Outcome:** Partial
    - **Why:** Structural/focus tests passed, but subsequent native AX checks still lost the controls; this did not close the native defect.
- **Root cause:** The initial hypothesis was conflicting sibling modal boundaries. The precise WebKit-internal cause was not established by the structural test.
- **Resolution:** The folder browser now owns a temporary snapshot of the background export dialog's state and restores it on close.
- **Verification:** The new structural/focus regression failed before and passed after the change; all 25 focused product and folder-integration tests passed. Final native AX and complete-gate results are recorded in `docs/product-review.md`.
- **Prevention/follow-up:** Verify the actual target webview, not only Chromium. The native controller authentication attempt failed; app-scoped CUA worked without changing credentials or using a desktop capture.
- **Reusable learning:** Exactly one active modal owns the accessibility boundary; screenshots and CSS z-index alone cannot prove assistive-technology access.
- **References:** `public/folder-browser.js`, `tests/product-reliability.spec.js`, `docs/architecture.md`, `docs/product-review.md`

### 2026-09-05 — Release compilation can invalidate timing-sensitive gate conditions

- **Status:** Resolved
- **Task/context:** Scheduling native packaging and the final pre-push gate on the shared workstation.
- **Unexpected observation or failure:** Five unit tests failed during simultaneous release compilation: a 1.5-second child fixture never wrote its PID, two readiness waits expired, one async output deletion was not yet visible, and a timezone subprocess timed out.
- **Evidence:** The same 42-test unit suite had passed on Node 22.13. During compilation its duration rose to 104.8 seconds and a parser case took 38 seconds. After compilation ended, the unchanged suite passed 42/42 in 13.4 seconds; the containing literal pre-push gate then passed 42 unit, 158 browser and one Rust test.
- **Approaches tried:**
  - **Attempt:** Run the complete release build and timing-sensitive gate concurrently.
    - **Outcome:** Did not work
    - **Why:** Readiness and cleanup deadlines were consumed under substantially slower host execution.
  - **Attempt:** Finish the build, rerun the unchanged unit suite, then rerun the complete containing gate sequentially.
    - **Outcome:** Worked
    - **Why:** All failures disappeared without skipping tests or extending lifecycle assertions.
- **Root cause:** Host execution contention during concurrent compilation is supported by the same-code timing comparison; the exact OS scheduling/I/O bottleneck was not measured.
- **Resolution:** Serialize release compilation and validation on this host and retain the failed run as evidence rather than treating its partial output as success.
- **Verification:** Both the unchanged 42-test unit rerun and the complete 158-browser-test pre-push run returned zero. The later modal correction requires its own final containing gate, recorded in `docs/product-review.md`.
- **Prevention/follow-up:** Added the smallest scheduling rule to `AGENTS.md`; keep process lifecycle deadlines meaningful and recheck clean-checkout CI independently.
- **Reusable learning:** Parallelism is useful only within a measured resource envelope; isolate timing-sensitive validation before diagnosing a runtime regression.
- **References:** `AGENTS.md`, `tests/unit/index.test.js`, `tests/unit/lifecycle.test.js`, `docs/product-review.md`

### 2026-09-05 — An active export must own immutable form state and cancellable focus

- **Status:** Resolved
- **Task/context:** Independent review of the native modal correction.
- **Unexpected observation or failure:** Export disabled only its Confirm button. The user could open Browse during a running request; success then closed the parent and moved focus behind the child folder dialog.
- **Evidence:** Code tracing connected the still-enabled Browse button to asynchronous parent close/focus restoration. Two delayed-response regressions failed before the fix because Browse remained enabled.
- **Approaches tried:**
  - **Attempt:** Permit form edits/child browsing during the job and coordinate all possible parent/child completion states.
    - **Outcome:** Partial
    - **Why:** It adds state transitions while suggesting edits affect a job already submitted with different settings.
  - **Attempt:** Freeze the submitted settings, keep Cancel/Close enabled and focused, and restore controls only for the current request generation.
    - **Outcome:** Worked
    - **Why:** The displayed job remains consistent, cancellation is always reachable, and success cannot strand a subsequently opened child dialog.
- **Root cause:** A running job owned a snapshot of inputs but the form still suggested those inputs could be changed.
- **Resolution:** Centralized busy-state handling for export settings/Confirm; close and current-generation failure cleanup restore the controls.
- **Verification:** Delayed success/error tests assert every relevant setting is disabled, Cancel remains focused/enabled, and controls recover after failure or reopening. Existing stale-response/cancellation coverage is rerun in the same gate; final results are in `docs/product-review.md`.
- **Prevention/follow-up:** Keep cancellation controls outside any disabled settings group and generation-guard asynchronous restoration.
- **Reusable learning:** An in-flight operation needs a stable input contract and an explicit, focus-accessible way to cancel it.
- **References:** `public/player.js`, `tests/product-reliability.spec.js`, `tests/frontend-regressions.spec.js`, `docs/architecture.md`

### 2026-09-05 — Process titles are not a safe diagnostic inventory

- **Status:** Partial
- **Task/context:** Identifying the owned native development supervisor for shutdown verification.
- **Unexpected observation or failure:** A narrowly matched npm process title still included injected session environment data in its command-line output.
- **Evidence:** The title exposed a service credential in tool output even though no environment-dump option was used. No value is reproduced here or copied into repository artifacts.
- **Approaches tried:**
  - **Attempt:** Scope a full-command process search to the task's npm command.
    - **Outcome:** Did not work
    - **Why:** Scope limits which process is read, not which sensitive fields its runtime places in the title.
  - **Attempt:** Resolve PIDs without command-line output and inspect only PID/PPID/executable fields.
    - **Outcome:** Worked
    - **Why:** The owned process and cleanup can be verified without reading environment-bearing arguments.
- **Root cause:** A runtime-generated process title included injected environment state; arguments were incorrectly assumed safer than an explicit environment dump.
- **Resolution:** Subsequent diagnostics use PID/executable-only fields. The user was notified; repository files and PR text contain no credential value.
- **Verification:** Later development shutdown checks used only exact PIDs and listener state. Secret scanning covers the publication candidate independently.
- **Prevention/follow-up:** Added the precise diagnostic rule to `AGENTS.md`. Already-rendered conversation output cannot be erased here; credential revocation/rotation was not performed without separate authority, so containment remains Partial.
- **Reusable learning:** Sensitive state may appear in process titles; select safe output fields before collection, not after it.
- **References:** `AGENTS.md`, `docs/product-review.md`

### 2026-09-05 — Preserve one native dialog boundary when switching form panels

- **Status:** Resolved
- **Task/context:** Follow-up to the corrected stacked-dialog entry and real macOS accessibility verification.
- **Unexpected observation or failure:** The ARIA-only correction passed Chromium but still lost folder controls in the native accessibility tree. Separate native dialogs also failed when switching from Export, even when the parent was closed/hidden and child activation waited a frame.
- **Evidence:** App-scoped AX snapshots and app-only images distinguished visible controls from accessible controls. Removing initially active modal declarations made standalone browsing accessible, but did not resolve Export-to-Folder transitions. The single-shell prototype exposed the folder heading, path, parent-navigation button, selection and cancel controls; native Shift+Tab focused Cancel and selection restored the retained export form and its AX controls.
- **Approaches tried:**
  - **Attempt:** Retire ARIA state, use separate native showModal/close lifecycles, hide the parent and defer the transition by a frame.
    - **Outcome:** Did not work
    - **Why:** The native reproduction persisted. Timing and attribute workarounds did not prove a dependable transition and were removed.
  - **Attempt:** Keep one native dialog open and switch retained Export/Folder panels with title, cancellation and focus ownership.
    - **Outcome:** Worked
    - **Why:** There is no second modal boundary to compete with or transition to; inactive form state is retained but hidden/inert.
- **Root cause:** The application relied on separate persistent modal boundaries and tests of their visual stacking. A WebKit accessibility transition failure was observed, but the engine's internal cause remains unconfirmed; the shared-shell design eliminates that failing application path.
- **Resolution:** Added a small dialog-panel stack, native cancellation routing, safe inactive-parent removal and rebased focus restoration. The no-API fallback explicitly supplies dialog semantics. The offline demo caches the new module.
- **Verification:** All 32 focused product/folder tests passed, including retained form/focus, native cancel, inactive-parent close and the older-API fallback. The fallback role assertion and offline interaction were then added; final containing-gate and exact packaged-artifact results are in `docs/product-review.md`.
- **Prevention/follow-up:** Removed a test helper that forced `display:flex` after an opening failure, replaced z-index assertions with real modal ownership, and added the smallest native-UI/test-integrity rule to `AGENTS.md`.
- **Reusable learning:** Prefer one stable native accessibility boundary over accumulating unproven modal-transition workarounds; never make a test open the UI it was supposed to verify.
- **References:** `public/dialog.js`, `tests/product-reliability.spec.js`, `tests/export-folder-browser.spec.js`, `tests/folder-browser.spec.js`, `tests/pwa.spec.js`, `docs/architecture.md`

### 2026-09-05 — Text review does not cover executable-mode drift

- **Status:** Resolved
- **Task/context:** Final unpublished commit inspection of the recovered review candidate.
- **Unexpected observation or failure:** The existing shebang media-copy entry point had changed from Git mode 100755 to 100644, although its supported Node invocation and all content tests passed.
- **Evidence:** The commit summary exposed the mode change; the preceding text/stat review did not make it apparent.
- **Approaches tried:**
  - **Attempt:** Validate only the canonical `node scripts/copy-ffmpeg-binaries.js` path.
    - **Outcome:** Partial
    - **Why:** Node can read a non-executable script, so this did not protect its direct shebang entry point.
  - **Attempt:** Restore the original executable bit and verify direct invocation.
    - **Outcome:** Worked
    - **Why:** The existing interface is preserved without changing tested JavaScript bytes.
- **Root cause:** Executable-mode drift in the recovered candidate was outside the text-only review signal; the earlier edit operation responsible was not established.
- **Resolution:** Restored mode 100755 before publication and added a staged-summary review rule.
- **Verification:** Direct invocation completed successfully; source bytes and the tested application bundle are unchanged.
- **Prevention/follow-up:** Inspect staged modes/renames/deletions in addition to source content and tests.
- **Reusable learning:** A passing interpreter invocation does not verify a script's executable entry point.
- **References:** `scripts/copy-ffmpeg-binaries.js`, `AGENTS.md`

### 2026-09-05 — A passing local gate is not a passing hosted security analysis

- **Status:** Resolved
- **Task/context:** Exact-head PR #45 validation after source publication.
- **Unexpected observation or failure:** Clean local scanners and JavaScript/Rust CI passed, but CodeQL reported 26 alerts and failed its result check.
- **Evidence:** Analysis `1727707788` at `5bab61c647fbf3662f895e8c39f7a9bcaa3bc9b6`; source/sink review identified missing control-route rate limiting, unsafe manifest replacement and a predictable test temporary directory among intentional local-path/tool-selection flows.
- **Approaches tried:**
  - **Attempt:** Reuse the ad hoc browse/video counter and infer security status from local gates.
    - **Outcome:** Did not work
    - **Why:** Other expensive private routes had no quota, and local scanners do not run CodeQL's dataflow queries.
  - **Attempt:** Trace every alert with independent read-only reviews, implement real fixes, and document exact false-positive evidence without query exclusions.
    - **Outcome:** Worked
    - **Why:** The code corrections address observable behavior while preserving the tool's future coverage.
- **Root cause:** Incomplete middleware coverage, validation followed by a truncating pathname write, and predictable test fixture allocation; generic web-service queries also lack this product's intentional local-operator path semantics.
- **Resolution:** Maintained private-route quotas before costly work, separate media budget, private `mkdtemp` fixtures, and no-follow manifest reads plus exclusive atomic sibling publication. Explicit parent/host trust assumptions are documented rather than inferred from loopback.
- **Verification:** Unit tests exercise actual route exhaustion, window reset, rejected-origin budget isolation, spoofed forwarding headers, symlink manifest substitution and interrupted writes; the containing gate and final hosted state are tracked in `docs/product-review.md` and PR #45.
- **Prevention/follow-up:** Never replace a hosted failure with a different scanner's pass. Any alert disposition must name the exact dataflow and be revalidated on the current head.
- **Reusable learning:** Distinguish genuine vulnerabilities, intentional privileged interfaces and unproven assumptions; no broad suppression follows from a locally trusted application model.
- **References:** `docs/codeql-triage.md`, `tests/unit/rate-limits.test.js`, `tests/unit/tooling.test.js`, `tests/frontend-regressions.spec.js`

### 2026-09-05 — Exclusive creation does not protect a later pathname reopen

- **Status:** Resolved
- **Task/context:** Adversarial review of CodeQL output-path and cleanup flows.
- **Unexpected observation or failure:** Export created a public file with `wx`, closed it, then FFmpeg reopened that pathname with overwrite enabled. Failure cleanup later unlinked the same public name without retaining ownership.
- **Evidence:** The published sequence at `5bab61c` allowed replacement between reservation and encoding/cleanup. Regression fixtures now insert competing files/symlinks, retarget a selected directory alias and cancel on either side of publication.
- **Approaches tried:**
  - **Attempt:** Rely on initial `wx` reservation or add an inode check before deleting a public path.
    - **Outcome:** Did not work
    - **Why:** Reopening loses the descriptor's identity, and check-then-unlink is not an atomic compare-and-delete operation.
  - **Attempt:** Encode privately and use rename/copy as a universal publication fallback.
    - **Outcome:** Did not work
    - **Why:** Ordinary rename can overwrite, while exclusive copy does not promise atomic complete-file visibility. This alternative was rejected by API semantics, not a successful implementation experiment.
  - **Attempt:** Canonical private staging with atomic no-clobber hard-link publication, capability preflight and a clear unsupported-filesystem error.
    - **Outcome:** Worked
    - **Why:** No public name is reopened by FFmpeg or unlinked on cancellation; successful publication is an explicit commit point.
- **Root cause:** Filename reservation was incorrectly treated as continuing ownership across independent opens and deletes.
- **Resolution:** Added `export-output.js`; unsupported destinations fail before encoding, late disconnect keeps completed output, and cleanup touches only known staging entries under an identity-checked directory. Parent directories must remain trusted/stable.
- **Verification:** Seven focused publication tests and the real HTTP-disconnect regression pass; competing data survives and partial staging is removed. The first real-export assertion exposed macOS `/var` versus `/private/var` canonical aliases; assertions now compare the actual canonical output path instead of requiring an obsolete lexical alias.
- **Prevention/follow-up:** Preserve no-clobber publication and both cancellation-boundary tests. README explains APFS/local-disk export followed by a manual copy for exFAT/FAT, canonical returned paths and abrupt-termination staging inspection. Power-loss durability and hostile parent replacement are not certified.
- **Reusable learning:** A safe output workflow needs private work, one publication commit point, and cleanup ownership; exclusive creation alone is not that workflow.
- **References:** `export-output.js`, `tests/unit/export-output.test.js`, `tests/unit/index.test.js`, `tests/api.spec.js`, `docs/architecture.md`

### 2026-09-05 — A retry rejected before a mutex cannot prove its release

- **Status:** Resolved
- **Task/context:** Independent adversarial review of export cancellation regressions.
- **Unexpected observation or failure:** Three tests claimed to prove mutex release by submitting an empty file list and expecting HTTP 400.
- **Evidence:** `handleExportRequest` rejects empty files before checking `exportInProgress`; that assertion would pass even with a permanently stuck mutex.
- **Approaches tried:**
  - **Attempt:** Assert only that the retry is not HTTP 409.
    - **Outcome:** Did not work
    - **Why:** The request never reached admission.
  - **Attempt:** Submit valid files/output while deliberately making FFmpeg unavailable, then assert the post-mutex tool-preflight error.
    - **Outcome:** Worked
    - **Why:** That response can only occur after crossing and acquiring the export mutex; it needs no expensive second transcode.
- **Root cause:** The assertion observed a status code without tracing the handler's validation order.
- **Resolution:** Strengthened encoding-, duration-probe- and audio-probe-cancellation retries and added a concise prevention rule to `AGENTS.md`.
- **Verification:** The containing unit/pre-push gates in `docs/product-review.md` include the strengthened requests; real process termination and staging cleanup assertions remain intact.
- **Prevention/follow-up:** Test state transitions using a stimulus that can actually reach the claimed transition, and assert a response unique to the post-transition path.
- **Reusable learning:** Negative input validation is not evidence that a protected operation can be admitted again.
- **References:** `tests/unit/index.test.js`, `index.js`, `AGENTS.md`

### 2026-09-05 — A race regression must protect its own competing-file fixture

- **Status:** Resolved
- **Task/context:** Exact-head CodeQL refresh of the real HTTP-disconnect export regression.
- **Unexpected observation or failure:** The regression checked that a public filename was absent, then created and read a competing sentinel through separate pathname operations. CodeQL correctly identified that fixture's check/reopen pattern; its original failure cleanup also depended on reaching the normal cancellation assertion.
- **Evidence:** SARIF `1727829984` at `c0696cc` reported fixture alerts #56/#57. With the strengthened test copied into an isolated `5bab61c` snapshot, the old implementation failed specifically with `no public placeholder while encoding` and the test process exited without a timeout. The corrected implementation passes the focused test.
- **Approaches tried:**
  - **Attempt:** Keep reading the competing file by pathname or exclude intentional race fixtures from security analysis.
    - **Outcome:** Did not work
    - **Why:** Reopening repeats the unsafe pattern, and excluding tests would hide unrelated future defects.
  - **Attempt:** Retain an exclusive read/write descriptor, assert the public path still names its inode and size, and verify contents at explicit offset zero.
    - **Outcome:** Worked
    - **Why:** The fixture owns exactly the object it wrote, while the separate public-path assertion prevents a deleted-but-still-open file from falsely proving preservation.
- **Root cause:** A test of pathname ownership relied on pathname reopening for its own evidence; cleanup was written for the passing path rather than the deliberately failing baseline.
- **Resolution:** Use `wx+` and retained descriptor identity/content checks. Destroy the owned HTTP request, terminate its owned process group on failure and close active server connections in `finally` before fixture removal.
- **Verification:** Focused green regression passed; the same test failed on the old backend at the intended assertion, with normal test-runner termination. The containing gate is recorded in `docs/product-review.md`; the red log is retained privately as Brotli Q6.
- **Prevention/follow-up:** Keep both public-path and descriptor assertions, exercise the red baseline, and never weaken a regression to appease static analysis. No application or packaged-resource inputs changed in this fixture-only follow-up.
- **Reusable learning:** A regression's evidence must remain valid under the same failure it is designed to detect, and its failing path must release owned resources.
- **References:** `tests/unit/index.test.js`, `docs/codeql-triage.md`, `AGENTS.md`
