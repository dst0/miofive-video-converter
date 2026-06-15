#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUILD_ROOT="${ROOT_DIR}/vendor/ffmpeg/build"
SOURCE_ROOT="${ROOT_DIR}/vendor/ffmpeg/src"
INSTALL_ROOT="${ROOT_DIR}/vendor/ffmpeg/macos-arm64"
DOWNLOAD_ROOT="${ROOT_DIR}/vendor/ffmpeg/downloads"

FFMPEG_VERSION="8.1.1"
FFMPEG_ARCHIVE="ffmpeg-${FFMPEG_VERSION}.tar.xz"
FFMPEG_URL="https://ffmpeg.org/releases/${FFMPEG_ARCHIVE}"
FFMPEG_SHA256="b6863adde98898f42602017462871b5f6333e65aec803fdd7a6308639c52edf3"

X264_COMMIT="0480cb05fa188d37ae87e8f4fd8f1aea3711f7ee"
X264_ARCHIVE="x264-${X264_COMMIT}.tar.gz"
X264_URL="https://code.videolan.org/videolan/x264/-/archive/${X264_COMMIT}/${X264_ARCHIVE}"
X264_SHA256="d0967a1348c85dfde363bb52610403be898171493100561efa0dd05d5fd1ae50"

if [[ "$(uname -s)" != "Darwin" || "$(uname -m)" != "arm64" ]]; then
  echo "This source build script currently supports Apple Silicon macOS only." >&2
  exit 1
fi

for tool in curl make clang tar shasum; do
  if ! command -v "${tool}" >/dev/null 2>&1; then
    echo "Missing required build tool: ${tool}" >&2
    exit 1
  fi
done

jobs="$(sysctl -n hw.ncpu 2>/dev/null || echo 4)"
mkdir -p "${BUILD_ROOT}" "${SOURCE_ROOT}" "${INSTALL_ROOT}" "${DOWNLOAD_ROOT}"

download() {
  local url="$1"
  local output="$2"
  if [[ ! -f "${output}" ]]; then
    echo "Downloading ${url}"
    curl -fL --retry 3 --connect-timeout 20 -o "${output}" "${url}"
  fi
}

verify_sha256() {
  local file="$1"
  local expected="$2"
  local actual
  actual="$(shasum -a 256 "${file}" | awk '{print $1}')"
  if [[ "${actual}" != "${expected}" ]]; then
    echo "SHA-256 mismatch for ${file}" >&2
    echo "expected: ${expected}" >&2
    echo "actual:   ${actual}" >&2
    exit 1
  fi
}

make_pkg_config_shim() {
  local shim="${BUILD_ROOT}/pkg-config-x264"
  cat > "${shim}" <<EOF
#!/usr/bin/env bash
set -euo pipefail

want_exists=false
want_cflags=false
want_libs=false
want_modversion=false

for arg in "\$@"; do
  case "\${arg}" in
    --exists) want_exists=true ;;
    --cflags) want_cflags=true ;;
    --libs) want_libs=true ;;
    --modversion) want_modversion=true ;;
    --print-errors|--silence-errors|--static) ;;
    x264|x264\ *) ;;
    [0-9]*|">="|"<="|"="|">"|"<") ;;
    *) ;;
  esac
done

if [[ "\${want_exists}" == "true" ]]; then
  exit 0
fi
if [[ "\${want_modversion}" == "true" ]]; then
  echo "0.164"
fi
if [[ "\${want_cflags}" == "true" ]]; then
  echo "-I${INSTALL_ROOT}/include"
fi
if [[ "\${want_libs}" == "true" ]]; then
  echo "-L${INSTALL_ROOT}/lib -lx264"
fi
EOF
  chmod +x "${shim}"
  echo "${shim}"
}

