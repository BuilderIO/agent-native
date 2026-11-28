import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { runActionCli } from "../cli.js";
import {
  ActionClientError,
  actionErrorMessage,
  createActionClient,
} from "../client.js";
import {
  ActionError,
  ActionPostCommitError,
  createActionBuilder,
  createActions,
  defineAction,
  defineActionErrors,
  fail,
  generateActionArtifacts,
  isActionError,
  isActionPostCommitError,
  toAiSdkTools,
  toAnthropicTools,
  toNodeHandler,
  toOpenAiTools,
} from "../index.js";
import { withAgentNativeActions } from "../next-config.js";
import {
  callNextAction,
  parseFormData,
  runFormAction,
} from "../next-server.js";
import { createNextHandler } from "../next.js";

const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir && fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

interface TestUserContext {
  caller: string;
  user: { id: string; role: "admin" | "member" } | null;
}

const defineAppAction = createActionBuilder<TestUserContext>();

function createTestRegistry() {
  const todos: Array<{
    id: string;
    title: string;
    done: boolean;
    ownerId: string;
  }> = [{ id: "t1", title: "Draft docs", done: false, ownerId: "u1" }];
  const afterMutateCalls: string[] = [];

  const todoErrors = defineActionErrors("not_found", "duplicate_title");

  const listTodos = defineAppAction({
    description: "List todos",
    schema: z.object({
      done: z.boolean().optional(),
      tags: z.array(z.string()).optional(),
    }),
    http: { method: "GET" },
    readOnly: true,
    run: async ({ done }, ctx) => {
      if (!ctx.user) {
        fail("Sign in required.", {
          statusCode: 401,
          errorCode: "unauthorized",
        });
      }
      return todos.filter(
        (t) =>
          t.ownerId === ctx.user?.id &&
          (done === undefined ? true : t.done === done),
      );
    },
  });

  const createTodo = defineAppAction({
    description: "Create a new todo",
    schema: z.object({
      title: z.string().min(1),
      priority: z.enum(["low", "high"]).optional(),
    }),
    outputSchema: z.object({
      id: z.string(),
      title: z.string(),
      done: z.boolean(),
      ownerId: z.string(),
    }),
    authorize: (_input, ctx) => Boolean(ctx.user),
    run: async ({ title }, ctx) => {
      if (todos.some((t) => t.title === title)) {
        todoErrors.fail("Todo already exists.", "duplicate_title", {
          statusCode: 409,
          details: { title },
        });
      }
      const created = {
        id: `t${todos.length + 1}`,
        title,
        done: false,
        ownerId: ctx.user?.id ?? "unknown",
      };
      todos.push(created);
      return created;
    },
  });

  const deleteTodo = defineAppAction({
    description: "Permanently delete a todo",
    schema: z.object({ id: z.string() }),
    destructive: true,
    needsApproval: true,
    authorize: (_input, ctx) => ctx.user?.role === "admin",
    run: async ({ id }) => {
      const idx = todos.findIndex((t) => t.id === id);
      if (idx === -1) {
        todoErrors.fail("Todo not found.", "not_found", {
          statusCode: 404,
          details: { id },
        });
      }
      todos.splice(idx, 1);
      return { deletedId: id };
    },
  });

  const internalUiOnly = defineAppAction({
    description: "Internal UI helper",
    mcpTool: false,
    agentTool: false,
    http: { method: "GET" },
    run: async () => ({ ok: true }),
  });

  const brokenOutputAction = defineAppAction({
    description: "Returns invalid output after mutating",
    outputSchema: z.object({ id: z.string() }),
    run: async () => ({ wrongKey: 123 }) as unknown as { id: string },
  });

  const actions = createActions({
    actions: {
      "list-todos": listTodos,
      "create-todo": createTodo,
      "delete-todo": deleteTodo,
      "internal-ui-only": internalUiOnly,
      "broken-output": brokenOutputAction,
    },
    createContext: ({ caller, headers }): TestUserContext => {
      const roleHeader = headers.get("x-test-role");
      const userId = headers.get("x-test-user");
      return {
        caller,
        user: userId
          ? { id: userId, role: roleHeader === "admin" ? "admin" : "member" }
          : null,
      };
    },
    verifyApproval: ({ approvalToken }) =>
      approvalToken === "valid-approval-grant",
    onAfterMutate: ({ name }) => {
      afterMutateCalls.push(name);
    },
  });

  return { actions, todos, afterMutateCalls };
}

