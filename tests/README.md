# Test suite

The repository has two layers:

- `tests/unit/*.test.js`: Node's built-in test runner for parsers and trust-boundary helpers.
- `tests/*.spec.js`: Playwright browser and API coverage, including real FFmpeg export tests.

## Run

```bash
npm ci --ignore-scripts
npx playwright install chromium
npm run check:ffmpeg
npm run test:unit
npm run test:e2e
```

`npm test` runs both test layers. `npm run precommit` is the quick local gate; `npm run prepush` also runs the complete browser and Rust checks.

Validation gates:

- Unit tests (`tests/unit/*.test.js`): run via `npm run test:unit`, including backend helpers, process/scan lifecycle regressions and build tooling/manifest resolvers. Do not enumerate a subset when reporting the global gate.
- Rust unit tests and Clippy (`npm run check:rust`): runs Clippy with warnings denied and tests loopback sidecar URL validation in `src-tauri/src/lib.rs`.
- End-to-end browser and API tests (`tests/*.spec.js`): run via `npm run test:e2e`, executing Playwright across all browser and API specifications in single-worker mode.
- Local merge gates: run `npm run precommit` before committing and `npm run prepush` before pushing. Full pre-push and remote CI validation on the exact PR head remain required for merge.

The Playwright configuration starts a fresh backend at `127.0.0.1:3000`, never reuses an unknown local server, blocks service workers, and writes an HTML report without opening an interactive report server. It strictly uses one worker (`workers: 1`) because export/API flows share one backend-wide FFmpeg mutex, and it permits no retries. CI installs Chromium runtime dependencies and FFmpeg explicitly.

Every API and UI export test creates a unique directory under the operating-system temporary directory and removes it in cleanup, including after a failed assertion. The tests intentionally use ordinary uncompressed temporary MP4 files because FFmpeg and browser media decoders require random access and do not support a Brotli-wrapped input.

When adding tests:

- cover malformed input and failure behavior, not only success;
- make media state deterministic instead of relying on decoder timing;
- use asymmetric date fixtures when validating compact date formats;
- assert that descendants and inherited pipes are gone in any future process-timeout test;
- keep unit tests portable and vendor-free: validate per-build identity via isolated fixtures and recorded digests rather than asserting uncommitted workstation artifact paths or environment-specific hashes;
- never place real card paths, customer filenames, credentials, or sensitive payloads in fixtures or reports.

`tests/product-reliability.spec.js` exercises storage-denied startup/export, unknown and late-arriving durations, scan cancellation controls, keyboard/modal focus, immutable running-export settings, literal paths, viewport-edge scrubbing, explicit output choice, and a synthetic network-playlist trap. `tests/unit/lifecycle.test.js` starts isolated ephemeral servers and self-expiring probe descendants; it checks the queue, processes, inherited pipes, mutex reuse and graceful exit. Fixture source is syntax-checked before execution. Temporary live probe journals remain ordinary appendable text and are removed after the test; retained completed logs use Brotli Q6. Scanner/source snapshots stay readable by their tools during verification; do not compress active inputs into unsupported wrappers.
