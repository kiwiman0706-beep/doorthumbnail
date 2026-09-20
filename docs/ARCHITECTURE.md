# Architecture

## 全体像

本アプリは、Androidネイティブの薄いコンテナーと、WebView内で動くHTML/CSS/JavaScriptの編集UIを組み合わせています。

```text
Android MainActivity
  ├─ WebView: 年表・候補箱・コラージュUI
  ├─ AndroidBridge: 写真、予定、印刷、バックアップ
  ├─ SearchActivity: SR5900P検索
  └─ PhotoSearchActivity: 日付範囲付きMediaStore写真選択
```

## Androidネイティブ層

### MainActivity.java

- WebViewの初期化
- Android共有Intentの受信
- 写真の回転補正、縮小、JPEG圧縮
- Calendar Providerの読取
- MediaStore写真検索画面の起動
- TEPRA-Print SDKを介したSR5900P印刷
- 公式instax mini Linkアプリへの共有
- Android印刷フレームワークを使ったA4印刷
- ZIPバックアップの生成と安全な展開

### SearchActivity.java

同一Wi-Fi上の対応テプラを探索し、選択結果をMainActivityへ返します。

### PhotoSearchActivity.java

指定期間のMediaStore画像を取得し、最大24枚を選択してMainActivityへ返します。Android 14以降では、利用者が許可した範囲の写真だけが対象です。

## Web UI層

### index.html / styles.css

- 年×月の年表
- 候補箱
- 月カード編集
- 設定、印刷選択ダイアログ
- スマートフォン／タブレット向けレスポンシブUI

### app.js

- IndexedDBの読書き
- 候補の選別と予定の関連付け
- Canvasコラージュ編集
- JSON／ZIPバックアップ用データ生成
- AndroidBridgeとの相互呼出し

## 端末内データ

IndexedDB名は`omoide-timeline`、現在のversionは`2`です。

| Store | Key | 内容 |
| --- | --- | --- |
| `months` | `YYYY-MM` | 月カード、出来事、配置、写真Blob、印刷状態 |
| `settings` | `main` | 表示年、テプラ機種、テープ幅 |
| `candidates` | UUID | 候補写真、撮影日時、年月、状態、関連予定 |
| `calendarMonths` | `YYYY-MM` | 読み込んだ予定と同期日時 |

version 1からversion 2への更新では、既存の`months`と`settings`を保持し、新しいStoreだけを追加します。

## バックアップ形式

APK版1.1.0は`.omoide.zip`を生成します。

```text
manifest.json
photos/months/00001.jpg
photos/candidates/00002.jpg
...
```

復元時はエントリー数、各ファイルサイズ、合計サイズ、パスを検証し、全写真の読込に成功してからIndexedDBを1トランザクションで置換します。旧`.omoide.json`も読込可能です。

