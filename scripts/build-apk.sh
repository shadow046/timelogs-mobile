#!/bin/bash
set -euo pipefail
export NVM_DIR="$HOME/.nvm"
source "$NVM_DIR/nvm.sh"

nvm use 22

node -v

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

if [[ -f "$PROJECT_ROOT/mobile/app.json" ]]; then
  MOBILE_ROOT="$PROJECT_ROOT/mobile"
elif [[ -f "$PROJECT_ROOT/app.json" ]]; then
  MOBILE_ROOT="$PROJECT_ROOT"
else
  echo "Could not find mobile app.json. Expected either:"
  echo "  $PROJECT_ROOT/mobile/app.json"
  echo "  $PROJECT_ROOT/app.json"
  exit 1
fi

ANDROID_ROOT="$MOBILE_ROOT/android"
APP_CONFIG_PATH="$MOBILE_ROOT/app.json"
ANDROID_BUILD_GRADLE="$ANDROID_ROOT/app/build.gradle"
ANDROID_STRINGS_PATH="$ANDROID_ROOT/app/src/main/res/values/strings.xml"
BUILD_PATH="$ANDROID_ROOT/app/build/outputs/apk/release"
DEFAULT_OUTPUT_DIR="$PROJECT_ROOT/APK"
if [[ -d "/var/www/html" && -w "/var/www/html" ]]; then
  DEFAULT_OUTPUT_DIR="/var/www/html/fieldclock-apk"
fi
OUTPUT_DIR="${APK_OUTPUT_DIR:-${FIELD_CLOCK_APK_OUTPUT_DIR:-$DEFAULT_OUTPUT_DIR}}"
LATEST_INFO_FILE="$OUTPUT_DIR/latest.txt"
LATEST_APK_NAME="FieldClock.apk"
APP_LABEL="FieldClock"
UPDATE_MANIFEST_NAME="mobile.json"
UPDATE_APK_PATH="/updates/$LATEST_APK_NAME"
UPDATE_PUBLIC_BASE_URL="${UPDATE_PUBLIC_BASE_URL:-https://timelogs.ideaserv.online}"
ABI_LIST=("arm64-v8a" "armeabi-v7a")

if [[ -n "${UPDATE_PUBLISH_TARGET:-}" ]]; then
  DEFAULT_UPDATE_PUBLISH_TARGET="$UPDATE_PUBLISH_TARGET"
elif [[ -d "$PROJECT_ROOT/backend/public" ]]; then
  DEFAULT_UPDATE_PUBLISH_TARGET="$PROJECT_ROOT/backend/public/updates"
else
  DEFAULT_UPDATE_PUBLISH_TARGET=""
fi

DEFAULT_UPDATE_PUBLISH_TARGET="root@timelogs.ideaserv.online:/opt/TimeLogs/backend/public/updates"

# export PATH="/usr/bin:/bin:$PATH"
export PATH="$HOME/.nvm/versions/node/v22.22.3/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

ANDROID_SDK_ROOT="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-/root/Android/Sdk}}"
AAPT_BIN="$(find "$ANDROID_SDK_ROOT/build-tools" -maxdepth 2 -type f -name aapt 2>/dev/null | sort -V | tail -1 || true)"
APKSIGNER_BIN="$(find "$ANDROID_SDK_ROOT/build-tools" -maxdepth 2 -type f -name apksigner 2>/dev/null | sort -V | tail -1 || true)"
NODE_BIN="${NODE_BIN:-$(command -v node)}"
PNPM_BIN="${PNPM_BIN:-$(command -v pnpm)}"

if [[ -t 1 ]]; then
  COLOR_RESET='\033[0m'
  COLOR_BOLD='\033[1m'
  COLOR_RED='\033[31m'
  COLOR_GREEN='\033[32m'
  COLOR_YELLOW='\033[33m'
  COLOR_BLUE='\033[34m'
  COLOR_CYAN='\033[36m'
else
  COLOR_RESET=''
  COLOR_BOLD=''
  COLOR_RED=''
  COLOR_GREEN=''
  COLOR_YELLOW=''
  COLOR_BLUE=''
  COLOR_CYAN=''
fi

print_info() { echo -e "${COLOR_CYAN}$1${COLOR_RESET}"; }
print_success() { echo -e "${COLOR_GREEN}$1${COLOR_RESET}"; }
print_warning() { echo -e "${COLOR_YELLOW}$1${COLOR_RESET}"; }
print_error() { echo -e "${COLOR_RED}$1${COLOR_RESET}"; }
print_header() { echo -e "${COLOR_BOLD}${COLOR_BLUE}$1${COLOR_RESET}"; }

