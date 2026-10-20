import { ActionContractError } from "@agent-native/core/action";
import {
  BuilderBranchError,
  type BuilderBranchErrorCode,
  type BuilderBranchStatus,
} from "@agent-native/core/server";
import { describe, expect, it, vi } from "vitest";

import { sanitizeDetails } from "../tripwire/redact.js";
import { createCapturingTripwireSink } from "../tripwire/testing.js";
import type { TripwireSink } from "../tripwire/types.js";
import { OPERATION_CATALOG } from "../workflow/catalog/index.js";
import type { OperationDefinition } from "../workflow/operations.js";
import {
  DEFAULT_BUILDER_STUCK_AFTER_MS,
  executeBuilderOperation,
  mapBranchState,
  type BuilderOperationDeps,
} from "./builder-operations.js";

const NOW = new Date("2026-10-18T12:00:00.000Z");
const MINUTE = 60_000;
const window = DEFAULT_BUILDER_STUCK_AFTER_MS;

function op(id: string): OperationDefinition {
  const def = OPERATION_CATALOG.get(id);
  if (!def) throw new Error(`${id} is not in the catalog`);
  return def;
}

function branchError(
  code: BuilderBranchErrorCode,
  operation: "status" | "message" = "status",
) {
  return new BuilderBranchError(
    code,
    operation,
    "Authorization: Bearer secret-token-123",
  );
}

function status(overrides: Partial<BuilderBranchStatus> = {}) {
  return {
    agentState: "idle",
    lastActivityAt: NOW.getTime() - 5 * MINUTE,
    state: "active",
    archived: false,
    prStatus: null,
    prUrl: null,
    ...overrides,
  } as BuilderBranchStatus;
}

/** Builder as a map of branches: a start adds one, a lookup reads it. */
function fakeBuilder(
  options: {
    startThrows?: (branchName: string) => Error | undefined;
    createsEvenWhenItThrows?: boolean;
    lookupThrows?: () => BuilderBranchError | undefined;
  } = {},
) {
  const branches = new Map<string, BuilderBranchStatus>();
  const startAgent = vi.fn(async (args: { branchName?: string }) => {
    const branchName = args.branchName ?? "generated";
    const thrown = options.startThrows?.(branchName);
    if (thrown) {
      if (options.createsEvenWhenItThrows) {
        branches.set(branchName, status({ agentState: "running" }));
      }
      throw thrown;
    }
    branches.set(branchName, status({ agentState: "running" }));
    return {
      branchName,
      projectId: "proj-1",
      url: `https://builder.io/app/projects/proj-1/${branchName}`,
      status: "processing",
    };
  });
  const getStatus = vi.fn(async (args: { branchName: string }) => {
    const thrown = options.lookupThrows?.();
    if (thrown) throw thrown;
    const found = branches.get(args.branchName);
    if (!found) throw branchError("branch_not_found");
    return found;
  });
  const sendMessage = vi.fn(async () => ({ accepted: true as const }));
  const deps = {
    startAgent,
    getStatus,
    sendMessage,
    now: () => NOW,
    stuckAfterMs: window,
  } as unknown as BuilderOperationDeps;
  return { branches, startAgent, getStatus, sendMessage, deps };
}

function run(
  operationId: string,
  fields: Record<string, unknown>,
  deps: BuilderOperationDeps,
  signal: AbortSignal = new AbortController().signal,
) {
  return executeBuilderOperation({
    operation: op(operationId),
    fields,
    owner: "owner@example.com",
    signal,
    deps,
  });
}

/** What the dispatch gate passes: a clear, low-risk, high-confidence bug nobody claimed. */
const cleanGate = {
  clearBug: true,
  productUxImplications: false,
  risk: "low",
  confidence: "high",
  alreadyClaimed: false,
  categories: [],
};
const startFields = {
  projectId: "proj-1",
  branchName: "factory-group-7",
  prompt: "Fix the login bug",
  ...cleanGate,
};
const task = { projectId: "proj-1", branchName: "factory-group-7" };

