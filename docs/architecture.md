# Architecture and runtime contract

## Components

```text
Browser or Tauri webview
        |
        | loopback HTTP only
        v
Express backend (index.js)
   |         |          |
   |         |          +-- FFmpeg/FFprobe child processes
   |         +------------- selected export directory
   +----------------------- selected video directories

Tauri host (src-tauri/src/lib.rs)
   +-- starts and owns the packaged Node sidecar
   +-- validates the sidecar's loopback URL before navigation
   +-- terminates the sidecar when the application exits
```

The static GitHub Pages demo is a separate, frontend-only mode. `public/demo-api-mock.js` intercepts the small API surface and exposes only bundled sample metadata and files. It cannot export. Its manifest, service-worker registration, cache keys, and fallback URLs are relative to the deployment scope so the project works below `/miofive-video-converter/` rather than assuming a domain root.

## Trust boundaries

The backend is a local privileged component: folder browsing, scanning, video streaming, and export intentionally operate on paths selected by the local user. It is not a multi-user web service and has no remote authentication model. Loopback/browser guards do not authenticate an OS user or local process: a native local client can omit browser metadata. Trusted local clients and a trusted host are explicit assumptions, not isolation guarantees against other local accounts/apps. Its mandatory network boundary is loopback:

- the listener refuses non-loopback bind addresses;
- request `Host`, `Origin`, and Fetch Metadata are checked;
- CSP and response hardening are applied by Express and the Tauri configuration;
- internal executable paths and raw filesystem errors are not returned to clients;
- request bodies, recursive scans, captured child-process output, concurrent exports, and media ranges are bounded;
- local media and filesystem API responses use `Cache-Control: no-store`; static application assets remain separately cacheable.

All private control routes use `express-rate-limit` with an aggregate 300-request/minute process-local quota; `/video` has a separate 300-request/minute quota for legitimate range bursts. Host/origin rejection precedes accounting, and limiting precedes JSON parsing, filesystem access and tool execution. Fixed loopback keys prevent forwarding-header/IP quota evasion and unbounded client maps. A 429 includes retry guidance and is uncached. This complements, not replaces, the scan/export concurrency and resource bounds.

Filesystem names and API payloads are untrusted. Frontend code must use `textContent`, DOM properties, or the context-safe encoder in `public/security.js`; never interpolate an unencoded path, filename, or error into HTML. Values restored from `localStorage` are convenience state, not trusted authorization state.

Demo containment is based on `realpath` and path-segment comparison. Lexical prefix checks such as `candidate.startsWith(root)` are forbidden because sibling names and symlinks can escape the intended root.

## Recording discovery

`scanDirectory` iterates directory entries with bounded memory, skips hidden entries and symbolic-link directory entries, and limits nesting to 32, examined entries to 100,000, and matching videos to 20,000. It accepts only Miofive names ending in channel `A.MP4` or `B.MP4`. A scan and exact timeline select one channel at a time because A/B recordings are simultaneous views, not sequential segments. Both encoded dates use `MMDDYY`; impossible calendar or clock values are rejected independently of the viewer timezone. `utcTime` is an ISO instant; `localTime` is the camera wall time serialized without a timezone suffix. Never reinterpret that second field as an instant. UI date/time fields and labels display UTC instants in the computer's local timezone; pre-scan filters match clip starts, whereas the post-scan timeline includes duration overlaps.

Each scan/export owns a client-disconnect signal combined with the process-wide shutdown signal. Cancellation stops traversal, prevents queued callbacks/spawns, kills active child process groups, and waits for workers before releasing the operation mutex. Shutdown aborts admission/work and closes active HTTP connections before the two-second safety deadline; `server.close()` alone can leave a late keep-alive connection delaying exit.

Duration extraction walks MP4 atom headers with random-access reads. It supports 32-bit, extended 64-bit, and end-of-file atom sizes and can skip a large `mdat` to find a trailing `moov`. Traversal stops after 4,096 atoms, and unsupported, adversarial, or malformed metadata falls back to a bounded `ffprobe` process. A failed probe produces an unknown scan duration; export requires valid positive durations.

## Playback state

The browser keeps two video elements: one active and one preloaded. Separate monotonically increasing playback and source generations invalidate stale `play()` promises, readiness callbacks, timeouts, and seeks whenever a pause, source change, or navigation supersedes them. Each player owns at most one cancellable readiness wait. Expected `AbortError` rejections are ignored, while current playback errors return the global state to paused. Automatic end-of-file advancement preserves playback; manual Next cancels the old player's request before activating the next video. Returning to the scan screen clears both child `<source>` elements before `load()` so removable media is released.

## Export contract

`POST /export` accepts an ordered list of existing MP4 files, a `.mp4` output path, optional range boundaries, speed, and a named quality profile. The backend:

1. validates and resolves source files and rejects a mixed A/B camera timeline;
2. resolves the output directory once and creates mode-0700 private staging with a mode-0600 output file; preflights hard-link support before encoding;
3. determines per-file overlap with the global range using at most four concurrent metadata probes;
4. builds FFmpeg filters for trim, speed, audio normalization, and concatenation;
5. runs one export at a time and keeps only a bounded stderr tail;
6. strips inherited container metadata and chapters from the output;
7. terminates complete Unix process groups during cancellation/shutdown using Node's negative-PID signal API (there is no external `kill` subprocess);
8. flushes a completed regular file and publishes it using atomic no-clobber `link`, retrying numeric suffixes on collisions;
9. removes only known private staging entries on failure or success. A completed public output is never deleted for a late client disconnect.

