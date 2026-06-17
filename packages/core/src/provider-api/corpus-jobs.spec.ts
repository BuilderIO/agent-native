import { beforeEach, describe, expect, it, vi } from "vitest";

const jobs = new Map<string, Record<string, unknown>>();
const hits = new Map<string, Record<string, unknown>[]>();

vi.mock("../db/client.js", () => ({
  getDialect: () => "sqlite",
  isPostgres: () => false,
  intType: () => "INTEGER",
  getDbExec: () => ({
    execute: async (sql: string | { sql: string; args: unknown[] }) => {
      const rawSql = typeof sql === "string" ? sql : sql.sql;
      const args = typeof sql === "string" ? [] : sql.args;

      if (
        /CREATE TABLE/i.test(rawSql) ||
        /CREATE INDEX/i.test(rawSql) ||
        /ALTER TABLE/i.test(rawSql)
      ) {
        return { rows: [], rowsAffected: 0 };
      }

      if (/INSERT INTO provider_corpus_jobs/i.test(rawSql)) {
        const [
          id,
          appId,
          ownerEmail,
          name,
          mode,
          status,
          provider,
          requestJson,
          paginationJson,
          batchJson,
          searchJson,
          limitsJson,
          checkpointJson,
          createdAt,
          updatedAt,
        ] = args;
        // Emulate `ON CONFLICT (id) DO UPDATE ... WHERE app_id/owner_email
        // match`: a conflicting insert from a different owner is skipped rather
        // than clobbering the existing tenant's row.
        const existing = jobs.get(String(id));
        if (
          existing &&
          (existing.app_id !== appId || existing.owner_email !== ownerEmail)
        ) {
          return { rows: [], rowsAffected: 0 };
        }
        jobs.set(String(id), {
          id,
          app_id: appId,
          owner_email: ownerEmail,
          name,
          mode,
          status,
          provider,
          request_json: requestJson,
          pagination_json: paginationJson,
          batch_json: batchJson,
          search_json: searchJson,
          limits_json: limitsJson,
          checkpoint_json: checkpointJson,
          pages_processed: 0,
          batches_processed: 0,
          items_processed: 0,
          matched_items: 0,
          total_hits: 0,
          stored_hits: 0,
          error: null,
          next_resume_at: null,
          created_at: createdAt,
          updated_at: updatedAt,
        });
        return { rows: [], rowsAffected: 1 };
      }

      if (/SELECT \* FROM provider_corpus_jobs WHERE id/i.test(rawSql)) {
        const [id, appId, ownerEmail] = args.map(String);
        const job = jobs.get(id);
        return {
          rows:
            job && job.app_id === appId && job.owner_email === ownerEmail
              ? [job]
              : [],
          rowsAffected: 0,
        };
      }

      if (
        /SELECT \* FROM provider_corpus_jobs WHERE app_id.*owner_email/i.test(
          rawSql,
        )
      ) {
        const [appId, ownerEmail] = args.map(String);
        return {
          rows: Array.from(jobs.values()).filter(
            (job) => job.app_id === appId && job.owner_email === ownerEmail,
          ),
          rowsAffected: 0,
        };
      }

      if (/UPDATE provider_corpus_jobs SET/i.test(rawSql)) {
        const [
          status,
          checkpointJson,
          pagesProcessed,
          batchesProcessed,
          itemsProcessed,
          matchedItems,
          totalHits,
          storedHits,
          error,
          nextResumeAt,
          updatedAt,
          id,
          appId,
          ownerEmail,
        ] = args;
        const job = jobs.get(String(id));
        if (
          job &&
          job.app_id === String(appId) &&
          job.owner_email === String(ownerEmail)
        ) {
          Object.assign(job, {
            status,
            checkpoint_json: checkpointJson,
            pages_processed: pagesProcessed,
            batches_processed: batchesProcessed,
            items_processed: itemsProcessed,
            matched_items: matchedItems,
            total_hits: totalHits,
            stored_hits: storedHits,
            error,
            next_resume_at: nextResumeAt,
            updated_at: updatedAt,
          });
          return { rows: [], rowsAffected: 1 };
        }
        return { rows: [], rowsAffected: 0 };
      }

      if (/DELETE FROM provider_corpus_job_hits WHERE job_id/i.test(rawSql)) {
        hits.delete(String(args[0]));
        return { rows: [], rowsAffected: 1 };
      }

      if (/INSERT INTO provider_corpus_job_hits/i.test(rawSql)) {
        // Multi-row insert: args arrive in (job_id, hit_index, hit_data)
        // triples. Emulate `ON CONFLICT (job_id, hit_index) DO NOTHING` so a
        // resume that re-appends already-stored indices is idempotent.
        const ignoreConflicts = /DO NOTHING/i.test(rawSql);
        const jobId = String(args[0]);
        const rows = hits.get(jobId) ?? [];
        for (let k = 0; k + 2 < args.length; k += 3) {
          const index = Number(args[k + 1]);
          if (ignoreConflicts && rows[index] !== undefined) continue;
          rows[index] = JSON.parse(String(args[k + 2])) as Record<
            string,
            unknown
          >;
        }
        hits.set(jobId, rows);
        return { rows: [], rowsAffected: 1 };
      }

      if (/SELECT hit_data FROM provider_corpus_job_hits/i.test(rawSql)) {
        const [jobId, limit, offset] = args;
        const rows = (hits.get(String(jobId)) ?? [])
          .filter(Boolean)
          .slice(Number(offset), Number(offset) + Number(limit))
          .map((hit) => ({ hit_data: JSON.stringify(hit) }));
        return { rows, rowsAffected: 0 };
      }

      if (/DELETE FROM provider_corpus_jobs WHERE id/i.test(rawSql)) {
        const [id, appId, ownerEmail] = args.map(String);
        const job = jobs.get(id);
        if (job && job.app_id === appId && job.owner_email === ownerEmail) {
          jobs.delete(id);
          return { rows: [], rowsAffected: 1 };
        }
        return { rows: [], rowsAffected: 0 };
      }

      return { rows: [], rowsAffected: 0 };
    },
  }),
}));