describe("builder.start", () => {
  it("starts the task on the deterministic branch and returns its receipt", async () => {
    const builder = fakeBuilder();
    const result = await run("builder.start", startFields, builder.deps);

    expect(builder.startAgent).toHaveBeenCalledTimes(1);
    expect(builder.startAgent).toHaveBeenCalledWith({
      prompt: "Fix the login bug",
      projectId: "proj-1",
      branchName: "factory-group-7",
      userEmail: "owner@example.com",
    });
    expect(result).toEqual({
      ok: true,
      output: {
        accepted: true,
        projectId: "proj-1",
        branchName: "factory-group-7",
        status: "processing",
        url: "https://builder.io/app/projects/proj-1/factory-group-7",
      },
      externalRef: "factory-group-7",
      url: "https://builder.io/app/projects/proj-1/factory-group-7",
    });
  });

  it("attributes the task to the person the graph names", async () => {
    const builder = fakeBuilder();
    await run(
      "builder.start",
      { ...startFields, userEmail: "pat@example.com" },
      builder.deps,
    );
    expect(builder.startAgent).toHaveBeenCalledWith(
      expect.objectContaining({ userEmail: "pat@example.com" }),
    );
  });

  it("never starts a task without a configured project", async () => {
    const builder = fakeBuilder();
    for (const projectId of [undefined, "", "   "]) {
      const result = await run(
        "builder.start",
        { ...startFields, projectId },
        builder.deps,
      );
      expect(result).toMatchObject({
        ok: false,
        code: "credential_missing",
        sideEffect: "none",
        retryable: false,
      });
      expect((result as { message: string }).message).toContain(
        "builder_project_missing",
      );
    }
    expect(builder.getStatus).not.toHaveBeenCalled();
    expect(builder.startAgent).not.toHaveBeenCalled();
  });

  it("looks the branch up before starting, so a retry never makes a second one", async () => {
    // Builder created the branch, but the answer was lost on the wire.
    const builder = fakeBuilder({
      startThrows: () => new Error("Builder agent run timed out after 30000ms"),
      createsEvenWhenItThrows: true,
    });
    const first = await run("builder.start", startFields, builder.deps);
    expect(first).toMatchObject({ ok: true });
    expect(builder.startAgent).toHaveBeenCalledTimes(1);

    const second = await run("builder.start", startFields, builder.deps);
    expect(second).toMatchObject({
      ok: true,
      externalRef: "factory-group-7",
      output: { accepted: true, reused: true },
    });
    expect(builder.startAgent).toHaveBeenCalledTimes(1);
  });

  it("finds a branch an earlier attempt already made and starts nothing", async () => {
    const builder = fakeBuilder();
    builder.branches.set("factory-group-7", status({ agentState: "running" }));
    const result = await run("builder.start", startFields, builder.deps);
    expect(result).toMatchObject({
      ok: true,
      output: { accepted: true, reused: true },
      externalRef: "factory-group-7",
    });
    expect(builder.startAgent).not.toHaveBeenCalled();
  });

  it("refuses to reuse an archived branch's name", async () => {
    const builder = fakeBuilder();
    builder.branches.set(
      "factory-group-7",
      status({ state: "archived", archived: true }),
    );
    const result = await run("builder.start", startFields, builder.deps);
    expect(result).toMatchObject({
      ok: false,
      code: "provider_error",
      sideEffect: "none",
    });
    expect(builder.startAgent).not.toHaveBeenCalled();
  });

  it("does not start blind when the lookup itself fails", async () => {
    const builder = fakeBuilder({
      lookupThrows: () => branchError("network_error"),
    });
    const result = await run("builder.start", startFields, builder.deps);
    expect(result).toMatchObject({
      ok: false,
      sideEffect: "none",
      retryable: true,
    });
    expect(builder.startAgent).not.toHaveBeenCalled();
  });

  it("maps a missing connection to credential_missing", async () => {
    const builder = fakeBuilder({
      startThrows: () =>
        new ActionContractError("Builder.io is not connected.", {
          errorCode: "builder_not_connected",
          statusCode: 400,
        }),
    });
    const result = await run("builder.start", startFields, builder.deps);
    expect(result).toMatchObject({
      ok: false,
      code: "credential_missing",
      sideEffect: "none",
      retryable: false,
    });
    expect((result as { message: string }).message).toContain("Settings");
  });

  it("is none and retryable when Builder timed out and made no branch", async () => {
    const builder = fakeBuilder({
      startThrows: () => new Error("Builder agent run timed out after 30000ms"),
    });
    const result = await run("builder.start", startFields, builder.deps);
    expect(result).toMatchObject({
      ok: false,
      sideEffect: "none",
      retryable: true,
    });
    expect(builder.getStatus).toHaveBeenCalledTimes(2);
  });

  it("is none and not retryable when Builder refused and made no branch", async () => {
    const builder = fakeBuilder({
      startThrows: () => new Error("The Background Agents API is not enabled"),
    });
    const result = await run("builder.start", startFields, builder.deps);
    expect(result).toMatchObject({
      ok: false,
      sideEffect: "none",
      retryable: false,
    });
    // Whatever Builder said stays out of the failure.
    expect((result as { message: string }).message).not.toContain(
      "Background Agents",
    );
  });

  it("is maybe when it cannot tell whether the branch was made", async () => {
    let lookups = 0;
    const builder = fakeBuilder({
      startThrows: () => new Error("fetch failed"),
      lookupThrows: () =>
        lookups++ === 0 ? undefined : branchError("timeout"),
    });
    const result = await run("builder.start", startFields, builder.deps);
    expect(result).toMatchObject({
      ok: false,
      sideEffect: "maybe",
      retryable: false,
    });
  });

  it("needs a task description", async () => {
    const builder = fakeBuilder();
    const result = await run(
      "builder.start",
      { ...startFields, prompt: " " },
      builder.deps,
    );
    expect(result).toMatchObject({ ok: false, code: "graph_invalid" });
    expect(builder.startAgent).not.toHaveBeenCalled();
  });
});

