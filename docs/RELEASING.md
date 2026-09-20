# Release procedure

## 1. バージョンを更新

次の2か所を同じ値へ更新します。

- `app/build.gradle`の`versionCode`／`versionName`
- `build-manual.sh`の`--version-code`／`--version-name`

変更内容を`CHANGELOG.md`へ追記します。

## 2. 検査

```bash
node --check app/src/main/assets/app.js
./gradlew clean assembleRelease
```

ネットワーク制限環境では、`build-manual.sh`で未署名APKを生成できます。

## 3. 署名

既存利用者が上書き更新できるよう、必ず初回リリースと同じ鍵で署名します。鍵、エイリアス、パスワードをコマンド履歴やリポジトリへ残さないでください。

```bash
zipalign -P 16 -f 4 unsigned.apk aligned.apk
apksigner sign --ks "$KEYSTORE_PATH" --ks-key-alias "$KEY_ALIAS" --out release.apk aligned.apk
```

パスワードは対話入力、または安全なCIシークレットから渡してください。

## 4. 検証

```bash
apksigner verify --verbose --print-certs release.apk
zipalign -c -P 16 -v 4 release.apk
aapt dump badging release.apk
sha256sum release.apk
```

前版APKと証明書SHA-256が一致すること、`versionCode`が増えていることを確認します。

## 5. 実機確認

- 旧版へ上書きインストールし、既存年表が残る
- 写真共有がストックへ入る
- カレンダー権限と写真権限の許可／拒否
- 予定日前後の写真検索
- ZIPバックアップと別端末相当の復元
- instax公式アプリへの共有
- SR5900P検索、テープ幅検出、テスト印刷
- A4印刷の倍率100%と54×86mm原寸

## GitHub Releases

GitHub ReleasesへAPKを載せる場合も、署名鍵やSDKバイナリをソースアーカイブへ含めないでください。APK、SHA-256、変更点、対応Androidバージョン、実機検証状況を明記します。

