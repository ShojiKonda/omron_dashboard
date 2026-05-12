# OMRON Activity Dashboard

授業で配布していたExcel操作を置き換えるための、静的Webダッシュボードです。OMRON活動量計の summary CSV と 1分ごとの processed CSV を読み込み、学生ごとの活動量をブラウザ上で可視化します。

## 主な機能

- ブラウザだけで動作します
- サーバー、ログイン、データベースは不要です
- 学生がアップロードしたCSVはサーバーへ送信されません
- UTF-8 / Shift-JIS / CP932 のCSVに対応します
- GitHub Pagesで公開できます

## 表示内容

1. データ読み込み
   - summary CSVを1つ読み込み
   - processed CSVを複数読み込み

2. 読み込み後サマリー
   - 解析対象日数
   - 平均歩数
   - 可視化対象日数（装着時間180分以上）
   - 平均METs
   - 平均エクササイズ

3. サマリーデータの可視化
   - 装着時間180分以上の日だけを対象
   - 歩数を日別棒グラフで表示
   - エクササイズExを日別棒グラフで表示
   - 全員平均を点線で表示

4. 各個人の各日の時系列データ
   - processed CSVからMETs時系列を表示
   - 日付選択に加えて「全日」表示に対応
   - 横軸の表示範囲を選択可能
   - 縦軸は表示データに合わせて自動調整
   - グラフ内部をダークテーマ、発光ライン、低コントラストグリッドで表示

5. 個人平均と全体平均の比較
   - 個人のprocessed CSVから平均パターンを計算
   - 全平日平均と比較
   - 縦軸は0〜6 METs
   - 横軸の表示範囲を選択可能

6. 平日平均METs: 月〜金
   - 月曜〜金曜の全員平均METsを表示
   - 横軸の表示範囲を選択可能
   - 低信頼区間の注釈や点線表示は行わない

## ファイル構成

```text
omron_dashboard/
├─ index.html
├─ styles.css
├─ app.js
├─ data/
│  ├─ weekday_mean.csv
│  └─ step_ex.csv
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

主に以下の列を利用します。

- 日付
- 曜日
- 歩数合計(歩)
- 装着時間(分)
- エクササイズ合計(Ex)

簡易形式の例:

```csv
date,weekday,steps,wear_minutes,exercise_ex
2022-10-21,金,11655,644,8.58
```

### processed CSV

1日1440行、1分ごとのデータを想定しています。ヘッダーなしでも読み込めます。

```csv
0,00:00:00,0.0,-1.0
1,00:01:00,0.0,-1.0
2,00:02:00,1.3,0.0
```

列の意味:

1. minute index
2. time
3. METs
4. flag

### 平日平均CSV

`data/weekday_mean.csv` を自動読み込みします。

想定列:

- `日付` または `time`
- `all`, `Mon`, `Tue`, `Wed`, `Thu`, `Fri`
- `Num_Mon`, `Num_Tue`, `Num_Wed`, `Num_Thu`, `Num_Fri`

### 歩数・Ex全員平均CSV

`data/step_ex.csv` を自動読み込みします。

想定列:

- `ave_step`
- `ave_exercise`

## GitHub Pagesで公開する方法

1. GitHubのリポジトリを開く
2. `Settings` → `Pages` を開く
3. `Source` を `Deploy from a branch` に設定
4. Branchを `main`、folderを `/root` に設定
5. 保存後、Pages URLで公開

## 注意

このアプリは教育用プロトタイプです。実際の学生データをGitHubリポジトリに含めないでください。学生データは各自がブラウザ上で読み込む運用にしてください。

## v6 更新内容

- データ読み込み欄から全体平均データの表示ボックスを削除
- 個人平均と全体平均の比較グラフに横軸範囲選択を追加
- 平日平均METsグラフに横軸範囲選択を追加
- 全体デザインを濃いグレー背景のダークテーマに変更


## v13 update

- 平日平均METs: 月〜金の縦軸を0.0, 1.0, 2.0, 3.0, 4.0に固定。
- 個人平均と全体平均の比較では、横補助線を1.0 METsごとに表示し、数値目盛は2.0 METsごとに表示。


## v14 update

- 時系列グラフに縦軸ラベル「METs」と横軸ラベル「時刻」を追加。

## v15 update

- グラフ内の文字色、軸線、軸ラベルを白に統一。
- グラフ内フォントを Noto Sans JP / Hiragino Sans / Yu Gothic / Meiryo 系に統一。
- canvas を表示サイズと devicePixelRatio に合わせて再描画し、文字と線のぼやけを軽減。
- 時系列グラフの縦軸ラベル（METs）・横軸ラベル（時刻）を維持。


## v16 update

- 各個人の各日の時系列データでは、縦軸の下限を1.0 METsに固定。
- 時系列データの横補助線を必ず1.0 METsごとに表示。

## v17 update

- 全グラフの軸・補助線設定を再確認。
- 各個人の各日の時系列データは縦軸下限を1.0 METs、補助線を1.0 METsごとに固定。
- 個人平均と全体平均の比較は補助線を1.0 METsごと、数値目盛を2.0 METsごとに固定。
- 平日平均METs: 月〜金は0.0〜4.0 METs、補助線と数値目盛を1.0 METsごとに固定。
- 歩数・Exの棒グラフは、グリッド線と数値目盛が必ず同じ値に対応するように修正。