describe("builder.start dispatch gate", () => {
  async function refused(
    overrides: Record<string, unknown>,
    options: { dropFields?: string[] } = {},
  ) {
    const builder = fakeBuilder();
    const fields: Record<string, unknown> = { ...startFields, ...overrides };
    for (const name of options.dropFields ?? []) delete fields[name];
    const result = await run("builder.start", fields, builder.deps);
    // Nothing reached Builder: not the lookup that comes first, and not the start.
    expect(builder.getStatus).not.toHaveBeenCalled();
    expect(builder.startAgent).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      ok: false,
      code: "operation_not_allowed",
      sideEffect: "none",
      retryable: false,
    });
    return (result as { message: string }).message;
  }

  it.each<[string, Record<string, unknown>, string]>([
    ["a report that is not a clear bug", { clearBug: false }, "not_clear_bug"],
    [
      "a product or design question",
      { productUxImplications: true },
      "product_ux_implications",
    ],
    ["unknown risk", { risk: "unknown" }, "risk_not_low"],
    ["negligible risk", { risk: "negligible" }, "risk_not_low"],
    ["medium risk", { risk: "medium" }, "risk_not_low"],
    ["high risk", { risk: "high" }, "risk_not_low"],
    ["critical risk", { risk: "critical" }, "risk_not_low"],
    ["unknown confidence", { confidence: "unknown" }, "confidence_not_high"],
    ["low confidence", { confidence: "low" }, "confidence_not_high"],
    ["medium confidence", { confidence: "medium" }, "confidence_not_high"],
    ["a report a person claimed", { alreadyClaimed: true }, "already_claimed"],
    ["a change in auth", { categories: ["auth"] }, "never_automate_category"],
    [
      "a change in payments",
      { categories: ["payments"] },
      "never_automate_category",
    ],
    [
      "a change nobody could classify",
      { categories: ["ui-polish"] },
      "category_unrecognized",
    ],
  ])("refuses %s and names the reason", async (_name, overrides, code) => {
    const message = await refused(overrides);

    expect(message).toContain(code);
    expect(message).toContain("builder_dispatch_refused");
  });

  it("refuses every hard category, and names which one it saw", async () => {
    for (const category of [
      "auth",
      "session",
      "identity",
      "credentials",
      "vault",
      "migration",
      "payments",
      "security",
      "publishable_package",
    ]) {
      const message = await refused({ categories: ["migration", category] });
      expect(message).toContain("never_automate_category");
      expect(message).toContain(category);
    }
  });

  it("names every reason at once, not only the first", async () => {
    const message = await refused({
      clearBug: false,
      risk: "high",
      confidence: "low",
      alreadyClaimed: true,
      categories: ["vault"],
    });

    for (const code of [
      "not_clear_bug",
      "risk_not_low",
      "confidence_not_high",
      "already_claimed",
      "never_automate_category",
    ]) {
      expect(message).toContain(code);
    }
  });

  it.each([
    "clearBug",
    "productUxImplications",
    "risk",
    "confidence",
    "alreadyClaimed",
    "categories",
  ])("refuses a start that leaves out %s, and says which", async (name) => {
    const message = await refused({}, { dropFields: [name] });

    expect(message).toContain("gate_input_invalid");
    expect(message).toContain(name);
  });

  it.each<[string, Record<string, unknown>]>([
    ["a flag that is text", { clearBug: "true" }],
    ["a flag that is a number", { alreadyClaimed: 0 }],
    ["a flag that is null", { productUxImplications: null }],
    ["a blank risk", { risk: "  " }],
    ["a risk that is not text", { confidence: 3 }],
    ["categories that are text", { categories: "auth" }],
    ["categories that are not a list", { categories: {} }],
    ["categories with a non-text entry", { categories: ["auth", 1] }],
  ])("refuses %s rather than reading it as clean", async (_name, overrides) => {
    const message = await refused(overrides);

    expect(message).toContain("gate_input_invalid");
  });

  it("judges before it looks at the project, so a missing project never hides a refusal", async () => {
    const message = await refused({ projectId: "", risk: "high" });

    expect(message).toContain("risk_not_low");
  });

  it("lets a clean report through, including a category that is known and not a hard one", async () => {
    const builder = fakeBuilder();

    const result = await run(
      "builder.start",
      { ...startFields, categories: ["owner_owned"] },
      builder.deps,
    );

    expect(result).toMatchObject({ ok: true });
    expect(builder.startAgent).toHaveBeenCalledTimes(1);
  });

  it("gates nothing but the start: a check and a follow-up need no gate fields", async () => {
    const builder = fakeBuilder();
    builder.branches.set("factory-group-7", status({ agentState: "running" }));

    expect(await run("builder.check", task, builder.deps)).toMatchObject({
      ok: true,
    });
    expect(
      await run(
        "builder.followUp",
        { ...task, userMessage: "continue" },
        builder.deps,
      ),
    ).toMatchObject({ ok: true });
  });

  it("is in the catalog as six required fields, so a graph cannot leave one out", () => {
    const fields = op("builder.start").fields;
    for (const name of [
      "clearBug",
      "productUxImplications",
      "risk",
      "confidence",
      "alreadyClaimed",
      "categories",
    ]) {
      expect(fields.find((field) => field.name === name)).toMatchObject({
        required: true,
      });
      expect(
        fields.find((field) => field.name === name)?.default,
      ).toBeUndefined();
    }
  });

  it("lists the values that fail first, so a node added from the palette is refused until it is bound", () => {
    const fields = op("builder.start").fields;
    const risk = fields.find((field) => field.name === "risk");
    const confidence = fields.find((field) => field.name === "confidence");

    expect(risk?.enum?.[0]).toBe("unknown");
    expect(confidence?.enum?.[0]).toBe("unknown");
  });
});

