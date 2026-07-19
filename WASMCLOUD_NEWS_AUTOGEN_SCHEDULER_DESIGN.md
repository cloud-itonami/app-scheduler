# etzhayyim-project-news 自動記事生成を App 定期実行にする設計

## 1. 目的
`60-apps/etzhayyim-project-news` の記事生成ジョブ（`/jobs/news-generate`, `/jobs/anime-generate`, `/jobs/game-generate`, `/jobs/japanese-food-generate`）を、App scheduler 依存なしで `scheduler.etzhayyim.com` から定期実行できるようにする。

## 2. 現状
- `60-apps/etzhayyim-project-news/scheduler.jsonld` に cron 定義はある。
- `60-apps/etzhayyim-project-scheduler/wasm/scheduler-mcp-component` は KV 永続化と API を提供済み。
- `60-apps/etzhayyim-project-www/wasm/www-mcp-component` に `/scheduler/automations` と `/jobs/scheduler-tick` があり、定期実行メタデータを管理可能。
- ただし tick 実行時の「実ジョブ起動（news への POST）」は未実装。

## 3. ターゲット構成（App）
1. Control Plane: `scheduler-mcp-component`
- automation 定義を `wasi:keyvalue/store` へ保存
- next run 計算、lock、実行履歴管理

2. Tick Entrypoint: `www-mcp-component` の `/jobs/scheduler-tick`
- 1分ごとに呼び出される固定エンドポイント
- due automation を `scheduler-mcp-component` に転送

3. Job Runner: `scheduler-mcp-component` 内の executor
- 対象ジョブ URL へ HTTP POST
- 成功/失敗を run history に記録
- 失敗時リトライ（指数バックオフ）

4. Target Service: `etzhayyim-project-news` wasm endpoint
- 既存の `/jobs/*` エンドポイントを利用

## 4. データモデル
`automation` を次のフィールドで統一する。

```json
{
  "id": "aut_xxx",
  "name": "news-autogen-4h",
  "project": "etzhayyim-project-news",
  "enabled": true,
  "timezone": "Asia/Tokyo",
  "schedule": {
    "kind": "interval_hours",
    "value": 4,
    "days": ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"]
  },
  "target": {
    "method": "POST",
    "url": "https://etzhayyim.com/<news-nanoid>/jobs/news-generate",
    "headers": {"content-type": "application/json"},
    "body": {"data": {"topic": "automated", "localeTargets": ["ja", "en"]}}
  },
  "retry": {"max_attempts": 3, "backoff_seconds": 30},
  "next_run_at": "2026-02-16T20:00:00Z",
  "last_run_at": "2026-02-16T16:00:00Z",
  "last_result": "ok"
}
```

## 5. API 設計
1. `GET /scheduler/automations`
- automation 一覧

2. `POST /scheduler/automations`
- automation 作成
- `target.url`, `schedule`, `timezone` を受け取る

3. `PATCH /scheduler/automations/{id}`
- `enabled`/schedule 更新

4. `POST /scheduler/automations/{id}/trigger`
- 手動実行

5. `POST /jobs/scheduler-tick`
- due automation を一括実行
- レスポンス例: `{ "ok": true, "ran": 3, "failed": 1 }`

## 6. scheduler.etzhayyim.com UI/UX
`/scheduler` 画面に次を配置する。

1. Automation Composer
- 名前、対象プロジェクト、対象 URL、interval/days、prompt を入力
- テンプレート: `etzhayyim-project-news` 自動記事生成

2. Automation List
- Enabled/Disabled, next run, last run, last result
- `Trigger now`, `Enable/Disable`

3. Live Tick Ops
- `Run Tick Now` ボタン
- 実行件数と失敗件数の表示

4. Existing Scheduler Telemetry
- wellbeing/resource/thread 表示は維持

## 7. 実装ステップ
1. `scheduler-mcp-component` に automation 実行ロジックを追加
- `net/http` で target endpoint を POST
- run result を KV 永続化

2. `www-mcp-component` の automation struct を target 指向へ拡張
- 既存 `prompt/work_dir` 中心から `target.url/body` 中心へ移行

3. `60-apps/etzhayyim-project-news/scheduler.jsonld` から job seed を投入
- 初期 automation を自動登録（migration job）

4. Tick source を固定化
- Cluster 側で 1分間隔の tick 呼び出しを 1本だけ運用

5. 可観測性
- `automation_runs_total`, `automation_run_failures_total`, `automation_run_latency_ms`

## 8. 受け入れ条件
1. `etzhayyim-project-news` の `news-generate` が 4時間間隔で自動実行される。
2. `/scheduler` UI からジョブ作成・有効化・手動トリガーができる。
3. 失敗時に `last_result` と失敗回数が記録される。
4. App scheduler コンポーネントを使わずに同等運用が可能。

## 9. 移行順序
1. Shadow 実行（既存 cron を残したまま wasm 側を dry-run）
2. 重複配信がないことを確認
3. App scheduler を停止
4. wasm 側を本番 primary に切替
