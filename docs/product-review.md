# Product review and delivery evidence

Review date: 2026-09-05 (Australia/Brisbane). Scope: the previous review document, current source changes, scan/playback/export user journeys, loopback security, process ownership, setup, desktop packaging and clean-checkout delivery. This is a source pull-request review, not a signed binary release certification.

## What the second review corrected

The previous report described useful completed work but mixed interim gates with final evidence. It also retained a removed Linux shell `kill` fallback, a stale minimum-Node status, and an unjustified inference that recovery of useful changes proved lossless worktree recovery. Component tests, native API exercises, real GUI interaction, clean-checkout CI and release signing are separate evidence gates. Historical journal entries remain historical; the current contract is in `README.md` and `docs/architecture.md`.

| Finding | Resolution | Regression evidence |
| --- | --- | --- |
| P1: scan queues launched detached probes after shutdown had killed the initial workers | Shared shutdown signal reaches admission, queues and subprocesses; HTTP connections close before the bounded cleanup deadline | `tests/unit/lifecycle.test.js`: shutdown during eight queued clips; only four start; all descendants stop; server exits normally |
| P2: cancelling a scan left backend work and its mutex active | Request-disconnect cancellation propagates through streamed directory traversal and duration probes; workers settle before mutex release | Same suite: disconnect, descendant/pipe termination, queue count and successful next scan |
| P2: failed audio probing could silently produce a soundless export | Only a successful empty audio probe means no audio; probe errors fail the export and cleanup partial output | Audio-probe negative test and existing export-abort/cleanup coverage |
| P2: camera wall times were validated using the viewer's DST rules | Calendar validation uses timezone-independent components; camera `localTime` has no timezone suffix | Same filename tested under UTC, New York's DST gap and Brisbane |
| P2: storage denial could break initialization, folder selection or successful-export feedback | Shared best-effort preference wrapper; no dependency of product correctness on browser persistence | Browser test with a throwing `localStorage` getter |
| P2: unknown clip durations were guessed, and late preview metadata could authorize an already-shortened range | Require confirmed original scan durations; rescan/exclude to rebuild the selection | Tests prove no `/export` request, including a two-clip delayed-metadata reproduction that failed before the fix |
| P2: several filter controls failed to invalidate in-flight scans | Cancel button and filter toggle/preset/clear actions invalidate request generations | Held-response browser tests for all four controls |
| P2: folder browsing required a mouse and automatically reused discovered recording media for output | Keyboard activation, dialog labels, focus trap/restore, disabled unvalidated selection, manually editable output path and explicit destination choice | Keyboard and output-destination browser tests |
| P2: switching separate dialogs hid controls from macOS WebKit's accessibility tree | One native shell with retained Export/Folder panels, active cancellation and focus restoration | Native AX reproduction; shared-shell controls/keyboard/selection verified in app; regression tests cover panel and parent-close lifecycle |
| P2: an export could finish while the user changed settings/opened its child folder dialog | Freeze submitted settings and Browse while preserving focused Cancel/Close; restore only the current request generation | Held success/error responses and existing cancellation/stale-response tests |
| P2: a literal Unix backslash changed parent-path interpretation; pointer x=0 produced an invalid media seek | Recognize only actual Windows path prefixes; use nullish rather than truthy coordinate fallback | Real temporary-folder navigation and viewport-edge scrub browser tests |
| P2: MP4 extension alone did not constrain system FFmpeg input protocols | MOV/MP4 demuxer and local-only protocols are explicit for every file input/probe | Disguised network playlist is rejected; loopback HTTP trap receives no requests |
| P2: desktop development waited for an unstarted port-3000 server | Start from static `frontendDist`; owned sidecar selects an ephemeral loopback port | Configuration regression and native development smoke gate |
| P2: desktop monitoring ended at `ready` | Continue reading sidecar events, clear an unexpectedly terminated child, display recovery guidance, and suppress errors on intentional Quit | Independent adversarial code review plus native lifecycle verification |
| P2: media availability check selected artifacts runtime did not use | Share runtime resolver; validate actual bundled bytes before execution; support system tools and an intentionally empty development bundle | Hermetic PATH/override/incomplete-bundle tests |
| P2: project and third-party notices were absent from packaged resources | Generate exact copies alongside the FFmpeg notice | Resource-copy byte comparison and native bundle inspection |
| P1: exclusive output reservation did not survive later pathname replacement | Encode in canonical private staging; publish using no-clobber hard links; late disconnect retains complete output | Seven publication tests plus strengthened real HTTP-cancellation tests |
| P2: most expensive private routes lacked a rate limit | Maintained middleware, separate control/media budgets, limits before JSON/filesystem/process work | Real route exhaustion, reset, spoofed-header and origin-budget tests |
| P2: cached manifest validation preceded a truncating pathname write | No-follow descriptor validation and private atomic sibling publication | Existing/swapped symlinks, interrupted write and temporary-name collision tests |

