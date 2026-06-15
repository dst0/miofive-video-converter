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

The default release bundle uses Martin Riedl's macOS arm64 FFmpeg 8.1.1 release zips:

- `https://ffmpeg.martin-riedl.de/download/macos/arm64/1778761665_8.1.1/ffmpeg.zip`
- `https://ffmpeg.martin-riedl.de/download/macos/arm64/1778761665_8.1.1/ffprobe.zip`

The bundle script downloads the matching `.sha256` files, verifies each archive, runs each extracted binary with `-L`, and rejects output containing `nonfree` or `not legally redistributable`. The verified `-L` output reports GNU GPL version 3 or later for both FFmpeg and FFprobe.

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