describe("core action execution pipeline", () => {
  it("validates inputs, enforces authorize before approval/run, and fires onAfterMutate", async () => {
    const { actions, afterMutateCalls } = createTestRegistry();

    const created = await actions.call(
      "create-todo",
      { title: "Ship package" },
      { ctx: { caller: "server", user: { id: "u1", role: "member" } } },
    );
    expect(created.title).toBe("Ship package");
    expect(afterMutateCalls).toEqual(["create-todo"]);

    await expect(
      actions.call(
        "delete-todo",
        { id: "t1" },
        { ctx: { caller: "server", user: { id: "u1", role: "member" } } },
      ),
    ).rejects.toMatchObject({ statusCode: 403, errorCode: "forbidden" });

    await expect(
      actions.call(
        "delete-todo",
        { id: "t1" },
        { ctx: { caller: "server", user: { id: "u1", role: "admin" } } },
      ),
    ).rejects.toMatchObject({
      statusCode: 403,
      errorCode: "approval_required",
    });

    const deleted = await actions.call(
      "delete-todo",
      { id: "t1" },
      {
        ctx: { caller: "server", user: { id: "u1", role: "admin" } },
        approvalToken: "valid-approval-grant",
      },
    );
    expect(deleted).toEqual({ deletedId: "t1" });
  });

  it("raises ActionPostCommitError (committed: true) when outputSchema fails after run()", async () => {
    const { actions } = createTestRegistry();
    const caught = await actions
      .call(
        "broken-output",
        {},
        { ctx: { caller: "server", user: { id: "u1", role: "admin" } } },
      )
      .then(
        () => undefined,
        (err: unknown) => err,
      );
    expect(isActionError(caught)).toBe(true);
    expect(isActionPostCommitError(caught)).toBe(true);
    expect((caught as ActionPostCommitError).committed).toBe(true);
    expect((caught as ActionError).errorCode).toBe("post_commit_error");
  });

  it("normalizes LLM null-padded optional fields on agent/mcp calls", async () => {
    const { actions } = createTestRegistry();
    const result = await actions.invokeWithContext(
      "create-todo",
      { title: "From LLM", priority: null },
      { caller: "agent", user: { id: "u1", role: "member" } },
      { caller: "agent" },
    );
    expect(result).toMatchObject({ title: "From LLM" });
  });
});