## Decisions and tradeoffs

- Cancellation: merely hide stale browser responses (insufficient resource ownership), create a persistent job service (unnecessary for one local operation), or propagate request/process signals through existing queues. The third approach preserves the local architecture and is covered by real process-tree reproductions.
- Unknown metadata: guess durations (wrong exact ranges), silently omit clips (data loss), or reject exact export until all selected scan durations are known. Recomputing an untouched default after asynchronous metadata would require preserving the original selection intent; allowing mutable preview metadata alone silently shortened a range. The product requires rescan/exclusion with guidance; ordinary preview remains available.
- Tool availability: trust the source-build cache (not a runtime input), require operator overrides for every source checkout (contradicts setup), or follow runtime candidates while failing closed on a damaged bundle. The last approach separates development availability from release provenance.
- Folder selection: automatically choose a source card (surprising write destination) or let the user explicitly choose/paste an output folder. Previously selected valid output folders remain a convenience; fresh cards are not implied consent.
- Media parsing: rely on `.mp4` names or restrict both demuxer and protocols. Explicit restrictions keep system and bundled FFmpeg aligned without adding a network service or upload path.
- Modal ownership: z-index/ARIA retirement, two native dialogs, and a frame-delayed close/open all failed the native AX reproduction. A single native shell switching retained panels succeeded without timing workarounds or losing form state. Chromium structural checks now assert that contract, not arbitrary z-index values or forced DOM visibility.

## Verification record

### Published checkpoint `5bab61c` (before the CodeQL follow-up)

All results below are observed on 2026-09-05 (Brisbane), not inferred from a prior agent's summary.

