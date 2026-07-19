# etzhayyim-project-scheduler

**URL**: `https://scheduler.etzhayyim.com`

## Components

| Component | Path | Nanoid | 説明 |
|---|---|---|---|
| `scheduler-mcp-component` | `wasm/scheduler-mcp-component/` | `5dcfvsbd` | Agent orchestrator, タスクスケジューリング |
| `scheduler-cron-component` | `wasm/scheduler-cron-component/` | `2w9k6q1m` | Cron tick MCP actor |
| `scheduler-performer-mcp-component` | `wasm/scheduler-performer-mcp-component/` | — | Performer MCP |
| `scheduler-ui-2w9k6q1m` | `wasm/scheduler-ui-2w9k6q1m/` | — | UI (TS Native + SvelteKit) |

## Architecture

`scheduler.etzhayyim.com` は Codex Automations 風 UI で、スケジュールされた automation を `/xrpc` の Connect + controlplane MCP で管理する。

- UI: SvelteKit (authn.etzhayyim.com AT Protocol JWT 認証)
- Backend: App (XRPC, no REST)
- Auth:
  - user calls: AT Protocol JWT (`authn.etzhayyim.com/.well-known/jwks.json`)
  - cron tick: `scheduler_cron.tick` は `SCHEDULER_TICK_TOKEN` も受け付ける (CronJob 用)
- Routing note: actors HTTPRoute は Gateway の `https-actors-root` section に attach する (wildcard section だと期待通りに当たらない)

## Build & Deploy

```bash
# scheduler-cron-component
cd wasm/scheduler-cron-component
etzhayyim build
etzhayyim deploy --smoke-url https://2w9k6q1m.etzhayyim.com/health

# scheduler-mcp-component
cd wasm/scheduler-mcp-component
etzhayyim build
etzhayyim deploy --smoke-url https://2w9k6q1m.etzhayyim.com/health

# verify
curl https://2w9k6q1m.etzhayyim.com/xrpc/controlplane.v1.MCPService/ListTools \
  -X POST -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{}'
```
