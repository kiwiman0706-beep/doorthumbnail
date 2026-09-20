# Contributing

## 基本方針

- 家族写真・カレンダー・バックアップなどの実データをコミットしないでください。
- 署名鍵、パスワード、`local.properties`、KING JIM SDKバイナリをコミットしないでください。
- 既存のIndexedDBデータを壊さないよう、DB version更新時には移行処理を追加してください。
- Android 11以上での動作を維持してください。
- 新しい権限を追加する場合は、用途を`docs/PRIVACY.md`とアプリ画面の両方へ明記してください。

## 変更前の確認

```bash
node --check app/src/main/assets/app.js
./gradlew assembleDebug
```

TEPRA-Print SDKを配置していない環境ではAndroidビルドは失敗します。その場合でも、Web UIのJavaScript構文検査は実行してください。

## Pull Request

- 目的と利用者への影響を簡潔に記載してください。
- UI変更ではAndroidスマートフォン幅とタブレット幅の両方を確認してください。
- データ形式、権限、印刷処理、バックアップ処理の変更は、復元互換性と失敗時の挙動も記載してください。