- Final `npm run prepush`: **passed**, exit 0 in 248.610 seconds. ESLint, 42 unit tests, declared-license metadata checks, Rust formatting, all **164 Playwright tests** (one worker, zero retries), Clippy with warnings denied and one Rust test. Retained completed output is Brotli Q6. The earlier overloaded run failed and was not counted; unchanged tests passed after release compilation finished.
- Minimum supported runtime: **Node 22.13.0**, all 42 unit tests passed with zero skips. The full host gate used Node 26.5.0.
- Focused evidence: 20 lifecycle/tooling tests; 32 final product/folder tests before the containing gate. Late metadata and editable running-export settings were reproduced with failing regressions before their fixes. The initial modal structural test was insufficient; native reproduction drove the single-shell correction and stronger panel/focus/cancellation/fallback tests.
- `npm audit --audit-level=high`: **0 vulnerabilities**. `cargo audit --file src-tauri/Cargo.lock`: **0 vulnerability-category advisories**, 16 unmaintained warnings and one upstream `glib` unsoundness warning; see the security report for target-specific risk. These are not a zero-risk certification.
- Checksum-verified gitleaks 8.30.1 (candidate tree and all-ref history), actionlint 1.7.12, and zizmor 1.30.0 (regular and pedantic/offline): **zero findings**, all five commands exited 0 on the 147-file pre-commit candidate and 264 existing commits. The committed candidate is rechecked before push. No coordinator notes, user media or generated application binaries are included.
- Native development: `npm run desktop -- --no-watch` started with no listener on port 3000; its owned ephemeral sidecar served a byte-identical current frontend asset. Interrupting the dev supervisor exited 130 as expected and left neither app/sidecar PID nor its port. The standalone debug executable was not addressable by the app automation provider, so this is startup/API/cleanup evidence, not a full dev-window GUI claim.
- Packaged macOS GUI: the final full build selected a synthetic input folder through AX-visible controls, scanned 10 clips, played/paused/switched clips, opened Export/Folder panels, cycled keyboard focus, retained form values and selected a separate output folder. During export all submitted settings/Browse were disabled and Cancel remained focused/enabled. Range 0.5–3.5 produced H.264/AAC, 160×120, **3.000000 seconds** measured by bundled ffprobe. Ordinary Quit removed both identified app/sidecar PIDs and the listener. This confirms the shared-shell native correction on the actual final build, not only a resource-only prototype.
- Native packaging: final `npm run pack:mac` **passed**, exit 0 in 182.842 seconds. Generated public assets, tools, manifest, sidecar and notices matched their source bytes. The complete bundle file/mode manifest digest was `9362464c576d1582df1ac717ada660eb8db59cbb3a5ae1b93dcab6972094e70f`, unchanged after the GUI run. The bundle has only a linker ad-hoc executable signature; `codesign --verify --deep --strict` **failed** resource-seal verification. This is a local source-build/run result, not signed/notarized distribution approval; no binary is published.
- Two independent read-only adversarial reviewers inspected runtime and delivery changes. Follow-up review found late-metadata, running-export focus and fallback dialog-role cases; the corresponding corrections are included. The final single-shell lifecycle design was independently re-reviewed without a native lifecycle blocker in that bounded scope.
- Remote CI is a separate exact-PR-head gate and is not claimed by local results. Current `main` protection has empty required-check contexts and does not enforce admins, so this PR must remain open for owner review instead of self-merge. Published check results belong to the PR, not a mutable local report.

### CodeQL follow-up

The first published head passed clean-checkout JavaScript and Rust CI but failed CodeQL with 26 alerts. Root and both independent reviewers traced the exact SARIF and distinguished intentional local-operator paths from real rate-limiting, manifest-write, temporary-fixture and output-ownership defects. [Per-alert evidence](codeql-triage.md) preserves the scope; no broad query exclusions or severity reductions were added.

The follow-up adds private/no-clobber export publication, capability preflight, quotas before expensive work, no-follow/atomic manifest replacement and `mkdtemp` fixtures. It also corrects the proof of mutex release: a retry must pass pre-mutex input validation. Four manifest tests include a temporary-name collision to prove failed exclusive creation cannot authorize cleanup.

Minimum Node 22.13.0 passed all **55 unit tests**, zero skips, after these corrections. Final `npm run prepush` then passed, exit 0 in **254.378 seconds**: 55 unit tests, **164 Playwright tests**, lint, declared-license metadata (300 npm/458 Cargo entries), Rust fmt/Clippy and one Rust test. `npm audit --audit-level=high` reports zero vulnerabilities after the reviewed exact dependency addition. Closed logs are Brotli Q6. The earlier 42-test/artifact checkpoint above must not be presented as this follow-up's final build.

Rebuilt `npm run pack:mac` passed, exit 0 in **214.619 seconds**. Source/generated/bundled assets, notices, tools and sidecar matched. The final 21-file/mode manifest SHA-256 is `6d54d6dbdd24781df45f21ff37ab7297a335f1c8df5ef22410b79101fb369457`; it remained identical after native GUI testing. The final app scanned 10 synthetic clips, exercised player controls and retained Export/Folder panels with keyboard focus, then exported 0.5–3.5 seconds to an already occupied name. The existing sentinel hash stayed unchanged, success reported the `_1.mp4` suffix, and verified H.264/AAC 160×120 duration was **3.000000 seconds**. Ordinary Quit removed both identified processes and port 52138. Full resource-seal signature verification still fails; this is not a signed/notarized release.

