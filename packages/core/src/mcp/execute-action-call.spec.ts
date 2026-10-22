import { inspect } from "node:util";

import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { currentInvocationEvidence } from "../action-frame.js";
import { ActionContractError, defineAction } from "../action.js";
import type { ActionEntry } from "../agent/production-agent.js";
import { MCP_ACTION_RESULT_MARKER } from "../mcp-client/app-result.js";
import {
  ServicePrincipalRefusedError,
  assertServicePrincipalMayRun,
  recordServicePrincipalDenial,
  servicePrincipalActionDeniedError,
} from "../org/service-principal-guard.js";
import { runWithRequestContext } from "../server/request-context.js";
import * as approvalStore from "./approval-store.js";
import {
  type McpActionCallContext,
  type McpActionCallOutcome,
  embedCredentialGuard,
  executeMcpActionCall,
  redactEmbedCredentials,
  runMcpActionCallUnredacted,
  UnreadableResultError,
} from "./execute-action-call.js";

const grants = vi.hoisted(() => new Map<string, any>());

vi.mock("./approval-store.js", async () => {
  const actual = await vi.importActual<typeof import("./approval-store.js")>(
    "./approval-store.js",
  );
  return {
    mcpApprovalAppId: actual.mcpApprovalAppId,
    storedApprovalArguments: actual.storedApprovalArguments,
    normalizeApprovalEmail: actual.normalizeApprovalEmail,
    createMcpApprovalGrant: vi.fn(async (grant: any) => {
      grants.set(grant.nonce, { ...grant, consumed: false });
    }),
    consumeMcpApprovalGrant: vi.fn(async (grant: any) => {
      const existing = grants.get(grant.nonce);
      if (!existing || existing.consumed) return false;
      existing.consumed = true;
      return true;
    }),
    consumeReviewedMcpApprovalGrant: vi.fn(async () => null),
    answerMcpApprovalPrompt: vi.fn(async () => true),
    findRecentMcpApprovalRun: vi.fn(async () => null),
    recordMcpApprovalRun: vi.fn(async () => undefined),
  };
});

const store = vi.mocked(approvalStore);

function resetApprovalStore() {
  grants.clear();
  for (const fn of Object.values(store)) {
    if (vi.isMockFunction(fn)) fn.mockClear();
  }
}

vi.mock("../org/service-principal-guard.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../org/service-principal-guard.js")>();
  return {
    ...actual,
    assertServicePrincipalMayRun: vi.fn(actual.assertServicePrincipalMayRun),
    recordServicePrincipalDenial: vi.fn(async () => {}),
  };
});

const EMBED_START =
  "https://mail.agent-native.com/_agent-native/embed/start?ticket=secret-ticket";

const context: McpActionCallContext = {
  appId: "mail",
  approvalAppId: "mail",
  identity: {
    userEmail: "user@example.com",
    identityAssurance: "user",
    orgDomain: undefined,
  },
  approvalCallerKey: "caller-key",
  canRequestApproval: true,
};

function entry(overrides: Partial<ActionEntry>): ActionEntry {
  return {
    tool: { description: "test action" },
    run: async () => ({ ok: true }),
    ...overrides,
  } as ActionEntry;
}

type Call = Parameters<typeof executeMcpActionCall>[1];

/**
 * The client's answer to a form prompt, with the signed state the host hands
 * back beside it. No decision is a decline or a cancel.
 */
function formAnswer(
  grant: any,
  decision?: "approve" | "deny",
): NonNullable<Call["approval"]> {
  const state = {
    version: grant.version,
    nonce: grant.nonce,
    actionName: grant.actionName,
    argumentsHash: grant.argumentsHash,
    expiresAt: grant.expiresAt,
  };
  return {
    state: () => state,
    decision: () => decision,
    accepted: () => decision !== undefined,
  };
}

function inRequest<T>(fn: () => Promise<T>): Promise<T> {
  return runWithRequestContext(
    { userEmail: "user@example.com" },
    fn,
  ) as Promise<T>;
}

function execute(
  callable: Record<string, ActionEntry>,
  name: string,
  args: unknown = {},
  options: {
    context?: McpActionCallContext;
    approval?: Call["approval"];
    actionRunContext?: Call["actionRunContext"];
  } = {},
): Promise<McpActionCallOutcome> {
  return inRequest(() =>
    executeMcpActionCall(options.context ?? context, {
      name,
      args,
      callable,
      approval: options.approval,
      actionRunContext: options.actionRunContext,
    }),
  );
}

const embedResult = () => ({
  title: "Thread",
  embedStartUrl: EMBED_START,
  embedExpiresAt: 1,
  ticket: "secret-ticket",
  items: [{ url: EMBED_START }, { id: "kept" }],
});