Publication is the commit point. There is no public placeholder for FFmpeg to reopen, and cleanup never targets the public result name. Filesystems without hard links (including exFAT/FAT) fail closed with local-disk guidance before encoding; overwrite-capable rename or non-atomic copy is not an equivalent fallback. Selected symlink aliases cannot redirect a prepared job, but canonical parent directories must remain trusted and stable. Staging identity checks refuse uncertain cleanup; they are not an atomic compare-and-delete guarantee against hostile concurrent parent replacement. Abrupt power loss/SIGKILL can leave a hidden staging folder; inspect it before manually removing it and keep the original recordings.

Input files are never modified. Output is encoded as H.264/yuv420p with optional AAC audio and a newly generated `faststart` container; input comments, device tags, GPS/location metadata, and chapters are not copied.

All media input probes and transcodes force the MOV/MP4 demuxer and permit only `file,pipe` protocols, including when using system media tools. A failed audio probe is an export failure, not proof of absent audio. Export offsets refer to concatenated selected clips, not wall-clock gaps. The browser refuses exact export when a selected clip's scan duration is unknown, even after preview metadata arrives: the original selection was built from incomplete scan offsets. Rescan/exclusion must rebuild that selection; mutable preview durations alone cannot authorize it. Preference storage failures must not block startup, browsing or successful-export feedback.

## Desktop packaging and supply chain

One native `productDialog` owns the accessibility boundary; Export and Select Folder are retained panels, not separate modal siblings. `dialog.js` switches the title, active panel and cancellation callback while keeping the same native dialog open. Inactive panels are hidden/inert; their form values and return-focus targets are retained. Closing an inactive parent does not dismiss its child or resurrect the parent later. The native `showModal()`/`close()` API owns top-layer state; a no-API fallback retains ARIA and the existing panel keyboard traps. The demo's offline asset list includes this shared module. See [WebKit's native dialog contract](https://webkit.org/blog/12209/introducing-the-dialog-element/).

Visual z-index and Chromium DOM assertions alone are insufficient: native testing reproduced inaccessible controls even after separate-dialog ARIA retirement, native close/open and a frame-delayed transition. A shared shell removed that failing transition in the observed macOS app; this is not a claim to have diagnosed WebKit internals or certified every assistive technology. While an export request is running, settings and Browse are disabled; Cancel/Close remain available and receive focus. Completion, failure and cancellation restore settings only for the current request generation.

The Tauri host accepts only a credential-free `http://127.0.0.1:<port>/` (or localhost) ready URL emitted by its owned sidecar. No generic sidecar-provided navigation is allowed. The webview CSP is non-null, and no application capability grants frontend IPC commands. Development starts from `frontendDist`, not an unstarted fixed-port dev server. Event supervision continues after `ready`; unexpected termination clears the child handle and displays recovery guidance, while intentional Quit suppresses that error. The child mutex is released before waiting for shutdown.

`check:ffmpeg` follows runtime candidates: explicit operator paths, validated bundled resources, then system tools. The source-build cache is not a runtime candidate and is validated separately by build/copy gates. An empty development `resources/bin` is absent; an incomplete nonempty bundle fails closed. Resource generation includes exact project license and third-party notice bytes. These notices and metadata checks alone do not establish distribution-license compliance.

Cached manifest regeneration reads one regular no-follow descriptor, validates its pins/hashes, writes a private exclusive sibling and atomically replaces only the manifest name. Existing or swapped destination symlinks cannot redirect truncating writes. Build parents are trusted operator-owned directories; simultaneous builds or hostile parent replacement are unsupported.

JavaScript dependencies and tool versions are exact in `package-lock.json`; npm lifecycle scripts are disabled by repository configuration. macOS release media tools are built from checksum-pinned FFmpeg and x264 source archives with a macOS 11.0 deployment target. Reuse requires an exact build manifest verifying source-pin and binary-hash consistency, arm64 architecture, deployment target, and redistributable license output (local manifests establish pin and hash consistency, not cryptographic signed provenance); explicit operator binaries receive an accurate disclaimer instead of the source-built manifest. The desktop installer stages a complete bundle beside the destination before its atomic rename. GitHub Actions are pinned to immutable commit SHAs and receive job-scoped minimum permissions. Dependabot tracks npm, Cargo, and Actions drift, and GitHub default CodeQL setup analyzes Actions and JavaScript with extended queries; Rust remains covered by formatting, Clippy, tests, and RustSec because GitHub's default-setup API does not currently accept Rust as a configured language.

`scripts/build-sidecar.js` uses the compression modes exposed by the `pkg` executable format. It currently requests GZip because `pkg` does not expose a Brotli quality-level control; executable snapshot compatibility takes precedence over the repository's Brotli Q6 preference. Human-readable closed diagnostic logs, when intentionally retained, must use Brotli Q6.

## Verification boundaries

- `npm run precommit` is the fast local gate.
- `npm run prepush` adds full browser/API/export and Rust checks (Playwright runs with `workers: 1` to prevent backend FFmpeg export mutex contention).
- CI runs `JavaScript / test` and `Rust / check` from a clean checkout; it is authoritative only for the exact PR head SHA.
- GitHub Pages deploys only from `main` via an explicit job-level `github.ref == 'refs/heads/main'` guard; a Pages deployment proves the static demo only and does not prove desktop packaging or local filesystem/export behavior.
- A release build is not a published or signed release. Distribution additionally requires artifact signing, notarization, provenance/SBOM, exact-byte verification, and a documented rollback target; operations fail closed if these are missing.
