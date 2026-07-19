# etzhayyim-project-scheduler App migration

このディレクトリは `legacy-runtime` 実装を残したまま、App 版を段階移行するための配置先です。

## 対象 App services

- `etzhayyim-performer-sys-etzhayyim-app-scheduler-go-tvf5lsbq` -> `scheduler-performer-mcp-component`
- `scheduler-5dcfvsbd` -> `scheduler-mcp-component`

## App 実装

- `scheduler-mcp-component`
  - scheduler API (`/threads`, `/schedule`, `/resources`, `/wellbeing`, `/autopilot`, `/api/*`) を wasm 側で提供
  - MCP endpoint (`/api/mcp`, `/{nanoid}/api/mcp`) を提供
  - `wasi:keyvalue/store` へ scheduler 状態を永続化
  - provider link config (`grpc`, `messaging`, `sqldb`, `blobstore`) を受け取り可能
- `scheduler-performer-mcp-component`
  - performer job API (`/api/v1/jobs`) と MCP endpoint を提供
  - `wasi:keyvalue/store` へ performer job 状態を永続化

## 補足

- 既存 App runtime は互換運用のため維持。
- Tauri OS 側の実装はこの移行対象外。
