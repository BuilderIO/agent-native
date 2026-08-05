import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  currentExecute: vi.fn(),
  createDbExec: vi.fn(),
  orgId: null as string | null,
  ownerEmail: "owner@example.com",
}));

vi.mock("@agent-native/core/db", () => ({
  createDbExec: mocks.createDbExec,
  getDbExec: () => ({ execute: mocks.currentExecute }),
}));

vi.mock("./dispatch-store.js", () => ({
  currentOrgId: () => mocks.orgId,
  currentOwnerEmail: () => mocks.ownerEmail,
}));

import {
  getAgentThreadDebug,
  listAgentRunFailures,
  listThreadDebugSources,
  searchAgentThreads,
} from "./thread-debug-store.js";

const thread = {
  id: "thread-1",
  owner_email: "owner@example.com",
  title: "A production run",
  preview: "Investigate this run",
  thread_data: JSON.stringify({ messages: [] }),
  message_count: 0,
  created_at: 1,
  updated_at: 2,
};

const run = {
  id: "run-prod-1",
  thread_id: "thread-1",
  turn_id: "turn-1",
  status: "errored",
  abort_reason: null,
  started_at: 1,
  completed_at: 12,
  heartbeat_at: 10,
  last_progress_at: 9,
  error_code: "provider_timeout",
  error_detail: "The provider did not respond.",
  terminal_reason: "provider_timeout",
  dispatch_mode: "background-processing",
  worker_stage: "model",
  diag_stage: '{"stage":"model"}',
  peak_rss_mb: 321,
};

function rowsForThreadLookup(sql: string, args: unknown[]) {
  if (sql.includes("FROM org_members")) return [];
  if (sql.includes("FROM agent_runs") && sql.includes("WHERE id = ?")) {
    return [run];
  }
  if (
    sql.includes("FROM agent_runs r") &&
    sql.includes("r.thread_id = ?") &&
    !sql.includes("JOIN chat_threads")
  ) {
    return [run];
  }
  if (sql.includes("FROM chat_threads")) {
    return args[0] === "thread-1" || args[0] === "owner@example.com"
      ? [thread]
      : [];
  }
  return [];
}

function failureRow(
  id: string,
  completedAt: number,
  overrides: Record<string, unknown> = {},
) {
  return {
    ...run,
    id,
    completed_at: completedAt,
    debug_owner_email: "owner@example.com",
    debug_thread_title: `Thread for ${id}`,
    debug_thread_preview: "Preview",
    debug_terminal_event_data: JSON.stringify({
      type: "error",
      errorCode: "provider_timeout",
    }),
    ...overrides,
  };
}

