import { inspect } from "node:util";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { ActionContractError } from "../action.js";
import type { ActionEntry } from "../agent/production-agent.js";
import { MCP_ACTION_RESULT_MARKER } from "../mcp-client/app-result.js";
import { runWithRequestContext } from "../server/request-context.js";
import {
  type McpActionCallContext,
  type McpActionCallOutcome,
  executeMcpActionCall,
  purgeEmbedStartUrls,
  runMcpActionCallUnredacted,
} from "./execute-action-call.js";

const grants = vi.hoisted(() => new Map<string, any>());

vi.mock("./approval-store.js", () => ({
  createMcpApprovalGrant: vi.fn(async (grant: any) => {
    grants.set(grant.nonce, { ...grant, consumed: false });
  }),
  consumeMcpApprovalGrant: vi.fn(async (grant: any) => {
    const existing = grants.get(grant.nonce);
    if (!existing || existing.consumed) return false;
    existing.consumed = true;
    return true;
  }),
}));

const EMBED_START =
  "https://mail.agent-native.com/_agent-native/embed/start?ticket=secret-ticket";

const context: McpActionCallContext = {
  appId: "mail",
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
  options: { context?: McpActionCallContext; approval?: Call["approval"] } = {},
): Promise<McpActionCallOutcome> {
  return inRequest(() =>
    executeMcpActionCall(options.context ?? context, {
      name,
      args,
      callable,
      approval: options.approval,
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
  beforeEach(() => grants.clear());

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

  it("asks for approval and runs only on an approved resume of the same call", async () => {
    const run = vi.fn(async () => ({ id: "d-1" }));
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
    const { callerKey: _callerKey, consumed: _consumed, ...state } = grant;
    const resume = { state: () => state, decision: () => "approve" };
    await expect(
      execute(callable, "publish", { draftId: "d-2" }, { approval: resume }),
    ).resolves.toEqual({
      status: "approval-denied",
      message:
        "Approval for publish is invalid or does not match this exact call.",
    });

    await expect(
      execute(callable, "publish", { draftId: "d-1" }, { approval: resume }),
    ).resolves.toMatchObject({ status: "completed", value: { id: "d-1" } });
    await expect(
      execute(callable, "publish", { draftId: "d-1" }, { approval: resume }),
    ).resolves.toEqual({
      status: "approval-denied",
      message: "Approval for publish is invalid, expired, or already used.",
    });
    expect(run).toHaveBeenCalledTimes(1);
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
});

describe("executeMcpActionCall sanitizing", () => {
  beforeEach(() => grants.clear());

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
    // The direct wire path keeps dropping such keys, as it always has.
    expect(
      Object.keys(purgeEmbedStartUrls(JSON.parse(json)) as object),
    ).toEqual(["nested"]);
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