read_json_value() {
  local expression="$1"
  "$NODE_BIN" -e "const fs=require('fs'); const app=JSON.parse(fs.readFileSync('$APP_CONFIG_PATH','utf8')); const value=$expression; if (value !== undefined && value !== null) console.log(value);"
}

increment_version() {
  local current_version="$1"
  IFS='.' read -r -a version_parts <<< "$current_version"
  local last_index=$((${#version_parts[@]} - 1))

  if [[ $last_index -lt 0 ]]; then
    echo "1.0.1"
    return
  fi

  version_parts[$last_index]=$((version_parts[$last_index] + 1))

  local incremented_version="${version_parts[0]}"
  local i
  for ((i = 1; i < ${#version_parts[@]}; i++)); do
    incremented_version="${incremented_version}.${version_parts[$i]}"
  done

  echo "$incremented_version"
}

calculate_version_code() {
  local version="$1"
  echo "$version" | awk -F. '{
    major = ($1 == "" ? 0 : $1);
    minor = ($2 == "" ? 0 : $2);
    patch = ($3 == "" ? 0 : $3);
    build = ($4 == "" ? 0 : $4);
    printf "%d", (major * 1000000) + (minor * 10000) + (patch * 100) + build;
  }'
}

update_versions() {
  local new_version="$1"
  local new_version_code="$2"

  "$NODE_BIN" <<NODE
const fs = require('fs');
const path = '$APP_CONFIG_PATH';
const app = JSON.parse(fs.readFileSync(path, 'utf8'));
app.expo.version = '$new_version';
app.expo.android = app.expo.android || {};
app.expo.android.versionCode = Number('$new_version_code');
fs.writeFileSync(path, JSON.stringify(app, null, 2) + '\n');
NODE

  if [[ -f "$ANDROID_BUILD_GRADLE" ]]; then
    sed -i -E "s/versionCode [0-9]+/versionCode ${new_version_code}/" "$ANDROID_BUILD_GRADLE"
    sed -i -E "s/versionName \"[^\"]+\"/versionName \"${new_version}\"/" "$ANDROID_BUILD_GRADLE"
  fi
}

configure_abi_splits() {
  if [[ ! -f "$ANDROID_BUILD_GRADLE" ]]; then
    return
  fi

  ANDROID_BUILD_GRADLE_PATH="$ANDROID_BUILD_GRADLE" "$NODE_BIN" <<'NODE'
const fs = require('fs');
const path = process.env.ANDROID_BUILD_GRADLE_PATH;
let buildGradle = fs.readFileSync(path, 'utf8');

if (!buildGradle.includes('FIELD_CLOCK_ABI_SPLITS')) {
  const splitBlock = `
    // FIELD_CLOCK_ABI_SPLITS: build universal and per-architecture release APKs for smaller updates.
    splits {
        abi {
            reset()
            enable true
            universalApk true
            include "armeabi-v7a", "arm64-v8a", "x86", "x86_64"
        }
    }
`;
  if (buildGradle.includes('\n    packagingOptions {')) {
    buildGradle = buildGradle.replace(/\n    packagingOptions \{/, `${splitBlock}\n    packagingOptions {`);
  } else if (buildGradle.includes('\n    androidResources {')) {
    buildGradle = buildGradle.replace(/\n    androidResources \{/, `${splitBlock}\n    androidResources {`);
  } else {
    buildGradle = buildGradle.replace(/\n\}/, `${splitBlock}\n}`);
  }
}

fs.writeFileSync(path, buildGradle);
NODE
}

ensure_gradle_wrapper() {
  local wrapper_jar="$ANDROID_ROOT/gradle/wrapper/gradle-wrapper.jar"
  local wrapper_properties="$ANDROID_ROOT/gradle/wrapper/gradle-wrapper.properties"
  local fallback_wrapper_dir="$MOBILE_ROOT/node_modules/@react-native/gradle-plugin/gradle/wrapper"
  local fallback_wrapper_jar=""
  local fallback_wrapper_properties=""

  if [[ -f "$wrapper_jar" && -f "$wrapper_properties" ]]; then
    return
  fi

  if [[ -f "$fallback_wrapper_dir/gradle-wrapper.jar" ]]; then
    fallback_wrapper_jar="$fallback_wrapper_dir/gradle-wrapper.jar"
    fallback_wrapper_properties="$fallback_wrapper_dir/gradle-wrapper.properties"
  elif [[ -d "$MOBILE_ROOT/node_modules" ]]; then
    fallback_wrapper_jar="$(find "$MOBILE_ROOT/node_modules" -path '*/gradle/wrapper/gradle-wrapper.jar' | sort | head -1 || true)"
    if [[ -n "$fallback_wrapper_jar" ]]; then
      fallback_wrapper_properties="$(dirname "$fallback_wrapper_jar")/gradle-wrapper.properties"
    fi
  fi

  if [[ -f "$fallback_wrapper_jar" && -f "$fallback_wrapper_properties" ]]; then
    print_warning "Gradle wrapper files are missing. Restoring from @react-native/gradle-plugin."
    mkdir -p "$ANDROID_ROOT/gradle/wrapper"
    cp "$fallback_wrapper_jar" "$wrapper_jar"
    cp "$fallback_wrapper_properties" "$wrapper_properties"
  fi

  if [[ ! -f "$wrapper_jar" || ! -f "$wrapper_properties" ]]; then
    print_error "Missing Gradle wrapper files under $ANDROID_ROOT/gradle/wrapper."
    print_error "Run pnpm install first, or run Expo prebuild again to regenerate the Android wrapper."
    print_error "You can check available wrapper files with: find node_modules -path '*/gradle/wrapper/gradle-wrapper.jar' | head"
    exit 1
  fi

  chmod +x "$ANDROID_ROOT/gradlew" 2>/dev/null || true
}

get_package_name() {
  local apk_path="$1"
  if [[ -x "${AAPT_BIN:-}" ]]; then
    "$AAPT_BIN" dump badging "$apk_path" 2>/dev/null | awk -F"'" '/^package: name=/{print $2; exit}' || true
  fi
}

get_badging_value() {
  local apk_path="$1"
  local pattern="$2"
  if [[ -x "${AAPT_BIN:-}" ]]; then
    "$AAPT_BIN" dump badging "$apk_path" 2>/dev/null | awk -F"'" -v pattern="$pattern" '$0 ~ pattern {print $2; exit}' || true
  fi
}

get_signer_digest() {
  local apk_path="$1"
  local digest_label="$2"
  if [[ -x "${APKSIGNER_BIN:-}" ]]; then
    "$APKSIGNER_BIN" verify --verbose --print-certs "$apk_path" 2>/dev/null | awk -F': ' -v label="$digest_label" '$1 == label {print $2; exit}' || true
  fi
}

get_file_size() {
  local file_path="$1"
  local size_bytes
  size_bytes=$(stat -c '%s' "$file_path" 2>/dev/null) || {
    echo "Unavailable"
    return
  }

  awk -v bytes="$size_bytes" 'BEGIN { printf "%d bytes / %.2f MB", bytes, bytes / 1048576 }'
}

get_sha256() {
  local file_path="$1"
  if [[ -f "$file_path" ]]; then
    sha256sum "$file_path" 2>/dev/null | awk '{print $1}' || true
  fi
}

get_size_bytes() {
  local file_path="$1"
  if [[ -f "$file_path" ]]; then
    stat -c '%s' "$file_path" 2>/dev/null || echo 0
  else
    echo 0
  fi
}

write_abi_manifest_json() {
  local manifest_path="$1"

  ABI_MANIFEST_PATH="$manifest_path" \
    ABI_OUTPUT_DIR="$OUTPUT_DIR" \
    ABI_PUBLIC_BASE_URL="$UPDATE_PUBLIC_BASE_URL" \
    ABI_LIST="${ABI_LIST[*]}" \
    "$NODE_BIN" <<'NODE'
const fs = require('fs');
const path = require('path');

const outputDir = process.env.ABI_OUTPUT_DIR;
const publicBaseUrl = process.env.ABI_PUBLIC_BASE_URL;
const abis = (process.env.ABI_LIST || '').split(/\s+/).filter(Boolean);
const apks = {};

for (const abi of abis) {
  const fileName = `FieldClock-${abi}.apk`;
  const filePath = path.join(outputDir, fileName);
  if (!fs.existsSync(filePath)) {
    continue;
  }

  const crypto = require('crypto');
  const contents = fs.readFileSync(filePath);
  const apkPath = `/updates/${fileName}`;
  apks[abi] = {
    abi,
    apk_path: apkPath,
    apk_url: `${publicBaseUrl}${apkPath}`,
    apk_sha256: crypto.createHash('sha256').update(contents).digest('hex'),
    apk_size_bytes: contents.length,
  };
}

fs.writeFileSync(process.env.ABI_MANIFEST_PATH, JSON.stringify(apks));
NODE
}

write_update_manifest() {
  local manifest_path="$1"
  local details="$2"
  local mandatory="$3"
  local apk_size_bytes
  local abi_manifest_path="$OUTPUT_DIR/.abi-apks.json"

  apk_size_bytes=$(stat -c '%s' "$OUTPUT_DIR/$LATEST_APK_NAME" 2>/dev/null || echo 0)
  write_abi_manifest_json "$abi_manifest_path"

  UPDATE_MANIFEST_PATH="$manifest_path" \
    UPDATE_MANIFEST_DETAILS="$details" \
    UPDATE_MANIFEST_MANDATORY="$mandatory" \
    UPDATE_MANIFEST_VERSION="$VERSION" \
    UPDATE_MANIFEST_VERSION_CODE="$VERSION_CODE" \
    UPDATE_MANIFEST_APK_PATH="$UPDATE_APK_PATH" \
    UPDATE_MANIFEST_APK_URL="$UPDATE_PUBLIC_BASE_URL$UPDATE_APK_PATH" \
    UPDATE_MANIFEST_APK_SHA256="$APK_SHA256" \
    UPDATE_MANIFEST_APK_SIZE_BYTES="$apk_size_bytes" \
    UPDATE_MANIFEST_ABI_JSON="$(cat "$abi_manifest_path")" \
    "$NODE_BIN" <<'NODE'
const fs = require('fs');
const path = process.env.UPDATE_MANIFEST_PATH;
const details = (process.env.UPDATE_MANIFEST_DETAILS || '')
  .split('|')
  .map((item) => item.trim())
  .filter(Boolean);

const manifest = {
  version: `v${process.env.UPDATE_MANIFEST_VERSION}`,
  changelog: details.length ? details.join('\n') : 'Bug fixes and improvements.',
  latest_version: process.env.UPDATE_MANIFEST_VERSION,
  latest_version_code: Number(process.env.UPDATE_MANIFEST_VERSION_CODE),
  apk_path: process.env.UPDATE_MANIFEST_APK_PATH,
  apk_url: process.env.UPDATE_MANIFEST_APK_URL,
  mandatory: process.env.UPDATE_MANIFEST_MANDATORY === 'true',
  published_at: new Date().toISOString(),
  apk_sha256: process.env.UPDATE_MANIFEST_APK_SHA256,
  apk_size_bytes: Number(process.env.UPDATE_MANIFEST_APK_SIZE_BYTES),
  apks: JSON.parse(process.env.UPDATE_MANIFEST_ABI_JSON || '{}'),
  details: details.length ? details : ['Bug fixes and improvements.'],
};

fs.writeFileSync(path, JSON.stringify(manifest, null, 2) + '\n');
NODE
}

publish_update() {
  local target="$1"
  local manifest_path="$OUTPUT_DIR/$UPDATE_MANIFEST_NAME"
  local publish_files=()

  write_update_manifest "$manifest_path" "$UPDATE_DETAILS" "$UPDATE_MANDATORY"

  while IFS= read -r file_path; do
    publish_files+=("$file_path")
  done < <(find "$OUTPUT_DIR" -maxdepth 1 -type f -name 'FieldClock*.apk' | sort)
  publish_files+=("$manifest_path")

  if [[ "$target" == *:* ]]; then
    require_command ssh
    require_command rsync
    local remote_dir="$target"
    local remote_host="${remote_dir%%:*}"
    local remote_path="${remote_dir#*:}"
    ssh "$remote_host" "mkdir -p '$remote_path'"
    rsync -av "${publish_files[@]}" "$remote_dir/"
  else
    mkdir -p "$target"
    cp "${publish_files[@]}" "$target/"
  fi
}

require_command() {
  local command_name="$1"
  if ! command -v "$command_name" >/dev/null 2>&1; then
    print_error "Missing command: $command_name"
    exit 1
  fi
}

require_command node
require_command pnpm
require_command java
require_command javac

if [[ ! -x "$MOBILE_ROOT/node_modules/.bin/expo" ]] \
  || [[ ! -d "$MOBILE_ROOT/node_modules/babel-preset-expo" ]] \
  || [[ ! -d "$MOBILE_ROOT/node_modules/expo-constants" ]] \
  || [[ ! -d "$MOBILE_ROOT/node_modules/expo-intent-launcher" ]] \
  || [[ ! -d "$MOBILE_ROOT/node_modules/react-native-vision-camera" ]]; then
  print_warning "Installing or refreshing mobile dependencies first."
  if [[ -f "$MOBILE_ROOT/pnpm-lock.yaml" ]]; then
    (cd "$MOBILE_ROOT" && "$PNPM_BIN" install --frozen-lockfile)
  else
    (cd "$MOBILE_ROOT" && "$PNPM_BIN" install)
  fi
fi

if [[ ! -d "$ANDROID_ROOT" ]]; then
  print_warning "Android folder not found. Running Expo prebuild first."
  (cd "$MOBILE_ROOT" && "$PNPM_BIN" exec expo prebuild --platform android)
fi

VERSION="$(read_json_value 'app.expo.version')"
SUGGESTED_INCREMENT="$(increment_version "$VERSION")"
SHOULD_CLEAN=false
SHOULD_PREBUILD=false
SHOULD_PUBLISH_UPDATE="${PUBLISH_UPDATE:-false}"
UPDATE_PUBLISH_TARGET="${UPDATE_PUBLISH_TARGET:-$DEFAULT_UPDATE_PUBLISH_TARGET}"
UPDATE_DETAILS="${UPDATE_DETAILS:-Bug fixes and improvements.}"
UPDATE_MANDATORY="${UPDATE_MANDATORY:-true}"

if [[ -f "$ANDROID_STRINGS_PATH" ]] && ! grep -q "<string name=\"app_name\">${APP_LABEL}</string>" "$ANDROID_STRINGS_PATH"; then
  print_warning "Android app label is stale. Expo prebuild will run to refresh native branding."
  SHOULD_PREBUILD=true
fi

if [[ -t 0 ]]; then
  print_header "========== FieldClock APK Builder =========="
  print_info "Current version: ${COLOR_BOLD}$VERSION${COLOR_RESET}"
  echo
  print_header "Choose version option:"
  echo -e "${COLOR_GREEN}1)${COLOR_RESET} Keep current version"
  echo -e "${COLOR_YELLOW}2)${COLOR_RESET} Increment version to ${COLOR_BOLD}$SUGGESTED_INCREMENT${COLOR_RESET}"
  echo -e "${COLOR_CYAN}3)${COLOR_RESET} Enter custom version"
  echo -e "${COLOR_RED}4)${COLOR_RESET} Cancel build"
  read -r -p "Select [1/2/3/4] (default: 1): " VERSION_CHOICE

  case "${VERSION_CHOICE:-1}" in
    1) ;;
    2) VERSION="$SUGGESTED_INCREMENT" ;;
    3)
      read -r -p "Enter custom version (example: 1.1.0.33): " CUSTOM_VERSION
      if [[ ! "$CUSTOM_VERSION" =~ ^[0-9]+(\.[0-9]+){0,3}$ ]]; then
        print_error "Invalid version format. Use digits and dots only, up to 4 parts."
        exit 1
      fi
      VERSION="$CUSTOM_VERSION"
      ;;
    4)
      print_warning "Build cancelled."
      exit 0
      ;;
    *)
      print_error "Invalid selection."
      exit 1
      ;;
  esac

  echo
  read -r -p "Run expo prebuild before Gradle? [y/N]: " PREBUILD_CHOICE
  case "${PREBUILD_CHOICE:-N}" in
    [yY]|[yY][eE][sS]) SHOULD_PREBUILD=true ;;
  esac

  read -r -p "Clean build? [y/N]: " CLEAN_CHOICE
  case "${CLEAN_CHOICE:-N}" in
    [yY]|[yY][eE][sS]) SHOULD_CLEAN=true ;;
  esac

  echo
  read -r -p "Publish APK update manifest after build? [Y/n]: " PUBLISH_CHOICE
  case "${PUBLISH_CHOICE:-Y}" in
    [yY]|[yY][eE][sS])
      SHOULD_PUBLISH_UPDATE=true
      read -r -p "Publish target [$UPDATE_PUBLISH_TARGET]: " CUSTOM_PUBLISH_TARGET
      UPDATE_PUBLISH_TARGET="${CUSTOM_PUBLISH_TARGET:-$UPDATE_PUBLISH_TARGET}"
      read -r -p "Release details (use | for multiple lines) [$UPDATE_DETAILS]: " CUSTOM_UPDATE_DETAILS
      UPDATE_DETAILS="${CUSTOM_UPDATE_DETAILS:-$UPDATE_DETAILS}"
      read -r -p "Mandatory update? [Y/n]: " MANDATORY_CHOICE
      case "${MANDATORY_CHOICE:-Y}" in
        [yY]|[yY][eE][sS]) UPDATE_MANDATORY=true ;;
        [nN]|[nN][oO]) UPDATE_MANDATORY=false ;;
      esac
      ;;
  esac