describe("executeMcpActionCall", () => {
  beforeEach(resetApprovalStore);

  it("returns plain, frozen, detached JSON with embed credentials removed", async () => {
    const raw = embedResult();
    const outcome = await execute(
      { open: entry({ readOnly: true, run: async () => raw }) },
      "open",
    );

    expect(outcome).toEqual({
      status: "completed",
      value: { title: "Thread", items: [{}, { id: "kept" }] },
      reportedError: false,
    });
    expect(Reflect.ownKeys(outcome).sort()).toEqual([
      "reportedError",
      "status",
      "value",
    ]);
    expect(inspect(outcome, { showHidden: true, depth: null })).not.toContain(
      "secret-ticket",
    );
    expect(structuredClone(outcome)).toEqual(outcome);
    expect(Object.isFrozen(outcome)).toBe(true);
    if (outcome.status !== "completed") return;
    expect(Object.isFrozen((outcome.value as any).items[1])).toBe(true);
    raw.items[1].id = "changed later";
    expect((outcome.value as any).items[1].id).toBe("kept");
  });

  it("unwraps a proxied MCP result and reports its own error flag", async () => {
    const outcome = await execute(
      {
        proxy: entry({
          run: async () => ({
            [MCP_ACTION_RESULT_MARKER]: true,
            text: "Upstream failed",
            raw: { isError: true, detail: "nope" },
            serverId: "upstream",
            toolName: "upstream__fail",
            originalToolName: "fail",
            input: {},
          }),
        }),
      },
      "proxy",
    );

    expect(outcome).toEqual({
      status: "completed",
      reportedError: true,
      value: { isError: true, detail: "nope" },
    });
  });

  it("hides a ticket a proxied result echoes away from its start URL", async () => {
    const echoed = "Sign in with code secret-ticket.";
    const outcome = await execute(
      {
        proxy: entry({
          run: async () => ({
            [MCP_ACTION_RESULT_MARKER]: true,
            text: echoed,
            raw: {
              content: [{ type: "text", text: echoed }],
              _meta: { "agent-native/embedStart": { startUrl: EMBED_START } },
            },
            serverId: "upstream",
            toolName: "upstream__session",
            originalToolName: "session",
            input: {},
          }),
        }),
      },
      "proxy",
    );

    expect(outcome).toEqual({
      status: "completed",
      reportedError: false,
      value: {
        content: [{ type: "text", text: "[hidden embed ticket]" }],
        _meta: {},
      },
    });
  });

  it("reports a result that cannot become JSON as a result-stage failure after the action ran", async () => {
    const cyclic: Record<string, unknown> = { id: "loop" };
    cyclic.self = cyclic;
    const run = vi.fn(async () => ({ count: 1n }));
    const callable = {
      big: entry({ run }),
      cycle: entry({ run: async () => cyclic }),
      getter: entry({
        run: async () => ({
          get secret() {
            throw new Error(`cannot read ${EMBED_START}`);
          },
        }),
      }),
    };

    await expect(execute(callable, "big")).resolves.toEqual({
      status: "failed",
      stage: "result",
      message: "Do not know how to serialize a BigInt",
      errorCode: undefined,
    });
    expect(run).toHaveBeenCalledTimes(1);
    await expect(execute(callable, "cycle")).resolves.toMatchObject({
      status: "failed",
      stage: "result",
    });
    await expect(execute(callable, "getter")).resolves.toEqual({
      status: "failed",
      stage: "result",
      message: "[hidden embed URL]",
      errorCode: undefined,
    });
  });

  it("separates failures before the action from failures inside it", async () => {
    const run = vi.fn(async () => ({ ok: true }));
    await expect(
      execute({ write: entry({ run }) }, "write", { n: Infinity }),
    ).resolves.toEqual({
      status: "failed",
      stage: "approval",
      message: "MCP action arguments must contain finite numbers",
      errorCode: undefined,
    });
    expect(run).not.toHaveBeenCalled();
    // A Date has no JSON form to bind as sent; it does not pass as `{}`.
    await expect(
      execute({ write: entry({ run }) }, "write", { at: new Date(0) }),
    ).resolves.toEqual({
      status: "failed",
      stage: "approval",
      message: "MCP action arguments must be JSON values",
      errorCode: undefined,
    });
    expect(run).not.toHaveBeenCalled();

    const effects: string[] = [];
    await expect(
      execute(
        {
          partial: entry({
            run: async () => {
              effects.push("written");
              throw new ActionContractError("Revision is stale.", {
                errorCode: "stale_revision",
              });
            },
          }),
        },
        "partial",
      ),
    ).resolves.toEqual({
      status: "failed",
      stage: "action",
      message: "Revision is stale.",
      errorCode: "stale_revision",
    });
    expect(effects).toEqual(["written"]);

    const failing = {
      generic: entry({
        run: async () => {
          throw new ActionContractError("Generic failure.", {
            errorCode: "action_failed",
          });
        },
      }),
      plain: entry({
        run: async () => {
          throw "plain string";
        },
      }),
    };
    await expect(execute(failing, "generic")).resolves.toEqual({
      status: "failed",
      stage: "action",
      message: "Generic failure.",
      errorCode: undefined,
    });
    await expect(execute(failing, "plain")).resolves.toEqual({
      status: "failed",
      stage: "action",
      message: "plain string",
      errorCode: undefined,
    });
  });

  it("refuses unknown tools and tools outside the caller's OAuth scope without running them", async () => {
    const run = vi.fn(async () => ({ ok: true }));
    const callable = { write: entry({ run }) };

    await expect(execute(callable, "missing")).resolves.toEqual({
      status: "unknown-tool",
      message: "Unknown tool: missing",
    });
    await expect(
      execute(
        callable,
        "write",
        {},
        {
          context: {
            ...context,
            identity: { ...context.identity!, oauthScopes: ["mcp:read"] },
          },
        },
      ),
    ).resolves.toEqual({
      status: "forbidden-scope",
      message: "OAuth scope does not allow tool write",
    });
    expect(run).not.toHaveBeenCalled();
  });

  it("asks approval for, and runs, the arguments with every gate on its own copy", async () => {
    // Freezing does not freeze a Date's time: a gate sharing the Date the
    // approval predicate reads could change what it decides on.
    const ran: number[] = [];
    const gate: number[] = [];
    const publish = defineAction({
      description: "Publish at a time.",
      schema: z.object({}).transform(() => ({ at: new Date(1000) })),
      readOnly: false,
      planMode: {
        effect: (args) => {
          args.at.setTime(0);
          return "write";
        },
      },
      needsApproval: (args) => {
        gate.push(args.at.getTime());
        return args.at.getTime() > 0;
      },
      run: async (args) => {
        ran.push(args.at.getTime());
        return { ok: true };
      },
    }) as unknown as ActionEntry;

    await expect(execute({ publish }, "publish")).resolves.toMatchObject({
      status: "approval-required",
    });
    expect(ran).toEqual([]);
    const [grant] = [...grants.values()];
    await expect(
      execute(
        { publish },
        "publish",
        {},
        { approval: formAnswer(grant, "approve") },
      ),
    ).resolves.toMatchObject({ status: "completed" });
    expect(ran).toEqual([1000]);
    expect(gate.length).toBeGreaterThan(0);
    expect(gate.every((time) => time === 1000)).toBe(true);
  });

  it("asks for approval and runs only on an approved resume of the same call", async () => {
    const evidence: unknown[] = [];
    const run = vi.fn(async (_args: unknown, _ctx: unknown) => {
      evidence.push(currentInvocationEvidence());
      return { id: "d-1" };
    });
    const callable = { publish: entry({ needsApproval: true, run }) };

    const first = await execute(callable, "publish", { draftId: "d-1" });
    const [grant] = [...grants.values()];
    expect(first).toEqual({
      status: "approval-required",
      approval: { actionName: "publish", expiresAt: grant.expiresAt },
    });
    if (first.status !== "approval-required") return;
    expect(Object.isFrozen(first.approval)).toBe(true);
    expect(JSON.stringify(first)).not.toContain(grant.nonce);
    expect(run).not.toHaveBeenCalled();

    // The signed state travels through the trusted host channel only.
    const resume = formAnswer(grant, "approve");
    const actionRunContext = { mcpClient: { name: "spec-client" } };
    await expect(
      execute(callable, "publish", { draftId: "d-2" }, { approval: resume }),
    ).resolves.toEqual({
      status: "approval-denied",
      message:
        "Approval for publish is invalid or does not match this exact call.",
    });

    await expect(
      execute(
        callable,
        "publish",
        { draftId: "d-1" },
        {
          approval: resume,
          actionRunContext,
        },
      ),
    ).resolves.toMatchObject({ status: "completed", value: { id: "d-1" } });
    expect(run).toHaveBeenCalledWith(
      { draftId: "d-1" },
      expect.objectContaining(actionRunContext),
    );
    // The acceptance is held by this invocation's frame, so a child the
    // action hands its context to records none.
    expect(run.mock.calls[0]?.[1]).not.toHaveProperty("mcpClientAccepted");
    expect(evidence).toEqual([{ mcpClientAccepted: true }]);
    expect(store.recordMcpApprovalRun).toHaveBeenCalledWith(
      grant.nonce,
      "completed",
    );
    await expect(
      execute(callable, "publish", { draftId: "d-1" }, { approval: resume }),
    ).resolves.toEqual({
      status: "approval-denied",
      message: "Approval for publish is invalid, expired, or already used.",
    });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("binds a grant to the exact arguments the call runs with", async () => {
    let stamp = 0;
    const run = vi.fn(async () => ({ ok: true }));
    const callable = {
      schedule: entry({
        schema: z.object({
          at: z
            .string()
            .default(() => new Date(++stamp * 1000).toISOString())
            .transform((at) => new Date(at)),
        }),
        needsApproval: true,
        run,
      }),
    };
    const first = await execute(callable, "schedule");
    expect(first.status).toBe("approval-required");
    const [grant] = [...grants.values()];
    // Resumed, the same call as sent prepares a different Date.
    await expect(
      execute(
        callable,
        "schedule",
        {},
        { approval: formAnswer(grant, "approve") },
      ),
    ).resolves.toEqual({
      status: "approval-denied",
      message:
        "Approval for schedule is invalid or does not match this exact call.",
    });
    expect(run).not.toHaveBeenCalled();
  });

  it("refuses arguments it cannot snapshot exactly, with or without approval", async () => {
    const run = vi.fn(async () => ({ ok: true }));
    const tag = (needsApproval: boolean) =>
      entry({
        schema: z.object({
          tags: z
            .array(z.string())
            .default(["a"])
            .transform((tags) => new Set(tags)),
        }),
        ...(needsApproval ? { needsApproval: true } : {}),
        run,
      });
    for (const needsApproval of [true, false]) {
      await expect(
        execute({ tag: tag(needsApproval) }, "tag"),
      ).resolves.toMatchObject({
        status: "failed",
        stage: "action",
        message: 'Argument "tags" has no exact encoding (Set).',
      });
    }
    expect(grants.size).toBe(0);
    expect(run).not.toHaveBeenCalled();
  });

  it("never asks approval for, or runs, arguments read through an accessor", async () => {
    // Read once to bind a grant and again to run, a getter could answer
    // differently each time.
    const run = vi.fn(async (_args: unknown) => ({ ok: true }));
    const publish = entry({
      schema: z.object({}).transform(() => {
        let reads = 0;
        return Object.defineProperty({}, "amount", {
          enumerable: true,
          get: () => (++reads === 1 ? 1 : 100),
        });
      }),
      needsApproval: true,
      run,
    });
    await expect(execute({ publish }, "publish")).resolves.toMatchObject({
      status: "failed",
      stage: "action",
      message: 'Argument "amount" has no exact encoding (accessor).',
    });
    expect(grants.size).toBe(0);
    expect(run).not.toHaveBeenCalled();
  });

  it("refuses approval when the caller is not a verified user", async () => {
    const outcome = await execute(
      { publish: entry({ needsApproval: true }) },
      "publish",
      {},
      {
        context: {
          ...context,
          identity: { userEmail: "owner@example.com", orgDomain: undefined },
        },
      },
    );
    expect(outcome).toEqual({
      status: "approval-denied",
      message: "publish requires approval from a verified user identity.",
    });
  });

  it("refuses a service principal that is outside its grant, inactive or unverifiable before the action is looked up or run", async () => {
    const denial = vi.mocked(recordServicePrincipalDenial);
    denial.mockClear();
    const run = vi.fn(async () => ({ ok: true }));
    const callable = { write: entry({ run }) };
    const denied = {
      status: "failed",
      stage: "authorization",
      message: "Forbidden: write is not permitted for this service principal.",
      errorCode: "service_principal_action_denied",
    };

    vi.mocked(assertServicePrincipalMayRun).mockResolvedValueOnce({
      allowedActions: ["read"],
    });
    await expect(execute(callable, "write")).resolves.toEqual(denied);
    expect(denial).toHaveBeenCalledWith(
      expect.objectContaining({
        actionName: "write",
        caller: "mcp",
        error: expect.any(ServicePrincipalRefusedError),
      }),
    );

    // A denial that cannot be audited is still a denial.
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    denial.mockRejectedValueOnce(new Error("audit store down"));
    vi.mocked(assertServicePrincipalMayRun).mockResolvedValueOnce({
      allowedActions: ["read"],
    });
    await expect(execute({}, "write")).resolves.toEqual(denied);
    expect(logged).toHaveBeenCalledTimes(1);
    logged.mockRestore();

    for (const [code, message] of [
      ["service_principal_inactive", "Service principal is suspended."],
      ["service_principal_unavailable", "Status unavailable."],
    ] as const) {
      vi.mocked(assertServicePrincipalMayRun).mockRejectedValueOnce(
        new ServicePrincipalRefusedError(code, message),
      );
      await expect(execute(callable, "write")).resolves.toEqual({
        status: "failed",
        stage: "authorization",
        message,
        errorCode: code,
      });
    }
    expect(run).not.toHaveBeenCalled();
  });

  it("keeps the code of a refusal thrown after the action was invoked, at the action stage", async () => {
    // The action's own wrapper refuses from inside `run`, where nothing proves
    // the body did not start.
    await expect(
      execute(
        {
          write: entry({
            run: async () => {
              throw servicePrincipalActionDeniedError("write");
            },
          }),
        },
        "write",
      ),
    ).resolves.toEqual({
      status: "failed",
      stage: "action",
      message: "Forbidden: write is not permitted for this service principal.",
      errorCode: "service_principal_action_denied",
    });
  });
});

describe("executeMcpActionCall sanitizing", () => {
  beforeEach(resetApprovalStore);

  it("redacts embed URLs from refusal messages and error codes", async () => {
    await expect(execute({}, `open ${EMBED_START}`)).resolves.toEqual({
      status: "unknown-tool",
      message: "[hidden embed URL]",
    });
    await expect(
      execute(
        {
          stale: entry({
            run: async () => {
              throw new ActionContractError("Revision is stale.", {
                errorCode: EMBED_START,
              });
            },
          }),
        },
        "stale",
      ),
    ).resolves.toEqual({
      status: "failed",
      stage: "action",
      message: "Revision is stale.",
      errorCode: "[hidden embed URL]",
    });
  });

  it("drops object keys that carry an embed URL and the credentials beside them", async () => {
    const outcome = await execute(
      {
        links: entry({
          readOnly: true,
          run: async () => ({
            title: "Thread",
            links: {
              [EMBED_START]: { label: "open" },
              ticket: "secret-ticket",
              keep: "me",
            },
          }),
        }),
      },
      "links",
    );

    expect(outcome).toEqual({
      status: "completed",
      value: { title: "Thread", links: { keep: "me" } },
      reportedError: false,
    });
    expect(JSON.stringify(outcome)).not.toContain("secret-ticket");
  });

  // An embed start URL inside another URL's query or fragment, escaped in the
  // ways a URL picks up when it is nested in a URL, JSON or HTML. The outer
  // URL's own path is never the embed route.
  const nestedEmbedStarts = [
    `https://redirect.example/?next=${EMBED_START}`,
    `https://redirect.example/?next=${encodeURIComponent(EMBED_START)}`,
    `https://redirect.example/?next=${encodeURIComponent(encodeURIComponent(EMBED_START))}`,
    `https://redirect.example/#next=${EMBED_START}`,
    `https://redirect.example/?next=${EMBED_START.replace("/start", "/x/../start")}`,
    `https://redirect.example/?next=${EMBED_START.replace("start?", "start/../?")}`,
    JSON.stringify({ next: EMBED_START }).replaceAll("/", "\\/"),
    `<a href="https://redirect.example/?next=${EMBED_START.replaceAll("/", "&#x2F;")}">open</a>`,
    `https://redirect.example/?next=${EMBED_START.replaceAll("/", "\\u002f")}`,
  ];

  // The embed start URL spelled with escapes a decoder resolves, with
  // characters a URL parser drops, or with forms a reader folds back into it.
  const disguisedEmbedStarts = [
    EMBED_START.replace("_", "&UnderBar;"),
    EMBED_START.replace("_agent", "_ag&Tab;ent"),
    EMBED_START.replace("_agent", "_ag&NewLine;ent"),
    ...["\t", "\n", "\r"].map((control) =>
      JSON.stringify({
        next: EMBED_START.replace("_agent", `_ag${control}ent`),
      }),
    ),
    EMBED_START.replace("embed", "em&Tab;bed"),
    JSON.stringify({ next: EMBED_START.replace("start", "st\nart") }),
    EMBED_START.replace("/start", "/x/.&Tab;./start"),
    EMBED_START.replace("/start", "/x/\\.\\./start"),
    JSON.stringify({
      next: EMBED_START.replace("/start", "/x/.\t./start"),
    }).replaceAll("/", "\\/"),
    `https://redirect.example/?next=${encodeURIComponent(EMBED_START.replace("/start", "/a%2Fb/%2e%2e/start"))}`,
    `https://redirect.example/?next=${encodeURIComponent(EMBED_START).replaceAll("%", "&percnt;")}`,
    EMBED_START.replace("embed", `em${String.fromCodePoint(0x200b)}bed`),
    EMBED_START.replace("embed/start", "ｅｍｂｅｄ／ｓｔａｒｔ"),
    EMBED_START.replace("embed", "em&bogus;bed"),
  ];

  it("redacts an embed start URL nested or disguised anywhere in a string, key or message", async () => {
    for (const nested of [...nestedEmbedStarts, ...disguisedEmbedStarts]) {
      const callable = {
        value: entry({
          readOnly: true,
          run: async () => ({
            next: nested,
            ticket: "secret-ticket",
            keep: "me",
          }),
        }),
        key: entry({
          readOnly: true,
          run: async () => ({
            links: {
              [nested]: { label: "open" },
              ticket: "secret-ticket",
              keep: "me",
            },
          }),
        }),
        sibling: entry({
          readOnly: true,
          run: async () => ({
            items: [{ url: nested }, { ticket: "secret-ticket", id: "kept" }],
          }),
        }),
        bare: entry({ readOnly: true, run: async () => nested }),
      };
      const expected: Record<string, unknown> = {
        value: { keep: "me" },
        key: { links: { keep: "me" } },
        sibling: { items: [{}, { id: "kept" }] },
        bare: "[hidden embed URL]",
      };
      for (const [name, value] of Object.entries(expected)) {
        const outcome = await execute(callable, name);
        expect(outcome, `${name}: ${nested}`).toEqual({
          status: "completed",
          value,
          reportedError: false,
        });
        expect(JSON.stringify(outcome)).not.toContain("secret-ticket");
      }
      await expect(execute({}, `open ${nested}`)).resolves.toEqual({
        status: "unknown-tool",
        message: "[hidden embed URL]",
      });
    }
  });

  it("keeps ordinary nested URLs and ticket fields with no embed route beside them", async () => {
    const value = {
      next: `https://redirect.example/?next=${encodeURIComponent("https://mail.agent-native.com/inbox")}`,
      support: {
        ticket: "SUP-12",
        url: "https://support.example/_agent-native/embed?step=1#started-guide",
        note: "Embedded charts &amp; start-up tips",
      },
    };
    await expect(
      execute(
        { read: entry({ readOnly: true, run: async () => value }) },
        "read",
      ),
    ).resolves.toEqual({ status: "completed", value, reportedError: false });
  });

  it("treats any mention of embed start as a credential, even outside a URL", async () => {
    for (const mention of [
      "https://support.example/_agent-native/embed#start",
      "Embed start failed; retry.",
    ]) {
      await expect(
        execute(
          {
            read: entry({
              readOnly: true,
              run: async () => ({ mention, ticket: "SUP-12", keep: "me" }),
            }),
          },
          "read",
        ),
        mention,
      ).resolves.toEqual({
        status: "completed",
        value: { keep: "me" },
        reportedError: false,
      });
    }
  });

  it("redacts a deeply nested result in work linear in its depth", async () => {
    const listed = vi.spyOn(Object, "entries");
    try {
      const flat = entry({ readOnly: true, run: async () => "ordinary" });
      listed.mockClear();
      await execute({ read: flat }, "read");
      // What the call lists whatever it returns, such as its arguments.
      const baseline = listed.mock.calls.length;
      for (const depth of [100, 200, 400, 800, 1600]) {
        let nested: unknown = "ordinary";
        for (let level = 0; level < depth; level += 1) {
          nested = { child: nested };
        }
        const read = entry({ readOnly: true, run: async () => nested });
        listed.mockClear();
        const outcome = await execute({ read }, "read");
        const listings = listed.mock.calls.length;
        expect(outcome).toEqual({
          status: "completed",
          value: nested,
          reportedError: false,
        });
        // Each object is listed once for the value's embed context and once
        // to copy it redacted. Rescanning every subtree from every level lists
        // the chain's objects depth * (depth + 3) / 2 times.
        expect(listings - baseline, `depth ${depth}`).toBeLessThanOrEqual(
          2 * depth,
        );
      }
    } finally {
      listed.mockRestore();
    }
  });

  it("keeps __proto__ keys from JSON and freezes everything under them", async () => {
    const json = '{"__proto__":{"admin":true},"nested":{"__proto__":{"x":1}}}';
    const outcome = await execute(
      { read: entry({ readOnly: true, run: async () => JSON.parse(json) }) },
      "read",
    );

    expect(outcome.status).toBe("completed");
    if (outcome.status !== "completed") return;
    const value = outcome.value as Record<string, any>;
    expect(JSON.stringify(value)).toBe(json);
    expect(Object.keys(value)).toEqual(["__proto__", "nested"]);
    expect(Object.getPrototypeOf(value)).toBe(Object.prototype);
    const own = Object.getOwnPropertyDescriptor(value, "__proto__")!.value;
    expect(Object.isFrozen(own)).toBe(true);
    expect(
      Object.isFrozen(
        Object.getOwnPropertyDescriptor(value.nested, "__proto__")!.value,
      ),
    ).toBe(true);
  });

  it("redacts a value that holds itself, as the direct path can be handed one", () => {
    const value: Record<string, unknown> = {
      next: nestedEmbedStarts[0],
      ticket: "secret-ticket",
      keep: "me",
    };
    value.items = [value, { ticket: "secret-ticket" }];

    expect(redactEmbedCredentials(value)).toEqual({
      keep: "me",
      items: ["[circular result]", {}],
    });
  });

  it("hides an echoed credential whatever characters it holds", () => {
    expect(
      redactEmbedCredentials({
        next: EMBED_START,
        ticket: "a.b+c(d)[e]$f",
        note: "Use a.b+c(d)[e]$f or secret-ticket-2.",
      }),
    ).toEqual({
      note: "[hidden embed ticket]",
    });
  });

  it("hides many credentials across a large result with one pattern", () => {
    const tickets = Array.from(
      { length: 500 },
      (_, index) => `ticket-${String(index).padStart(8, "0")}`,
    );
    const value = {
      next: EMBED_START,
      sessions: tickets.map((ticket) => ({ ticket })),
      notes: Array.from(
        { length: 5000 },
        (_, index) => `Row ${index} echoes ${tickets[index % tickets.length]}.`,
      ),
    };
    let patterns = 0;
    vi.stubGlobal(
      "RegExp",
      new Proxy(RegExp, {
        construct(target, args) {
          patterns += 1;
          return new target(...(args as [string, string?]));
        },
      }),
    );
    let redacted: unknown;
    try {
      redacted = redactEmbedCredentials(value);
    } finally {
      vi.unstubAllGlobals();
    }

    expect(patterns).toBe(1);
    expect(redacted).toEqual({
      sessions: tickets.map(() => ({})),
      notes: value.notes.map(() => "[hidden embed ticket]"),
    });
  });

  describe("echoes of a minted ticket", () => {
    const ticket = "Abcdefghijklmnopqrstuvwxyz0123456789_-ABCDE";
    const start = `https://mail.agent-native.com/_agent-native/embed/start?ticket=${ticket}`;
    const encoded = (text: string, times: number) => {
      let out = text;
      for (let layer = 0; layer < times; layer += 1) {
        out = encodeURIComponent(out);
      }
      return out;
    };

    it("learns nothing from image bytes, but reads the rest of an image", () => {
      // Base64 whose letters run "embedstart", which the loose route match
      // reads as naming the route, so reading it would put the call in embed
      // context.
      const bytes = `${"QUJD".repeat(500_000)}embedstart`;
      const image = (fields: Record<string, unknown>) => ({
        _agentImages: [{ mediaType: "image/png", ...fields }],
      });
      expect(embedCredentialGuard({ note: bytes }).embedContext).toBe(true);
      expect(embedCredentialGuard(image({ data: bytes })).embedContext).toBe(
        false,
      );
      expect(
        embedCredentialGuard(image({ data: `data:image/png;base64,${bytes}` }))
          .embedContext,
      ).toBe(false);
      expect(
        embedCredentialGuard(image({ data: "aGVsbG8=", label: "embedstart" }))
          .embedContext,
      ).toBe(true);
      expect(embedCredentialGuard(image({ url: start })).credentials).toEqual([
        ticket,
      ]);
      // Data that is not image bytes is read, so a start URL in it is learned.
      expect(embedCredentialGuard(image({ data: start })).credentials).toEqual([
        ticket,
      ]);
    });

    it("reads a ticket without the punctuation that ends its sentence", () => {
      for (const prose of [`Open ${start}.`, `${start}.`, `(see ${start})`]) {
        expect(embedCredentialGuard(prose).credentials, prose).toEqual([
          ticket,
        ]);
        expect(
          redactEmbedCredentials([prose, `Your code is ${ticket}.`]),
          prose,
        ).toEqual(["[hidden embed URL]", "[hidden embed ticket]"]);
      }
    });

    it("hides a string that echoes a ticket under any escaping it decodes", () => {
      const characters = [...ticket];
      const hex = (character: string) =>
        character.charCodeAt(0).toString(16).padStart(2, "0");
      const percent = characters.map((c) => `%${hex(c)}`).join("");
      const html = characters.map((c) => `&#${c.charCodeAt(0)};`).join("");
      const script = characters
        .map((c) => `${String.fromCharCode(92)}x${hex(c)}`)
        .join("");

      expect(
        redactEmbedCredentials([
          start,
          `https://elsewhere.example/?code=${percent}`,
          `Code: ${html}`,
          `Code: ${script}`,
        ]),
      ).toEqual([
        "[hidden embed URL]",
        "[hidden embed ticket]",
        "[hidden embed ticket]",
        "[hidden embed ticket]",
      ]);
      expect(
        redactEmbedCredentials({ next: start, [ticket]: "x", keep: "me" }),
      ).toEqual({ keep: "me" });
    });

    it("reads a ticket field in any escaping it decodes", () => {
      const code = (character: string) => character.charCodeAt(0);
      const spellings = [
        [...ticket].map((c) => `%${code(c).toString(16)}`).join(""),
        [...ticket].map((c) => `&#${code(c)};`).join(""),
        [...ticket]
          .map(
            (c) =>
              `${String.fromCharCode(92)}u${code(c).toString(16).padStart(4, "0")}`,
          )
          .join(""),
      ];
      for (const spelling of spellings) {
        expect(
          embedCredentialGuard({ embedTargetPath: "/inbox", ticket: spelling })
            .credentials,
          spelling,
        ).toContain(ticket);
        expect(
          redactEmbedCredentials({
            embedTargetPath: "/inbox",
            ticket: spelling,
            note: `Code ${ticket}`,
          }),
          spelling,
        ).toEqual({ note: "[hidden embed ticket]" });
      }
    });

    it("reads every layer to the cap and withholds a result escaped deeper", async () => {
      // Escaped exactly as many times as it reads (MAX_DECODE_ROUNDS, 8).
      const atCap = `https://redirect.example/?next=${encoded(start, 8)}`;
      expect(redactEmbedCredentials([atCap, `Code: ${ticket}`])).toEqual([
        "[hidden embed URL]",
        "[hidden embed ticket]",
      ]);

      // Deliberate: one layer deeper, credential or not, and no part of the
      // result is shown.
      const overCap = `https://redirect.example/?next=${encoded("https://example.com/plain", 9)}`;
      expect(() => redactEmbedCredentials([overCap, "plain"])).toThrow(
        UnreadableResultError,
      );
      expect(() =>
        redactEmbedCredentials("plain", embedCredentialGuard({ overCap })),
      ).toThrow(UnreadableResultError);
      expect(() => redactEmbedCredentials({ [overCap]: "plain" })).toThrow(
        UnreadableResultError,
      );
      await expect(
        execute(
          { deep: entry({ run: async () => ({ next: overCap, keep: "me" }) }) },
          "deep",
        ),
      ).resolves.toEqual({
        status: "failed",
        stage: "result",
        message: "The result could not be checked for embed credentials.",
        errorCode: undefined,
      });
      // An error message is the whole output, so it is hidden instead.
      await expect(
        execute(
          {
            fails: entry({
              run: async () => {
                throw new Error(overCap);
              },
            }),
          },
          "fails",
        ),
      ).resolves.toMatchObject({
        stage: "action",
        message: "[hidden embed URL]",
      });

      const once = `https://redirect.example/?next=${encoded("https://mail.agent-native.com/inbox", 1)}`;
      expect(redactEmbedCredentials([once])).toEqual([once]);
      expect(redactEmbedCredentials([start, once])).toEqual([
        "[hidden embed URL]",
        once,
      ]);
    });
  });

  it("keeps the failure stage when the error itself cannot be read", async () => {
    const unreadableMessage = new Error("hidden");
    Object.defineProperty(unreadableMessage, "message", {
      get() {
        throw new Error("message getter");
      },
    });
    const unreadableCode = new ActionContractError("Stale.", {
      errorCode: "stale_revision",
    });
    Object.defineProperty(unreadableCode, "errorCode", {
      get() {
        throw new Error("code getter");
      },
    });
    const callable = {
      message: entry({
        run: async () => {
          throw unreadableMessage;
        },
      }),
      code: entry({
        run: async () => {
          throw unreadableCode;
        },
      }),
    };

    for (const name of ["message", "code"]) {
      await expect(execute(callable, name)).resolves.toEqual({
        status: "failed",
        stage: "action",
        message: "The call failed, and its error could not be read.",
        errorCode: undefined,
      });
    }
  });
});

describe("runMcpActionCallUnredacted", () => {
  it("hands the trusted adapter the action's own value and thrown error", async () => {
    const raw = embedResult();
    const failure = new Error("boom");
    const callable = {
      open: entry({ readOnly: true, run: async () => raw }),
      fail: entry({
        run: async () => {
          throw failure;
        },
      }),
    };
    const run = (name: string) =>
      inRequest(() =>
        runMcpActionCallUnredacted(context, { name, args: {}, callable }),
      );

    const ran = await run("open");
    expect(ran).toMatchObject({ status: "ran", entry: callable.open });
    if (ran.status === "ran") expect(ran.result).toBe(raw);
    const threw = await run("fail");
    expect(threw).toMatchObject({ status: "threw", stage: "action" });
    if (threw.status === "threw") expect(threw.error).toBe(failure);
  });
});

describe("MCP action approval grants", () => {
  beforeEach(resetApprovalStore);

  const runUnredacted = (
    callable: Record<string, ActionEntry>,
    name: string,
    args: Record<string, unknown>,
    approval?: Call["approval"],
  ) =>
    inRequest(() =>
      runMcpActionCallUnredacted(context, { name, args, callable, approval }),
    );

  it("hands the review page the stored arguments, and warns of an earlier run only when a repeat could duplicate it", async () => {
    const run = vi.fn(async () => ({ ok: true }));
    const callable = {
      send: entry({ needsApproval: true, run }),
      upsert: entry({ needsApproval: true, retrySafe: true, run }),
    };
    const args = { to: "ana@example.com", subject: "Hi", apiKey: "fake-key" };
    const argumentsJson = JSON.stringify({ ...args, apiKey: "[redacted]" });
    // The same call already ran within the approval window.
    store.findRecentMcpApprovalRun.mockResolvedValueOnce({
      consumedAt: 5_000,
      runStatus: "completed",
    } as approvalStore.McpApprovalRecord);

    const retrySafe = await runUnredacted(callable, "upsert", args);
    expect(retrySafe).toMatchObject({
      status: "approval-required",
      review: { actionName: "upsert", priorRun: undefined, argumentsJson },
    });
    expect(store.findRecentMcpApprovalRun).not.toHaveBeenCalled();
    if (retrySafe.status !== "approval-required") return;
    expect(grants.get(retrySafe.review.nonce)).toMatchObject({
      nonce: retrySafe.approval.nonce,
      ownerEmail: "user@example.com",
      argumentsJson,
      retrySafe: true,
    });

    await expect(runUnredacted(callable, "send", args)).resolves.toMatchObject({
      status: "approval-required",
      review: {
        actionName: "send",
        priorRun: { at: 5_000, status: "completed" },
        argumentsJson,
      },
    });
    expect(run).not.toHaveBeenCalled();
  });

  it("runs an identical call a person approved on the review page once, recorded as the page's approval", async () => {
    const evidence: unknown[] = [];
    const run = vi.fn(async () => {
      evidence.push(currentInvocationEvidence());
      return { sent: true };
    });
    const callable = { send: entry({ needsApproval: true, run }) };
    const args = { to: "ana@example.com" };
    await runUnredacted(callable, "send", args);
    const [grant] = [...grants.values()];

    // The agent retries the identical call, with no prompt answer, after the
    // owner approved it on the review page.
    store.consumeReviewedMcpApprovalGrant.mockResolvedValueOnce({
      nonce: grant.nonce,
      status: "approved",
    } as approvalStore.McpApprovalRecord);
    await expect(runUnredacted(callable, "send", args)).resolves.toMatchObject({
      status: "ran",
      result: { sent: true },
    });
    expect(store.consumeReviewedMcpApprovalGrant).toHaveBeenLastCalledWith({
      appId: "mail",
      callerKey: "caller-key",
      actionName: "send",
      argumentsHash: grant.argumentsHash,
    });
    expect(evidence).toEqual([{ auditOverride: { approval: "mcp-review" } }]);
    expect(store.recordMcpApprovalRun).toHaveBeenCalledWith(
      grant.nonce,
      "completed",
    );
    expect(store.consumeMcpApprovalGrant).not.toHaveBeenCalled();
    expect(grants.size).toBe(1);
  });

  it("records whether an approved run that failed may have written", async () => {
    const fail = async () => {
      throw new Error("Mail server unavailable.");
    };
    const callable = {
      send: entry({ needsApproval: true, run: fail }),
      upsert: entry({ needsApproval: true, retrySafe: true, run: fail }),
    };
    for (const [name, settled] of [
      ["send", "unknown"],
      ["upsert", "failed"],
    ] as const) {
      await runUnredacted(callable, name, {});
      const grant = [...grants.values()].find((g) => g.actionName === name);
      await expect(
        runUnredacted(callable, name, {}, formAnswer(grant, "approve")),
      ).resolves.toMatchObject({ status: "threw", stage: "action" });
      expect(store.recordMcpApprovalRun).toHaveBeenLastCalledWith(
        grant.nonce,
        settled,
      );
    }
  });

  it("ends a denied grant for good without running the call", async () => {
    const run = vi.fn(async () => ({ ok: true }));
    const callable = { send: entry({ needsApproval: true, run }) };
    await runUnredacted(callable, "send", {});
    const [grant] = [...grants.values()];

    await expect(
      runUnredacted(callable, "send", {}, formAnswer(grant, "deny")),
    ).resolves.toEqual({
      status: "approval-denied",
      message: "send was not approved.",
    });
    expect(store.answerMcpApprovalPrompt).toHaveBeenCalledWith(
      expect.objectContaining({ nonce: grant.nonce }),
      "denied",
    );
    expect(grants.size).toBe(1);
    expect(run).not.toHaveBeenCalled();
  });

  it("answers a declined or cancelled prompt with a new grant for the review page, never running the call", async () => {
    const run = vi.fn(async () => ({ ok: true }));
    const callable = { send: entry({ needsApproval: true, run }) };
    const args = { to: "ana@example.com" };
    await runUnredacted(callable, "send", args);
    const [declined] = [...grants.values()];

    const outcome = await runUnredacted(
      callable,
      "send",
      args,
      formAnswer(declined),
    );
    expect(outcome).toMatchObject({
      status: "approval-pending",
      reason: "declined",
      review: { actionName: "send", argumentsJson: JSON.stringify(args) },
    });
    if (outcome.status !== "approval-pending") return;
    expect(outcome.review.nonce).not.toBe(declined.nonce);
    expect(grants.get(outcome.review.nonce)).toMatchObject({
      callerKey: "caller-key",
      argumentsHash: declined.argumentsHash,
    });
    expect(store.answerMcpApprovalPrompt).toHaveBeenCalledWith(
      expect.objectContaining({ nonce: declined.nonce }),
      "declined",
    );

    // The model-visible outcome names the action, not the new grant.
    const replacement = grants.get(outcome.review.nonce);
    const redacted = await execute(callable, "send", args, {
      approval: formAnswer(replacement),
    });
    expect(redacted).toEqual({
      status: "approval-pending",
      approval: { actionName: "send", expiresAt: expect.any(Number) },
    });
    expect(JSON.stringify(redacted)).not.toContain(replacement.nonce);
    expect(run).not.toHaveBeenCalled();
  });

  it("leaves an opened review page to decide, whatever the URL prompt's answer says", async () => {
    const run = vi.fn(async () => ({ ok: true }));
    const callable = { send: entry({ needsApproval: true, run }) };
    await runUnredacted(callable, "send", {});
    const [grant] = [...grants.values()];
    const state = { ...formAnswer(grant).state()!, mode: "url" as const };

    await expect(
      runUnredacted(
        callable,
        "send",
        {},
        {
          state: () => state,
          decision: () => "approve",
          accepted: () => true,
        },
      ),
    ).resolves.toMatchObject({
      status: "approval-pending",
      reason: "opened",
      review: { nonce: grant.nonce },
    });
    expect(store.answerMcpApprovalPrompt).toHaveBeenCalledWith(
      expect.objectContaining({ nonce: grant.nonce }),
      "opened",
    );
    expect(store.consumeMcpApprovalGrant).not.toHaveBeenCalled();
    expect(grants.size).toBe(1);
    expect(run).not.toHaveBeenCalled();
  });

  it("uses a page approval after the prompt that asked for it expires, and nothing else that prompt says", async () => {
    const run = vi.fn(async () => ({ sent: true }));
    const callable = { send: entry({ needsApproval: true, run }) };
    await runUnredacted(callable, "send", {});
    const [grant] = [...grants.values()];
    const expired = { ...grant, expiresAt: Date.now() - 1 };

    for (const decision of ["approve", "deny", undefined] as const) {
      await expect(
        runUnredacted(callable, "send", {}, formAnswer(expired, decision)),
      ).resolves.toEqual({
        status: "approval-denied",
        message: "Approval for send is invalid, expired, or already used.",
      });
    }
    expect(store.consumeMcpApprovalGrant).not.toHaveBeenCalled();
    expect(store.answerMcpApprovalPrompt).not.toHaveBeenCalled();

    // The person approved on the page, which outlives the prompt.
    store.consumeReviewedMcpApprovalGrant.mockResolvedValueOnce({
      nonce: grant.nonce,
      status: "approved",
    } as approvalStore.McpApprovalRecord);
    const state = { ...formAnswer(expired).state()!, mode: "url" as const };
    await expect(
      runUnredacted(
        callable,
        "send",
        {},
        { state: () => state, decision: () => undefined, accepted: () => true },
      ),
    ).resolves.toMatchObject({ status: "ran", result: { sent: true } });
    expect(store.consumeReviewedMcpApprovalGrant).toHaveBeenLastCalledWith(
      expect.objectContaining({ nonce: grant.nonce }),
      grant.nonce,
    );
    expect(run).toHaveBeenCalledTimes(1);
  });
});
