import { describe, it, expect, beforeEach } from "vitest";
import { MockEtzhayyim } from "@etzhayyim/sdk-mock";
import {
  registerJob,
  setJobStatus,
  getJob,
  listJobs,
  recordRun,
  listRuns,
  getRun,
  coverage,
} from "../src/index.js";

const OWNER = "did:web:scheduler.etzhayyim.com";

describe("scheduler kotoba (kotoba-E2E split)", () => {
  let e: any;
  beforeEach(() => {
    e = new MockEtzhayyim({ did: OWNER });
  });

  describe("job catalog (PLAINTEXT public schedule metadata)", () => {
    it("registers, dedups, validates, gets, lists/filters, status re-write", async () => {
      const r = await registerJob(e, {
        jobId: "j1",
        name: "news-autogen",
        cron: "0 */4 * * *",
        targetMethod: "POST",
        targetUrl: "https://news.etzhayyim.com/jobs/news-generate",
        ownerDid: OWNER,
      });
      expect(r.status).toBe("registered");
      expect(r.did).toBe("did:web:scheduler.etzhayyim.com:job:j1");
      // dedup
      expect((await registerJob(e, { jobId: "j1", name: "x", cron: "* * * * *", targetMethod: "POST", targetUrl: "https://x", ownerDid: OWNER })).status).toBe("alreadyExists");
      // validation: missing fields
      expect((await registerJob(e, { jobId: "", name: "", cron: "", targetMethod: "", targetUrl: "", ownerDid: "" })).status).toBe("rejected");
      // validation: bad status
      expect((await registerJob(e, { jobId: "jZ", name: "z", cron: "* * * * *", targetMethod: "GET", targetUrl: "https://z", ownerDid: OWNER, status: "bogus" as any })).status).toBe("rejected");

      await registerJob(e, { jobId: "j2", name: "anime", cron: "0 0 * * *", targetMethod: "POST", targetUrl: "https://x/anime", ownerDid: OWNER, status: "paused" });

      const got = await getJob(e, { jobId: "j1" });
      expect(got.job?.name).toBe("news-autogen");
      expect(got.job?.status).toBe("active");
      expect((await getJob(e, { jobId: "nope" })).error).toBe("notFound");

      expect((await listJobs(e)).total).toBe(2);
      expect((await listJobs(e, { status: "paused" })).total).toBe(1);

      // pause/resume = status re-write on same rkey
      expect((await setJobStatus(e, { jobId: "j1", status: "paused" })).status).toBe("updated");
      expect((await getJob(e, { jobId: "j1" })).job?.status).toBe("paused");
      expect((await setJobStatus(e, { jobId: "nope", status: "active" })).status).toBe("rejected");
      // job count stays 2 (overwrite, not insert)
      expect(e.count("com.etzhayyim.apps.scheduler.job")).toBe(2);
    });
  });

  describe("jobRun (E2E-ENCRYPTED CUI per-execution content)", () => {
    beforeEach(async () => {
      await registerJob(e, { jobId: "j1", name: "news", cron: "0 */4 * * *", targetMethod: "POST", targetUrl: "https://x", ownerDid: OWNER });
    });

    it("seals via encryptedWrite, round-trips via encryptedRead, validates, FK via exists()", async () => {
      const ok = await recordRun(e, { runId: "r1", jobId: "j1", outcome: "ok", durationMs: 1200, detail: "200 OK body" });
      expect(ok.status).toBe("recorded");
      expect(ok.keyId).toBeTruthy();
      // sealed into the E2E envelope, not the plaintext job collection
      expect(e.encCount()).toBe(1);

      // FK via exists(): run for an unknown job is rejected
      expect((await recordRun(e, { runId: "rX", jobId: "ghost", outcome: "ok", durationMs: 1 })).status).toBe("rejected");
      // validation: bad outcome / negative duration
      expect((await recordRun(e, { runId: "rY", jobId: "j1", outcome: "weird" as any, durationMs: 1 })).status).toBe("rejected");
      expect((await recordRun(e, { runId: "rZ", jobId: "j1", outcome: "ok", durationMs: -5 })).status).toBe("rejected");

      const got = await getRun(e, { runId: "r1" });
      expect(got.run?.jobId).toBe("j1");
      expect(got.run?.detail).toBe("200 OK body");
      expect(got.run?.outcome).toBe("ok");

      await recordRun(e, { runId: "r2", jobId: "j1", outcome: "failed", durationMs: 30, detail: "timeout", attempt: 2 });
      expect((await listRuns(e)).total).toBe(2);
      expect((await listRuns(e, { outcome: "failed" })).total).toBe(1);
      expect((await listRuns(e, { jobId: "j1" })).total).toBe(2);
    });

    it("enforces read-cap: a non-recipient DID cannot decrypt the run", async () => {
      await recordRun(e, { runId: "r1", jobId: "j1", outcome: "ok", durationMs: 100, detail: "secret" });
      const outsider: any = new MockEtzhayyim({ did: "did:web:outsider.example" });
      // distinct PDS view, no read-cap → zero runs
      expect((await listRuns(outsider)).total).toBe(0);
    });

    it("grants read-cap to an explicit recipient", async () => {
      const partner = "did:web:partner.example";
      const r = await recordRun(e, { runId: "r1", jobId: "j1", outcome: "ok", durationMs: 100, detail: "shared", recipients: [partner] });
      expect(r.status).toBe("recorded");
      expect((await listRuns(e)).total).toBe(1);
    });
  });

  describe("coverage rollup", () => {
    it("counts plaintext jobs (by status) + E2E runs", async () => {
      await registerJob(e, { jobId: "j1", name: "a", cron: "* * * * *", targetMethod: "POST", targetUrl: "https://a", ownerDid: OWNER });
      await registerJob(e, { jobId: "j2", name: "b", cron: "* * * * *", targetMethod: "POST", targetUrl: "https://b", ownerDid: OWNER, status: "paused" });
      await recordRun(e, { runId: "r1", jobId: "j1", outcome: "ok", durationMs: 10 });
      const cov = await coverage(e);
      expect(cov.jobCount).toBe(2);
      expect(cov.jobRunCount).toBe(1);
      expect(cov.jobsByStatus?.active).toBe(1);
      expect(cov.jobsByStatus?.paused).toBe(1);
    });
  });
});