vi.mock("../server/request-context.js", () => ({
  getCredentialContext: () => ({
    userEmail: "ada@example.com",
    orgId: "org_123",
  }),
}));

const { createProviderCorpusJobAction, createProviderCorpusJobReadAction } =
  await import("./corpus-jobs.js");
const {
  _resetProviderCorpusJobsStoreForTests,
  createProviderCorpusJob,
  getProviderCorpusJob,
  appendProviderCorpusJobHits,
  getProviderCorpusJobHits,
} = await import("./corpus-jobs-store.js");

function providerEnvelope(json: unknown, status = 200) {
  return {
    provider: { id: "fake", label: "Fake" },
    response: {
      ok: status >= 200 && status < 300,
      status,
      statusText: status === 200 ? "OK" : "Error",
      json,
      headers: {},
      truncated: false,
    },
  };
}

describe("provider corpus jobs", () => {
  beforeEach(() => {
    jobs.clear();
    hits.clear();
    _resetProviderCorpusJobsStoreForTests();
  });

  it("checkpoints paginated corpus searches across continue calls", async () => {
    const calls: unknown[] = [];
    const action = createProviderCorpusJobAction({
      appId: "analytics",
      getRuntime: () => ({
        executeRequest: async (args) => {
          calls.push(args);
          const page = Number((args.query as Record<string, unknown>)?.page);
          return providerEnvelope({
            items:
              page === 1
                ? [
                    { id: "m1", text: "customer asked about Figma MCP" },
                    { id: "m2", text: "ordinary note" },
                  ]
                : [{ id: "m3", text: "another Figma MCP mention" }],
          });
        },
      }),
    });

    const first = (await action.run({
      operation: "start",
      name: "messages",
      mode: "paginated-search",
      request: { provider: "fake", path: "/messages" },
      pagination: { itemsPath: "items", pageParam: "page", maxPages: 2 },
      search: { query: "Figma MCP", textPaths: ["text"] },
      limits: { pageBudget: 1 },
    })) as any;

    expect(first.job.status).toBe("paused");
    expect(first.coverage.pagesProcessed).toBe(1);
    expect(first.coverage.totalHits).toBe(1);

    const second = (await action.run({
      operation: "continue",
      jobId: first.job.id,
      limits: { pageBudget: 1 },
    })) as any;

    expect(second.job.status).toBe("completed");
    expect(second.coverage.pagesProcessed).toBe(2);
    expect(second.coverage.totalHits).toBe(2);
    expect((calls[0] as any).query.page).toBe(1);
    expect((calls[1] as any).query.page).toBe(2);

    const results = (await action.run({
      operation: "results",
      jobId: first.job.id,
    })) as any;
    expect(results.hits.map((hit: any) => hit.id)).toEqual(["m1", "m3"]);
  });

  it("walks arbitrary id cohorts through batch provider endpoints", async () => {
    const batches: unknown[] = [];
    const action = createProviderCorpusJobAction({
      appId: "analytics",
      getRuntime: () => ({
        executeRequest: async (args) => {
          const ids = (args.body as any).filter.callIds as string[];
          batches.push(ids);
          return providerEnvelope({
            callTranscripts: ids.map((id) => ({
              callId: id,
              transcript:
                id === "c2"
                  ? "The buyer asked whether Figma MCP could help."
                  : "No relevant mention.",
            })),
          });
        },
      }),
    });

    const first = (await action.run({
      operation: "start",
      name: "transcripts",
      mode: "batch-search",
      request: {
        provider: "fake",
        method: "POST",
        path: "/calls/transcript",
        body: { filter: {} },
      },
      batch: {
        items: ["c1", "c2", "c3"],
        batchSize: 2,
        itemBodyPath: "filter.callIds",
        responseItemsPath: "callTranscripts",
      },
      search: {
        query: "Figma MCP",
        textPaths: ["transcript"],
        idPaths: ["callId"],
      },
      limits: { batchBudget: 1 },
    })) as any;

    expect(first.job.status).toBe("paused");
    expect(first.coverage.batchesProcessed).toBe(1);
    expect(first.coverage.totalHits).toBe(1);

    const second = (await action.run({
      operation: "continue",
      jobId: first.job.id,
      limits: { batchBudget: 1 },
    })) as any;

    expect(second.job.status).toBe("completed");
    expect(second.coverage.batchesProcessed).toBe(2);
    expect(batches).toEqual([["c1", "c2"], ["c3"]]);
  });

  it("pauses with quota_wait and preserves resumable progress", async () => {
    const retryAt = "2026-06-17T12:00:00.000Z";
    let quota = true;
    const action = createProviderCorpusJobAction({
      appId: "analytics",
      getRuntime: () => ({
        executeRequest: async () => {
          if (quota) {
            return providerEnvelope(
              {
                error: "provider_quota_exhausted",
                retryAt,
                retryAfterMs: 60_000,
                reason: "cooldown",
              },
              429,
            );
          }
          return providerEnvelope({
            items: [{ id: "m1", text: "Figma MCP after retry" }],
          });
        },
      }),
    });

    const first = (await action.run({
      operation: "start",
      mode: "paginated-search",
      request: { provider: "fake", path: "/messages" },
      pagination: { itemsPath: "items", maxPages: 1 },
      search: { query: "Figma MCP", textPaths: ["text"] },
    })) as any;

    expect(first.job.status).toBe("quota_wait");
    expect(first.nextResumeAt).toBe(retryAt);
    expect(first.coverage.itemsProcessed).toBe(0);

    quota = false;
    const second = (await action.run({
      operation: "continue",
      jobId: first.job.id,
    })) as any;

    expect(second.job.status).toBe("completed");
    expect(second.coverage.totalHits).toBe(1);
  });

  it("exposes read-only job status and results for UI surfaces", async () => {
    const action = createProviderCorpusJobAction({
      appId: "analytics",
      getRuntime: () => ({
        executeRequest: async () =>
          providerEnvelope({
            items: [{ id: "m1", text: "alpha beta" }],
          }),
      }),
    });
    const readAction = createProviderCorpusJobReadAction({
      appId: "analytics",
    });

    const started = (await action.run({
      operation: "start",
      mode: "paginated-search",
      request: { provider: "fake", path: "/messages" },
      pagination: { itemsPath: "items", maxPages: 1 },
      search: { terms: ["alpha", "beta"], matchMode: "allTerms" },
    })) as any;

    const list = (await readAction.run({
      operation: "list",
      limit: 10,
    })) as any;
    expect(list.jobs[0].job.id).toBe(started.job.id);
    expect(list.jobs[0].job.status).toBe("completed");
    expect(list.jobs[0].coverage).toMatchObject({
      itemsProcessed: 1,
      matchedItems: 1,
      totalHits: 1,
    });

    const results = (await readAction.run({
      operation: "results",
      jobId: started.job.id,
    })) as any;
    expect(results.hits[0]).toMatchObject({
      id: "m1",
      kind: "allTerms",
      matchedTerms: ["alpha", "beta"],
    });
  });

  it("uses the shortest all-terms cluster for same-field snippets", async () => {
    const action = createProviderCorpusJobAction({
      appId: "analytics",
      getRuntime: () => ({
        executeRequest: async () =>
          providerEnvelope({
            items: [
              {
                id: "m1",
                text:
                  `opening alpha ${"filler ".repeat(80)} beta ` +
                  `${"gap ".repeat(20)} compact alpha near beta ending`,
              },
            ],
          }),
      }),
    });

    const started = (await action.run({
      operation: "start",
      mode: "paginated-search",
      request: { provider: "fake", path: "/messages" },
      pagination: { itemsPath: "items", maxPages: 1 },
      search: {
        terms: ["alpha", "beta"],
        matchMode: "allTerms",
        textPaths: ["text"],
        contextChars: 24,
      },
    })) as any;
    const results = (await action.run({
      operation: "results",
      jobId: started.job.id,
    })) as any;

    expect(results.hits[0].snippet).toContain("compact alpha near beta");
    expect(results.hits[0].snippet).not.toContain("opening alpha");
  });

  it("joins useful snippets for all-terms matches split across fields", async () => {
    const action = createProviderCorpusJobAction({
      appId: "analytics",
      getRuntime: () => ({
        executeRequest: async () =>
          providerEnvelope({
            items: [{ id: "m1", title: "alpha title", body: "beta body" }],
          }),
      }),
    });

    const started = (await action.run({
      operation: "start",
      mode: "paginated-search",
      request: { provider: "fake", path: "/messages" },
      pagination: { itemsPath: "items", maxPages: 1 },
      search: {
        terms: ["alpha", "beta"],
        matchMode: "allTerms",
        textPaths: ["title", "body"],
        contextChars: 24,
      },
    })) as any;
    const results = (await action.run({
      operation: "results",
      jobId: started.job.id,
    })) as any;

    expect(results.hits[0].snippet).toContain("title: alpha title");
    expect(results.hits[0].snippet).toContain("body: beta body");
  });
});

