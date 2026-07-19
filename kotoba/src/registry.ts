/**
 * scheduler kotoba — kotoba-E2E registry.
 *
 * Plaintext path (job): sdk.write / sdk.read — public schedule metadata.
 * E2E path (jobRun): sdk.encryptedWrite / sdk.encryptedRead — CUI per-execution
 * body sealed in the kotoba envelope (ADR-2605181100), read-cap = owner DID. The
 * substrate never sees confidential run payloads in plaintext.
 *
 * jobRun.jobId is FK-checked against the plaintext job collection via exists()
 * before sealing. The cron-tick EXECUTION + auth-token custody stay etzhayyim
 * (consent-capability); only run DATA migrates here.
 *
 * Note: deleteJob is out-of-scope for this kotoba slice — the substrate
 * mock/PDS exposes write/read only (no delete primitive); hard-delete is a etzhayyim
 * execution act consumed via consent-capability.
 */

import type { Etzhayyim } from "@etzhayyim/sdk";
import {
  JOB_COLLECTION,
  JOB_RUN_INNER_TYPE,
  isJobStatus,
  isRunOutcome,
  isUint,
  jobDidFor,
  jobRkey,
  runRkey,
  type CoverageInput,
  type CoverageOutput,
  type GetJobInput,
  type GetJobOutput,
  type GetRunInput,
  type GetRunOutput,
  type JobRecord,
  type JobRunBody,
  type JobRunView,
  type JobView,
  type ListJobsInput,
  type ListJobsOutput,
  type ListRunsInput,
  type ListRunsOutput,
  type RecordRunInput,
  type RecordRunOutput,
  type RegisterJobInput,
  type RegisterJobOutput,
  type SetJobStatusInput,
  type SetJobStatusOutput,
} from "./types.js";

const PAGE_LIMIT = 100;
const DEFAULT_MAX_SCAN = 10_000;

// ─── Job catalog (PLAINTEXT) ────────────────────────────────────────

async function readJob(e: Etzhayyim, jobId: string): Promise<{ uri: string; value: JobRecord } | undefined> {
  const resp = await e
    .read<JobRecord>({ collection: JOB_COLLECTION, rkey: jobRkey(jobId) })
    .catch(() => ({ records: [] as Array<{ uri: string; value: JobRecord }> }));
  return resp.records[0];
}

/** FK helper: does a plaintext job with this id exist? */
async function jobExists(e: Etzhayyim, jobId: string): Promise<boolean> {
  return Boolean(await readJob(e, jobId));
}

export async function registerJob(e: Etzhayyim, input: RegisterJobInput): Promise<RegisterJobOutput> {
  if (!input.jobId || !input.name || !input.cron || !input.targetUrl || !input.targetMethod || !input.ownerDid) {
    return { status: "rejected", error: "missingRequiredFields" };
  }
  if (input.status !== undefined && !isJobStatus(input.status)) {
    return { status: "rejected", error: "invalidStatus" };
  }
  const existing = await readJob(e, input.jobId);
  if (existing?.value) {
    return { status: "alreadyExists", jobUri: existing.uri, did: existing.value.did, jobId: input.jobId };
  }
  const now = new Date().toISOString();
  const did = jobDidFor(input.jobId);
  const record: JobRecord = {
    did,
    jobId: input.jobId,
    name: input.name,
    cron: input.cron,
    status: input.status ?? "active",
    targetMethod: input.targetMethod,
    targetUrl: input.targetUrl,
    ownerDid: input.ownerDid,
    orgDid: input.orgDid,
    createdAt: now,
    updatedAt: now,
  };
  const receipt = await e.write({ collection: JOB_COLLECTION, record: record as unknown as Record<string, unknown>, rkey: jobRkey(input.jobId) });
  return { status: "registered", jobUri: receipt.uri, did, jobId: input.jobId };
}

/** pauseJob / resumeJob / updateJob(status) — re-write same rkey. */
export async function setJobStatus(e: Etzhayyim, input: SetJobStatusInput): Promise<SetJobStatusOutput> {
  if (!input.jobId || !isJobStatus(input.status)) return { status: "rejected", error: "invalidStatus" };
  const existing = await readJob(e, input.jobId);
  if (!existing?.value) return { status: "rejected", error: "notFound" };
  const updated: JobRecord = { ...existing.value, status: input.status, updatedAt: new Date().toISOString() };
  const receipt = await e.write({ collection: JOB_COLLECTION, record: updated as unknown as Record<string, unknown>, rkey: jobRkey(input.jobId) });
  return { status: "updated", jobUri: receipt.uri, jobId: input.jobId, jobStatus: input.status };
}

