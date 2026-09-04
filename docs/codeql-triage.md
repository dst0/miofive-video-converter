# CodeQL follow-up, 2026-09-05

PR #45 head `5bab61c647fbf3662f895e8c39f7a9bcaa3bc9b6` failed its CodeQL result check with 26 alerts, despite passing local gates and clean-checkout JavaScript/Rust CI. JavaScript SARIF analysis `1727707788` used `refs/pull/45/head`. Root and two independent read-only reviewers traced the exact sources and sinks. No query exclusions, severity changes or broad suppressions are justified.

## Genuine corrections

- Missing rate limits on path validation, scan and export, plus an unrecognized ad hoc browse/video limiter: maintained `express-rate-limit` now guards every private route, with separate control/media quotas and rejection before expensive work. `tests/unit/rate-limits.test.js` proves actual route coverage, reset, origin-budget isolation, forged-header resistance, 429 guidance and static/media separation.
- Alert #51: cached manifest validation followed by pathname truncation. No-follow descriptor reads plus private exclusive sibling writes and atomic rename replace that sequence. Four tooling tests cover symlink substitution, disk-write failure and temporary-name collision while retaining prior/unrelated bytes.
- Insecure frontend test temporary directory: replaced predictable naming/recursive creation with `mkdtemp`.
- Alerts #40/#45 exposed a separate genuine output-integrity race: exclusive creation, close, FFmpeg reopen, and error unlink did not retain ownership. `export-output.js` now stages privately and uses no-clobber publication; cancellation removes only staging. Tests cover late competing names, symlink collision, retargeted aliases, both sides of the cancellation/commit boundary, unsupported filesystems and uncertain cleanup. The actual HTTP-disconnect test additionally requires no public placeholder and preservation of a competing file.

## Narrow false-positive classifications at the reviewed head

These are conclusions about exact dataflows, not statements that arbitrary local binaries, local clients or filesystem parents are trustworthy. Any changed flow requires fresh review.

| Alert IDs | Source and sink | Why this is intentional, not the reported vulnerability |
| --- | --- | --- |
| #33–34 | Explicit `MIOFIVE_FFMPEG_PATH`/`MIOFIVE_FFPROBE_PATH` → checks in `scripts/check-ffmpeg.js` | Local CLI operator chooses a tool path; no request/media-controlled invocation. |
| #35–37 | Explicit tool paths → inspect/access/copy in `scripts/copy-ffmpeg-binaries.js` | Sources are operator-controlled build configuration; outputs have fixed repository-owned names. |
| #48 | Explicit selected binary → `spawnSync` inspection | Only constant `-version`/`-L` arguments; no shell. Selecting an executable is an intentional operator interface, not remote command injection. |
| #52 | `argv[2] === 'buildJobs'` → `process.exit(0/1)` | CLI dispatch prints a validated integer (1–16/default 2); it is not an authorization check or bypass. Unknown keys fail closed. |
| #49–50 | Resource/tool/PATH environment → runtime `spawn(command, args)` | Only trusted operator configuration chooses the executable. No HTTP input selects it; no shell is enabled. File arguments are absolute and filter values are validated. |
| #38 | Operator demo root → `realpath` | Canonicalization is part of enforcing the root boundary. |
| #39 | Requested candidate → `realpath` | Resolving an untrusted candidate is necessary to compare real path segments with the demo root; canonicalization itself does not expose file contents. |
| #8–9 | Selected output folder → access/stat | Arbitrary user-accessible output directories are the normal-mode product interface, not a fixed server storage root. The subsequent real write race is corrected separately, not waived. |
| #41 | Selected folder → path-validation stat | Explicit local path validation; demo containment precedes a positive response. |
| #42–44 | Selected scan root → access/stat/realpath | Deliberate normal-mode local scan interface; demo containment precedes traversal. Static symlink/prefix escape regressions remain required. |
| #46 | Selected `.mp4` regular file → streaming | Deliberate local video selection behind browser/loopback guards; fixed media type and no-store responses. This is not arbitrary active-content hosting. |

## Limits and publication status

Browser metadata and loopback do **not** authenticate an OS user/process: native local clients may omit those headers. This utility is not safe as a remote or multi-user service. Canonical parent directories must remain trusted/stable; inode-before-unlink is not atomic compare-and-delete. Hard-link publication requires filesystem support; exFAT/FAT fails before encoding with guidance to use a supported local disk. A silent rename/copy fallback was rejected because it would weaken the no-overwrite/complete-file guarantee.

This document records the initial failed revision and the code response. Exact updated-head checks and any per-alert disposition must be read back from GitHub and recorded in the PR; this file alone is not evidence that CodeQL passed or alerts were dismissed.

Primary references: [CodeQL rate-limiting query](https://codeql.github.com/codeql-query-help/javascript/js-missing-rate-limiting/), [express-rate-limit](https://github.com/express-rate-limit/express-rate-limit), [Node filesystem API](https://nodejs.org/api/fs.html), [POSIX atomic link and existing-name failure](https://pubs.opengroup.org/onlinepubs/9699919799/functions/link.html).
