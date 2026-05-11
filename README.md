# OMRON Activity Dashboard

授業で配布していたExcel操作を置き換えるための、静的Webダッシュボードです。OMRON活動量計の summary CSV と 1分ごとの processed CSV を読み込み、歩数、エクササイズ合計、METs時系列、個人平均と全体平均の比較、曜日別平均METsをブラウザ内で可視化します。

## 特徴

- ブラウザだけで動作します
- サーバー、ログイン、データベースは不要です
- 学生がアップロードしたCSVはサーバーへ送信されません
- GitHub Pagesで公開できます
- UTF-8 / Shift-JIS / CP932のCSVに対応します
- 付属サンプルデータですぐに動作確認できます

## 画面構成

1. データを読み込む
   - summary CSVを1つ選択
   - processed CSVを複数選択
   - `data/weekday_mean.csv` と `data/step_ex.csv` は自動読み込み
2. サマリーデータの可視化
   - 装着時間180分以上の日だけを対象
   - 歩数とエクササイズ合計を個人データとして棒グラフ表示
   - `data/step_ex.csv` の全員平均を点線で表示
3. 各個人の各日の時系列データ
   - processed CSVから選択日のMETs時系列を0時〜24時で表示
   - 縦軸は0〜8 METsに固定
4. 個人平均と全体平均の比較
   - processed CSVから個人平均パターンを計算
   - `data/weekday_mean.csv` の全平日平均と比較
5. 平日平均METs
   - 月曜〜金曜の全員平均METsを表示

## ファイル構成

```text
activity-rhythm-dashboard/
├─ index.html
├─ styles.css
├─ app.js
├─ data/
│  ├─ weekday_mean.csv
│  ├─ step_ex.csv
│  └─ class_average_by_minute.csv
├─ sample/
│  ├─ manifest.json
│  ├─ summary.csv
│  └─ processed_YYYY-MM-DD.csv
└─ .github/
   └─ workflows/
      └─ pages.yml
```

## 対応データ

### summary CSV

OMRON出力のsummaryファイル、または以下の簡易形式に対応します。

```csv
date,weekday,steps,wear_minutes,walking_minutes,total_calories,activity_calories,exercise_ex
2022-10-21,金,11655,644,132,2395,576,8.58
```

サマリー可視化では、`wear_minutes` または `装着時間(分)` が180分以上の日だけを使用します。

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

### step_ex.csv

サマリーデータの全員平均として使用します。

```csv
ave_step,ave_exercise
8406.949129,5.649763821
```

### weekday_mean.csv

平日平均METsとして使用します。

想定列:

- `日付` または `time`
- `all`, `Mon`, `Tue`, `Wed`, `Thu`, `Fri`
- `Num_Mon`, `Num_Tue`, `Num_Wed`, `Num_Thu`, `Num_Fri`

## GitHub Pagesで公開する方法

1. GitHubのリポジトリを開く
2. `Settings` → `Pages` を開く
3. `Build and deployment` の `Source` を `GitHub Actions` に設定する
4. mainブランチへpushする
5. Actions完了後、PagesのURLで公開されます

## 注意

このアプリは教育用プロトタイプです。実際の学生データをGitHubリポジトリに含めないでください。学生データは各自がブラウザ上で読み込む運用にしてください。