fi

VERSION_CODE="$(calculate_version_code "$VERSION")"
VERSIONED_APK_NAME="FieldClock-$VERSION.apk"

print_info "Selected version: ${COLOR_BOLD}$VERSION${COLOR_RESET}"
print_info "Computed version code: ${COLOR_BOLD}$VERSION_CODE${COLOR_RESET}"

update_versions "$VERSION" "$VERSION_CODE"

if [[ "$SHOULD_PREBUILD" == true ]]; then
  print_header "Running Expo prebuild..."
  (cd "$MOBILE_ROOT" && "$PNPM_BIN" exec expo prebuild --platform android)
  update_versions "$VERSION" "$VERSION_CODE"
fi

ensure_gradle_wrapper
configure_abi_splits

print_header "Building APK..."
(cd "$ANDROID_ROOT" && {
  if [[ "$SHOULD_CLEAN" == true ]]; then
    print_warning "Removing stale Android build outputs."
    rm -rf \
      "$ANDROID_ROOT/.gradle" \
      "$ANDROID_ROOT/build" \
      "$ANDROID_ROOT/app/.cxx" \
      "$ANDROID_ROOT/app/build"
  fi

  GRADLE_ARGS=(assembleRelease)
  if [[ -n "${MYAPP_UPLOAD_STORE_FILE:-}" ]]; then
    GRADLE_ARGS+=(
      "-PMYAPP_UPLOAD_STORE_FILE=${MYAPP_UPLOAD_STORE_FILE}"
      "-PMYAPP_UPLOAD_STORE_PASSWORD=${MYAPP_UPLOAD_STORE_PASSWORD:-}"
      "-PMYAPP_UPLOAD_KEY_ALIAS=${MYAPP_UPLOAD_KEY_ALIAS:-}"
      "-PMYAPP_UPLOAD_KEY_PASSWORD=${MYAPP_UPLOAD_KEY_PASSWORD:-}"
    )
  fi

  ./gradlew "${GRADLE_ARGS[@]}"
})