describe("HTTP handler, CSRF, client, and Node adapter", () => {
  it("handles GET lossless ?input=JSON, POST mutations, 405, CSRF, and client errors", async () => {
    const { actions } = createTestRegistry();

    const getRes = await actions.handler(
      new Request(
        `https://app.test/api/agent-native/actions/list-todos?input=${encodeURIComponent(JSON.stringify({ done: false }))}`,
        { headers: { "x-test-user": "u1" } },
      ),
    );
    expect(getRes.status).toBe(200);
    expect(getRes.headers.get("cache-control")).toBe("no-store");
    expect(await getRes.json()).toHaveLength(1);

    const methodRes = await actions.handler(
      new Request("https://app.test/api/agent-native/actions/create-todo", {
        method: "GET",
        headers: { "x-test-user": "u1" },
      }),
    );
    expect(methodRes.status).toBe(405);

    const csrfRes = await actions.handler(
      new Request("https://app.test/api/agent-native/actions/create-todo", {
        method: "POST",
        headers: {
          cookie: "session=abc",
          origin: "https://evil.example",
          "content-type": "application/json",
        },
        body: JSON.stringify({ title: "CSRF" }),
      }),
    );
    expect(csrfRes.status).toBe(403);
    expect(await csrfRes.json()).toMatchObject({
      errorCode: "csrf_origin_mismatch",
    });

    const client = createActionClient<typeof actions>({
      baseUrl: "https://app.test/api/agent-native/actions",
      fetch: (input, init) => actions.handler(new Request(input, init)),
      headers: { "x-test-user": "u1" },
      methods: actions.httpMethodMap(),
    });

    const list = await client.call("list-todos", { done: false });
    expect(list).toHaveLength(1);

    await expect(
      client.call("create-todo", { title: "Draft docs" }),
    ).rejects.toSatisfy((err: unknown) => {
      expect(err).toBeInstanceOf(ActionClientError);
      expect((err as ActionClientError).statusCode).toBe(409);
      expect((err as ActionClientError).errorCode).toBe("duplicate_title");
      expect(actionErrorMessage(err)).toBe("Todo already exists.");
      return true;
    });
  });

  it("runs cleanly behind node:http via toNodeHandler", async () => {
    const { actions } = createTestRegistry();
    const nodeHandler = toNodeHandler(actions.handler);
    const server = http.createServer((req, res) => {
      void nodeHandler(req, res);
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );

    try {
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("Expected TCP address");
      }
      const res = await fetch(
        `http://127.0.0.1:${address.port}/api/agent-native/actions/create-todo`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-test-user": "u1",
          },
          body: JSON.stringify({ title: "Via node:http" }),
        },
      );
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ title: "Via node:http" });
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

describe("MCP Streamable HTTP & AI SDK adapters", () => {
  it("lists exposed tools with annotations, hides mcpTool: false, and executes tool calls", async () => {
    const { actions } = createTestRegistry();
    const mcpHandler = actions.createHandler({
      mcp: {
        name: "test-todos",
        authenticate: (req) =>
          req.headers.get("authorization") === "Bearer secret-key",
      },
    });

    const unauth = await mcpHandler(
      new Request("https://app.test/api/agent-native/mcp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      }),
    );
    expect(unauth.status).toBe(401);

    const listRes = await mcpHandler(
      new Request("https://app.test/api/agent-native/mcp", {
        method: "POST",
        headers: {
          authorization: "Bearer secret-key",
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      }),
    );
    expect(listRes.status).toBe(200);
    const listText = await listRes.text();
    expect(listText).toContain("create-todo");
    expect(listText).toContain("list-todos");
    expect(listText).not.toContain("internal-ui-only");
  });

  it("exports tools for Vercel AI SDK, Anthropic SDK, and OpenAI SDK", async () => {
    const { actions } = createTestRegistry();
    const ctx: TestUserContext = {
      caller: "agent",
      user: { id: "u1", role: "member" },
    };

    const aiTools = toAiSdkTools(actions, {
      context: ctx,
      only: ["create-todo"],
    });
    expect(Object.keys(aiTools)).toEqual(["create-todo"]);
    const created = await aiTools["create-todo"]?.execute({
      title: "From AI SDK",
    });
    expect(created).toMatchObject({ title: "From AI SDK" });

    const anthropic = toAnthropicTools(actions, { context: ctx });
    expect(anthropic.tools.map((t) => t.name)).not.toContain(
      "internal-ui-only",
    );
    const toolResult = await anthropic.executeToolUse({
      id: "tu_1",
      name: "list-todos",
      input: { done: false },
    });
    expect(toolResult.is_error).toBeUndefined();
    expect(JSON.parse(toolResult.content)).toHaveLength(2);

    const openai = toOpenAiTools(actions, { context: ctx });
    const oaiResult = await openai.executeToolCall({
      id: "call_1",
      function: {
        name: "create-todo",
        arguments: JSON.stringify({ title: "From OpenAI SDK" }),
      },
    });
    expect(JSON.parse(oaiResult.content)).toMatchObject({
      title: "From OpenAI SDK",
    });
  });
});

describe("Next.js adapter, codegen, and CLI", () => {
  it("routes Next.js catch-all params, guards RSC mutations, and parses FormData", async () => {
    const { actions } = createTestRegistry();
    const handlers = createNextHandler(actions);

    const res = await handlers.GET(
      new Request("https://app.test/api/agent-native/actions/list-todos", {
        headers: { "x-test-user": "u1" },
      }),
      { params: Promise.resolve({ path: ["actions", "list-todos"] }) },
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toHaveLength(1);

    await expect(
      callNextAction(actions, "create-todo", { title: "Bad RSC mutation" }),
    ).rejects.toMatchObject({ errorCode: "mutation_in_render" });

    const fd = new FormData();
    fd.append("title", "From FormData");
    const parsed = parseFormData(fd);
    expect(parsed).toEqual({ title: "From FormData" });

    const created = await runFormAction(actions, "create-todo", fd, {
      headers: { "x-test-user": "u1" },
    });
    expect(created).toMatchObject({ title: "From FormData" });
  });

  it("runs deterministic codegen, next config wrapper, and CLI init/inspect/run", async () => {
    const dir = makeTempDir("an-actions-cli-");
    fs.writeFileSync(
      path.join(dir, "package.json"),
      JSON.stringify({ name: "sample-next", dependencies: { next: "16.0.0" } }),
    );

    expect(await runActionCli(["init", "--cwd", dir, "--dry-run"])).toBe(0);
    expect(fs.existsSync(path.join(dir, "actions/hello.ts"))).toBe(false);

    expect(await runActionCli(["init", "--cwd", dir])).toBe(0);
    expect(fs.existsSync(path.join(dir, "actions/hello.ts"))).toBe(true);
    expect(
      fs.existsSync(path.join(dir, "app/api/agent-native/[...path]/route.ts")),
    ).toBe(true);
    expect(fs.existsSync(path.join(dir, ".generated/actions.ts"))).toBe(true);
    expect(fs.existsSync(path.join(dir, ".generated/action-types.d.ts"))).toBe(
      true,
    );

    const cfg = withAgentNativeActions(
      { reactStrictMode: true },
      { projectRoot: dir },
    );
    expect(cfg).toEqual({ reactStrictMode: true });

    fs.writeFileSync(path.join(dir, "actions/hello.js"), "export default {};");
    expect(() => generateActionArtifacts({ projectRoot: dir })).toThrow(
      /Action "hello"/,
    );
    fs.rmSync(path.join(dir, "actions/hello.js"));

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const code = await runActionCli([
        "hello",
        "--cwd",
        dir,
        "--name",
        "Steve",
      ]);
      expect(code).toBe(0);
      expect(logSpy).toHaveBeenCalledWith(
        JSON.stringify({ message: "Hello, Steve!" }, null, 2),
      );
    } finally {
      logSpy.mockRestore();
    }
  });
});

describe("standalone defineAction compatibility", () => {
  it("works with zero custom context setup", async () => {
    const ping = defineAction({
      description: "Simple ping",
      schema: z.object({ msg: z.string().default("pong") }),
      http: { method: "GET" },
      readOnly: true,
      run: async ({ msg }) => ({ reply: msg }),
    });
    const registry = createActions({ actions: { ping } });
    expect(await registry.call("ping", { msg: "hi" })).toEqual({ reply: "hi" });
  });
});
