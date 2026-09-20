# Release procedure

> **このリポジトリだけではAPKを作れません。** ビルドには、リポジトリに含めていない
> KING JIM TEPRA-Print SDK（JARとネイティブライブラリ）と、初回リリースと同じ
> 署名鍵の両方が必要です。どちらも手元の環境にしかありません。
> 入手方法は[README-BUILD.md](../README-BUILD.md)を参照してください。

## 0. 手元に揃っているか確認

```bash
test -f app/libs/TepraPrint.jar || echo "TepraPrint.jar がありません"
for abi in arm64-v8a armeabi-v7a x86 x86_64; do
  test -f "app/src/main/jniLibs/$abi/libTepraPrint.so" || echo "$abi の .so がありません"
done
test -f local.properties || echo "local.properties がありません"
```

署名鍵は次の証明書と一致するものを使います（1.1.0で使った鍵）。

```text
CN=Omoide Timeline, O=Yaegaki, C=JP
SHA-256: 1B:D8:38:CB:54:29:9E:FF:9A:72:BF:1F:33:1C:18:AF:12:C0:C4:D1:8C:C5:89:8E:A3:ED:18:A1:09:86:00:5D
```

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

まず同梱スクリプトを通します。署名鍵が前版と同じか、TEPRAのネイティブライブラリが
4 ABIとも入っているか、WebViewアセットが入っているかを見ます。

```bash
tools/verify-apk.sh release.apk
```

Android SDKが使える環境では、あわせて次も確認します。

```bash
apksigner verify --verbose --print-certs release.apk
zipalign -c -P 16 -v 4 release.apk
aapt dump badging release.apk
sha256sum release.apk
```

前版APKと証明書SHA-256が一致すること、`versionCode`が増えていることを確認します。
**鍵が違うAPKを配ると、既存利用者は上書き更新できず、アンインストールしない限り
更新できなくなります（データも消えます）。ここは必ず確認してください。**

## 5. 実機確認

- 旧版へ上書きインストールし、既存年表が残る
- 写真共有がストックへ入る
- カレンダー権限と写真権限の許可／拒否
- 予定日前後の写真検索
- ZIPバックアップと別端末相当の復元
- instax公式アプリへの共有
- SR5900P検索、テープ幅検出、テスト印刷
- A4印刷の倍率100%と54×86mm原寸

## 6. GitHub Releases

タグとリリースノートはソース側で先に作れます。APKは手元でビルド・署名・検証してから、
同じリリースへアップロードしてください。

```bash
gh release upload v1.2.0 dist/omoide-timeline-1.2.0.apk
sha256sum dist/omoide-timeline-1.2.0.apk
```

署名鍵やSDKバイナリをソースアーカイブへ含めないでください。APK、SHA-256、変更点、
対応Androidバージョン、実機検証状況を明記します。