SOURCE_APK="$BUILD_PATH/app-universal-release.apk"
if [[ ! -f "$SOURCE_APK" ]]; then
  SOURCE_APK="$BUILD_PATH/app-release.apk"
fi
if [[ ! -f "$SOURCE_APK" ]]; then
  SOURCE_APK="$(find "$BUILD_PATH" -maxdepth 1 -type f \( -name '*universal*release*.apk' -o -name '*release*.apk' \) | sort | head -1 || true)"
fi

if [[ -z "${SOURCE_APK:-}" || ! -f "$SOURCE_APK" ]]; then
  print_error "APK not found under $BUILD_PATH"
  exit 1
fi

mkdir -p "$OUTPUT_DIR"
cp "$SOURCE_APK" "$OUTPUT_DIR/$LATEST_APK_NAME"
cp "$SOURCE_APK" "$OUTPUT_DIR/$VERSIONED_APK_NAME"

for abi in "${ABI_LIST[@]}"; do
  ABI_SOURCE_APK="$(find "$BUILD_PATH" -maxdepth 1 -type f -name "*${abi}*release*.apk" | sort | head -1 || true)"
  if [[ -n "$ABI_SOURCE_APK" && -f "$ABI_SOURCE_APK" ]]; then
    cp "$ABI_SOURCE_APK" "$OUTPUT_DIR/FieldClock-${abi}.apk"
    cp "$ABI_SOURCE_APK" "$OUTPUT_DIR/FieldClock-${VERSION}-${abi}.apk"
  fi
