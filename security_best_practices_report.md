# Security best-practices review

Review date: 2026-09-05
Scope: Express backend, browser UI, Tauri host, FFmpeg execution and packaging, dependency graphs, tests, GitHub Actions, and live repository security settings.

## Executive summary

The review found and fixed multiple high-impact boundary failures. The most serious baseline behavior exposed an unauthenticated local-filesystem API on non-loopback interfaces, rendered filesystem metadata in unsafe HTML contexts, allowed demo-mode path escapes, and could terminate the desktop sidecar without reliably stopping FFmpeg descendants or cleaning partial output. Dependency installation could also invoke host package managers unexpectedly.

The corrected design is explicitly local-only, applies request and browser boundaries, validates real paths and output reservations, bounds process and parsing resources, and treats filenames and process output as untrusted. The second review found additional lifecycle, metadata and setup defects despite earlier green component checks; see `docs/product-review.md`. Passing scans are dated observations, not proof that every defect has been found. Public binary distribution is outside the verified source-PR boundary.

## Findings

| ID | Severity | Status | Finding and resolution |
| --- | --- | --- | --- |
| SEC-001 | High | Fixed | The server used the platform default bind while exposing path-based read/write operations. Startup now rejects non-loopback hosts, and every request validates `Host`, `Origin` (rejecting opaque/null), and Fetch Metadata (`requestBoundaryGuard` and `startServer` in `index.js`). |
| SEC-002 | High | Fixed | Filenames, folder paths, file types, and API errors reached `innerHTML` and attribute contexts without quote-safe encoding. Rendering now uses `textContent`, a five-character HTML encoder, and a restricted CSS-token encoder (`public/security.js`, `public/app.js`, `public/player.js`, `public/folder-browser.js`). Playwright injects hostile-looking metadata to prevent regression (`tests/security.spec.js`). |
| SEC-003 | High | Fixed | Demo containment used lexical prefix assumptions and still exposed host device/output operations. Checks now resolve both roots and candidates with `realpath`; device discovery is hidden and export is disabled in demo mode (`index.js`). |
| SEC-004 | High | Fixed | Output could overwrite existing data, malformed ranges were weakly bounded, and concurrent exports could exhaust local resources. Export now reserves an exclusive mode-0600 `.mp4`, selects a suffix on collision, admits one job at a time, removes failure output, caps inputs, and implements strict single-range behavior (`index.js`). |
| SEC-005 | High | Fixed | Capture uses size/time limits and detached Unix groups. Request cancellation and the common shutdown signal stop queues and prevent new spawns before killing existing groups with Node's signal API; active HTTP connections close so keep-alive cannot delay cleanup. There is no external Linux `kill` fallback. Tests prove queue cancellation, descendant death, mutex reuse and partial-file cleanup (`tests/unit/index.test.js`, `tests/unit/lifecycle.test.js`). |
| SEC-006 | High | Fixed | Tauri trusted a sidecar-emitted navigation string and used only a hard child kill. It now accepts only credential-free loopback HTTP root URLs with an explicit port, performs native navigation, sends graceful termination before fallback, and exposes no frontend IPC capabilities (`src-tauri/src/lib.rs`, `src-tauri/tauri.conf.json`). |
| SEC-007 | High | Fixed | `npm install` could invoke Homebrew and privileged/system package managers. The lifecycle installer was removed from `package.json` postinstall, npm scripts are disabled by default via `.npmrc`, media checks are read-only (`scripts/check-ffmpeg.js`), tool versions are lockfile-pinned, and the unused legacy `install-ffmpeg.js` script has been removed. |
| SEC-008 | Medium | Fixed | Browser responses lacked a maintained security-header policy. Helmet now sets a restrictive CSP and related headers, Express disclosure is disabled, JSON is strict and capped at 64 KiB, and Tauri has a matching non-null CSP (`index.js:393-415`, `src-tauri/tauri.conf.json:24-27`). |
| SEC-009 | Medium | Fixed | FFmpeg source/version and CI actions were mutable or insufficiently governed. The build uses checksum-pinned FFmpeg 9.0.1 and x264 sources, disables networking/nonfree output, verifies license text, pins Actions to commits, and applies least permissions/timeouts (`scripts/build-ffmpeg-macos-arm64.sh:10-18`, `scripts/build-ffmpeg-macos-arm64.sh:103-186`, `.github/workflows/node.js.yml`, `.github/workflows/deploy-demo.yml`). |
| SEC-010 | Medium | Fixed | GitHub dependency alerts, automated security updates, private vulnerability reporting, and CodeQL were disabled. Live settings now enable those controls; repository configuration schedules npm, Cargo, and Actions updates (`.github/dependabot.yml`, `SECURITY.md`). |
| SEC-011 | Medium | Fixed | System media tools could interpret input using their broader default demuxer/protocol policy. Probes and every file input now force MOV/MP4 and `file,pipe`; a disguised network playlist regression verifies no HTTP fetch. Audio-probe errors also fail closed instead of silently dropping sound. |

