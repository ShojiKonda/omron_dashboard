# OMRON Activity Dashboard

授業用の活動量データ可視化ダッシュボードです。学生がブラウザ上でOMRON由来のCSVデータを読み込み、装着時間、歩数、エクササイズ量、METs時系列、個人平均と全体平均の比較を確認できます。

## 画面構成

1. データを読み込む
   - summary CSVを1つ読み込みます
   - processed CSVを複数読み込みます
   - 曜日別平均CSVは `data/weekday_mean.csv` を自動読み込みします

2. 装着状況と日別サマリー
   - 日付、曜日、装着時間、歩数、エクササイズ合計を一覧表示します
   - 信頼性ラベルは表示しません

3. サマリーデータの可視化
   - 装着時間
   - 歩数
   - エクササイズ合計
   を日別棒グラフで表示します

4. 各個人の各日の時系列データ
   - processed CSVから、選択日のMETs時系列を0時〜24時で表示します

5. 個人平均と全体平均の比較
   - 複数日のprocessed CSVから個人平均パターンを計算します
   - `weekday_mean.csv` の全平日平均と比較します

6. 平日平均METs: 月〜金
   - 月曜〜金曜の全員平均を8時〜20時で比較します
   - データ数が少ない区間は点線で表示します

## データの扱い

このアプリは静的Webアプリです。アップロードしたCSVはブラウザ内でのみ処理され、サーバーには送信されません。ログインもデータベースも使用しません。

## 対応データ

### summary CSV

OMRON出力形式、または以下の簡易形式に対応します。

```csv
date,weekday,steps,wear_minutes,walking_minutes,total_calories,activity_calories,exercise_ex
2022-10-21,金,11655,644,132,2395,576,8.58
```

エクササイズ合計は `exercise_ex`、`エクササイズ合計(Ex)`、またはExcelのK列を参照します。

### processed CSV

1日1440行、1分ごとのデータを想定しています。ヘッダーなしでも読み込めます。

```csv
minute,time,mets,flag
0,00:00:00,0.0,-1.0
1,00:01:00,0.0,-1.0
2,00:02:00,1.3,0.0
```

### 曜日別平均CSV

`data/weekday_mean.csv` を既定ファイルとして読み込みます。

```csv
日付,all,Mon,Tue,Wed,Thu,Fri,Num_Mon,Num_Tue,Num_Wed,Num_Thu,Num_Fri
08:00:00,1.2,1.1,1.3,1.2,1.4,1.1,5,5,5,5,5
```

## GitHub Pagesで公開する方法

`index.html`、`styles.css`、`app.js`、`data/weekday_mean.csv`、`sample/` をリポジトリ直下に配置し、GitHub Pagesで `main / root` を公開してください。
