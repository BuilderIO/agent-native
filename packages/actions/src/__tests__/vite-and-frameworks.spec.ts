import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createServer as createViteServer } from "vite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { createActionClient } from "../client.js";
import { createActions, defineAction } from "../index.js";
import { createPagesHandler } from "../next-pages.js";
import { createNextActionHandler, createNextMcpHandler } from "../next.js";
import agentNativeActionsNuxtModule from "../nuxt.js";
import {
  callSvelteKitAction,
  createSvelteKitHandler,
} from "../svelte-server.js";
import { agentNativeActionsPlugin } from "../vite.js";
import { createNitroHandler } from "../vue-server.js";
import { registerWebMcpTools } from "../webmcp.js";

const tmpDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop();
    if (dir && fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
  vi.restoreAllMocks();
});

function createSampleRegistry() {
  const greet = defineAction({
    description: "Greet a user",
    schema: z.object({ name: z.string().default("world") }),
    http: { method: "GET" },
    readOnly: true,
    run: async ({ name }, ctx) => ({
      message: `Hello, ${name}!`,
      caller: ctx.caller,
      platform: (ctx as { platform?: unknown }).platform ?? null,
    }),
  });

  const echo = defineAction({
    description: "Echo a payload",
    schema: z.object({ text: z.string() }),
    run: async ({ text }) => ({ echoed: text }),
  });

  const secret = defineAction({
    description: "Hidden from MCP",
    mcpTool: false,
    http: { method: "GET" },
    run: async () => ({ secret: true }),
  });

  return createActions({
    actions: { greet, echo, secret },
    createContext: ({ caller, headers, platform }) => ({
      caller,
      source: caller,
      headers,
      platform,
    }),
  });
}

describe("Vite plugin real dev server + HMR + virtual module", () => {
  it("serves HTTP actions and MCP inside a real Vite dev server and reloads edited actions", async () => {
    const root = makeTempDir("an-actions-vite-");
    fs.mkdirSync(path.join(root, "actions"), { recursive: true });
    const actionsIndexUrl = path.resolve(import.meta.dirname, "../index.ts");
    const zodEntryUrl = fileURLToPath(import.meta.resolve("zod"));

    const writeHello = (prefix: string) => {
      fs.writeFileSync(
        path.join(root, "actions/hello.ts"),
        [
          `import { defineAction } from ${JSON.stringify(actionsIndexUrl)};`,
          'import { z } from "zod";',
          "export default defineAction({",
          '  description: "Say hello",',
          "  schema: z.object({ name: z.string().default('world') }),",
          '  http: { method: "GET" },',
          "  readOnly: true,",
          `  run: async ({ name }) => ({ greeting: \`${prefix}, \${name}!\` }),`,
          "});",
          "",
        ].join("\n"),
        "utf8",
      );
    };

    writeHello("Hi");

    const server = await createViteServer({
      root,
      configFile: false,
      logLevel: "silent",
      server: { port: 0, host: "127.0.0.1" },
      resolve: {
        alias: {
          "@agent-native/actions": actionsIndexUrl,
          zod: zodEntryUrl,
        },
      },
      plugins: [agentNativeActionsPlugin()],
    });

    try {
      await server.listen();
      const address = server.httpServer?.address();
      if (!address || typeof address === "string") {
        throw new Error("Expected Vite HTTP TCP address");
      }
      const base = `http://127.0.0.1:${address.port}`;

      expect(fs.existsSync(path.join(root, ".generated/actions.ts"))).toBe(
        true,
      );
      expect(
        fs.existsSync(path.join(root, ".generated/action-types.d.ts")),
      ).toBe(true);

      const res1 = await fetch(
        `${base}/api/agent-native/actions/hello?name=Steve`,
      );
      expect(res1.status).toBe(200);
      expect(await res1.json()).toEqual({ greeting: "Hi, Steve!" });

      const mcpRes = await fetch(`${base}/api/agent-native/mcp`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/list",
        }),
      });
      expect(mcpRes.status).toBe(200);
      expect(await mcpRes.text()).toContain("hello");

      writeHello("Updated");
      const actionMod = server.moduleGraph.getModuleById(
        path.join(root, "actions/hello.ts"),
      );
      if (actionMod) server.moduleGraph.invalidateModule(actionMod);
      const virtualMod = server.moduleGraph.getModuleById(
        "\0virtual:agent-native/actions",
      );
      if (virtualMod) server.moduleGraph.invalidateModule(virtualMod);

      const res2 = await fetch(
        `${base}/api/agent-native/actions/hello?name=Steve`,
      );
      expect(res2.status).toBe(200);
      expect(await res2.json()).toEqual({ greeting: "Updated, Steve!" });
    } finally {
      await server.close();
    }
  }, 20_000);
});

