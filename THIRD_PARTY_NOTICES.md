# Third-Party Notices

This app is intended to use open-source dependencies only. This file summarizes the current dependency and binary licensing from `package-lock.json`, installed package metadata, FFmpeg binary inspection, and `src-tauri/Cargo.toml`.

## Project License

- Miofive Video Converter: MIT. See `LICENSE`.

## JavaScript Runtime and Build Dependencies

- `express`: MIT.
- `@playwright/test`: Apache-2.0.
- `@tauri-apps/cli`: Apache-2.0 OR MIT.
- `@yao-pkg/pkg` and `@yao-pkg/pkg-fetch`: MIT.
The transitive npm dependency licenses in the current lockfile are open-source licenses such as MIT, ISC, Apache-2.0, BSD, and BlueOak. The app does not depend on npm FFmpeg/FFprobe binary installer packages.

## FFmpeg and FFprobe Binaries

The Apple Silicon macOS desktop release bundles static FFmpeg and FFprobe binaries by default. At runtime the backend resolves binaries in this order:

1. `MIOFIVE_FFMPEG_PATH` / `MIOFIVE_FFPROBE_PATH`
2. `src-tauri/resources/bin/ffmpeg` / `src-tauri/resources/bin/ffprobe`
3. common Homebrew paths on macOS
4. `PATH`

The default release bundle does not download third-party prebuilt FFmpeg binaries. It builds FFmpeg and x264 from pinned upstream source archives:

- FFmpeg 8.1.1: `https://ffmpeg.org/releases/ffmpeg-8.1.1.tar.xz`
- x264 commit `0480cb05fa188d37ae87e8f4fd8f1aea3711f7ee`: `https://code.videolan.org/videolan/x264/-/archive/0480cb05fa188d37ae87e8f4fd8f1aea3711f7ee/x264-0480cb05fa188d37ae87e8f4fd8f1aea3711f7ee.tar.gz`

The source build script verifies each source archive SHA-256, builds static Apple Silicon macOS binaries with `--enable-gpl --enable-version3 --enable-libx264 --disable-nonfree`, runs each built binary with `-L`, and rejects output that reports `--enable-nonfree` or FFmpeg's "not legally redistributable" wording. The verified `-L` output reports GNU GPL version 3 or later for both FFmpeg and FFprobe.

The packaged app includes `src-tauri/resources/licenses/FFMPEG-GPL-NOTICE.txt`, generated during release packaging. That notice records the exact source URLs, source checksums, and configure flags used for the bundled binaries.

Set both `MIOFIVE_FFMPEG_PATH` and `MIOFIVE_FFPROBE_PATH` to bundle a different redistributable LGPL/GPL build. Set `MIOFIVE_SKIP_FFMPEG_BUNDLE=true` only for development builds that intentionally rely on environment, Homebrew paths, or `PATH`.

Important note from the removed installer path:

- The previously installed `@ffmpeg-installer/darwin-arm64` binary reported `--enable-nonfree` and "This version of ffmpeg has nonfree parts compiled in. Therefore it is not legally redistributable."
- The tested `ffmpeg-ffprobe-static@6.1.2-rc.1` Apple Silicon binaries also reported `--enable-nonfree` and "not legally redistributable"; the repository license check rejects that package family.
- For redistributable desktop builds, keep the bundled GPL notice and source-code pointers in app resources.

## Rust/Tauri Dependencies

The Tauri app declares `tauri`, `tauri-build`, `tauri-plugin-shell`, and `serde_json` dependencies from crates.io. The resolved crate metadata is open-source, primarily MIT, Apache-2.0, BSD, Unicode-3.0, MPL-2.0, Zlib, and compatible dual-license expressions. Check the resolved `src-tauri/Cargo.lock` and crate metadata before release packaging.

## Release Checklist

- Keep `LICENSE` and this notice file in source releases.
- Include third-party notices in packaged app resources.
- Re-check the exact FFmpeg/FFprobe binary licenses for the target platform before publishing installers.
- Re-run dependency license checks after changing `package-lock.json` or `src-tauri/Cargo.lock`.
