# GitHub repository file policy

## コミットするもの

| パス | 内容 |
| --- | --- |
| `app/src/main/java/` | Android Javaソース |
| `app/src/main/assets/` | HTML/CSS/JavaScript/PWA素材 |
| `app/src/main/res/` | アイコン、文字列、テーマ、XML |
| `app/build.gradle` | Androidアプリのビルド設定 |
| ルートのGradleファイル | プロジェクト設定とWrapper |
| `gradle/wrapper/` | Gradle Wrapper JARと設定 |
| `build-manual.sh` | オフライン寄りの手動ビルド |
| `.github/workflows/` | 自動ソース検査 |
| `README*.md`、`docs/` | セットアップ、設計、運用手順 |
| `local.properties.example` | ローカル設定の見本 |
| `app/libs/README.md` | SDK JAR配置案内 |
| `app/src/main/jniLibs/README.md` | SDKネイティブライブラリ配置案内 |

## コミットしないもの

| 対象 | 理由 |
| --- | --- |
| `local.properties` | PC固有のAndroid SDK絶対パス |
| `.gradle/`、`**/build/`、`dist/` | 再生成可能なビルド生成物 |
| `manual-build-*/` | 一時ビルド生成物 |
| APK、AAB、IDSIG | GitHub Releases等で別配布する生成物 |
| JKS、P12、PEM、秘密鍵、署名情報 | 漏えいすると更新経路が危険になる |
| `TepraPrint.jar`、`libTepraPrint.so` | KING JIM SDKの再配布を避ける |
| `.omoide.json`、`.omoide.zip` | 家族写真や予定を含む個人データ |
| 実写真、端末ログ、カレンダー書出し | 個人情報 |

## 公開前チェック

```bash
git status --short
git ls-files | grep -E '(local\.properties$|\.p12$|\.jks$|\.keystore$|TepraPrint\.jar$|libTepraPrint\.so$|\.omoide\.(json|zip)$)'
```

2行目が何も返さないことを確認してください。

公開ライセンスはこのZIPでは未指定です。Publicリポジトリへする際に、利用許諾の範囲を決めて`LICENSE`を追加してください。

