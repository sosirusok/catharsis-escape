#!/usr/bin/env bash

set -euo pipefail
umask 077

usage() {
  cat <<'EOF'
Usage:
  OWNER_KEYSTORE_PATH=/absolute/path/catharsis-owner.jks \
  OWNER_KEY_ALIAS=catharsis-owner \
  ./owner-app/scripts/sign-release.sh INPUT_UNSIGNED_APK OUTPUT_SIGNED_APK

The script prompts for passwords when they are not already set in
OWNER_KEYSTORE_PASSWORD and OWNER_KEY_PASSWORD.
EOF
}

if [[ $# -ne 2 ]]; then
  usage >&2
  exit 64
fi

input_apk=$1
output_apk=$2
keystore_path=${OWNER_KEYSTORE_PATH:-}
key_alias=${OWNER_KEY_ALIAS:-}

if [[ ! -f "$input_apk" ]]; then
  echo "Unsigned APK not found: $input_apk" >&2
  exit 66
fi

if [[ -e "$output_apk" ]]; then
  echo "Refusing to overwrite an existing output file: $output_apk" >&2
  echo "Choose a new output name or move the existing file first." >&2
  exit 73
fi

if [[ -z "$keystore_path" || ! -f "$keystore_path" ]]; then
  echo "Set OWNER_KEYSTORE_PATH to an existing private keystore." >&2
  exit 66
fi

if [[ -z "$key_alias" ]]; then
  echo "Set OWNER_KEY_ALIAS to the signing-key alias." >&2
  exit 64
fi

repo_root=$(git -C "$(dirname "${BASH_SOURCE[0]}")" rev-parse --show-toplevel 2>/dev/null || true)
keystore_real=$(realpath "$keystore_path")
if [[ -n "$repo_root" && "$keystore_real" == "$repo_root"/* ]]; then
  echo "Refusing to use a keystore stored inside the repository." >&2
  echo "Move it to a private directory outside the checkout and try again." >&2
  exit 78
fi

sdk_root=${ANDROID_SDK_ROOT:-${ANDROID_HOME:-}}
if [[ -z "$sdk_root" || ! -d "$sdk_root/build-tools" ]]; then
  echo "Set ANDROID_SDK_ROOT (or ANDROID_HOME) to an installed Android SDK." >&2
  exit 69
fi

build_tools_dir=$(find "$sdk_root/build-tools" -mindepth 1 -maxdepth 1 -type d -print | sort -V | tail -n 1)
zipalign_bin=$build_tools_dir/zipalign
apksigner_bin=$build_tools_dir/apksigner
if [[ ! -x "$zipalign_bin" || ! -x "$apksigner_bin" ]]; then
  echo "zipalign and apksigner were not found under $build_tools_dir." >&2
  exit 69
fi

if [[ -z ${OWNER_KEYSTORE_PASSWORD:-} ]]; then
  if [[ ! -t 0 ]]; then
    echo "Set OWNER_KEYSTORE_PASSWORD when running without a terminal." >&2
    exit 64
  fi
  read -r -s -p "Keystore password: " OWNER_KEYSTORE_PASSWORD
  echo
fi

if [[ -z ${OWNER_KEY_PASSWORD:-} ]]; then
  if [[ -t 0 ]]; then
    read -r -s -p "Key password (Enter to reuse keystore password): " OWNER_KEY_PASSWORD
    echo
  fi
  OWNER_KEY_PASSWORD=${OWNER_KEY_PASSWORD:-$OWNER_KEYSTORE_PASSWORD}
fi
export OWNER_KEYSTORE_PASSWORD OWNER_KEY_PASSWORD

output_dir=$(dirname "$output_apk")
mkdir -p "$output_dir"
temp_dir=$(mktemp -d)
trap 'rm -rf "$temp_dir"; unset OWNER_KEYSTORE_PASSWORD OWNER_KEY_PASSWORD' EXIT
aligned_apk=$temp_dir/aligned.apk
signed_apk=$temp_dir/signed.apk

"$zipalign_bin" -p -f 4 "$input_apk" "$aligned_apk"
"$apksigner_bin" sign \
  --ks "$keystore_real" \
  --ks-key-alias "$key_alias" \
  --ks-pass env:OWNER_KEYSTORE_PASSWORD \
  --key-pass env:OWNER_KEY_PASSWORD \
  --out "$signed_apk" \
  "$aligned_apk"
"$apksigner_bin" verify --verbose --print-certs "$signed_apk"
"$zipalign_bin" -c -v 4 "$signed_apk" >/dev/null

install -m 600 "$signed_apk" "$output_apk"
sha256sum "$output_apk" > "$output_apk.sha256"
echo "Signed APK: $output_apk"
echo "Checksum:   $output_apk.sha256"
