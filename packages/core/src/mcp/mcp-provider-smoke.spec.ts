import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import type { Tool } from "@modelcontextprotocol/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  CHUNK_SIZE,
  runProviderSmoke,
  type SmokeEnvironment,
  type TemplateCatalogs,
} from "../../scripts/mcp-provider-smoke.js";
import type { ActionEntry } from "../agent/production-agent.js";
import type { McpCatalogMode } from "./provider-schema-conformance.js";

const KEY = "fake-openrouter-key-for-tests";

const schema = {
  type: "object" as const,
  properties: { x: { type: "string" } },
  required: ["x"],
};

// One tool more than a request holds, so every check sends the forced call
// with one slice and a plain request with the other.
function fakeTemplate(
  only?: McpCatalogMode[],
  toolCount = CHUNK_SIZE + 1,
): TemplateCatalogs {
  const tools: Tool[] = Array.from({ length: toolCount }, (_, index) => ({
    name: `tool_${index}`,
    inputSchema: schema,
  }));
  const action: ActionEntry = {
    tool: { description: "Echoes x.", parameters: schema },
    run: async () => ({}),
  };
  return {
    modes: ["default"],
    catalogs:
      only && !only.includes("default") ? [] : [{ mode: "default", tools }],
    actions: { tool_0: action },
  };
}

/** How the fake provider answers one kind of request. */
type Reply = "answer" | "bad-arguments" | "rejected" | "unreachable";