describe("the workflow's Builder project", () => {
  it("fills in a blank project and never overrides a named one", async () => {
    const builder = fakeBuilder();
    const deps = { ...builder.deps, projectId: "settings-project" };

    await run("builder.start", { ...startFields, projectId: "" }, deps);
    expect(builder.startAgent).toHaveBeenLastCalledWith(
      expect.objectContaining({ projectId: "settings-project" }),
    );

    await run(
      "builder.start",
      {
        ...startFields,
        branchName: "factory-group-8",
        projectId: "named-project",
      },
      deps,
    );
    expect(builder.startAgent).toHaveBeenLastCalledWith(
      expect.objectContaining({ projectId: "named-project" }),
    );
  });

  it("still refuses to start in no project when neither names one", async () => {
    const builder = fakeBuilder();

    const result = await run(
      "builder.start",
      { ...startFields, projectId: "" },
      { ...builder.deps, projectId: "  " },
    );

    expect(result).toMatchObject({ ok: false, code: "credential_missing" });
    expect(builder.startAgent).not.toHaveBeenCalled();
  });
});

describe("builder.check", () => {
  const at = (minutesAgo: number | null) =>
    minutesAgo === null ? null : NOW.getTime() - minutesAgo * MINUTE;

  it.each<[string, Partial<BuilderBranchStatus>, string]>([
    ["archived", { state: "archived", archived: true }, "failed"],
    ["deleted", { state: "deleted" }, "failed"],
    [
      "archived after its pull request merged",
      {
        state: "archived",
        archived: true,
        prStatus: "merged",
        prUrl: "https://github.com/acme/app/pull/9",
      },
      "completed",
    ],
    ["running", { agentState: "running" }, "working"],
    ["waiting for input", { agentState: "waiting" }, "stuck"],
    [
      "idle with a pull request",
      {
        agentState: "idle",
        prUrl: "https://github.com/acme/app/pull/9",
        prStatus: "open",
      },
      "completed",
    ],
    [
      "idle with no pull request past the window",
      { agentState: "idle", lastActivityAt: at(31) },
      "stuck",
    ],
    [
      "idle with no pull request inside the window",
      { agentState: "idle", lastActivityAt: at(5) },
      "working",
    ],
    [
      "idle with no pull request and no activity time",
      { agentState: "idle", lastActivityAt: null },
      "stuck",
    ],
    [
      "no agent state yet and no activity",
      { agentState: null, lastActivityAt: null },
      "working",
    ],
    [
      "no agent state but a pull request",
      { agentState: null, prUrl: "https://github.com/acme/app/pull/9" },
      "completed",
    ],
  ])("maps %s to %s", async (_label, overrides, expected) => {
    const builder = fakeBuilder();
    builder.branches.set("factory-group-7", status(overrides));
    const result = await run("builder.check", task, builder.deps);
    expect(result).toMatchObject({ ok: true, output: { state: expected } });
    expect(mapBranchState(status(overrides), NOW, window).state).toBe(expected);
  });

  it("reports the pull request and the last activity", async () => {
    const builder = fakeBuilder();
    builder.branches.set(
      "factory-group-7",
      status({
        agentState: "idle",
        prUrl: "https://github.com/acme/app/pull/42",
        prStatus: "approved",
        lastActivityAt: Date.parse("2026-10-18T11:30:00.000Z"),
      }),
    );
    const result = await run("builder.check", task, builder.deps);
    expect(result).toEqual({
      ok: true,
      output: {
        state: "completed",
        reason: "pull_request_open",
        agentState: "idle",
        branchState: "active",
        archived: false,
        prStatus: "approved",
        prUrl: "https://github.com/acme/app/pull/42",
        prNumber: 42,
        prRepository: "acme/app",
        hasPullRequest: true,
        lastActivityAt: "2026-10-18T11:30:00.000Z",
        idleForMs: 30 * MINUTE,
      },
    });
  });

  it("leaves the pull request number and repository empty when the link has none", async () => {
    const builder = fakeBuilder();
    builder.branches.set(
      "factory-group-7",
      status({ prUrl: "https://example.com/review/abc" }),
    );
    const result = await run("builder.check", task, builder.deps);
    expect(result).toMatchObject({
      ok: true,
      output: { hasPullRequest: true, prNumber: null, prRepository: null },
    });
  });

  describe("against the workflow's repository", () => {
    const withPullRequestIn = (prUrl: string, repository?: string) => {
      const builder = fakeBuilder();
      builder.branches.set("factory-group-7", status({ prUrl }));
      return run("builder.check", task, {
        ...builder.deps,
        ...(repository === undefined ? {} : { repository }),
      });
    };

    it("fails typed, handing on no number, when Builder's pull request is in another repository", async () => {
      const result = await withPullRequestIn(
        "https://github.com/other-org/other-app/pull/42",
        "acme/app",
      );

      expect(result).toMatchObject({
        ok: false,
        code: "operation_not_allowed",
        sideEffect: "none",
        retryable: false,
      });
      const { message } = result as { message: string };
      expect(message).toContain("builder_pr_repository_mismatch");
      expect(message).toContain("other-org/other-app");
      expect(message).toContain("acme/app");
    });

    it("passes a pull request in the same repository, however either is written", async () => {
      for (const repository of [
        "acme/app",
        "ACME/App",
        "https://github.com/acme/app",
        "git@github.com:acme/app.git",
      ]) {
        expect(
          await withPullRequestIn(
            "https://github.com/Acme/APP/pull/42",
            repository,
          ),
        ).toMatchObject({
          ok: true,
          output: { prNumber: 42, prRepository: "Acme/APP" },
        });
      }
    });

    it("judges only when both repositories are known", async () => {
      const elsewhere = "https://github.com/other-org/other-app/pull/42";

      for (const repository of [undefined, "", "   ", "not a repository"]) {
        expect(await withPullRequestIn(elsewhere, repository)).toMatchObject({
          ok: true,
          output: { prRepository: "other-org/other-app" },
        });
      }
      expect(
        await withPullRequestIn("https://example.com/review/abc", "acme/app"),
      ).toMatchObject({ ok: true, output: { prRepository: null } });
    });
  });

  it("reads a branch Builder no longer has as failed, and says why", async () => {
    const builder = fakeBuilder();
    const result = await run("builder.check", task, builder.deps);
    expect(result).toMatchObject({
      ok: true,
      output: {
        state: "failed",
        reason: "branch_not_found",
        branchState: "not_found",
        hasPullRequest: false,
      },
    });
  });

  it("honors the configured stuck window", async () => {
    const builder = fakeBuilder();
    builder.branches.set(
      "factory-group-7",
      status({ agentState: "idle", lastActivityAt: at(10) }),
    );
    const tight = await run("builder.check", task, {
      ...builder.deps,
      stuckAfterMs: 5 * MINUTE,
    });
    expect(tight).toMatchObject({ output: { state: "stuck" } });
  });

  it.each<[BuilderBranchErrorCode, string, boolean]>([
    ["not_connected", "credential_missing", false],
    ["unauthorized", "credential_missing", false],
    ["forbidden", "credential_missing", false],
    ["timeout", "lookup_failed", true],
    ["network_error", "lookup_failed", true],
    ["rate_limited", "lookup_failed", true],
    ["server_error", "lookup_failed", true],
    ["invalid_response", "lookup_failed", false],
    ["request_rejected", "lookup_failed", false],
  ])(
    "maps a %s failure to %s (retryable %s), never a side effect",
    async (code, workflowCode, retryable) => {
      const builder = fakeBuilder({ lookupThrows: () => branchError(code) });
      const result = await run("builder.check", task, builder.deps);
      expect(result).toMatchObject({
        ok: false,
        code: workflowCode,
        retryable,
        sideEffect: "none",
      });
      expect((result as { message: string }).message).not.toContain(
        "secret-token",
      );
    },
  );
});

