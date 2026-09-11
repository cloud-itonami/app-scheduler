# app-scheduler

**`scheduler.etzhayyim.com` — the scheduled-job plane: a public catalog of *what
is scheduled*, and an end-to-end encrypted record of *what happened when it
ran*.**

The split is the point of this repo. A job's schedule metadata (name, cron,
target method and URL, owner) is deliberately public and plaintext, because a
schedule is frontable operational meta. The per-execution record — the response
body, the error text, the timing — is deliberately sealed, because it can carry
whatever the target endpoint returned. The two live in different collections
with different read paths:

| | collection / inner type | path | who can read it |
|---|---|---|---|
| **Job catalog** | `com.etzhayyim.apps.scheduler.job` | `sdk.write` / `sdk.read` | anyone |
| **Job run** | `com.etzhayyim.apps.scheduler.jobRun` | `sdk.encryptedWrite` / `sdk.encryptedRead` | owner DID + explicit recipients |

What deliberately does **not** live here: the cron tick itself. Firing the
outbound HTTP call, the retry/backoff runtime, and custody of the auth tokens
used to authenticate those calls stay etzhayyim-side and are consumed through a
consent-capability. Only the resulting run *data* migrates. `registry.ts` states
this at the top and the code follows it — there is no `deleteJob` in the kotoba
slice because a hard delete is an execution act, not a data write.

Authority for the split: ADR-2605181100 (kotoba E2E encrypted-record envelope),
ADR-2606011400 (Consensys c-split), ADR-2605172400 (3-axis), ADR-2605172000
(substrate boundary). Those ADRs live in `etzhayyim/root`, not in this repo.

## Layout

Thirty-two tracked files (thirty, plus this README and the quickstart), two
planes that do not currently meet:

```
kotoba/                            reference implementation of the data model (TypeScript)
  src/types.ts                     the split, as types + validators
  src/registry.ts                  registerJob / setJobStatus / getJob / listJobs
                                   recordRun / listRuns / getRun / coverage
  test/scheduler.test.ts           5 tests, green (see docs/operator-quickstart.md)
appview/scheduler-mcp-component/   thin-edge dispatcher (Cloudflare Worker)
  src/app.ts                       /health + /xrpc/com.etzhayyim.apps.scheduler.*
  cljs/                            ClojureScript UI (reagent + re-frame + jp-go-dds),
                                    served as static assets — see cljs/ for the build
bpmn/scheduler.bpmn                BPMN orchestration
```

**2026-08-26: the frontend was migrated from SvelteKit to ClojureScript**
(reagent + re-frame + `jp-go-dds`, ADR-2608260900). `appview/scheduler-mcp-component/svelte/`
is gone; the ported page lives at `appview/scheduler-mcp-component/cljs/src/scheduler/app.cljk`
and is a faithful, content-preserving port of the deleted `svelte/src/routes/+page.svelte` —
no scheduling behavior was added or removed. One file under the deleted `svelte/` tree was
backend, not frontend, and does not fit that story cleanly:
`svelte/src/routes/xrpc/[...path]/+server.ts` was a SvelteKit server route that proxied
`/xrpc/<nsid>` to `AGENTGATEWAY_MCP_ROUTER_URL`. It was moved (unmodified) to
`appview/scheduler-mcp-component/src/xrpc-agentgateway-proxy.ts`, but it cannot run there —
it depended on the SvelteKit build, which no longer exists, and `wrangler.jsonc`'s `main` (which
used to point at that build) has been dropped rather than repointed, since `src/app.ts` does not
call `env.ASSETS.fetch()`. Whether/how to revive that proxy is a product decision this migration
does not make; see the header comment on that file.

## Read this before trusting the rest of the tree

This repo was extracted from `etzhayyim/root` (`60-apps/etzhayyim-project-scheduler`,
see `migration.edn`) and **several files still describe the pre-extraction
layout.** All of the following were measured on 2026-08-17, re-walked unchanged on
2026-08-23, and are reproducible from `docs/operator-quickstart.md`:

| What a reader would conclude | What the tree actually contains |
|---|---|
| `CLAUDE.md` lists four components under `wasm/` | There is **no `wasm/` directory**. The only component present is `appview/scheduler-mcp-component`. `scheduler-cron-component`, `scheduler-performer-mcp-component` and `scheduler-ui-2w9k6q1m` are not in this repo |
| `CLAUDE.md` build steps: `cd wasm/scheduler-cron-component && etzhayyim build` | That path does not exist, so the documented build cannot be run as written |
| `PROJECT.jsonld` says `programmingLanguage: Go`, `runtimePlatform: SpinApp (TinyGo)` | Every source file here is TypeScript |
| `PROJECT.jsonld` says `codeRepository: etzhayyim/etzhayyim-apps-etzhayyim` | This repo is `cloud-itonami/app-scheduler` |
| `MIGRATION-TODO.md` says "appview wiring + `kotoba/` reference slice TBD" | `kotoba/` exists, is complete enough to test, and its suite is green |
| The dispatcher and the kotoba slice expose the same operations | They share **only `getJob` and `listJobs`** — see below |

### The two planes expose different surfaces

`appview/scheduler-mcp-component/src/app.ts` advertises eight methods;
`kotoba/src/registry.ts` exports eight functions; six on each side have no
counterpart:

| dispatcher only | shared | kotoba only |
|---|---|---|
| `createJob`, `updateJob`, `deleteJob`, `pauseJob`, `resumeJob`, `jobStatus` | `getJob`, `listJobs` | `registerJob`, `setJobStatus`, `recordRun`, `listRuns`, `getRun`, `coverage` |

Two consequences an operator should know:

- **The entire encrypted run surface is unreachable through the dispatcher.**
  `recordRun` / `listRuns` / `getRun` have no XRPC method, so the E2E jobRun
  records — the confidential half of the split this repo exists to implement —
  cannot be written or read through the deployed worker.
- **The dispatcher advertises `deleteJob`, which the kotoba slice explicitly
  refuses to implement** (`registry.ts`: hard-delete is an etzhayyim execution
  act consumed via consent-capability, not a substrate write).

**None of these are fixed here, on purpose.** Each one requires deciding which
face is canonical — whether the dispatcher's verb list or the substrate model is
the contract — and that is a product decision this tree does not settle. They
are recorded so that the next reader does not have to rediscover them, and so
that a green test suite is not mistaken for agreement between the planes.

## Getting started

`docs/operator-quickstart.md` — every command there was walked, and the output
pasted into it is the output it produced.