done

PACKAGE_NAME="$(get_package_name "$SOURCE_APK"  || true)"
BADGE_LABEL="$(get_badging_value "$SOURCE_APK" "^application-label:"  || true)"
MIN_SDK="$(get_badging_value "$SOURCE_APK" "^sdkVersion:")"
TARGET_SDK="$(get_badging_value "$SOURCE_APK" "^targetSdkVersion:"  || true)"
SIGNER_SHA256="$(get_signer_digest "$SOURCE_APK" "Signer #1 certificate SHA-256 digest"  || true)"
SIGNER_SHA1="$(get_signer_digest "$SOURCE_APK" "Signer #1 certificate SHA-1 digest"  || true)"
APK_SIZE="$(get_file_size "$OUTPUT_DIR/$LATEST_APK_NAME"  || true)"
VERSIONED_APK_SIZE="$(get_file_size "$OUTPUT_DIR/$VERSIONED_APK_NAME"  || true)"
APK_SHA256="$(get_sha256 "$OUTPUT_DIR/$LATEST_APK_NAME")"
VERSIONED_APK_SHA256="$(get_sha256 "$OUTPUT_DIR/$VERSIONED_APK_NAME"  || true)"
BUILD_USER="$(whoami 2>/dev/null || echo Unavailable)"
BUILD_HOST="$(hostname 2>/dev/null || echo Unavailable)"

