# Operator quickstart

Every command below was walked on 2026-08-17 and walked again on 2026-08-23
from a clean checkout of the then-current `main`; the output pasted here is the
output it produced. If a step does not reproduce, that is a finding — say so
rather than adjusting the doc to match. Where the two walks differed, both
values are given and the reason is stated.

One step needs npm and does not work under every `~/.npmrc`; see
[a note on npm](#a-note-on-npm) before you start.

What you can reach from here: the `kotoba/` reference implementation — the data
model, its validators, and the encryption boundary — runs entirely offline
against a mock substrate. **The deployed dispatcher is not exercised by any of
this**, and the two do not expose the same operations (see `README.md`).

---

## 1. Read the split without installing anything

No toolchain needed. These three files are the contract:

```bash
sed -n '1,40p' kotoba/src/types.ts     # what is public vs sealed, and why
grep -n 'JOB_COLLECTION\|JOB_RUN_INNER_TYPE' kotoba/src/types.ts
```

```
31:export const JOB_COLLECTION = "com.etzhayyim.apps.scheduler.job";
33:export const JOB_RUN_INNER_TYPE = "com.etzhayyim.apps.scheduler.jobRun";
```

The first is written with `sdk.write` and is world-readable. The second is
written with `sdk.encryptedWrite` and is readable only by the owner DID plus
recipients named at write time. Nothing else in the repo changes that.

## 2. Confirm the two planes disagree

This is the fastest way to see the finding recorded in `README.md`, and it needs
no install:

```bash
comm -3 \
  <(grep -oE '"(createJob|getJob|updateJob|deleteJob|listJobs|pauseJob|resumeJob|jobStatus)"' \
      appview/scheduler-mcp-component/src/app.ts | tr -d '"' | sort -u) \
  <(grep -oE '^export (async )?function [a-zA-Z]+' kotoba/src/registry.ts \
      | awk '{print $NF}' | sort -u)
```

Left column = dispatcher only, right column = kotoba only, shared names appear
in neither:

```
	coverage
createJob
deleteJob
	getRun
jobStatus
	listRuns
pauseJob
	recordRun
	registerJob
resumeJob
	setJobStatus
updateJob
```

Only `getJob` and `listJobs` are common. Note in particular that `recordRun`,
`listRuns` and `getRun` — the whole encrypted half — have no dispatcher method.

## 3. Install

```bash
cd kotoba
npm install
```

Expect this to be slow. Both `@etzhayyim/sdk` and `@etzhayyim/sdk-mock` are git
dependencies that ship no `dist/` and compile through a `prepare` script, so a
cold install builds them from source. On this workstation (node v26.3.0, npm
11.16.0) under load average ~35 it ran for several minutes and overran a
400-second timeout more than once — if you wrap it in a timeout, give it room.
On 2026-08-23 (same node/npm, load average ~20) it took **12m57s** wall clock
and reported `added 135 packages` — against 76 on 2026-08-17. The cause of the
difference was not isolated. What was checked: every git dependency in the tree
is pinned by commit (the two direct ones, and the six `kotoba-lang/*` ones that
`@etzhayyim/sdk` pulls in), so the movement is in the `^`-ranged npm
dependencies underneath them (`@atproto/*`, `@noble/*`, `viem`, …) or in how the
earlier count was taken. Do not read either number as the contract; the four
direct dependencies below are, and they did not move.

There are four direct dependencies:

```bash
npm ls --depth=0
```

```
@etzhayyim/scheduler-kotoba@0.0.0 /path/to/app-scheduler/kotoba
+-- @etzhayyim/sdk-mock@0.1.0 (git+ssh://git@github.com/etzhayyim/com-etzhayyim-sdk-mock.git#c857ff9be5310bf433bfe1e8d3c0f677e213d667)
+-- @etzhayyim/sdk@0.1.0-alpha (git+ssh://git@github.com/etzhayyim/com-etzhayyim-sdk.git#12314a0cc5ac2feb49dd9789d5c002398acb6988)
+-- typescript@5.9.3
`-- vitest@4.1.11
```

(`vitest` and `typescript` are declared with `^`, so the patch version here
floats: 4.1.10 on 2026-08-17, 4.1.11 on 2026-08-23. The two `@etzhayyim` commits
are the ones in `package.json` and do not move.)

`package.json` pins both git dependencies over `git+https`; npm reports them
back as `git+ssh`. Which transport is actually used was not tested here — this
machine has GitHub SSH configured, so a host without it may behave differently.

If this fails with `EALLOWSCRIPTS`, read [the note below](#a-note-on-npm) — the
fix is a flag, not a different machine.

The repo has no `.gitignore`, so after this step `git status` shows
`kotoba/node_modules/` as untracked. That is expected; do not commit it.

## 4. Run the suite

```bash
npx vitest run --reporter=verbose
```

All five tests pass, and the test names are the specification:

```
 ✓ test/scheduler.test.ts > scheduler kotoba (kotoba-E2E split) > job catalog (PLAINTEXT public schedule metadata) > registers, dedups, validates, gets, lists/filters, status re-write 35ms
 ✓ test/scheduler.test.ts > scheduler kotoba (kotoba-E2E split) > jobRun (E2E-ENCRYPTED CUI per-execution content) > seals via encryptedWrite, round-trips via encryptedRead, validates, FK via exists() 11ms
 ✓ test/scheduler.test.ts > scheduler kotoba (kotoba-E2E split) > jobRun (E2E-ENCRYPTED CUI per-execution content) > enforces read-cap: a non-recipient DID cannot decrypt the run 0ms
 ✓ test/scheduler.test.ts > scheduler kotoba (kotoba-E2E split) > jobRun (E2E-ENCRYPTED CUI per-execution content) > grants read-cap to an explicit recipient 24ms
 ✓ test/scheduler.test.ts > scheduler kotoba (kotoba-E2E split) > coverage rollup > counts plaintext jobs (by status) + E2E runs 1ms

 Test Files  1 passed (1)
      Tests  5 passed (5)
```

Typecheck is separate from the suite (`tsconfig.json` is `noEmit`, and vitest
does not typecheck):

```bash
npx tsc --noEmit
```

Clean — no output, exit 0.

## 5. Watch the encryption boundary hold

The single most important claim this repo makes is that a DID which was not
granted a read-cap cannot see a run record. That is one test, and you can run it
alone:

```bash
npx vitest run -t "enforces read-cap"
```

```
 Test Files  1 passed (1)
      Tests  1 passed | 4 skipped (5)
```

The `4 skipped` is what tells you the filter matched exactly one test — a run
reporting `5 passed` here would mean the filter silently did nothing.

What that test actually does (`test/scheduler.test.ts`): it records a run under
the owner DID with `detail: "secret"`, then constructs a second
`MockEtzhayyim` for `did:web:outsider.example` and asserts `listRuns` returns
`total: 0`. The outsider gets an empty result, not a decryption error.

## A note on npm

If `npm install` fails like this:

```
npm error code 1
npm error git dep preparation failed
npm error npm error code EALLOWSCRIPTS
npm error npm error --allow-scripts is not allowed in project-scoped installs.
```

…the cause is an `allow-scripts[]` entry in your **user-level** `~/.npmrc`, not
the npm version and not this repo. npm propagates the entry into the nested
install it runs to prepare a git dependency, and that nested install rejects it
as project-scoped.

Measured 2026-08-17 on one machine, node v26.3.0 / **npm 11.16.0** throughout:

| user config | result |
|---|---|
| `~/.npmrc` as-is (contains `allow-scripts[]=@anthropic-ai/claude-code`) | `EALLOWSCRIPTS` |
| minimal file containing only `strict-ssl=false` **plus** `allow-scripts[]=…` | `EALLOWSCRIPTS` |
| minimal file containing only `strict-ssl=false` | installs (76 packages on 08-17, 135 on 08-23 — see §3), suite green |

So the workaround is a flag:

```bash
printf 'strict-ssl=false\n' > /tmp/clean-npmrc
npm install --userconfig /tmp/clean-npmrc
```

Adding the two dependencies to a *project* `.npmrc` does **not** help — that was
tried and produced the same `EALLOWSCRIPTS`, because the rejection happens in
the nested install, not the outer one.

> `cloud-itonami/app-houbun`'s quickstart documents this same error as an npm
> **version** problem (11.16.0 broken, 10.9.8 and 11.17.0 fine) requiring a
> different machine. On the evidence above, npm 11.16.0 installs fine once the
> `allow-scripts` entry is out of the user config, so the version table there is
> at best incomplete. Both observations can hold — a version change may also
> avoid it — but the flag is cheaper than a second machine.

## What is not covered here

Deliberately, because none of it was walked:

- **The dispatcher.** `appview/scheduler-mcp-component` is a Cloudflare Worker
  that proxies to `DISPATCHER_URL`; running it needs the SvelteKit build and a
  live AgentGateway MCP endpoint. Nothing above starts it, and no step here
  proves `/health` responds.
- **`CLAUDE.md`'s build steps.** They `cd` into `wasm/…` paths that do not exist
  in this repo (see `README.md`), so they cannot be run as written.
- **Anything against a real PDS.** Every step above runs against
  `@etzhayyim/sdk-mock`. No network substrate is contacted, and no real DID is
  resolved.
