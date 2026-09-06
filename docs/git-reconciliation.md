# Open pull-request reconciliation

Checked on 2026-09-06 against PR #45 at `8c698e556ba207a933e591ab9672bf30e378972f` (`codex/recovered-full-review-20260904`). Remote `main` was `e00e106f62b3852eece30e50b7ac0d129ceb2c03`.

All six PRs below were open and unmerged. Root refreshed GitHub metadata, fetched the exact public PR heads into an isolated clone, and independently checked the worker's comparisons. None of the six original heads is a Git ancestor of this PR #45 baseline. Semantic replacement is **not** a claim of identical bytes, a merge, or lossless recovery of historical worktrees.

## Functional changes

| PR | Original intent | Replacement in #45 | Evidence and limits |
| --- | --- | --- | --- |
| [#35](https://github.com/dst0/miofive-video-converter/pull/35) | Track play promises during rapid play/pause and navigation | Generation tokens invalidate obsolete play requests; expected `AbortError` is ignored; pause does not wait indefinitely for a pending play promise | `requestPlay` / `pausePlayer` in [player.js](../public/player.js); [playback race tests](../tests/player-playback-race.spec.js) and [readiness/seek regressions](../tests/frontend-regressions.spec.js). This covers the intended behavior, not an assertion that all possible playback failures are eliminated. |
| [#37](https://github.com/dst0/miofive-video-converter/pull/37) | Add duration to every demo clip | `MOCK_VIDEO_FILES` normalization supplies the synthetic clips' two-second durations | [Demo implementation](../public/demo-api-mock.js) and [duration-property regression](../tests/demo-api-mock.spec.js). The implementation uses normalization rather than repeating the field in each literal. |
| [#38](https://github.com/dst0/miofive-video-converter/pull/38) | Pause the old player for user-initiated Next, not automatic end-of-file advance | `playNextVideo(true/false)` and `switchToNextVideo(isUserAction)` retain the distinction with generation-aware cancellation | [Player implementation](../public/player.js); the [race test](../tests/player-playback-race.spec.js) explicitly checks manual Next. Automatic-advance behavior is supported by source inspection here, not claimed as a new independent automatic-advance test. Historical design notes are superseded by [architecture.md](architecture.md). |

## Dependency changes

| PR | Original change | Current lockfile replacement |
| --- | --- | --- |
| [#42](https://github.com/dst0/miofive-video-converter/pull/42) | `body-parser` 1.20.5 → 1.20.6 under Express 4 | Express 5.2.1 uses `body-parser` 2.3.0; do not reintroduce the old major-version dependency tree. |
| [#43](https://github.com/dst0/miofive-video-converter/pull/43) | Update Express and `qs` | Exact Express 5.2.1 and resolved `qs` 6.16.0 are present. |
| [#44](https://github.com/dst0/miofive-video-converter/pull/44) | `tar` 7.5.16 → 7.5.22 | `tar` resolves to 7.5.22, with the same exact version enforced by the package override. |

Dependency evidence: [package.json](../package.json), [package-lock.json](../package-lock.json). These comparisons establish replacement versions, not a permanent absence of dependency vulnerabilities; audits remain revision-specific.

## Immutable comparison anchors

| PR | Head | Base |
| --- | --- | --- |
| #35 | `ff91a8ae332ab18eb717d794a5fd43df653047d9` | `40191a54227ca71c99aa27b8aaa37d5068c42711` |
| #37 | `d8a514aca1aeae02f6c64fb7b561e5470ba09c6b` | `40191a54227ca71c99aa27b8aaa37d5068c42711` |
| #38 | `1184904cc760cf5f802276d0fa43ef96879458d2` | `40191a54227ca71c99aa27b8aaa37d5068c42711` |
| #42 | `5c8d347cb02406a3713f1cf42d175a8c138e9aff` | `e00e106f62b3852eece30e50b7ac0d129ceb2c03` |
| #43 | `306bd467e085ca429c05110241532ab02fe138cf` | `e00e106f62b3852eece30e50b7ac0d129ceb2c03` |
| #44 | `8b3a40f3a5c9a4f36368ac969aa7663f813e9c04` | `e00e106f62b3852eece30e50b7ac0d129ceb2c03` |

## Disposition

The useful intent of these six PRs is represented by the reviewed baseline; blind merges would reintroduce older implementations or dependency trees. They are candidates to close as superseded **after replacement acceptance** and a fresh head/state check. This reconciliation performed no PR closure, merge, branch deletion or worktree pruning, and ran no new tests. Validation results belong to [the dated product review](product-review.md) and exact-head CI.

This is a bounded six-PR comparison, not certification that every historical or missing worktree was recovered. Active task checkouts and user-owned primary-worktree files are not cleanup candidates.