describe("SvelteKit, Nuxt/Nitro, Next split & Pages Router, and WebMCP adapters", () => {
  it("routes SvelteKit catch-all params, platform context, and direct callSvelteKitAction", async () => {
    const actions = createSampleRegistry();
    const handlers = createSvelteKitHandler(actions);

    const getRes = await handlers.GET({
      request: new Request(
        "https://app.test/api/agent-native/actions/greet?name=Svelte",
      ),
      params: { path: "actions/greet" },
      platform: { region: "us-west" },
    });
    expect(getRes.status).toBe(200);
    expect(await getRes.json()).toEqual({
      message: "Hello, Svelte!",
      caller: "http",
      platform: { region: "us-west" },
    });

    const direct = await callSvelteKitAction(
      actions,
      "greet",
      { name: "ServerLoad" },
      {
        request: new Request("https://app.test/todos"),
        platform: { edge: true },
      },
    );
    expect(direct).toEqual({
      message: "Hello, ServerLoad!",
      caller: "server",
      platform: { edge: true },
    });
  });

  it("runs Nuxt module hooks for codegen and handles both Web and Node Nitro events", async () => {
    const root = makeTempDir("an-actions-nuxt-");
    fs.mkdirSync(path.join(root, "actions"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "actions/hello.ts"),
      "export default {};\n",
    );

    const hooks: Record<string, () => void | Promise<void>> = {};
    agentNativeActionsNuxtModule(
      {},
      {
        options: { rootDir: root },
        hook: (name, fn) => {
          hooks[name] = fn;
        },
      },
    );
    expect(fs.existsSync(path.join(root, ".generated/actions.ts"))).toBe(true);
    expect(Object.keys(hooks)).toEqual(
      expect.arrayContaining(["prepare:types", "build:before"]),
    );

    fs.writeFileSync(
      path.join(root, "actions/second.ts"),
      "export default {};\n",
    );
    await hooks["build:before"]?.();
    expect(
      fs.readFileSync(path.join(root, ".generated/actions.ts"), "utf8"),
    ).toContain('"second"');

    const actions = createSampleRegistry();
    const nitroHandler = createNitroHandler(actions);
    const webRes = await nitroHandler({
      req: new Request("https://app.test/api/agent-native/actions/echo", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: "nitro-web" }),
      }),
    });
    expect(webRes?.status).toBe(200);
    expect(await webRes?.json()).toEqual({ echoed: "nitro-web" });

    const server = http.createServer((req, res) => {
      void nitroHandler({ node: { req, res } });
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    try {
      const addr = server.address();
      if (!addr || typeof addr === "string") throw new Error("Expected port");
      const nodeRes = await fetch(
        `http://127.0.0.1:${addr.port}/api/agent-native/actions/greet?name=NitroNode`,
      );
      expect(nodeRes.status).toBe(200);
      expect(await nodeRes.json()).toMatchObject({
        message: "Hello, NitroNode!",
      });
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("supports Next.js split HTTP/MCP handlers and Pages Router adapter", async () => {
    const actions = createSampleRegistry();
    const httpHandlers = createNextActionHandler(actions);
    const mcpHandlers = createNextMcpHandler(actions, {
      authenticate: (req) => req.headers.get("authorization") === "Bearer ok",
    });

    const httpRes = await httpHandlers.POST(
      new Request("https://app.test/api/agent-native/actions/echo", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: "split" }),
      }),
      { params: Promise.resolve({ action: ["echo"] }) },
    );
    expect(httpRes.status).toBe(200);
    expect(await httpRes.json()).toEqual({ echoed: "split" });

    const unauthMcp = await mcpHandlers.POST(
      new Request("https://app.test/api/agent-native/mcp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      }),
    );
    expect(unauthMcp.status).toBe(401);

    const pagesHandler = createPagesHandler(actions);
    const server = http.createServer((req, res) => {
      void pagesHandler(req, res);
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    try {
      const addr = server.address();
      if (!addr || typeof addr === "string") throw new Error("Expected port");
      const res = await fetch(
        `http://127.0.0.1:${addr.port}/api/agent-native/actions/greet?name=Pages`,
      );
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ message: "Hello, Pages!" });
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("registers allowlisted WebMCP tools with both options-only and explicit-client overloads", async () => {
    const actions = createSampleRegistry();
    const registeredTools: Array<{
      name: string;
      execute: (input: Record<string, unknown>) => Promise<unknown>;
    }> = [];

    const mockFetch: typeof fetch = (input, init) =>
      actions.handler(new Request(input, init));

    vi.stubGlobal("navigator", {
      modelContext: {
        registerTool: (tool: {
          name: string;
          execute: (input: Record<string, unknown>) => Promise<unknown>;
        }) => {
          registeredTools.push(tool);
        },
      },
    });
    vi.stubGlobal("fetch", mockFetch);

    const r1 = await registerWebMcpTools({
      baseUrl: "https://app.test/api/agent-native/actions",
      include: ["greet", "secret"],
    });
    expect(r1.registered).toEqual(["greet"]);
    const greetResult = await registeredTools[0]?.execute({ name: "WebMCP" });
    expect(greetResult).toMatchObject({ message: "Hello, WebMCP!" });

    registeredTools.length = 0;
    const client = createActionClient<typeof actions>({
      baseUrl: "https://app.test/api/agent-native/actions",
      fetch: mockFetch,
    });
    const r2 = await registerWebMcpTools(client, {
      include: ["echo", "secret"],
      metadata: actions.describe(),
    });
    expect(r2.registered).toEqual(["echo"]);
    expect(
      await registeredTools[0]?.execute({ text: "browser-agent" }),
    ).toEqual({ echoed: "browser-agent" });
  });
});
