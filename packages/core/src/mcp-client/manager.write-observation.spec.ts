import { afterEach, describe, expect, it, vi } from "vitest";

import { McpClientManager } from "./manager.js";

// A tool call on a remote MCP server leaves the framework's sight once it is
// sent, so the manager reports it right before the call and only after the
// tool's authorization has passed and the server has not been swapped out.
const mocks = vi.hoisted(() => ({
  noteExternalWrite: vi.fn(),
}));

vi.mock("../action.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../action.js")>()),
  noteExternalWrite: mocks.noteExternalWrite,
}));

const fake = vi.hoisted(() => {
  const callTool = vi.fn(async () => ({
    content: [{ type: "text", text: "ok" }],
  }));
  const tools = [
    { name: "search", inputSchema: { type: "object" } },
    { name: "mutate", inputSchema: { type: "object" } },
  ];

  class FakeStdio {
    onerror?: (error: unknown) => void;
    constructor(readonly options: unknown) {}
    close() {}
  }

  class FakeClient {
    onerror?: (error: unknown) => void;
    constructor(
      readonly info: unknown,
      readonly capabilities: unknown,
    ) {}
    async connect(_transport: unknown) {}
    async listTools() {
      return { tools };
    }
    callTool = callTool;
    async close() {}
  }

  return { callTool, FakeClient, FakeStdio };
});

vi.mock("@modelcontextprotocol/client", () => ({
  Client: fake.FakeClient,
  StreamableHTTPClientTransport: class {},
}));

vi.mock("@modelcontextprotocol/client/stdio", () => ({
  StdioClientTransport: fake.FakeStdio,
}));

function callOrder(
  spy: { mock: { invocationCallOrder: number[] } },
  index = 0,
): number {
  const order = spy.mock.invocationCallOrder[index];
  if (order === undefined) {
    throw new Error(`Expected call ${index} to be recorded.`);
  }
  return order;
}

function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

async function startManager(command: string): Promise<McpClientManager> {
  const mgr = new McpClientManager({
    servers: { docs: { command } },
  });
  await mgr.start();
  return mgr;
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("McpClientManager write observation", () => {
  it("notes the mcp write after authorization and before the tool call", async () => {
    const mgr = await startManager("docs-bin");
    const authorize = vi.fn(async () => true);
    mgr.setToolAuthorizationResolver(() => authorize);

    await mgr.callTool("mcp__docs__search", { q: "x" });

    expect(mocks.noteExternalWrite).toHaveBeenCalledTimes(1);
    expect(mocks.noteExternalWrite).toHaveBeenCalledWith("mcp");
    expect(fake.callTool).toHaveBeenCalledWith({
      name: "search",
      arguments: { q: "x" },
    });
    expect(callOrder(authorize)).toBeLessThan(
      callOrder(mocks.noteExternalWrite),
    );
    expect(callOrder(mocks.noteExternalWrite)).toBeLessThan(
      callOrder(fake.callTool),
    );
  });

  it("does not note or call a tool that authorization denies", async () => {
    const mgr = await startManager("docs-bin");
    mgr.setToolAuthorizationResolver(() => async () => false);

    await expect(
      mgr.callTool("mcp__docs__mutate", { recordId: "record-1" }),
    ).rejects.toMatchObject({ name: "ForbiddenError", statusCode: 403 });

    expect(mocks.noteExternalWrite).not.toHaveBeenCalled();
    expect(fake.callTool).not.toHaveBeenCalled();
  });

  it("does not note a call whose server changed while it was authorizing", async () => {
    const mgr = await startManager("docs-bin");
    const authorizing = deferred<void>();
    const verdict = deferred<boolean>();
    mgr.setToolAuthorizationResolver(() => async () => {
      authorizing.resolve();
      return verdict.promise;
    });

    const call = mgr.callTool("mcp__docs__mutate", {});
    await authorizing.promise;
    await mgr.reconfigure({
      servers: { docs: { command: "replacement-bin" } },
    });
    verdict.resolve(true);

    await expect(call).rejects.toThrow(
      'MCP server "docs" changed while authorizing tool "mutate"',
    );
    expect(mocks.noteExternalWrite).not.toHaveBeenCalled();
    expect(fake.callTool).not.toHaveBeenCalled();
  });
});