describe("builder.followUp", () => {
  const fields = { ...task, userMessage: "status? continue" };

  it("sends the message and returns the branch as its receipt", async () => {
    const builder = fakeBuilder();
    const result = await run("builder.followUp", fields, builder.deps);
    expect(builder.sendMessage).toHaveBeenCalledWith({
      ...task,
      message: "status? continue",
    });
    expect(result).toEqual({
      ok: true,
      output: { accepted: true, ...task },
      externalRef: "factory-group-7",
    });
  });

  it.each<BuilderBranchErrorCode>([
    "timeout",
    "network_error",
    "incomplete_response",
    "invalid_response",
  ])(
    "is maybe after a %s, because the message may have been delivered",
    async (code) => {
      const builder = fakeBuilder();
      builder.sendMessage.mockRejectedValueOnce(branchError(code, "message"));
      const result = await run("builder.followUp", fields, builder.deps);
      expect(result).toMatchObject({
        ok: false,
        sideEffect: "maybe",
        retryable: false,
      });
    },
  );

  it.each<[BuilderBranchErrorCode, boolean]>([
    ["rate_limited", true],
    ["container_unavailable", true],
    ["server_error", true],
    ["message_rejected", false],
    ["request_rejected", false],
  ])(
    "is none after a %s: the message was not delivered (retryable %s)",
    async (code, retryable) => {
      const builder = fakeBuilder();
      builder.sendMessage.mockRejectedValueOnce(branchError(code, "message"));
      const result = await run("builder.followUp", fields, builder.deps);
      expect(result).toMatchObject({
        ok: false,
        code: "provider_error",
        sideEffect: "none",
        retryable,
      });
    },
  );

  it("maps a missing connection to credential_missing", async () => {
    const builder = fakeBuilder();
    builder.sendMessage.mockRejectedValueOnce(
      branchError("unauthorized", "message"),
    );
    const result = await run("builder.followUp", fields, builder.deps);
    expect(result).toMatchObject({ ok: false, code: "credential_missing" });
    expect((result as { message: string }).message).not.toContain(
      "secret-token",
    );
  });

  it("does not hide a bug behind a typed failure", async () => {
    const builder = fakeBuilder();
    builder.sendMessage.mockRejectedValueOnce(new TypeError("boom"));
    await expect(run("builder.followUp", fields, builder.deps)).rejects.toThrow(
      "boom",
    );
  });

  it("needs a message and a project", async () => {
    const builder = fakeBuilder();
    expect(
      await run("builder.followUp", { ...task, userMessage: "" }, builder.deps),
    ).toMatchObject({ ok: false, code: "graph_invalid" });
    expect(
      await run(
        "builder.followUp",
        { branchName: "b", userMessage: "hi" },
        builder.deps,
      ),
    ).toMatchObject({ ok: false, code: "credential_missing" });
    expect(builder.sendMessage).not.toHaveBeenCalled();
  });
});