describe("thread-debug-store", () => {
  beforeEach(() => {
    mocks.orgId = null;
    mocks.ownerEmail = "owner@example.com";
    mocks.currentExecute.mockReset();
    mocks.createDbExec.mockReset();
    mocks.currentExecute.mockImplementation(async ({ sql, args }) => ({
      rows: rowsForThreadLookup(sql, args),
    }));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it("finds a thread when search input is an exact run id", async () => {
    const result = await searchAgentThreads({ query: run.id });

    expect(result.threads).toHaveLength(1);
    expect(result.threads[0]?.id).toBe(thread.id);
  });

  it("resolves a run id and returns rich run diagnostics", async () => {
    const result = await getAgentThreadDebug({ runId: run.id });

    expect(result.lookup).toEqual({
      requestedId: run.id,
      threadId: thread.id,
      runId: run.id,
    });
    expect(result.runs[0]).toMatchObject({
      id: run.id,
      turnId: "turn-1",
      status: "errored",
      errorCode: "provider_timeout",
      errorDetail: "The provider did not respond.",
      terminalReason: "provider_timeout",
      lastProgressAt: 9,
      dispatchMode: "background-processing",
      workerStage: "model",
      diagStage: '{"stage":"model"}',
      peakRssMb: 321,
    });
    expect(
      mocks.currentExecute.mock.calls.some(([request]) =>
        request.sql.includes("SELECT r.*"),
      ),
    ).toBe(true);
  });

  it("keeps legacy failure rows readable when additive diagnostics are absent", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-30T12:00:00Z"));
    mocks.currentExecute.mockImplementation(async ({ sql }) => ({
      rows: sql.includes("JOIN chat_threads")
        ? [
            failureRow("run-legacy", Date.now() - 1_000, {
              turn_id: undefined,
              error_code: undefined,
              error_detail: undefined,
              terminal_reason: undefined,
              dispatch_mode: undefined,
              worker_stage: undefined,
              diag_stage: undefined,
              peak_rss_mb: undefined,
              debug_terminal_event_data: null,
            }),
          ]
        : [],
    }));

    const result = await listAgentRunFailures({ sourceId: "current" });

    expect(result.failures[0]).toMatchObject({
      id: "run-legacy",
      turnId: null,
      errorCode: null,
      errorDetail: null,
      terminalReason: null,
      dispatchMode: null,
      workerStage: null,
      diagStage: null,
      peakRssMb: null,
      terminalEvent: null,
    });
  });

  it("separates interactive and scheduled populations and attaches the measured taxonomy", async () => {
    mocks.currentExecute.mockImplementation(async ({ sql }) => {
      if (!sql.includes("JOIN chat_threads")) return { rows: [] };
      if (sql.includes("r.id NOT LIKE 'job-%'")) {
        return {
          rows: [
            failureRow("run-interactive", Date.now(), {
              error_code: null,
              error_detail: "Missing Authentication header",
              terminal_reason: null,
            }),
          ],
        };
      }
      if (sql.includes("r.id LIKE 'job-%'")) {
        return {
          rows: [
            failureRow("job-analytics-1", Date.now(), {
              error_code: null,
              error_detail:
                '{"error":{"type":"overloaded_error","message":"Overloaded"}}',
              terminal_reason: null,
            }),
          ],
        };
      }
      return [];
    });

    const interactive = await listAgentRunFailures({
      sourceId: "current",
      regime: "interactive",
    });
    const scheduled = await listAgentRunFailures({
      sourceId: "current",
      regime: "scheduled",
    });

    expect(interactive).toMatchObject({
      regime: "interactive",
      failures: [
        {
          id: "run-interactive",
          regime: "interactive",
          failureTaxonomy: { code: "authentication_error" },
        },
      ],
    });
    expect(scheduled).toMatchObject({
      regime: "scheduled",
      failures: [
        {
          id: "job-analytics-1",
          regime: "scheduled",
          failureTaxonomy: { code: "overloaded_error" },
        },
      ],
    });
  });

  it("merges all admin-visible sources, sorts globally, limits, and preserves partial health", async () => {
    vi.stubEnv("DISPATCH_ADMIN_EMAILS", "owner@example.com");
    vi.stubEnv("REMOTE_A_DATABASE_URL", "libsql://remote-a");
    vi.stubEnv("REMOTE_B_DATABASE_URL", "libsql://remote-b");
    vi.stubEnv("REMOTE_C_DATABASE_URL", "libsql://remote-c");

    mocks.currentExecute.mockImplementation(async ({ sql }) => ({
      rows: sql.includes("JOIN chat_threads")
        ? [failureRow("run-current", 100)]
        : [],
    }));
    mocks.createDbExec.mockImplementation(async ({ url }) => ({
      execute: async ({ sql }: { sql: string }) => {
        if (url === "libsql://remote-a") {
          return {
            rows: sql.includes("JOIN chat_threads")
              ? [failureRow("run-a-new", 300), failureRow("run-a-old", 200)]
              : [],
          };
        }
        if (url === "libsql://remote-b") {
          throw new Error("SQLITE_ERROR: no such table: agent_runs");
        }
        throw new Error("connect ECONNREFUSED 127.0.0.1");
      },
    }));

    const result = await listAgentRunFailures({
      sourceId: "all",
      limit: 2,
    });

    expect(result.failures.map((failure) => failure.id)).toEqual([
      "run-a-new",
      "run-a-old",
    ]);
    expect(result.failures[0]?.source.id).toBe("remote-a");
    expect(result.partial).toBe(true);
    expect(result.sources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: expect.objectContaining({ id: "current" }),
          status: "ok",
        }),
        expect.objectContaining({
          source: expect.objectContaining({ id: "remote-a" }),
          status: "ok",
        }),
        expect.objectContaining({
          source: expect.objectContaining({ id: "remote-b" }),
          status: "unsupported",
          errorCode: "thread_debug_schema_unsupported",
        }),
        expect.objectContaining({
          source: expect.objectContaining({ id: "remote-c" }),
          status: "unavailable",
          errorCode: "thread_debug_source_unavailable",
        }),
      ]),
    );
    expect(
      mocks.createDbExec.mock.calls.every(
        ([config]) => !JSON.stringify(config).includes("owner@example.com"),
      ),
    ).toBe(true);
  });

  it("retains disconnected configured sources without attempting a connection", async () => {
    vi.stubEnv("DISPATCH_ADMIN_EMAILS", "owner@example.com");
    vi.stubEnv(
      "AGENT_NATIVE_THREAD_DEBUG_DATABASES",
      JSON.stringify([
        {
          id: "missing-prod",
          label: "Missing Prod",
          databaseUrlEnv: "MISSING_PROD_DATABASE_URL",
        },
      ]),
    );
    mocks.currentExecute.mockResolvedValue({ rows: [] });

    const listed = await listThreadDebugSources();
    expect(listed.sources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "missing-prod",
          connected: false,
          databaseUrlEnv: "MISSING_PROD_DATABASE_URL",
        }),
      ]),
    );

    const result = await listAgentRunFailures({ sourceId: "all" });
    expect(result.sources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: expect.objectContaining({ id: "missing-prod" }),
          status: "disconnected",
          errorCode: "thread_debug_source_disconnected",
        }),
      ]),
    );
    expect(mocks.createDbExec).not.toHaveBeenCalled();
    await expect(
      listAgentRunFailures({ sourceId: "missing-prod" }),
    ).rejects.toThrow("configured but disconnected");
  });

  it("does not misclassify a missing additive column as a missing table", async () => {
    mocks.currentExecute.mockRejectedValue(
      new Error("SQLITE_ERROR: no such column: r.worker_stage"),
    );

    const result = await listAgentRunFailures({ sourceId: "current" });

    expect(result.sources).toEqual([
      expect.objectContaining({
        status: "unavailable",
        errorCode: "thread_debug_source_unavailable",
      }),
    ]);
  });

  it("limits all-source requests to the current database for non-admins", async () => {
    vi.stubEnv("REMOTE_DATABASE_URL", "libsql://remote");
    mocks.currentExecute.mockImplementation(async ({ sql }) => ({
      rows: sql.includes("JOIN chat_threads")
        ? [failureRow("run-current", Date.now())]
        : [],
    }));

    const result = await listAgentRunFailures({ sourceId: "all" });

    expect(result.sources).toEqual([
      expect.objectContaining({
        source: expect.objectContaining({ id: "current" }),
        status: "ok",
      }),
    ]);
    expect(result.failures.map((failure) => failure.id)).toEqual([
      "run-current",
    ]);
    expect(mocks.createDbExec).not.toHaveBeenCalled();
  });

  it("returns an explicit 403 when a non-operator requests a remote source", async () => {
    vi.stubEnv("REMOTE_DATABASE_URL", "libsql://remote");

    const denial = await listAgentRunFailures({ sourceId: "remote" }).catch(
      (error) => error as Error & { statusCode?: number },
    );

    expect(denial).toMatchObject({
      name: "ForbiddenError",
      statusCode: 403,
      message:
        "Thread Debug operator access is required to inspect thread databases from other apps.",
    });
    expect(mocks.createDbExec).not.toHaveBeenCalled();
  });

  it("lets read-only operators inspect organization-owned service-principal threads", async () => {
    vi.stubEnv("DISPATCH_THREAD_DEBUG_OPERATOR_EMAILS", "owner@example.com");
    vi.stubEnv("CONTENT_DATABASE_URL", "libsql://content-operator");
    mocks.orgId = "org-1";
    mocks.currentExecute.mockImplementation(async ({ sql }) => {
      if (sql.includes("SELECT role FROM org_members")) {
        return { rows: [{ role: "member" }] };
      }
      if (sql.includes("SELECT email FROM org_members")) {
        return { rows: [{ email: "owner@example.com" }] };
      }
      if (sql.includes("SELECT allowed_domain FROM organizations")) {
        return { rows: [{ allowed_domain: "example.com" }] };
      }
      return { rows: [] };
    });
    const remoteQueries: Array<{ sql: string; args: unknown[] }> = [];
    mocks.createDbExec.mockResolvedValue({
      execute: async ({ sql, args }: { sql: string; args: unknown[] }) => {
        remoteQueries.push({ sql, args });
        if (sql.includes("FROM organizations")) {
          return { rows: [{ id: "content-org-1" }] };
        }
        if (sql.includes("FROM agent_runs") && sql.includes("WHERE id = ?")) {
          return { rows: [] };
        }
        if (sql.includes("FROM chat_threads")) {
          return {
            rows: [
              {
                ...thread,
                owner_email: "integration@slack",
                org_id: "content-org-1",
              },
            ],
          };
        }
        return { rows: [] };
      },
    });

    const result = await searchAgentThreads({
      sourceId: "content",
      query: "AN-SLACK-CANARY-EXAMPLE",
      ownerEmail: "integration@slack",
    });

    expect(result).toMatchObject({
      count: 1,
      access: {
        scope: "integration@slack",
        canInspectAll: true,
      },
      threads: [{ ownerEmail: "integration@slack" }],
    });
    const threadQuery = remoteQueries.find(({ sql }) =>
      sql.includes("FROM chat_threads"),
    );
    expect(threadQuery?.sql).toContain("org_id = ? AND owner_email = ?");
    expect(threadQuery?.args).toEqual(
      expect.arrayContaining(["content-org-1", "integration@slack"]),
    );

    const detail = await getAgentThreadDebug({
      sourceId: "content",
      threadId: thread.id,
      ownerEmail: "integration@slack",
    });
    expect(detail.thread).toMatchObject({
      id: thread.id,
      ownerEmail: "integration@slack",
    });
  });

  it("keeps operator searches inside their organization and returns a truthful empty result", async () => {
    vi.stubEnv("DISPATCH_THREAD_DEBUG_OPERATOR_EMAILS", "owner@example.com");
    vi.stubEnv("CONTENT_DATABASE_URL", "libsql://content-empty");
    mocks.orgId = "org-1";
    mocks.currentExecute.mockImplementation(async ({ sql }) => {
      if (sql.includes("SELECT role FROM org_members")) {
        return { rows: [{ role: "member" }] };
      }
      if (sql.includes("SELECT email FROM org_members")) {
        return { rows: [{ email: "owner@example.com" }] };
      }
      if (sql.includes("SELECT allowed_domain FROM organizations")) {
        return { rows: [{ allowed_domain: "example.com" }] };
      }
      return { rows: [] };
    });
    const remoteQueries: Array<{ sql: string; args: unknown[] }> = [];
    mocks.createDbExec.mockResolvedValue({
      execute: async ({ sql, args }: { sql: string; args: unknown[] }) => {
        remoteQueries.push({ sql, args });
        if (sql.includes("FROM organizations")) {
          return { rows: [{ id: "content-org-1" }] };
        }
        return { rows: [] };
      },
    });

    const result = await searchAgentThreads({
      sourceId: "content",
      query: "AN-SLACK-CANARY-EXAMPLE",
      ownerEmail: "integration@slack",
    });

    expect(result).toMatchObject({
      count: 0,
      access: {
        scope: "integration@slack",
        canInspectAll: true,
      },
      threads: [],
    });
    expect(remoteQueries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sql: expect.stringContaining("org_id = ? AND owner_email = ?"),
          args: expect.arrayContaining(["content-org-1", "integration@slack"]),
        }),
      ]),
    );
  });

  it("denies cross-app access when the target source has duplicate organization domains", async () => {
    vi.stubEnv("DISPATCH_THREAD_DEBUG_OPERATOR_EMAILS", "owner@example.com");
    vi.stubEnv("CONTENT_DATABASE_URL", "libsql://content-duplicate-domain");
    mocks.orgId = "org-1";
    mocks.currentExecute.mockImplementation(async ({ sql }) => {
      if (sql.includes("SELECT role FROM org_members")) {
        return { rows: [{ role: "member" }] };
      }
      if (sql.includes("SELECT email FROM org_members")) {
        return { rows: [{ email: "owner@example.com" }] };
      }
      if (sql.includes("SELECT allowed_domain FROM organizations")) {
        return { rows: [{ allowed_domain: "example.com" }] };
      }
      return { rows: [] };
    });
    mocks.createDbExec.mockResolvedValue({
      execute: async ({ sql }: { sql: string }) => {
        if (sql.includes("FROM organizations")) {
          return {
            rows: [{ id: "content-org-1" }, { id: "content-org-2" }],
          };
        }
        return { rows: [] };
      },
    });

    const denial = await searchAgentThreads({
      sourceId: "content",
      query: "AN-SLACK-CANARY-EXAMPLE",
    }).catch((error) => error as Error & { statusCode?: number });

    expect(denial).toMatchObject({
      name: "ForbiddenError",
      statusCode: 403,
      message:
        "The active organization could not be uniquely resolved in the selected Thread Debug source.",
    });
  });

  it.each([
    ["no", []],
    ["multiple", [{ id: "content-org-1" }, { id: "content-org-2" }]],
  ])(
    "preserves an explicit 403 when failed-run lookup finds %s target organization matches",
    async (_label, organizationRows) => {
      vi.stubEnv("DISPATCH_THREAD_DEBUG_OPERATOR_EMAILS", "owner@example.com");
      vi.stubEnv("CONTENT_DATABASE_URL", "libsql://content-invalid-domain");
      mocks.orgId = "org-1";
      mocks.currentExecute.mockImplementation(async ({ sql }) => {
        if (sql.includes("SELECT role FROM org_members")) {
          return { rows: [{ role: "member" }] };
        }
        if (sql.includes("SELECT email FROM org_members")) {
          return { rows: [{ email: "owner@example.com" }] };
        }
        if (sql.includes("SELECT allowed_domain FROM organizations")) {
          return { rows: [{ allowed_domain: "example.com" }] };
        }
        return { rows: [] };
      });
      mocks.createDbExec.mockResolvedValue({
        execute: async ({ sql }: { sql: string }) => {
          if (sql.includes("FROM organizations")) {
            return { rows: organizationRows };
          }
          return { rows: [] };
        },
      });

      const denial = await listAgentRunFailures({
        sourceId: "content",
      }).catch((error) => error as Error & { statusCode?: number });

      expect(denial).toMatchObject({
        name: "ForbiddenError",
        statusCode: 403,
        message:
          "The active organization could not be uniquely resolved in the selected Thread Debug source.",
      });
    },
  );

  it("denies cross-app operator access when the organization has no stable domain mapping", async () => {
    vi.stubEnv("DISPATCH_THREAD_DEBUG_OPERATOR_EMAILS", "owner@example.com");
    vi.stubEnv("CONTENT_DATABASE_URL", "libsql://content-no-domain");
    mocks.orgId = "org-1";
    mocks.currentExecute.mockImplementation(async ({ sql }) => {
      if (sql.includes("SELECT role FROM org_members")) {
        return { rows: [{ role: "member" }] };
      }
      if (sql.includes("SELECT email FROM org_members")) {
        return { rows: [{ email: "owner@example.com" }] };
      }
      return { rows: [] };
    });

    const denial = await searchAgentThreads({
      sourceId: "content",
      query: "AN-SLACK-CANARY-EXAMPLE",
    }).catch((error) => error as Error & { statusCode?: number });

    expect(denial).toMatchObject({
      name: "ForbiddenError",
      statusCode: 403,
      message:
        "The active organization needs an allowed domain before operators can inspect cross-app traces.",
    });
    expect(mocks.createDbExec).not.toHaveBeenCalled();
  });
});
