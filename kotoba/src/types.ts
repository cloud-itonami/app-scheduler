/**
 * scheduler kotoba — kotoba-E2E split (plaintext job catalog + E2E jobRun).
 *
 * Per ADR-2606011400 (Consensys) + ADR-2605172400 (3-axis) + ADR-2605181100
 * (kotoba E2E encrypted-record envelope). Founder directive 2026-06-03: PII /
 * CUI / LE may migrate to etzhayyim when made safe via kotoba E2E.
 *
 * SPLIT:
 *   PUBLIC (plaintext AT records) — job catalog: schedule metadata (name, cron,
 *   status, target method+url, owner/org DIDs). Frontable open scheduling meta.
 *   Anchored by kotodama.jsonld subscribeRepos collection
 *   `com.etzhayyim.apps.scheduler.job`.
 *   SENSITIVE / CUI (kotoba E2E, com.etzhayyim.encrypted.record) — per-execution
 *   run records (outcome + output/error body + timing): may carry confidential
 *   target payloads/responses. Written via sdk.encryptedWrite (read-cap = owner
 *   DID + explicit recipients), so private execution content lives on-substrate
 *   encrypted, never etzhayyim-resident plaintext. jobRun.jobId references the
 *   plaintext job (FK via exists()).
 *
 *   STAYS etzhayyim (consumed via consent-capability) — the cron-tick EXECUTION
 *   (firing outbound HTTP POST to target endpoints), retry/backoff runtime, and
 *   the auth-token / secret custody used to authenticate those calls. These are
 *   regulated *acts* / secret custody — never sealed into a collection; only the
 *   resulting run DATA migrates (E2E).
 *
 * AT-Lexicon: no float. retry attempts / backoff seconds / durationMs are
 * integers; cron is a string; no money fields.
 */

// Plaintext public collection (matches kotodama.jsonld subscribeRepos).
export const JOB_COLLECTION = "com.etzhayyim.apps.scheduler.job";
// E2E inner-type NSID (body shape inside the encrypted envelope).
export const JOB_RUN_INNER_TYPE = "com.etzhayyim.apps.scheduler.jobRun";

export const SCHEDULER_DID_PREFIX = "did:web:scheduler.etzhayyim.com:" as const;

export type JobStatus = "active" | "paused";
export type RunOutcome = "ok" | "failed";

// ─── Job catalog (PLAINTEXT, public schedule metadata) ──────────────

export interface JobRecord {
  did: string;
  jobId: string;
  name: string;
  /** Cron expression — string (no float). */
  cron: string;
  status: JobStatus;
  /** Target call method (GET/POST/...) — metadata only, never the auth token. */
  targetMethod: string;
  /** Target endpoint URL — public metadata. */
  targetUrl: string;
  ownerDid: string;
  orgDid?: string;
  createdAt: string;
  updatedAt: string;
}
export interface JobView extends JobRecord {
  jobUri: string;
}
export interface RegisterJobInput {
  jobId: string;
  name: string;
  cron: string;
  targetMethod: string;
  targetUrl: string;
  ownerDid: string;
  orgDid?: string;
  status?: JobStatus;
}
export interface RegisterJobOutput {
  status: "registered" | "alreadyExists" | "rejected";
  jobUri?: string;
  did?: string;
  jobId?: string;
  error?: string;
}
export interface SetJobStatusInput {
  jobId: string;
  status: JobStatus;
}
export interface SetJobStatusOutput {
  status: "updated" | "rejected";
  jobUri?: string;
  jobId?: string;
  jobStatus?: JobStatus;
  error?: string;
}
export interface GetJobInput {
  jobId: string;
}
export interface GetJobOutput {
  job?: JobView;
  error?: string;
}
export interface ListJobsInput {
  status?: JobStatus;
  limit?: number;
  cursor?: string;
}
export interface ListJobsOutput {
  items: JobView[];
  cursor?: string;
  total: number;
}

// ─── Job run (E2E-ENCRYPTED, CUI per-execution content) ─────────────

export interface JobRunBody {
  runId: string;
  /** FK → JobRecord.jobId (validated via exists() before seal). */
  jobId: string;
  outcome: RunOutcome;
  /** integer ms (no float). */
  durationMs: number;
  /** Confidential target response / error body. */
  detail: string;
  attempt: number;
  ranAt: string;
}
export interface JobRunView extends JobRunBody {
  uri: string;
  sender: string;
  createdAt: string;
}
export interface RecordRunInput {
  runId: string;
  jobId: string;
  outcome: RunOutcome;
  durationMs: number;
  detail?: string;
  attempt?: number;
  ranAt?: string;
  /** Extra DIDs to grant read-cap (owner always included). */
  recipients?: string[];
}
export interface RecordRunOutput {
  status: "recorded" | "rejected";
  uri?: string;
  keyId?: string;
  runId?: string;
  error?: string;
}
export interface ListRunsInput {
  jobId?: string;
  outcome?: RunOutcome;
  limit?: number;
  cursor?: string;
}
export interface ListRunsOutput {
  items: JobRunView[];
  cursor?: string;
  total: number;
}
export interface GetRunInput {
  runId: string;
}
export interface GetRunOutput {
  run?: JobRunView;
  error?: string;
}

// ─── Coverage rollup ────────────────────────────────────────────────

export interface CoverageInput {
  maxScan?: number;
}
export interface CoverageOutput {
  jobCount?: number;
  jobRunCount?: number;
  jobsByStatus?: Record<string, number>;
  truncated?: boolean;
  error?: string;
}

// ─── Validation + helpers ───────────────────────────────────────────

export function isUint(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n) && n >= 0;
}
export function isJobStatus(s: unknown): s is JobStatus {
  return s === "active" || s === "paused";
}
export function isRunOutcome(s: unknown): s is RunOutcome {
  return s === "ok" || s === "failed";
}
export function jobDidFor(id: string): string {
  return `${SCHEDULER_DID_PREFIX}job:${id.toLowerCase()}`;
}
export function jobRkey(id: string): string {
  return `job-${id.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
}
export function runRkey(id: string): string {
  return `run-${id.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
}