cat > "$LATEST_INFO_FILE" <<EOF
FieldClock APK Build
===========================
Version: $VERSION
Version Code: $VERSION_CODE
Built At: $(date '+%Y-%m-%d %H:%M:%S %Z')
Built By: ${BUILD_USER:-Unavailable}
Build Host: ${BUILD_HOST:-Unavailable}
Project Root: $PROJECT_ROOT
Output Directory: $OUTPUT_DIR
Build Path: $BUILD_PATH
Build Type: Release
Clean Build: $SHOULD_CLEAN
Expo Prebuild: $SHOULD_PREBUILD
App Label: ${BADGE_LABEL:-$APP_LABEL}
Package Name: ${PACKAGE_NAME:-Unavailable}
Min SDK: ${MIN_SDK:-Unavailable}
Target SDK: ${TARGET_SDK:-Unavailable}
Latest APK: $LATEST_APK_NAME
Latest APK Size: ${APK_SIZE:-Unavailable}
Latest APK SHA-256: ${APK_SHA256:-Unavailable}
Versioned APK: $VERSIONED_APK_NAME
Versioned APK Size: ${VERSIONED_APK_SIZE:-Unavailable}
Versioned APK SHA-256: ${VERSIONED_APK_SHA256:-Unavailable}
Signer SHA-256: ${SIGNER_SHA256:-Unavailable}
Signer SHA-1: ${SIGNER_SHA1:-Unavailable}
EOF