describe("a stopped run", () => {
  it("calls nothing once the signal has aborted", async () => {
    const builder = fakeBuilder();
    const controller = new AbortController();
    controller.abort();
    for (const [id, fields] of [
      ["builder.start", startFields],
      ["builder.check", task],
      ["builder.followUp", { ...task, userMessage: "hi" }],
    ] as const) {
      expect(
        await run(id, fields, builder.deps, controller.signal),
      ).toMatchObject({ ok: false, code: "budget_paused", sideEffect: "none" });
    }
    expect(builder.getStatus).not.toHaveBeenCalled();
    expect(builder.startAgent).not.toHaveBeenCalled();
    expect(builder.sendMessage).not.toHaveBeenCalled();
  });
});

// The Builder tripwires. Each case runs with a capturing sink and without one,
// and the two results must be equal: recording is observe-only.
describe("builder tripwires", () => {
  const SECRET = "xoxb-FAKE-0000-aaaaaaaaaaaa";

  function observed(
    operationId: string,
    fields: Record<string, unknown>,
    builder: ReturnType<typeof fakeBuilder>,
    tripwire?: TripwireSink,
  ) {
    return executeBuilderOperation({
      operation: op(operationId),
      fields,
      owner: "owner@example.com",
      signal: new AbortController().signal,
      tripwire,
      deps: builder.deps,
    });
  }

  it("records the queue fact of an accepted follow-up, and only the shape of Builder's reply", async () => {
    const fields = { ...task, userMessage: "status? continue" };
    const reply = { accepted: true as const, note: SECRET };
    const replying = () => {
      const builder = fakeBuilder();
      builder.sendMessage.mockResolvedValueOnce(reply);
      return builder;
    };
    const { sink, events } = createCapturingTripwireSink();

    const withSink = await observed(
      "builder.followUp",
      fields,
      replying(),
      sink,
    );

    const stored = sanitizeDetails(events[0].details);
    expect(JSON.stringify(stored.fields)).not.toContain(SECRET);
    expect(withSink).toEqual(
      await observed("builder.followUp", fields, replying()),
    );
  });

  it("records the branch Builder started a task under when it differs, and scrubs it", async () => {
    const renamed = `factory-group-7-${SECRET}`;
    const renaming = () => {
      const builder = fakeBuilder();
      builder.startAgent.mockImplementationOnce(async () => ({
        branchName: renamed,
        projectId: "proj-1",
        url: "https://builder.io/app/projects/proj-1/renamed",
        status: "processing",
      }));
      return builder;
    };
    const { sink, events } = createCapturingTripwireSink();

    const withSink = await observed(
      "builder.start",
      startFields,
      renaming(),
      sink,
    );

    const stored = sanitizeDetails(events[1].details);
    expect(stored.fields).toEqual({
      requestedBranch: "factory-group-7",
      returnedBranch: "factory-group-7-[redacted]",
    });
    expect(withSink).toMatchObject({ ok: true, externalRef: renamed });
    expect(withSink).toEqual(
      await observed("builder.start", startFields, renaming()),
    );
  });

  it("records a start Builder failed with a status, and fails as it does without a sink", async () => {
    const failing = () =>
      fakeBuilder({
        startThrows: () =>
          Object.assign(new Error(`Builder request failed with ${SECRET}`), {
            builderStatus: 502,
          }),
      });
    const { sink, events } = createCapturingTripwireSink();

    const withSink = await observed(
      "builder.start",
      startFields,
      failing(),
      sink,
    );

    const stored = sanitizeDetails(events[0].details);
    expect(JSON.stringify(stored.fields)).not.toContain(SECRET);
    expect(withSink).toMatchObject({
      ok: false,
      sideEffect: "none",
      retryable: false,
    });
    expect(withSink).toEqual(
      await observed("builder.start", startFields, failing()),
    );
  });

  it("records the status core carries on a refusal whose text names none, for every status", async () => {
    const refusing = (message: string, builderStatus: number) =>
      fakeBuilder({
        startThrows: () => Object.assign(new Error(message), { builderStatus }),
      });

    for (const status of [403, 404, 429, 500]) {
      const { sink, events } = createCapturingTripwireSink();

      await observed(
        "builder.start",
        startFields,
        refusing(`Not allowed ${SECRET}`, status),
        sink,
      );

      expect(
        JSON.stringify(sanitizeDetails(events[0].details).fields),
      ).not.toContain(SECRET);
    }
  });

  it("records an error when Builder refuses a start over a feature", async () => {
    const refusing = (message: string, builderStatus?: number) =>
      fakeBuilder({
        startThrows: () =>
          Object.assign(
            new Error(message),
            builderStatus === undefined ? {} : { builderStatus },
          ),
      });
    // Builder's own error text need not carry a status, so the feature words name the refusal.
    const scenarios = [
      {
        message: `The Background Agents feature is not enabled for this project ${SECRET}`,
        status: null,
        words: "background_agents,feature,enabled",
      },
      {
        message: `Feature not available on your plan ${SECRET}`,
        status: 403,
        words: "feature,available,plan",
      },
    ];

    for (const scenario of scenarios) {
      const { sink, events } = createCapturingTripwireSink();

      const withSink = await observed(
        "builder.start",
        startFields,
        refusing(scenario.message, scenario.status ?? undefined),
        sink,
      );

      const stored = sanitizeDetails(events[1].details);
      expect(JSON.stringify(stored.fields)).not.toContain(SECRET);
      expect(withSink).toEqual(
        await observed(
          "builder.start",
          startFields,
          refusing(scenario.message, scenario.status ?? undefined),
        ),
      );
    }
  });

  it("records the gate clauses that refused a start, by name, and starts nothing", async () => {
    const fields = { ...startFields, risk: "high", categories: [SECRET] };
    const builder = fakeBuilder();
    const { sink, events } = createCapturingTripwireSink();

    const withSink = await observed("builder.start", fields, builder, sink);

    const stored = sanitizeDetails(events[0].details);
    expect(JSON.stringify(stored.fields)).not.toContain(SECRET);
    expect(builder.getStatus).not.toHaveBeenCalled();
    expect(builder.startAgent).not.toHaveBeenCalled();
    expect(withSink).toMatchObject({
      ok: false,
      code: "operation_not_allowed",
      sideEffect: "none",
      retryable: false,
    });
    expect(withSink).toEqual(
      await observed("builder.start", fields, fakeBuilder()),
    );
  });

  it("records only the queue fact for a clean start, and nothing unexpected", async () => {
    const { sink } = createCapturingTripwireSink();

    const withSink = await observed(
      "builder.start",
      startFields,
      fakeBuilder(),
      sink,
    );

    expect(withSink).toMatchObject({ ok: true });
    expect(withSink).toEqual(
      await observed("builder.start", startFields, fakeBuilder()),
    );
  });
});