describe("provider corpus job store guards", () => {
  beforeEach(() => {
    jobs.clear();
    hits.clear();
    _resetProviderCorpusJobsStoreForTests();
  });

  const baseJob = {
    name: "scan",
    mode: "paginated-search",
    status: "paused" as const,
    provider: "fake",
    request: { provider: "fake" },
    search: {},
    limits: {},
    checkpoint: {},
  };

  it("never lets a caller-supplied id clobber another owner's job", async () => {
    await createProviderCorpusJob({
      id: "shared-id",
      appId: "analytics",
      ownerEmail: "ada@example.com",
      ...baseJob,
    });

    await expect(
      createProviderCorpusJob({
        id: "shared-id",
        appId: "analytics",
        ownerEmail: "grace@example.com",
        ...baseJob,
      }),
    ).rejects.toThrow(/different owner/);

    const adaJob = await getProviderCorpusJob({
      id: "shared-id",
      appId: "analytics",
      ownerEmail: "ada@example.com",
    });
    expect(adaJob?.ownerEmail).toBe("ada@example.com");

    const graceJob = await getProviderCorpusJob({
      id: "shared-id",
      appId: "analytics",
      ownerEmail: "grace@example.com",
    });
    expect(graceJob).toBeNull();
  });

  it("re-appends the same hit indices idempotently", async () => {
    await createProviderCorpusJob({
      id: "job-1",
      appId: "analytics",
      ownerEmail: "ada@example.com",
      ...baseJob,
    });

    const batch = [{ id: "h0" }, { id: "h1" }];
    await appendProviderCorpusJobHits({
      jobId: "job-1",
      startIndex: 0,
      hits: batch,
    });
    await appendProviderCorpusJobHits({
      jobId: "job-1",
      startIndex: 0,
      hits: batch,
    });

    const stored = await getProviderCorpusJobHits({
      jobId: "job-1",
      appId: "analytics",
      ownerEmail: "ada@example.com",
    });
    expect(stored.map((hit) => hit.id)).toEqual(["h0", "h1"]);
  });
});