## Remaining risks and accepted boundaries

### RISK-001 — Transitive Rust maintenance advisories

Severity: Low for the supported macOS target. Online `cargo audit` reports 0 advisories in its vulnerability category and 17 warnings (16 unmaintained, one `glib` unsoundness warning) after resolving `quick-xml` (`plist: 1.10.0`, `quick-xml: 0.41.0`) and `anyhow` (`1.0.104`). Ten GTK3 maintenance notices, the `glib` unsoundness notice, and `proc-macro-error` are absent from the `aarch64-apple-darwin` dependency tree. Five unmaintained `unic-*` crates remain in Tauri's `urlpattern` chain on macOS. Replacing those crates directly would fork framework internals. Keep Dependabot and RustSec active and upgrade when Tauri removes the chain. The zero vulnerability count is not a claim of zero security risk or Linux release readiness.

### RISK-002 — Inline style allowance

Severity: Low. Both CSPs keep `style-src 'unsafe-inline'` because the existing UI uses inline positional styles and Tauri's static startup message applies a fixed inline style. Script execution remains restricted to self, objects and framing are denied, and all attacker-controlled style tokens and values are encoded or numerically clamped. A future UI rewrite should move all styles to classes and remove this allowance.

### RISK-003 — Release signing and provenance are not implemented

Severity: Operational. The repository builds a local macOS application but has no published, signed, notarized, provenance-attested release pipeline or immutable rollback target. The review therefore makes no production-release claim and fails closed before distribution. Before distributing binaries, sign/notarize the exact built bytes, generate an SBOM and provenance, scan and verify the same digest, and document rollback.

### RISK-004 — Hosted analysis coverage differs by language

Severity: Low. GitHub default CodeQL setup accepts Actions and JavaScript with extended queries but currently rejects Rust through that API. Rust is instead gated by formatting, Clippy with warnings denied, unit tests, and RustSec. Secret scanning and push protection are enabled; GitHub continued to report non-provider patterns and validity checks as disabled after enable attempts, so those two optional modes are not claimed.

## Verification evidence (previous checkpoint; not final source-PR evidence)

The following completed checks predate the second-review fixes. The final source/PR gates are recorded in `docs/product-review.md`; do not reuse these counts as the current total.

- `npm run precommit`: Passed clean. ESLint passed with 0 errors and 0 warnings across all files; complete unit suite passed on host Node v26.5.0 (interim checkpoint: 36/36 unit tests passing = 22 runtime tests in `index.test.js` + 14 tooling tests in `tooling.test.js`; also verified on Node v22.13.0); open-source license check script passed across 298 npm and 458 Cargo package notices (verifying declared license metadata presence, not formal legal compliance certification); Rust formatting (`cargo fmt --check`) passed.
- `npm run check:rust`: `cargo clippy --all-targets --all-features -- -D warnings` (0 warnings, 0 errors) and Rust unit tests (1/1, sidecar URL validation) passed.
- `npm audit`: 0 vulnerabilities across 298 dependencies.
- `cargo audit --file src-tauri/Cargo.lock`: 0 vulnerabilities; 17 disclosed upstream maintenance warnings assessed above under RISK-001 (retained upstream maintenance notices, not waived vulnerabilities).
- Local secret & static scan: Interim scan of 143 repository tree files and 264 git commits with checksum-verified gitleaks, actionlint, and zizmor (regular and pedantic): 0 findings. Local build manifests establish source-pin and binary-hash consistency, not cryptographic signed provenance. Final frozen-source scan pending.
- End-to-end browser and API validation (`npm run test:e2e`): Interim 146/146 checkpoint across all 16 Playwright specifications in single-worker mode. Final frozen `npm run prepush` and clean-checkout remote CI remain pending integration.

## Operational recommendations

1. Keep the backend loopback-only unless a separate authenticated remote-service threat model is designed and reviewed.
2. Treat every filename, filesystem path, sidecar line, media container, and FFmpeg message as attacker-controlled input.
3. Preserve the exclusive-output and process-tree tests when changing export or shutdown code.
4. Do not distribute local app builds as releases until signing, notarization, SBOM/provenance, and exact-byte verification are in place.
5. Recheck GitHub security settings and the exact required checks after workflow or branch-protection changes.
