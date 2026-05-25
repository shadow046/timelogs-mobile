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
BUILD_PATH="$ANDROID_ROOT/app/build/outputs/apk/release"
OUTPUT_DIR="$PROJECT_ROOT/APK"
LATEST_INFO_FILE="$OUTPUT_DIR/latest.txt"
LATEST_APK_NAME="TimeLogsPresence.apk"
APP_LABEL="TimeLogs Presence"

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

get_package_name() {
  local apk_path="$1"
  if [[ -x "${AAPT_BIN:-}" ]]; then
    "$AAPT_BIN" dump badging "$apk_path" 2>/dev/null | awk -F"'" '/^package: name=/{print $2; exit}'
  fi
}

get_badging_value() {
  local apk_path="$1"
  local pattern="$2"
  if [[ -x "${AAPT_BIN:-}" ]]; then
    "$AAPT_BIN" dump badging "$apk_path" 2>/dev/null | awk -F"'" -v pattern="$pattern" '$0 ~ pattern {print $2; exit}'
  fi
}

get_signer_digest() {
  local apk_path="$1"
  local digest_label="$2"
  if [[ -x "${APKSIGNER_BIN:-}" ]]; then
    "$APKSIGNER_BIN" verify --verbose --print-certs "$apk_path" 2>/dev/null | awk -F': ' -v label="$digest_label" '$1 == label {print $2; exit}'
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
  sha256sum "$file_path" 2>/dev/null | awk '{print $1}'
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

if [[ ! -x "$MOBILE_ROOT/node_modules/.bin/expo" ]] || [[ ! -d "$MOBILE_ROOT/node_modules/react-native-maps" ]]; then
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

if [[ -t 0 ]]; then
  print_header "========== TimeLogs APK Builder =========="
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
fi

VERSION_CODE="$(calculate_version_code "$VERSION")"
VERSIONED_APK_NAME="TimeLogsPresence-$VERSION.apk"

print_info "Selected version: ${COLOR_BOLD}$VERSION${COLOR_RESET}"
print_info "Computed version code: ${COLOR_BOLD}$VERSION_CODE${COLOR_RESET}"

update_versions "$VERSION" "$VERSION_CODE"

if [[ "$SHOULD_PREBUILD" == true ]]; then
  print_header "Running Expo prebuild..."
  (cd "$MOBILE_ROOT" && "$PNPM_BIN" exec expo prebuild --platform android)
  update_versions "$VERSION" "$VERSION_CODE"
fi

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

SOURCE_APK="$BUILD_PATH/app-release.apk"
if [[ ! -f "$SOURCE_APK" ]]; then
  SOURCE_APK="$(find "$BUILD_PATH" -maxdepth 1 -type f -name '*release*.apk' | sort | head -1 || true)"
fi

if [[ -z "${SOURCE_APK:-}" || ! -f "$SOURCE_APK" ]]; then
  print_error "APK not found under $BUILD_PATH"
  exit 1
fi

mkdir -p "$OUTPUT_DIR"
cp "$SOURCE_APK" "$BUILD_PATH/$LATEST_APK_NAME"
cp "$SOURCE_APK" "$BUILD_PATH/$VERSIONED_APK_NAME"
cp "$SOURCE_APK" "$OUTPUT_DIR/$LATEST_APK_NAME"
cp "$SOURCE_APK" "$OUTPUT_DIR/$VERSIONED_APK_NAME"

PACKAGE_NAME="$(get_package_name "$SOURCE_APK")"
BADGE_LABEL="$(get_badging_value "$SOURCE_APK" "^application-label:")"
MIN_SDK="$(get_badging_value "$SOURCE_APK" "^sdkVersion:")"
TARGET_SDK="$(get_badging_value "$SOURCE_APK" "^targetSdkVersion:")"
SIGNER_SHA256="$(get_signer_digest "$SOURCE_APK" "Signer #1 certificate SHA-256 digest")"
SIGNER_SHA1="$(get_signer_digest "$SOURCE_APK" "Signer #1 certificate SHA-1 digest")"
APK_SIZE="$(get_file_size "$OUTPUT_DIR/$LATEST_APK_NAME")"
VERSIONED_APK_SIZE="$(get_file_size "$OUTPUT_DIR/$VERSIONED_APK_NAME")"
APK_SHA256="$(get_sha256 "$OUTPUT_DIR/$LATEST_APK_NAME")"
VERSIONED_APK_SHA256="$(get_sha256 "$OUTPUT_DIR/$VERSIONED_APK_NAME")"
BUILD_USER="$(whoami 2>/dev/null || echo Unavailable)"
BUILD_HOST="$(hostname 2>/dev/null || echo Unavailable)"

cat > "$LATEST_INFO_FILE" <<EOF
TimeLogs Presence APK Build
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

echo
print_success "Local build ready"
print_info "APK:         ${COLOR_BOLD}$OUTPUT_DIR/$LATEST_APK_NAME${COLOR_RESET}"
print_info "Versioned:   ${COLOR_BOLD}$OUTPUT_DIR/$VERSIONED_APK_NAME${COLOR_RESET}"
print_info "Build path:  ${COLOR_BOLD}$BUILD_PATH${COLOR_RESET}"
print_info "Latest info: ${COLOR_BOLD}$LATEST_INFO_FILE${COLOR_RESET}"
