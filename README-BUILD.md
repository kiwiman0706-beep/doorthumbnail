# おもいで年表 Android版

家族写真を月ごとのコラージュにまとめるAndroidアプリです。写真共有でためる候補箱、Android端末で同期済みのカレンダー読込、撮影日付付近の写真検索、ZIP一括バックアップ、KING JIM「テプラ」PRO SR5900PへのWi‑Fi直接印刷、公式instax mini Linkアプリへの画像共有に対応します。

## 動作条件

- Android 11（API 30）以上
- テプラ直接印刷: KING JIM「テプラ」PRO SR5900P
- instax印刷: 富士フイルム公式instax mini Linkアプリ

## TEPRA-Print SDK

このソースバックアップにはKING JIMのSDKバイナリを含めていません。ビルド前に、公式サイトで使用許諾契約へ同意してTEPRA-Print SDK for Android v1.4.0を取得し、次の場所へ配置してください。

- `app/libs/TepraPrint.jar`
- `app/src/main/jniLibs/arm64-v8a/libTepraPrint.so`
- `app/src/main/jniLibs/armeabi-v7a/libTepraPrint.so`
- `app/src/main/jniLibs/x86/libTepraPrint.so`
- `app/src/main/jniLibs/x86_64/libTepraPrint.so`

公式SDK: https://www.kingjim.co.jp/download/tepra/sdk/

SDK使用許諾の条件に従い、日本国内で使用してください。アプリ内には指定のクレジット表示を実装しています。

### SDKの入手元を紛失した場合

リリース済みAPKにはネイティブライブラリがそのまま含まれているため、`.so` の4ファイルは自分のAPKから取り出せます。

```bash
unzip -o omoide-timeline-1.1.0.apk 'lib/*' -d extracted
for abi in arm64-v8a armeabi-v7a x86 x86_64; do
  mkdir -p "app/src/main/jniLibs/$abi"
  cp "extracted/lib/$abi/libTepraPrint.so" "app/src/main/jniLibs/$abi/"
done
```

ただし `TepraPrint.jar` はAPK内で `classes.dex` へ統合されているため、この方法では復元できません。**JARは公式サイトから取り直す必要があります。**
取得したSDK一式は、APKの署名鍵と同じ場所に暗号化バックアップしておくことを勧めます。

## ビルド

Android Studioでプロジェクトを開くか、JDK 17とAndroid SDKを設定してGradleの `assembleRelease` を実行します。外部依存はAndroid Gradle Pluginだけです。

ネットワークを使わず、Android SDK Build Toolsだけで未署名APKを作る場合は次を実行します。

```bash
export ANDROID_SDK_ROOT=/path/to/android-sdk
export JAVA_HOME=/path/to/jdk17
./build-manual.sh
```

未署名APKは `dist/omoide-timeline-unsigned.apk` に生成されます。配布前に、初回リリースと同じキーストアでzipalignと署名を行ってください。

## データ

写真と編集データはWebView内のIndexedDBへ端末内保存されます。APK版1.1.0のバックアップは、月カード、候補箱、カレンダーから取り込んだ予定、設定、アプリ内の圧縮済み写真を1つの `.omoide.zip` にまとめます。旧版およびPWA版の `.omoide.json` も、APK版の「復元」から読み込めます。

Androidのカレンダーは読み取り専用です。端末のCalendar Providerへ同期済みのGoogleカレンダー等を対象とし、予定を変更・削除しません。

## instaxについて

初代instax mini Linkには一般公開された直接印刷SDKを使用していないため、本アプリは完成画像を富士フイルム公式mini Linkアプリへ共有します。Bluetooth印刷の最終操作は公式アプリで行います。
