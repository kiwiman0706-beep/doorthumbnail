# おもいで年表 / Omoide Timeline

家族写真を「横軸＝月、縦軸＝年」の年表として残す、Android向けローカル保存アプリです。日常は写真をストックへため、月末にストックから選び抜いて1枚のinstax mini比率のコラージュへ仕上げる運用を想定しています。

月末の作業は1画面で完結します。年表の月をタップすると、上にinstaxプレビュー、下にその月のストックが並び、タップした写真がその場で配置されます。

## 主な機能

- Androidの共有メニューから、複数写真を撮影月ごとのストックへ保存
- 年表の月をタップすると、その月の**instaxプレビューとストックが同じ画面に並ぶ**
- ストックをタップすると採用され、その場で自動配置。番号を押せば採用を取り消せる
- 端末で同期済みのGoogleカレンダー等を読み込み、写真と出来事を関連付け
- 月全体、または予定日の前後1日に絞った端末内写真検索
- 最大24枚の自由配置、パン、ズーム、トリミング、レイヤー順変更
- instax mini用600×800px画像を公式mini Linkアプリへ共有
- A4へinstax mini原寸（54×86mm）で9枚ずつ配置して印刷
- KING JIM「テプラ」PRO SR5900PへのWi-Fi直接印刷
- 月カード、ストック、予定、設定、圧縮済み写真を含むZIPバックアップ／復元

## 動作条件

- Android 11（API 30）以上
- JDK 17
- Android SDK Platform 35 / Build Tools 35.0.0
- SR5900P直接印刷を使う場合は、KING JIM TEPRA-Print SDK for Android v1.4.0
- instax印刷を使う場合は、富士フイルム公式instax mini Linkアプリ

## 最初のセットアップ

このリポジトリには、ライセンス上再配布すべきでないKING JIMのSDKバイナリを含めていません。公式サイトからSDKを取得し、次へ配置してください。

```text
app/libs/TepraPrint.jar
app/src/main/jniLibs/arm64-v8a/libTepraPrint.so
app/src/main/jniLibs/armeabi-v7a/libTepraPrint.so
app/src/main/jniLibs/x86/libTepraPrint.so
app/src/main/jniLibs/x86_64/libTepraPrint.so
```

続いて、`local.properties.example`を参考に、各自の環境だけで使う`local.properties`を作成します。

```properties
sdk.dir=/absolute/path/to/Android/sdk
```

`local.properties`、SDKバイナリ、APK、署名鍵は`.gitignore`で除外されます。

## ビルド

Android Studioで開いてビルドするか、コマンドラインから実行します。

```bash
./gradlew assembleDebug
./gradlew assembleRelease
```

Google Mavenへ接続できない環境では、JDK 17とAndroid SDKを指定して、同梱の手動ビルドスクリプトも利用できます。

```bash
export ANDROID_SDK_ROOT=/path/to/android-sdk
export JAVA_HOME=/path/to/jdk17
./build-manual.sh
```

詳しくは[README-BUILD.md](README-BUILD.md)を参照してください。

## リポジトリ構成

```text
app/src/main/java/          Androidネイティブ部分、WebView連携、印刷、写真検索
app/src/main/assets/        年表・ストック・コラージュ編集UI（HTML/CSS/JavaScript）
tools/                      ソース検査とUIスモークテスト
app/src/main/res/           アイコン、文字列、テーマ
docs/                       設計、プライバシー、リリース手順
.github/workflows/          GitHub Actionsの軽量ソース検査
build-manual.sh             Gradleに依存しない手動APKビルド
```

詳しい役割は[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)、コミット対象の一覧は[docs/REPOSITORY_FILES.md](docs/REPOSITORY_FILES.md)に記載しています。

## GitHubへ登録する

ZIPを展開したフォルダーで、次のように開始できます。

```bash
git init
git add .
git commit -m "Initial import: Omoide Timeline 1.1.0"
git branch -M main
git remote add origin <GitHubで作成した空リポジトリのURL>
git push -u origin main
```

まずはPrivateリポジトリがおすすめです。公開する場合は、KING JIM SDKの利用条件、写真やバックアップの混入、採用するソースライセンスを改めて確認してください。

## データとプライバシー

写真と編集内容は端末内のIndexedDBへ保存されます。本アプリ自身はクラウド同期を行いません。バックアップはAndroidの`Downloads/OmoideTimeline`へ書き出します。カレンダーは読み取り専用で、予定の追加・変更・削除は行いません。

## instax mini Linkについて

本アプリは完成画像を公式mini Linkアプリへ共有します。mini Link本体へ独自Bluetooth通信で直接印刷する実装ではありません。

## 重要：署名鍵

既存APKへ上書き更新するには、初回リリースと同じ署名鍵が必要です。署名鍵とパスワードはGitHubへコミットせず、パスワード管理ツールと暗号化バックアップで別管理してください。手順は[docs/RELEASING.md](docs/RELEASING.md)にあります。

## ライセンス

このリポジトリのソースコードは[MIT License](LICENSE)です。

ただし **KING JIM TEPRA-Print SDK はこのライセンスの対象外**です。SDKのJARとネイティブライブラリはリポジトリに含めておらず、利用にはキングジムの使用許諾契約への同意と公式サイトからの入手が必要です。