function stubProvider(replies: { plain: Reply; forced: Reply; auto?: Reply }) {
  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    const reply =
      body.tool_choice === "none"
        ? replies.plain
        : body.tool_choice === "auto"
          ? (replies.auto ?? "answer")
          : replies.forced;
    if (reply === "unreachable") throw new Error("offline (test)");
    if (reply === "rejected") {
      return Response.json(
        { error: { message: "schema rejected (test)" } },
        { status: 400 },
      );
    }
    const args = reply === "bad-arguments" ? { x: 123 } : { x: "ok" };
    return Response.json({
      choices: [
        {
          message: {
            tool_calls: [
              {
                function: { name: "tool_0", arguments: JSON.stringify(args) },
              },
            ],
          },
        },
      ],
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

let outDir: string;

beforeEach(() => {
  outDir = mkdtempSync(path.join(os.tmpdir(), "mcp-provider-smoke-"));
});

afterEach(() => {
  vi.unstubAllGlobals();
  rmSync(outDir, { recursive: true, force: true });
});

async function run(argv: string[], overrides: Partial<SmokeEnvironment> = {}) {
  const lines: string[] = [];
  const exitCode = await runProviderSmoke(argv, {
    key: KEY,
    outDir,
    templateApps: () => ["fake"],
    loadCatalogs: async (_app, only) => fakeTemplate(only),
    log: (line) => lines.push(line),
    ...overrides,
  });
  expect(lines.join("\n")).not.toContain(KEY);
  return { exitCode, lines };
}

function writtenResults() {
  const files = readdirSync(outDir).filter((file) => file.endsWith(".json"));
  expect(files).toHaveLength(1);
  return JSON.parse(readFileSync(path.join(outDir, files[0]!), "utf8")) as {
    results: { outcome: string; unreachableRequests: number }[];
  };
}

describe("provider smoke exit code", () => {
  it.each([
    {
      name: "every request was answered",
      replies: { plain: "answer", forced: "answer" },
      outcome: "accepted",
      unreachableRequests: 0,
      exitCode: 0,
    },
    {
      name: "a slice was rejected",
      replies: { plain: "rejected", forced: "answer" },
      outcome: "rejected",
      unreachableRequests: 0,
      exitCode: 1,
    },
    {
      name: "the action refused the arguments",
      replies: { plain: "answer", forced: "bad-arguments" },
      outcome: "invalid-arguments",
      unreachableRequests: 0,
      exitCode: 1,
    },
    {
      name: "a forced call was rejected beside an unreachable slice",
      replies: { plain: "unreachable", forced: "rejected", auto: "answer" },
      outcome: "forced-rejected",
      unreachableRequests: 1,
      exitCode: 1,
    },
    {
      name: "the action refused the arguments beside an unreachable slice",
      replies: { plain: "unreachable", forced: "bad-arguments" },
      outcome: "invalid-arguments",
      unreachableRequests: 1,
      exitCode: 1,
    },
    {
      name: "a slice was rejected beside an unreachable forced call",
      replies: { plain: "rejected", forced: "unreachable" },
      outcome: "rejected",
      unreachableRequests: 1,
      exitCode: 1,
    },
    {
      name: "no request reached a provider",
      replies: { plain: "unreachable", forced: "unreachable" },
      outcome: "unreachable",
      unreachableRequests: 2,
      exitCode: 2,
    },
  ] as const)(
    "exits $exitCode when $name",
    async ({ replies, outcome, unreachableRequests, exitCode }) => {
      stubProvider(replies);
      const result = await run(["--apps", "fake"]);

      expect(result.exitCode).toBe(exitCode);
      const { results } = writtenResults();
      expect(results.map((check) => check.outcome)).toEqual([
        outcome,
        outcome,
        outcome,
      ]);
      expect(results.map((check) => check.unreachableRequests)).toEqual([
        unreachableRequests,
        unreachableRequests,
        unreachableRequests,
      ]);
      if (unreachableRequests > 0) {
        expect(result.lines).toContain(
          "Could not run: 3 check(s) sent a request that never reached a provider",
        );
      }
    },
  );

  it.each([
    {
      name: "no key is set",
      argv: ["--apps", "fake"],
      env: { key: undefined },
      reasons: ["OPENROUTER_API_KEY is not set; set it, or pass --dry-run"],
    },
    {
      name: "a flag is not understood",
      argv: ["--apps", "fake", "--everything"],
      env: {},
      reasons: ["the run stopped: Unknown argument: --everything"],
    },
    {
      name: "the app is unknown",
      argv: ["--apps", "nope"],
      env: {},
      reasons: [
        '"nope" is not a template app with actions',
        "no catalog matched the selection",
      ],
    },
    {
      name: "the app has none of the modes",
      argv: ["--apps", "fake", "--modes", "full"],
      env: {},
      reasons: [
        "fake has no full catalog; it advertises default",
        "no catalog matched the selection",
      ],
    },
    {
      name: "the catalog lists no tools",
      argv: ["--apps", "fake"],
      env: {
        loadCatalogs: async () => fakeTemplate(undefined, 0),
      },
      reasons: ["fake default lists no tools", "no provider check ran"],
    },
    {
      name: "the catalogs do not load",
      argv: ["--apps", "fake"],
      env: {
        loadCatalogs: async () => {
          throw new Error("vite could not start (test)");
        },
      },
      reasons: [
        "fake's catalogs did not load: vite could not start (test)",
        "no catalog matched the selection",
      ],
    },
    {
      name: "it is a dry run",
      argv: ["--apps", "fake", "--dry-run"],
      env: { key: undefined },
      reasons: ["--dry-run sends no request, so every catalog is unchecked"],
    },
  ] satisfies {
    name: string;
    argv: string[];
    env: Partial<SmokeEnvironment>;
    reasons: string[];
  }[])(
    "exits 2 without a provider request when $name",
    async ({ argv, env, reasons }) => {
      const fetchMock = stubProvider({ plain: "answer", forced: "answer" });
      const result = await run(argv, env);

      expect(result.exitCode).toBe(2);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(
        result.lines.filter((line) => line.startsWith("Could not run: ")),
      ).toEqual(reasons.map((reason) => `Could not run: ${reason}`));
    },
  );

  it.each([
    { name: "every slice was accepted", plain: "answer", exitCode: 2 },
    { name: "a slice was rejected", plain: "rejected", exitCode: 1 },
  ] as const)(
    "exits $exitCode when $name in a catalog with no forced-call candidate",
    async ({ plain, exitCode }) => {
      const fetchMock = stubProvider({ plain, forced: "answer" });
      // No listed tool is an app action, so none can be forced.
      const result = await run(["--apps", "fake"], {
        loadCatalogs: async (_app, only) => ({
          ...fakeTemplate(only),
          actions: {},
        }),
      });

      expect(result.exitCode).toBe(exitCode);
      expect(
        fetchMock.mock.calls.map(
          ([, init]) => JSON.parse(String(init?.body)).tool_choice,
        ),
      ).toEqual(Array(6).fill("none"));
      expect(result.lines).toContain(
        "Could not run: fake default has no forced-call candidate, an app action with required arguments, so no call's arguments were checked",
      );
      expect(writtenResults().results.map((check) => check.outcome)).toEqual(
        Array(3).fill(plain === "answer" ? "accepted" : "rejected"),
      );
    },
  );

  it("keeps a failure when a later app's catalogs do not load", async () => {
    stubProvider({ plain: "rejected", forced: "answer" });
    const result = await run([], {
      templateApps: () => ["fake", "broken"],
      loadCatalogs: async (app, only) => {
        if (app === "broken") throw new Error("vite could not start (test)");
        return fakeTemplate(only);
      },
    });

    expect(result.exitCode).toBe(1);
    expect(result.lines).toContain(
      "Could not run: broken's catalogs did not load: vite could not start (test)",
    );
    expect(writtenResults().results.map((check) => check.outcome)).toEqual([
      "rejected",
      "rejected",
      "rejected",
    ]);
  });
});
