import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { runActionCli } from "../cli.js";
import {
  coerceGatewayStringifiedArgs,
  normalizeLlmToolInput,
  schemaToJsonSchema,
} from "../contract.js";
import { createActions, defineAction, toNodeHandler } from "../index.js";

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

describe("CLI init framework detection and next-step hints", () => {
  it.each([
    {
      name: "sveltekit",
      deps: { "@sveltejs/kit": "^2.0.0", vite: "^6.0.0" },
      expectedRoute: "src/routes/api/agent-native/[...path]/+server.ts",
      expectedHint: "agentNativeActionsPlugin({ devMiddleware: false })",
    },
    {
      name: "nuxt",
      deps: { nuxt: "^3.15.0" },
      expectedRoute: "server/api/agent-native/[...path].ts",
      expectedHint: '"@agent-native/actions/nuxt"',
    },
    {
      name: "vite",
      deps: { vite: "^6.0.0" },
      expectedRoute: null,
      expectedHint: "agentNativeActionsPlugin()",
    },
    {
      name: "next",
      deps: { next: "^16.0.0" },
      expectedRoute: "app/api/agent-native/[...path]/route.ts",
      expectedHint: "withAgentNativeActions()",
    },
  ])(
    "scaffolds $name and prints accurate dependency + config hints",
    async ({ deps, expectedRoute, expectedHint }) => {
      const dir = makeTempDir("an-init-fw-");
      fs.writeFileSync(
        path.join(dir, "package.json"),
        JSON.stringify({ name: "fixture", dependencies: deps }, null, 2),
      );
      fs.writeFileSync(path.join(dir, "pnpm-lock.yaml"), "");

      const errLogs: string[] = [];
      vi.spyOn(console, "error").mockImplementation((...args) => {
        errLogs.push(args.join(" "));
      });

      const code = await runActionCli(["init", "--cwd", dir]);
      expect(code).toBe(0);

      expect(
        expectedRoute === null || fs.existsSync(path.join(dir, expectedRoute)),
      ).toBe(true);

      const combined = errLogs.join("\n");
      expect(combined).toContain("pnpm add @agent-native/actions zod");
      expect(combined).toContain(expectedHint);
    },
  );

  it.each([
    {
      name: "a package-lock.json",
      files: { "package-lock.json": "{}" },
      pkg: {},
      expected: "npm install @agent-native/actions zod",
    },
    {
      name: "a yarn.lock",
      files: { "yarn.lock": "" },
      pkg: {},
      expected: "yarn add @agent-native/actions zod",
    },
    {
      name: "a bun.lock",
      files: { "bun.lock": "" },
      pkg: {},
      expected: "bun add @agent-native/actions zod",
    },
    {
      name: "a packageManager field over a lockfile",
      files: { "package-lock.json": "{}" },
      pkg: { packageManager: "yarn@4.5.0" },
      expected: "yarn add @agent-native/actions zod",
    },
  ])(
    "prints the install hint for the package manager named by $name",
    async ({ files, pkg, expected }) => {
      const dir = makeTempDir("an-init-pm-");
      fs.writeFileSync(
        path.join(dir, "package.json"),
        JSON.stringify({ name: "fixture", ...pkg }, null, 2),
      );
      for (const [file, content] of Object.entries(files)) {
        fs.writeFileSync(path.join(dir, file), content);
      }

      const errLogs: string[] = [];
      vi.spyOn(console, "error").mockImplementation((...args) => {
        errLogs.push(args.join(" "));
      });

      expect(await runActionCli(["init", "--cwd", dir])).toBe(0);
      expect(errLogs.join("\n")).toContain(
        `Next step: install dependencies: ${expected}`,
      );
    },
  );
});

