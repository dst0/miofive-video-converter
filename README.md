# Miofive Video Converter

Miofive Video Converter scans Miofive S1 Ultra dashcam recordings, lets you review the timeline, and exports an exact range as one MP4. It runs as a local web application or a Tauri macOS application; selected videos are processed locally with FFmpeg.

[Open the static demo](https://dst0.github.io/miofive-video-converter/) (sample data only; export is disabled).

## Supported recordings

The scanner recursively finds front (`A`) and rear (`B`) recordings whose names use:

```text
{MMDDYY}_{HHMMSS}_{MMDDYY}_{HHMMSS}_{dddddd}{C}.MP4
```

- The first date/time is interpreted as UTC.
- The second date/time is the camera's recorded wall-clock time, not the viewing computer's timezone. It is validated without applying the computer's daylight-saving rules.
- `dddddd` is the sequence number and `C` is channel `A` or `B`.

For example, `010125_143052_010125_093052_000001A.MP4` represents a front-camera recording that began at 2025-01-01 14:30:52 UTC and 09:30:52 local time. Firmware variants may use another naming convention; unmatched or impossible dates are intentionally ignored rather than guessed.

Typical cards contain `CarDV/Movie/Normal`, `CarDV/Movie/Emr`, and `CarDV/Movie/Park`, but the scanner does not require that exact hierarchy.

## Run from source

Requirements:

- Node.js `^22.13.0 || >=24` (Node 23 is excluded; use a supported LTS release for development)
- FFmpeg and FFprobe on `PATH`, in the standard Homebrew locations, or configured together with `MIOFIVE_FFMPEG_PATH` and `MIOFIVE_FFPROBE_PATH` (an explicit invalid path fails closed instead of falling back; system availability is checked via `npm run check:ffmpeg`)
- Rust and the Tauri platform prerequisites only when building the desktop app

Install exactly the locked JavaScript dependency graph and verify media tools:

```bash
npm ci --ignore-scripts
npm run check:ffmpeg
```

Dependency installation never invokes a system package manager (`.npmrc` disables lifecycle scripts; legacy host-mutating installer scripts have been removed). Install FFmpeg yourself using your platform's trusted package source when the explicit check fails.

Start the local server:

```bash
npm start
```

Open `http://127.0.0.1:3000`. The backend deliberately binds only to loopback because its API can read selected local videos and write exports. LAN binding and reverse-proxy deployment are unsupported.

To explore bundled samples without granting access outside the repository's test data:

```bash
DEMO_MODE=true npm start
```

Demo mode resolves real paths before access checks, so sibling paths and symlinks cannot escape `test-data`.

## Use the converter

1. Insert the microSD card and choose its video folder.
2. Optionally restrict clip start times using the computer-local date/time fields and select exactly one camera channel, A or B. Simultaneous channels are not concatenated because that would duplicate elapsed time rather than form one exact timeline. To include clips overlapping a boundary, scan without the pre-filter and use the timeline selection.
3. Scan, select recordings, and review them in the dual-video player. **Cancel scan** stops pending work; changing the source or filters also cancels the in-flight scan.
4. Choose an exact export range, speed, quality, output directory, and `.mp4` filename.
5. Export. Existing files are never overwritten; a numeric suffix is selected instead. Source container metadata, including GPS/location and comments, is removed from the shareable clip.

Keep the original card or a backup until you verify an export. Long ranges can require substantial time and free disk space.

Exports are encoded in a private temporary folder and published as a complete file without overwriting an existing name. The destination must support hard links (for example the Mac's APFS disk); exFAT/FAT destinations fail with guidance before encoding. Export to a supported local disk, verify the result, then copy it to the removable drive if needed. A selected folder symlink is resolved once; success reports the actual canonical output path. Cancellation before publication removes private partial bytes; a completed file is kept if the client disconnects just after publication. Do not replace the destination directory while export is running.

Export offsets follow the selected clips concatenated in timestamp order; gaps between recordings are not filled. Clips with unreadable scan durations cannot be silently treated as one-second clips for an exact export, even if preview later loads their metadata. Rescan or exclude those clips so the selected range can be rebuilt from confirmed durations. Choose the output folder yourself (Browse or paste a path); finding a recording card never automatically makes it the export destination. Saved preferences are optional: the app continues working when browser storage is blocked.

## Desktop app

Development mode:

```bash
npm run desktop
```

Build the Apple Silicon macOS 11.0-or-newer app and DMG:

```bash
npm run build:mac
```

The release build compiles FFmpeg 9.0.1 and x264 from checksum-pinned source archives for the same macOS 11.0 deployment floor, disables FFmpeg networking and nonfree components, and verifies the resulting version, architecture, deployment target, license output, and build manifest before copying any binary. A stale ignored `vendor/ffmpeg` build is rebuilt instead of silently reused. The first build requires Xcode Command Line Tools plus `curl`, `make`, `tar`, and `shasum`.

Install the built app for the current user:

```bash
npm run install:mac
open "$HOME/Applications/Miofive Video Converter.app"
```

If an app already exists, the installer first copies into a sibling staging path, then atomically installs it while preserving the previous bundle as a timestamped backup. A packaged app includes the Node sidecar, FFmpeg/FFprobe and project/third-party notices; end users do not need the development toolchain. If the backend stops unexpectedly, the app displays a recovery message instead of leaving an apparently working player. Quit and reopen it, and check the output destination before retrying an interrupted export.

> [!WARNING]
> **Distribution & Release Integrity Boundary:** The repository builds local macOS desktop binaries, but automated cryptographic code signing, Apple notarization, SLSA provenance/SBOM generation, and exact-byte rollback target verification are currently NOT implemented. Distribution must fail closed until these signing and release pipeline requirements are fulfilled.

Advanced build options:

- Run `npm run build:ffmpeg` to build only the pinned media bundle.
- Set `MIOFIVE_FFMPEG_BUILD_JOBS` (1–16, default 2) to control compilation parallelism on shared hosts.
- Set both `MIOFIVE_FFMPEG_PATH` and `MIOFIVE_FFPROBE_PATH` to bundle a separately reviewed redistributable build.
- Set `MIOFIVE_SKIP_FFMPEG_BUNDLE=true` only for a development build without bundled media tools.

## Validation

Fast pre-commit gate:

```bash
npm run precommit
```

Full local pre-push gate (requires installed Playwright Chromium and FFmpeg; uses a single worker to prevent FFmpeg export mutex contention):

```bash
npx playwright install chromium
npm run prepush
```

Dependency security checks:

```bash
npm audit --omit=dev --audit-level=moderate
npm audit --audit-level=high
cargo audit --file src-tauri/Cargo.lock
```

Validation status:

- Canonical pre-commit gate (`npm run precommit`) validates ESLint across the codebase, runs the complete unit suite across runtime and tooling modules, checks open-source license notices, and verifies Rust formatting.
- Comprehensive pre-push gate (`npm run prepush`) additionally validates end-to-end browser and API flows via Playwright (configured with a single worker) and verifies Rust Clippy warnings and unit tests (`npm run check:rust`).
- Dependency and supply-chain checks must be rerun against the exact lockfiles before publication. License metadata checks are not formal legal compliance certification. Local build manifests establish source-pin and binary-hash consistency, not cryptographic signed provenance.
- Dated review evidence and unresolved release boundaries are tracked in [docs/product-review.md](docs/product-review.md). A local pass never substitutes for clean-checkout CI on the exact pull-request head. The static demo deploys only from `main` and does not establish desktop release readiness.

See [docs/architecture.md](docs/architecture.md) for runtime and trust-boundary details, [security_best_practices_report.md](security_best_practices_report.md) for the security review, and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) before distributing builds.

Report suspected vulnerabilities through the private process in [SECURITY.md](SECURITY.md), without attaching real recordings or sensitive local data to public issues.

## License

Project source is MIT licensed; see [LICENSE](LICENSE). The release app bundles GPL-3.0-or-later FFmpeg/FFprobe and x264-derived functionality under their applicable licenses. Third-party terms remain applicable to distributed artifacts.
