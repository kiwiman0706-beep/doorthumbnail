#!/usr/bin/env bash
set -euo pipefail

: "${ANDROID_SDK_ROOT:?ANDROID_SDK_ROOTを設定してください}"
: "${JAVA_HOME:?JAVA_HOMEを設定してください}"

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
BUILD_TOOLS_VERSION="${BUILD_TOOLS_VERSION:-35.0.0}"
PLATFORM_VERSION="${PLATFORM_VERSION:-35}"
BUILD_TOOLS="$ANDROID_SDK_ROOT/build-tools/$BUILD_TOOLS_VERSION"
ANDROID_JAR="$ANDROID_SDK_ROOT/platforms/android-$PLATFORM_VERSION/android.jar"
TEMP_DIR="$(mktemp -d)"
OUTPUT_DIR="$PROJECT_DIR/dist"

finish() {
  if command -v trash-put >/dev/null 2>&1; then
    trash-put "$TEMP_DIR"
  else
    echo "一時ビルドフォルダー: $TEMP_DIR"
  fi
}
trap finish EXIT

mkdir -p "$TEMP_DIR/gen" "$TEMP_DIR/classes" "$TEMP_DIR/dex" "$OUTPUT_DIR"

"$BUILD_TOOLS/aapt2" compile \
  --dir "$PROJECT_DIR/app/src/main/res" \
  -o "$TEMP_DIR/resources.zip"

"$BUILD_TOOLS/aapt2" link \
  -o "$TEMP_DIR/base.apk" \
  --manifest "$PROJECT_DIR/app/src/main/AndroidManifest.xml" \
  -I "$ANDROID_JAR" \
  --min-sdk-version 30 \
  --target-sdk-version 35 \
  --version-code 110 \
  --version-name 1.1.0 \
  --java "$TEMP_DIR/gen" \
  -A "$PROJECT_DIR/app/src/main/assets" \
  "$TEMP_DIR/resources.zip"

find "$PROJECT_DIR/app/src/main/java" "$TEMP_DIR/gen" -name '*.java' -print > "$TEMP_DIR/java-sources.txt"
"$JAVA_HOME/bin/javac" \
  -encoding UTF-8 \
  -source 17 -target 17 \
  -classpath "$ANDROID_JAR:$PROJECT_DIR/app/libs/TepraPrint.jar" \
  -d "$TEMP_DIR/classes" \
  @"$TEMP_DIR/java-sources.txt"

"$JAVA_HOME/bin/jar" cf "$TEMP_DIR/app-classes.jar" -C "$TEMP_DIR/classes" .
"$BUILD_TOOLS/d8" \
  --min-api 30 \
  --lib "$ANDROID_JAR" \
  --output "$TEMP_DIR/dex" \
  "$TEMP_DIR/app-classes.jar" "$PROJECT_DIR/app/libs/TepraPrint.jar"

cp "$TEMP_DIR/base.apk" "$TEMP_DIR/unsigned-unaligned.apk"
zip -q -j "$TEMP_DIR/unsigned-unaligned.apk" "$TEMP_DIR/dex/classes.dex"
cp -R "$PROJECT_DIR/app/src/main/jniLibs" "$TEMP_DIR/lib"
(
  cd "$TEMP_DIR"
  zip -q -r unsigned-unaligned.apk lib
)

"$BUILD_TOOLS/zipalign" -P 16 -f 4 \
  "$TEMP_DIR/unsigned-unaligned.apk" \
  "$OUTPUT_DIR/omoide-timeline-unsigned.apk"

echo "生成完了: $OUTPUT_DIR/omoide-timeline-unsigned.apk"