describe("CLI execution: JSON args, approvals, --help, inspect, and --remote", () => {
  it("supports positional JSON, --help, inspect, approval gating (exit 2) + --approved", async () => {
    const dir = makeTempDir("an-cli-run-");
    const actionsIndex = path.resolve(import.meta.dirname, "../index.ts");
    fs.mkdirSync(path.join(dir, "actions"), { recursive: true });
    fs.writeFileSync(
      path.join(dir, "actions/purge.ts"),
      [
        `import { defineAction } from ${JSON.stringify(actionsIndex)};`,
        'import { z } from "zod";',
        "export default defineAction({",
        '  description: "Purge old records",',
        "  schema: z.object({ olderThanDays: z.number(), dryRun: z.boolean().default(false) }),",
        "  destructive: true,",
        "  needsApproval: true,",
        "  run: async ({ olderThanDays, dryRun }) => ({ purged: true, olderThanDays, dryRun }),",
        "});",
        "",
      ].join("\n"),
    );

    const logs: string[] = [];
    const errs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => {
      logs.push(args.join(" "));
    });
    vi.spyOn(console, "error").mockImplementation((...args) => {
      errs.push(args.join(" "));
    });

    expect(await runActionCli(["purge", "--help", "--cwd", dir])).toBe(0);
    expect(logs.join("\n")).toContain("olderThanDays");

    logs.length = 0;
    expect(await runActionCli(["inspect", "--cwd", dir])).toBe(0);
    const inspected = JSON.parse(logs.join("\n")) as {
      actions: Array<{ name: string; destructive: boolean }>;
    };
    expect(inspected.actions).toEqual([
      expect.objectContaining({ name: "purge", destructive: true }),
    ]);

    errs.length = 0;
    const blockedCode = await runActionCli([
      "purge",
      '{"olderThanDays":30,"dryRun":true}',
      "--cwd",
      dir,
    ]);
    expect(blockedCode).toBe(2);
    expect(errs.join("\n")).toContain("--approved");

    logs.length = 0;
    const okCode = await runActionCli([
      "purge",
      '{"olderThanDays":30,"dryRun":true}',
      "--approved",
      "--cwd",
      dir,
    ]);
    expect(okCode).toBe(0);
    expect(JSON.parse(logs.join("\n"))).toEqual({
      purged: true,
      olderThanDays: 30,
      dryRun: true,
    });
  });

  it("calls a remote HTTP endpoint via --remote and --token", async () => {
    const ping = defineAction({
      description: "Remote ping",
      schema: z.object({ text: z.string() }),
      run: async ({ text }, ctx) => ({
        text,
        auth: ctx.headers.get("authorization"),
      }),
    });
    const actions = createActions({ actions: { ping } });
    const nodeHandler = toNodeHandler(actions.handler);
    const server = http.createServer((req, res) => {
      void nodeHandler(req, res);
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );

    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => {
      logs.push(args.join(" "));
    });

    try {
      const addr = server.address();
      if (!addr || typeof addr === "string") throw new Error("Expected port");
      const code = await runActionCli([
        "ping",
        "--text",
        "hello-remote",
        "--remote",
        `http://127.0.0.1:${addr.port}/api/agent-native/actions`,
        "--token",
        "tok_123",
      ]);
      expect(code).toBe(0);
      expect(JSON.parse(logs.join("\n"))).toEqual({
        text: "hello-remote",
        auth: "Bearer tok_123",
      });
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

describe("shared coerceGatewayStringifiedArgs & normalizeLlmToolInput", () => {
  const schema = z.object({
    title: z.string(),
    done: z.boolean().optional(),
    count: z.number().int().optional(),
    tags: z.array(z.string()).optional(),
    meta: z.object({ priority: z.number().optional() }).optional(),
    nullableNote: z.string().nullable().optional(),
    flagMode: z.enum(["true", "false"]).optional(),
  });

  it("repairs gateway-stringified primitives, arrays, objects, boolean-for-enum, and optional nulls", () => {
    const jsonSchema = schemaToJsonSchema(schema, "input");
    const repaired = normalizeLlmToolInput(
      {
        title: "Ship",
        done: "true",
        count: "7",
        tags: '["a","b"]',
        meta: '{"priority":2}',
        nullableNote: null,
        flagMode: false,
      },
      jsonSchema,
    );

    expect(repaired).toEqual({
      title: "Ship",
      done: true,
      count: 7,
      tags: ["a", "b"],
      meta: { priority: 2 },
      nullableNote: null,
      flagMode: "false",
    });

    const stripped = normalizeLlmToolInput(
      { title: "Ship", done: null, count: null },
      jsonSchema,
    );
    expect(stripped).toEqual({ title: "Ship" });
  });

  it("returns the exact same reference from coerceGatewayStringifiedArgs when nothing needs coercion", () => {
    const params = {
      properties: {
        force: { type: "boolean" },
        limit: { type: "number" },
      },
    };
    const input = { force: true, limit: 5 };
    expect(coerceGatewayStringifiedArgs(input, params)).toBe(input);
  });
});
