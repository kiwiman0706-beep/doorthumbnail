# Privacy and permissions

## 保存場所

- 月カード、候補箱、予定のコピー、設定はアプリ内のIndexedDBへ保存します。
- 完成画像は`Pictures/OmoideTimeline`へ保存します。
- バックアップは`Downloads/OmoideTimeline`へ保存します。
- 本アプリ自身はクラウド同期や解析送信を行いません。

## Android権限

| 権限 | 用途 |
| --- | --- |
| `READ_CALENDAR` | 端末で同期済みの予定を読み取る。書込みは行わない |
| `READ_MEDIA_IMAGES` | 指定月・指定日付付近の写真をMediaStoreから検索 |
| `READ_MEDIA_VISUAL_USER_SELECTED` | Android 14以降の選択写真アクセス |
| `READ_EXTERNAL_STORAGE` | Android 12L以前の写真検索。maxSdkVersion 32 |
| `NEARBY_WIFI_DEVICES` | Android 13以降でSR5900Pを探索 |
| `ACCESS_FINE_LOCATION` | Android 12L以前でWi-Fiプリンターを探索 |
| Wi-Fi／network state関連 | SR5900Pとのローカルネットワーク通信 |
| `INTERNET` | WebViewとローカルネットワーク通信に必要。自動クラウド送信には使用しない |

写真共有で受け取ったURIは、その場で回転補正・縮小・JPEG化してアプリへ保存します。元写真を変更・削除しません。

## カレンダー

Calendar Providerを読み取り専用で使用します。予定のタイトル、開始・終了日時、終日区分、場所、カレンダー名を候補整理用に端末内へコピーします。予定の追加・変更・削除は行いません。

## 公開リポジトリでの注意

実写真、バックアップ、署名鍵、`local.properties`、ログ、端末固有情報をIssueやPull Requestへ添付しないでください。