The independent follow-up found no remaining data-loss blocker under the documented trusted-parent assumption; its mutex-proof and route-case cache findings were corrected and included in the final gate. Exact committed-head scanners and hosted checks are read back before/after push and recorded in PR #45. In particular, passing local checks is not substituted for a failed hosted CodeQL result.

### Fixture proof follow-up

Exact head `c0696cc08d34439a276f3a9c812aedd2f6cc50e5` passed both clean-checkout JavaScript and Rust CI ([run 33930516024](https://github.com/dst0/miofive-video-converter/actions/runs/33930516024)). Its CodeQL result still failed with 20 alerts: 18 narrowly reviewed intentional local-path/operator flows and two competing-file fixture findings. No alerts were dismissed or queries excluded. The [dated triage refresh](codeql-triage.md) records the new IDs and exact dataflow assumptions.

The fixture now retains an exclusively created descriptor, checks the public path still names that same regular inode and size, reads contents at explicit offset zero and releases owned requests/process groups even if an early assertion fails. Copied into a disposable `5bab61c` snapshot, that same strengthened test failed specifically at `no public placeholder while encoding`, then terminated normally without a test timeout. It passes with the corrected backend. All **55 unit tests** passed again on actual **Node 22.13.0**, zero skips, in **16.248 seconds**.

Only tests, instructions and documentation change after the `c0696cc` native proof: application, dependency, build and packaged-resource inputs remain identical. A fresh source/resource comparison and complete bundle manifest check still produced `6d54d6dbdd24781df45f21ff37ab7297a335f1c8df5ef22410b79101fb369457`. This is verification of the same already GUI-tested bytes, not a claimed new build or signed release. Updated-head hosted checks and alert disposition remain separate gates, recorded in the PR after push.

The final containing `npm run prepush` passed with exit 0 in **267.586 seconds**: **55 unit tests**, **164 Playwright tests** (one worker, zero retries), lint, declared-license metadata checks, Rust fmt/Clippy and **one Rust test**. The completed output is retained as Brotli Q6. An independent read-only review found no actionable blocker in the strengthened identity/content assertions or early-failure cleanup.

## 2026-09-06 practical reliability follow-up

The follow-up stays within the local open-source utility: media recovery, preserving a working installation, regression evidence and accurate setup instructions. No signing/notarization, SBOM/provenance, authentication service or enterprise-security framework is added. Root owns architecture and acceptance; bounded implementation and independent reviews used AGY CLI with `gemini-3.8-flash-high` and high effort in exact isolated clones.

- Playback failures now have source-owned recovery beyond initial readiness, including child-source errors and failed cross-clip seeks. Current failures pause and show reconnect/rescan-or-select guidance; old/inactive sources cannot interrupt a new selection. Manual navigation keeps paused intent.
- The local installer validates the source and staged bundle before replacing a working app. Exclusive staging protects unrelated colliding content, and copy/promotion/rollback failures retain the available old installation with actionable diagnostics. Existing explicit media-tool overrides remain supported.
- [Six old PRs were reconciled against exact heads](git-reconciliation.md). Their useful intent is represented, but semantic replacement is not a merge or proof of lossless historical recovery. No PR/ref/worktree deletion occurred.
- Alternatives rejected: a new playback state framework, generic plist/HTML package parsing with guessed executable names, and a new release-security pipeline. Existing generation guards and the actual Tauri layout provide a smaller fix.

Focused verification before the containing gate: twelve browser tests passed after the independent review's paused-navigation timeout fix and root's buffered-error guard. The latter test first failed on the intermediate candidate because recovery guidance stayed hidden. Baseline `8c698e5` failed the active-error UI-state regression. Missing-host and staging-collision tests also failed on that baseline, the latter specifically because foreign content was deleted. All 24 installer tests and repository lint passed after acceptance corrections. A headed browser showed recovery guidance, paused controls and the correct Video 10 of 10 overlay for the same failed clip-10 request. A real local `.app` installed into an owned temporary destination with all 21 file contents/modes matching, the old sentinel retained in backup and source unchanged; no user app was replaced.

Final literal `npm run prepush` **passed**, exit 0 in **257.219 seconds** on Node 26.5.0: **79 unit tests**, **176 Playwright tests** (one worker, zero retries), lint, 300 npm/458 Cargo license metadata entries, Rust fmt/Clippy and **one Rust test**. Completed gate logs are retained as Brotli Q6. `npm audit --audit-level=high` returned zero vulnerabilities; both lockfile hashes remained unchanged throughout this follow-up. Earlier dated build digests and native GUI results above are historical, not evidence for changed frontend bytes.

Final `npm run pack:mac` **passed**, exit 0 in **333.678 seconds**. Generated/bundled UI files, media tools, notices and sidecar matched their source bytes. The 21-file/mode bundle manifest digest is `67292f4970a1c6514896efab54ce05ea45030f7b34af7e6a12576bbb182f0fc3`. Installation of that exact bundle into an owned temporary destination preserved its previous sentinel in backup, matched every installed file/mode and left the source unchanged. The temporary copy was removed after verification; the user's Applications directory was not touched. Current changed-UI evidence is the headed browser and automated suite, not a claimed rerun of the earlier native GUI export. Full resource-seal signature verification still fails for this local build; no signed/notarized binary is published.

## 2026-09-08 capability-state follow-up

A final code and review-document pass found a practical UI race that the earlier reliability work did not cover. FFmpeg availability was initialized optimistically, so a fast scan could render Export enabled before the asynchronous capability check settled. A later unavailable response or request failure updated only an internal boolean, leaving already-rendered review and player export controls stale; the failure path also omitted the visible setup guidance.

Export now starts unavailable until the local capability check succeeds. One state update synchronizes the dynamic review button, the static player button and the warning banner; both unavailable and request-failure results leave export disabled with actionable guidance, while playback remains available. The player control is disabled in initial markup to close the pre-initialization window, explains that export requires FFmpeg and FFprobe, and retains a neutral high-contrast disabled appearance on hover. The export handler also rejects a stale or synthetic click while capability is unconfirmed. Three unrelated trailing-whitespace findings in the existing demo test were removed so the complete diff passes `git diff --check`.

The same review considered changing `player.js:isExportModalOpen` while the retained folder panel is active. Real keyboard/dialog tests did not reproduce a user-visible defect: the folder browser owns Tab/Escape through immediate propagation control, hidden parent controls are excluded from focus trapping, and keeping the parent modal state suppresses playback shortcuts behind the child panel. That proposal was rejected rather than adding an unproved state change.

The new deferred-route tests failed **3/3** against exact prior head `a8d3420178c21b17178aa7ef060e06a79b9d2532`, with the review export control received enabled while `/check-ffmpeg` was still pending. An intermediate candidate also reproduced the disabled player button's misleading green hover, missing explanation and 1.6:1 text contrast. The accepted implementation passes all three focused pending/available/unavailable/failure scenarios, including both export controls, playable video, truthful labels, stable disabled hover and 9.6:1 text contrast. Independent read-only review also passed the 34-test touched suites and the 36 existing player/export tests before identifying and verifying the visual follow-up.

Final literal `npm run prepush` **passed**, exit 0 in **229.47 seconds**: lint, **79 unit tests**, license metadata checks, **179 Playwright tests** with one worker and zero retries, Rust formatting/Clippy with warnings denied and **one Rust test**. This is source and browser evidence for the changed frontend bytes. Earlier package/install/native-GUI evidence remains historical and is not re-labelled as proof of a newly built signed application. Exact-head hosted CI, CodeQL annotations and PR merge state are refreshed separately after push.

## 2026-09-08 consolidated dependency follow-up

Following the merge of PR #45 at commit `7670dfd8be6dccb73d62d811fb0f25d5b508c563`, five post-merge Dependabot dependency updates were consolidated into a single reviewed follow-up branch (`codex/dependency-review-20260908`). Rather than running `cargo update` which risks Cargo resolver drift, the exact patch union of the five approved Dependabot commits was applied via `git cherry-pick --no-commit`.

### Exact dependency versions

- **Rust / Cargo (`src-tauri/Cargo.lock`):**
  - `libc`: 0.2.186 → 0.2.189 (PR #46, commit `9047e4901b095b9caf43cb62a8ad797cdd9f45da`)
  - `tauri-plugin-shell`: 2.3.5 → 2.3.6 (PR #47, commit `6524560446312c8d0ac921c1a0e6b6ce4a528090`)
  - `tauri-build`: 2.6.2 → 2.6.3 and transitive `tauri-utils`: 2.9.2 → 2.9.3 (PR #48, commit `0375376251ed6ff857683b01765c9ec9e9eb854d`)
  - `serde_json`: 1.0.150 → 1.0.151 (PR #49, commit `0bd962bccc2b87c384508df4021fea5cb117f50d`)
- **JavaScript / npm (`package.json`, `package-lock.json`):**
  - `@playwright/test`: 1.62.1 → 1.63.0 (PR #50, commit `a1e5741d4be2bd01d6546975452494f447e7e3a8`)
  - `eslint`: 10.9.1 → 10.10.0 (PR #50, commit `a1e5741d4be2bd01d6546975452494f447e7e3a8`)
  - Associated dev-dependency lockfile resolutions updated identically to PR #50 without collateral resolver drift.

### Honest target scope and verification

- **Scope boundaries:** Pure dependency maintenance only. Zero runtime features added; no `.mjs` files introduced; `.github/dependabot.yml` unchanged.
- **Lockfile stability:** `npm ci --ignore-scripts` executed cleanly without mutating lockfiles; SHA-256 digests of `package.json`, `package-lock.json`, and `src-tauri/Cargo.lock` remained identical before and after installation.
- **Security audits:**
  - `npm audit --audit-level=high`: Exited 0 with **0 vulnerabilities**.
  - `cargo audit --file src-tauri/Cargo.lock`: Exited 0 with **0 vulnerability advisories** and 7 allowed warnings (6 unmaintained, 1 unsoundness). Truthfully recorded the known `glib` advisory (`RUSTSEC-2024-0429`: unsoundness in `VariantStrIter` implementation), which belongs exclusively to the Linux GTK/WebKitGTK target dependency tree and is neither linked nor executed in the macOS desktop application or Node backend. The warning is neither suppressed nor dismissed.
- **Prepush gate:** Literal `npm run prepush` validation passed with exit 0 in **592.57 seconds** on Node 26.5.0: ESLint passed, **79 unit tests** passed, license metadata checks passed (307 npm / 458 Cargo entries), **179 Playwright tests** passed (single worker, zero retries), Rust formatting and Clippy passed with warnings denied, and **one Rust test** passed.
- **Git diff cleanliness:** `git diff --check` passed cleanly with 0 errors.

## Current boundaries

- The product is single-user and loopback-only. No remote deployment, authentication service, telemetry or upload feature is introduced.
- Source recordings are never edited. Exact exports concatenate selected clips; clock gaps are not synthesized. Users must still verify output before deleting originals.
- Only synthetic repository media is used for tests. Diagnostic captures must be tied to the owned app window/browser tab; unrelated desktop content is forbidden.
- Source-build manifests prove source-pin and artifact-hash consistency, not signed provenance. Package-license metadata and copied notices are not a comprehensive distribution-license determination.
- This PR publishes tested source, not a signed/notarized installer or deployed runtime. Public binary-release verification remains separate; no new signing, SBOM/provenance or enterprise-security framework is introduced in this source follow-up.
- Existing primary-worktree user files are preserved. Missing historical temporary worktrees remain an uncertain historical event; verified backups protect current work, but do not establish lossless historical recovery.