{
  echo
  echo "ABI APKs:"
  for abi in "${ABI_LIST[@]}"; do
    abi_apk="$OUTPUT_DIR/FieldClock-${abi}.apk"
    if [[ -f "$abi_apk" ]]; then
      echo "- $abi: $(get_file_size "$abi_apk") / sha256 $(get_sha256 "$abi_apk")"
    fi
  done
} >> "$LATEST_INFO_FILE"

if [[ "$SHOULD_PUBLISH_UPDATE" == true ]]; then
  if [[ -z "$UPDATE_PUBLISH_TARGET" ]]; then
    print_error "Update publish target is empty. Set UPDATE_PUBLISH_TARGET or run from the full project root."
    exit 1
  fi

  print_header "Publishing APK update..."
  publish_update "$UPDATE_PUBLISH_TARGET"
  print_success "Update published"
  print_info "Target:      ${COLOR_BOLD}$UPDATE_PUBLISH_TARGET${COLOR_RESET}"
  print_info "Manifest:    ${COLOR_BOLD}$UPDATE_PUBLISH_TARGET/$UPDATE_MANIFEST_NAME${COLOR_RESET}"
fi

echo
print_success "Local build ready"
print_info "APK:         ${COLOR_BOLD}$OUTPUT_DIR/$LATEST_APK_NAME${COLOR_RESET}"
print_info "Versioned:   ${COLOR_BOLD}$OUTPUT_DIR/$VERSIONED_APK_NAME${COLOR_RESET}"
print_info "Build path:  ${COLOR_BOLD}$BUILD_PATH${COLOR_RESET}"
print_info "Latest info: ${COLOR_BOLD}$LATEST_INFO_FILE${COLOR_RESET}"
