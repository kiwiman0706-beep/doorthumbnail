#!/usr/bin/env bash
# Checks a release APK before it is published.
#
# The signing certificate is the thing worth guarding: an APK signed with a
# different key cannot update an existing install, and there is no way back
# once users have the old one. The fingerprint below is public information
# (every distributed APK carries it), not a secret.
#
#   tools/verify-apk.sh dist/omoide-timeline-1.2.0.apk

set -euo pipefail

EXPECTED_SHA256="1B:D8:38:CB:54:29:9E:FF:9A:72:BF:1F:33:1C:18:AF:12:C0:C4:D1:8C:C5:89:8E:A3:ED:18:A1:09:86:00:5D"
EXPECTED_ABIS=(arm64-v8a armeabi-v7a x86 x86_64)

apk="${1:-}"
if [[ -z "$apk" || ! -f "$apk" ]]; then
  echo "usage: tools/verify-apk.sh <apk>" >&2
  exit 2
fi

fail=0
note() { printf '%-42s %s\n' "$1" "$2"; }
bad()  { note "$1" "NG  $2"; fail=1; }
ok()   { note "$1" "OK  ${2:-}"; }

echo "== $apk =="

# 1. signing certificate
cert="$(unzip -Z1 "$apk" 'META-INF/*.RSA' 'META-INF/*.DSA' 'META-INF/*.EC' 2>/dev/null | head -1 || true)"
if [[ -z "$cert" ]]; then
  bad "署名" "署名されていません (META-INF に証明書がない)"
else
  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' EXIT
  unzip -oq "$apk" "$cert" -d "$tmp"
  got="$(keytool -printcert -file "$tmp/$cert" 2>/dev/null | awk -F': ' '/SHA256:/ {print $2; exit}')"
  if [[ "$got" == "$EXPECTED_SHA256" ]]; then
    ok "署名鍵" "1.1.0 と同じ鍵"
  else
    bad "署名鍵" "1.1.0 と別の鍵。上書き更新できません"
    echo "    expected $EXPECTED_SHA256"
    echo "    actual   ${got:-（読めません）}"
  fi
fi

# 2. TEPRA native libraries — the build succeeds without them, the app then
#    crashes the first time a label is printed.
for abi in "${EXPECTED_ABIS[@]}"; do
  if unzip -Z1 "$apk" "lib/$abi/libTepraPrint.so" >/dev/null 2>&1; then
    ok "TEPRA SDK ($abi)"
  else
    bad "TEPRA SDK ($abi)" "lib/$abi/libTepraPrint.so がありません"
  fi
done

# 3. WebView assets
for asset in index.html app.js styles.css; do
  if unzip -Z1 "$apk" "assets/$asset" >/dev/null 2>&1; then
    ok "assets/$asset"
  else
    bad "assets/$asset" "見つかりません"
  fi
done

echo
if (( fail )); then
  echo "=> 配布しないでください。上のNGを直してから作り直してください。"
  exit 1
fi
echo "=> 配布して問題ありません。"
