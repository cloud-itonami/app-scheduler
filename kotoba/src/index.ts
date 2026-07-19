/**
 * scheduler kotoba — barrel. kotoba-E2E split (plaintext job catalog +
 * kotoba-E2E per-execution jobRun, ADR-2605181100). The cron-tick EXECUTION and
 * auth-token/secret custody stay etzhayyim (consent-capability); only the resulting
 * run DATA migrates (E2E).
 */
export * from "./types.js";
export {
  registerJob,
  setJobStatus,
  getJob,
  listJobs,
  recordRun,
  listRuns,
  getRun,
  coverage,
} from "./registry.js";