export async function getJob(e: Etzhayyim, input: GetJobInput): Promise<GetJobOutput> {
  if (!input.jobId) return { error: "invalidJobId" };
  const existing = await readJob(e, input.jobId);
  if (!existing?.value) return { error: "notFound" };
  return { job: { ...existing.value, jobUri: existing.uri } };
}

export async function listJobs(e: Etzhayyim, input: ListJobsInput = {}): Promise<ListJobsOutput> {
  const limit = Math.min(input.limit ?? 50, 200);
  const resp = await e.read<JobRecord>({ collection: JOB_COLLECTION, cursor: input.cursor, limit });
  const items: JobView[] = resp.records
    .filter((r) => !input.status || r.value.status === input.status)
    .map((r) => ({ ...r.value, jobUri: r.uri }));
  return { items, cursor: resp.cursor, total: items.length };
}

// ─── Job run (E2E-ENCRYPTED, CUI) ───────────────────────────────────

export async function recordRun(e: Etzhayyim, input: RecordRunInput): Promise<RecordRunOutput> {
  if (!input.runId || !input.jobId) return { status: "rejected", error: "missingRequiredFields" };
  if (!isRunOutcome(input.outcome)) return { status: "rejected", error: "invalidOutcome" };
  if (!isUint(input.durationMs)) return { status: "rejected", error: "invalidDurationMs" };
  if (input.attempt !== undefined && !isUint(input.attempt)) return { status: "rejected", error: "invalidAttempt" };
  // FK via exists(): the run must reference a known plaintext job.
  if (!(await jobExists(e, input.jobId))) return { status: "rejected", error: "unknownJob" };
  const body: JobRunBody = {
    runId: input.runId,
    jobId: input.jobId,
    outcome: input.outcome,
    durationMs: input.durationMs,
    detail: input.detail ?? "",
    attempt: input.attempt ?? 1,
    ranAt: input.ranAt ?? new Date().toISOString(),
  };
  // Read-cap = owner DID (sender, auto-wrapped) + any explicit recipients.
  const receipt = await e.encryptedWrite<Record<string, unknown>>({
    innerType: JOB_RUN_INNER_TYPE,
    record: body as unknown as Record<string, unknown>,
    recipients: input.recipients ?? [],
    rkey: runRkey(input.runId),
  });
  return { status: "recorded", uri: receipt.uri, keyId: receipt.keyId, runId: input.runId };
}

async function scanRuns(e: Etzhayyim, maxScan: number): Promise<JobRunView[]> {
  const out: JobRunView[] = [];
  let cursor: string | undefined;
  while (out.length < maxScan) {
    const page = await e.encryptedRead<JobRunBody>({ innerType: JOB_RUN_INNER_TYPE, cursor, limit: PAGE_LIMIT });
    for (const r of page.records) {
      out.push({ ...r.value, uri: r.uri, sender: r.sender, createdAt: r.createdAt });
    }
    if (!page.cursor || page.records.length === 0) break;
    cursor = page.cursor;
  }
  return out;
}

export async function listRuns(e: Etzhayyim, input: ListRunsInput = {}): Promise<ListRunsOutput> {
  const limit = Math.min(input.limit ?? 50, 200);
  const all = await scanRuns(e, DEFAULT_MAX_SCAN);
  const filtered = all.filter(
    (r) => (!input.jobId || r.jobId === input.jobId) && (!input.outcome || r.outcome === input.outcome),
  );
  return { items: filtered.slice(0, limit), total: filtered.length };
}

export async function getRun(e: Etzhayyim, input: GetRunInput): Promise<GetRunOutput> {
  if (!input.runId) return { error: "invalidRunId" };
  const all = await scanRuns(e, DEFAULT_MAX_SCAN);
  const found = all.find((r) => r.runId === input.runId);
  if (!found) return { error: "notFound" };
  return { run: found };
}

// ─── Coverage rollup ────────────────────────────────────────────────

export async function coverage(e: Etzhayyim, input: CoverageInput = {}): Promise<CoverageOutput> {
  const maxScan = Math.min(input.maxScan ?? DEFAULT_MAX_SCAN, DEFAULT_MAX_SCAN);
  const jobsByStatus: Record<string, number> = {};
  let jobCount = 0;
  let cursor: string | undefined;
  while (jobCount < maxScan) {
    const page = await e.read<JobRecord>({ collection: JOB_COLLECTION, cursor, limit: PAGE_LIMIT });
    for (const r of page.records) {
      jobsByStatus[r.value.status] = (jobsByStatus[r.value.status] ?? 0) + 1;
      jobCount += 1;
    }
    if (!page.cursor || page.records.length < PAGE_LIMIT) break;
    cursor = page.cursor;
  }
  const jobRunCount = (await scanRuns(e, maxScan)).length;
  return {
    jobCount,
    jobRunCount,
    jobsByStatus,
    truncated: jobCount >= maxScan || jobRunCount >= maxScan,
  };
}
