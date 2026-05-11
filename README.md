# Activity Rhythm Dashboard

授業で配布していたExcel操作を置き換えるための、静的Webダッシュボードです。OMRON活動量計のsummary CSVと1分ごとのprocessed CSVを読み込み、装着時間、歩数、METs時系列、全体平均との比較、曜日間比較、活動リズムヒートマップ、考察サポートを表示します。

## 特徴

- ブラウザだけで動作します
- サーバー、ログイン、データベースは不要です
- 学生がアップロードしたCSVはサーバーへ送信されません
- GitHub Pagesで公開できます
- UTF-8 / Shift-JIS / CP932のCSVに対応します
- 付属サンプルデータですぐに動作確認できます

## ファイル構成

```text
activity-rhythm-dashboard/
├─ index.html
├─ styles.css
├─ app.js
├─ data/
│  └─ class_average_by_minute.csv
├─ sample/
│  ├─ manifest.json
│  ├─ summary.csv
│  └─ processed_YYYY-MM-DD.csv
└─ .github/
   └─ workflows/
      └─ pages.yml
```

## 使い方

1. GitHub Pagesで公開されたURLを開く
2. `サンプルデータを読み込む` を押して動作確認する
3. 実授業では学生が以下をアップロードする
   - summary CSVを1つ
   - processed CSVを複数
4. ダッシュボードで以下を確認する
   - 装着時間
   - 歩数
   - 平均METs、最大METs
   - 自分の平均METsと全体平均の比較
   - 曜日間比較
   - 活動リズムヒートマップ
   - 考察サポート

## 対応データ

### summary CSV

OMRON出力のsummaryファイルに対応しています。以下の列を利用します。

- 日付
- 曜日
- 歩数合計(歩)
- 装着時間(分)
- 歩行時間(分)
- 総カロリー合計(kcal)
- カロリー合計(kcal)
- エクササイズ合計(Ex)

以下の簡易形式にも対応します。

```csv
date,weekday,steps,wear_minutes,walking_minutes,total_calories,activity_calories,exercise_ex
2022-10-21,金,11655,644,132,2395,576,8.58
```

### processed CSV

1日1440行、1分ごとのデータを想定しています。ヘッダーなしでも読み込めます。

```csv
0,00:00:00,0.0,-1.0
1,00:01:00,0.0,-1.0
2,00:02:00,1.3,0.0
```

列の意味は以下です。

1. minute index
2. time
3. METs
4. flag

### 全体平均CSV 任意

指定しない場合は、付属のサンプル全体平均を表示します。授業本番では、教員側で作成した全体平均ファイルに差し替えてください。

```csv
minute,time,class_mean_mets,class_sd_mets,n
0,00:00:00,1.2,0.3,48
1,00:01:00,1.1,0.2,48
```

## GitHub Pagesで公開する方法

### 方法1: GitHub Actionsを使う

このリポジトリには `.github/workflows/pages.yml` が含まれています。

1. GitHubのリポジトリを開く
2. `Settings` → `Pages` を開く
3. `Build and deployment` の `Source` を `GitHub Actions` に設定する
4. mainブランチへpushする
5. Actions完了後、PagesのURLで公開されます

### 方法2: branchから直接公開する

1. `Settings` → `Pages` を開く
2. `Source` を `Deploy from a branch` に設定する
3. Branchを `main`、folderを `/root` に設定する
4. 保存する

## 授業での運用案

学生には次の順で作業させると、Excel操作ではなくデータ解釈に集中できます。

1. 自分のCSVを読み込む
2. 装着時間を確認し、解析に使える日を判断する
3. 歩数と活動量を確認する
4. METs時系列から1日の活動パターンを読む
5. 全体平均と比較し、自分の特徴を探す
6. 曜日間比較から生活リズムを考察する
7. 考察サポートの問いに基づいてレポートを書く

## 注意

このアプリは教育用プロトタイプです。実際の学生データをGitHubリポジトリに含めないでください。学生データは各自がブラウザ上で読み込む運用にしてください。


## 平日平均CSV

`data/weekday_mean.csv` を既定の平均ファイルとして読み込みます。

想定列:

- `日付` (時刻)
- `all`, `Mon`, `Tue`, `Wed`, `Thu`, `Fri`
- `Num_Mon`, `Num_Tue`, `Num_Wed`, `Num_Thu`, `Num_Fri`

グラフでは 8:00〜20:00 を表示し、曜日別は `n < 3`、全平日は `n < 10` の区間を点線で表示して、平均値の信頼度が低いことを示します。