assert_redistributable() {
  local binary="$1"
  local name="$2"
  local license_output
  license_output="$("${binary}" -L 2>&1)"
  if grep -Eiq 'nonfree|not legally redistributable' <<<"${license_output}"; then
    echo "${name} reports nonfree components and is not redistributable:" >&2
    echo "${license_output}" >&2
    exit 1
  fi
  if ! grep -Eiq 'GNU General Public License|GNU Lesser General Public License' <<<"${license_output}"; then
    echo "${name} did not report an expected GPL/LGPL license in -L output:" >&2
    echo "${license_output}" >&2
    exit 1
  fi
}

download "${FFMPEG_URL}" "${DOWNLOAD_ROOT}/${FFMPEG_ARCHIVE}"
download "${X264_URL}" "${DOWNLOAD_ROOT}/${X264_ARCHIVE}"
verify_sha256 "${DOWNLOAD_ROOT}/${FFMPEG_ARCHIVE}" "${FFMPEG_SHA256}"
verify_sha256 "${DOWNLOAD_ROOT}/${X264_ARCHIVE}" "${X264_SHA256}"

rm -rf "${BUILD_ROOT}/x264" "${BUILD_ROOT}/ffmpeg"
mkdir -p "${BUILD_ROOT}/x264" "${BUILD_ROOT}/ffmpeg"
tar -xf "${DOWNLOAD_ROOT}/${X264_ARCHIVE}" -C "${BUILD_ROOT}/x264" --strip-components 1
tar -xf "${DOWNLOAD_ROOT}/${FFMPEG_ARCHIVE}" -C "${BUILD_ROOT}/ffmpeg" --strip-components 1

rm -rf "${INSTALL_ROOT}"
mkdir -p "${INSTALL_ROOT}"

echo "Building x264 ${X264_COMMIT}"
(
  cd "${BUILD_ROOT}/x264"
  ./configure \
    --prefix="${INSTALL_ROOT}" \
    --host=aarch64-apple-darwin \
    --enable-static \
    --disable-opencl \
    --disable-cli \
    --disable-asm
  make -j "${jobs}"
  make install
)

pkg_config_shim="$(make_pkg_config_shim)"

echo "Building FFmpeg ${FFMPEG_VERSION}"
(
  cd "${BUILD_ROOT}/ffmpeg"
  ./configure \
    --prefix="${INSTALL_ROOT}" \
    --pkg-config="${pkg_config_shim}" \
    --extra-cflags="-I${INSTALL_ROOT}/include" \
    --extra-ldflags="-L${INSTALL_ROOT}/lib" \
    --extra-libs="-lpthread -lm" \
    --disable-autodetect \
    --disable-debug \
    --disable-doc \
    --disable-ffplay \
    --disable-network \
    --enable-gpl \
    --enable-version3 \
    --enable-libx264 \
    --disable-nonfree
  make -j "${jobs}"
  make install
)

assert_redistributable "${INSTALL_ROOT}/bin/ffmpeg" "ffmpeg"
assert_redistributable "${INSTALL_ROOT}/bin/ffprobe" "ffprobe"

cat > "${INSTALL_ROOT}/BUILD-MANIFEST.txt" <<EOF
Miofive Video Converter bundled FFmpeg build

FFmpeg:
  version: ${FFMPEG_VERSION}
  source: ${FFMPEG_URL}
  sha256: ${FFMPEG_SHA256}

x264:
  commit: ${X264_COMMIT}
  source: ${X264_URL}
  sha256: ${X264_SHA256}

Build:
  host: $(uname -s) $(uname -m)
  compiler: $(clang --version | head -1)
  configure: --disable-autodetect --disable-debug --disable-doc --disable-ffplay --disable-network --enable-gpl --enable-version3 --enable-libx264 --disable-nonfree

Validation:
  ffmpeg -L and ffprobe -L were checked and did not report nonfree components.
EOF

echo "Built source FFmpeg bundle:"
echo "  ${INSTALL_ROOT}/bin/ffmpeg"
echo "  ${INSTALL_ROOT}/bin/ffprobe"
