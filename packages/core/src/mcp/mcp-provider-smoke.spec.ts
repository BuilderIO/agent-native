import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  unlinkSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import type { Tool } from "@modelcontextprotocol/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  CHUNK_SIZE,
  isEntryPoint,
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

const optionalSchema = {
  type: "object" as const,
  properties: { x: { type: "string" } },
  additionalProperties: false,
};

// One tool more than a request holds, so every check sends the forced call
// with one slice and a plain request with the other.
function fakeTemplate(
  only?: McpCatalogMode[],
  toolCount = CHUNK_SIZE + 1,
  inputSchema: typeof schema | typeof optionalSchema = schema,
): TemplateCatalogs {
  const tools: Tool[] = Array.from({ length: toolCount }, (_, index) => ({
    name: `tool_${index}`,
    inputSchema,
  }));
  const action: ActionEntry = {
    tool: { description: "Echoes x.", parameters: inputSchema },
    run: async () => ({}),
  };
  return {
    modes: ["default"],
    catalogs:
      only && !only.includes("default") ? [] : [{ mode: "default", tools }],
    actions: { tool_0: action },
  };
}

/**
 * An OpenRouter error: its HTTP status, with `code` and `errorType` in the
 * body when given, or `text` in place of a JSON body.
 */
interface ErrorReply {
  status: number;
  code?: number;
  errorType?: string;
  text?: string;
}

/** How the fake provider answers one kind of request. */
type Reply =
  | "answer"
  | "empty"
  | "bad-arguments"
  | "other-tool"
  | "rejected"
  | "unreachable"
  | ErrorReply;

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
      // The shape a provider's schema refusal came back in on a real run.
      return Response.json(
        {
          error: {
            code: 400,
            message: "Provider returned error",
            metadata: {
              provider_name: "Anthropic",
              raw: "input_schema does not support oneOf, allOf, or anyOf at the top level (test)",
            },
          },
        },
        { status: 400 },
      );
    }
    if (typeof reply === "object") {
      if (reply.text !== undefined) {
        return new Response(reply.text, { status: reply.status });
      }
      return Response.json(
        {
          error: {
            ...(reply.code === undefined ? {} : { code: reply.code }),
            message: "error (test)",
            ...(reply.errorType === undefined
              ? {}
              : { metadata: { error_type: reply.errorType } }),
          },
        },
        { status: reply.status },
      );
    }
    const args =
      reply === "bad-arguments"
        ? { x: 123 }
        : reply === "empty"
          ? {}
          : { x: "ok" };
    const name = reply === "other-tool" ? "tool_1" : "tool_0";
    return Response.json({
      choices: [
        {
          message: {
            tool_calls: [
              { function: { name, arguments: JSON.stringify(args) } },
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
    skipped: string[];
    results: { outcome: string; uncheckedRequests: number }[];
  };
}

function toolChoices(fetchMock: ReturnType<typeof stubProvider>) {
  return fetchMock.mock.calls.map(([, init]) =>
    JSON.stringify(JSON.parse(String(init?.body)).tool_choice),
  );
}

const UNCHECKED_REASON =
  "Could not run: 3 check(s) sent a request that failed for a reason other than its schemas";

describe("provider smoke exit code", () => {
  it.each([
    {
      name: "every request was answered",
      replies: { plain: "answer", forced: "answer" },
      outcome: "accepted",
      uncheckedRequests: 0,
      exitCode: 0,
    },
    {
      name: "a slice was rejected",
      replies: { plain: "rejected", forced: "answer" },
      outcome: "rejected",
      uncheckedRequests: 0,
      exitCode: 1,
    },
    {
      name: "the action refused the arguments",
      replies: { plain: "answer", forced: "bad-arguments" },
      outcome: "invalid-arguments",
      uncheckedRequests: 0,
      exitCode: 1,
    },
    {
      name: "a forced call was rejected beside an unreachable slice",
      replies: { plain: "unreachable", forced: "rejected", auto: "answer" },
      outcome: "forced-rejected",
      uncheckedRequests: 1,
      exitCode: 1,
    },
    {
      name: "the action refused the arguments beside an unreachable slice",
      replies: { plain: "unreachable", forced: "bad-arguments" },
      outcome: "invalid-arguments",
      uncheckedRequests: 1,
      exitCode: 1,
    },
    {
      name: "a slice was rejected beside an unreachable forced call",
      replies: { plain: "rejected", forced: "unreachable" },
      outcome: "rejected",
      uncheckedRequests: 1,
      exitCode: 1,
    },
    {
      name: "no request reached a provider",
      replies: { plain: "unreachable", forced: "unreachable" },
      outcome: "unchecked",
      uncheckedRequests: 2,
      exitCode: 2,
    },
  ] as const)(
    "exits $exitCode when $name",
    async ({ replies, outcome, uncheckedRequests, exitCode }) => {
      stubProvider(replies);
      const result = await run(["--apps", "fake"]);

      expect(result.exitCode).toBe(exitCode);
      const { results } = writtenResults();
      expect(results.map((check) => check.outcome)).toEqual([
        outcome,
        outcome,
        outcome,
      ]);
      expect(results.map((check) => check.uncheckedRequests)).toEqual([
        uncheckedRequests,
        uncheckedRequests,
        uncheckedRequests,
      ]);
      if (uncheckedRequests > 0) {
        expect(result.lines).toContain(UNCHECKED_REASON);
      }
    },
  );

  it.each([
    {
      name: "the key is refused",
      reply: { status: 401 },
      outcome: "unchecked",
      exitCode: 2,
    },
    {
      name: "the account has no credits",
      reply: { status: 402, errorType: "payment_required" },
      outcome: "unchecked",
      exitCode: 2,
    },
    {
      name: "the key may not use the model",
      reply: { status: 403, errorType: "permission_denied" },
      outcome: "unchecked",
      exitCode: 2,
    },
    {
      name: "the request is rate limited",
      reply: { status: 429, errorType: "rate_limit_exceeded" },
      outcome: "unchecked",
      exitCode: 2,
    },
    {
      name: "a rate limit comes back as a 200 with its code in the body",
      reply: { status: 200, code: 429 },
      outcome: "unchecked",
      exitCode: 2,
    },
    {
      name: "the provider's answer is unusable",
      reply: { status: 502 },
      outcome: "unchecked",
      exitCode: 2,
    },
    {
      name: "no provider is available",
      reply: { status: 503, errorType: "provider_overloaded" },
      outcome: "unchecked",
      exitCode: 2,
    },
    {
      name: "an outage page comes back instead of JSON",
      reply: { status: 502, text: "<html>502 Bad Gateway</html>" },
      outcome: "unchecked",
      exitCode: 2,
    },
    {
      name: "a 400 names an error other than a refusal",
      reply: { status: 400, errorType: "context_length_exceeded" },
      outcome: "unchecked",
      exitCode: 2,
    },
    {
      name: "a 400 names no error type",
      reply: { status: 400 },
      outcome: "rejected",
      exitCode: 1,
    },
    {
      name: "a 400 names an invalid request",
      reply: { status: 400, code: 400, errorType: "invalid_request" },
      outcome: "rejected",
      exitCode: 1,
    },
    {
      name: "a refusal comes back as a 200 with its code in the body",
      reply: { status: 200, code: 400 },
      outcome: "rejected",
      exitCode: 1,
    },
  ] satisfies {
    name: string;
    reply: ErrorReply;
    outcome: string;
    exitCode: number;
  }[])(
    "ends a check in $outcome and exits $exitCode when $name",
    async ({ reply, outcome, exitCode }) => {
      stubProvider({ plain: reply, forced: "answer" });
      const result = await run(["--apps", "fake"]);

      expect(result.exitCode).toBe(exitCode);
      const { results } = writtenResults();
      expect(results.map((check) => check.outcome)).toEqual(
        Array(3).fill(outcome),
      );
      const unchecked = outcome === "unchecked" ? 1 : 0;
      expect(results.map((check) => check.uncheckedRequests)).toEqual(
        Array(3).fill(unchecked),
      );
      expect(result.lines.includes(UNCHECKED_REASON)).toBe(unchecked > 0);
    },
  );

  it.each([
    {
      name: "is rate limited",
      forced: { status: 429, errorType: "rate_limit_exceeded" },
    },
    { name: "is refused for the key", forced: { status: 401 } },
    { name: "hits an unavailable provider", forced: { status: 503 } },
  ] satisfies { name: string; forced: ErrorReply }[])(
    "leaves a forced call that $name unchecked, with no retry on auto",
    async ({ forced }) => {
      const fetchMock = stubProvider({ plain: "answer", forced });
      const result = await run(["--apps", "fake"]);

      expect(result.exitCode).toBe(2);
      expect(writtenResults().results.map((check) => check.outcome)).toEqual(
        Array(3).fill("unchecked"),
      );
      expect(toolChoices(fetchMock)).not.toContain('"auto"');
      expect(result.lines).toContain(UNCHECKED_REASON);
    },
  );

  it.each([
    {
      name: "a named app does not advertise one of the modes",
      argv: ["--apps", "fake", "--modes", "default,full"],
      modes: ["default"],
      exitCode: 2,
      reasons: ["fake has no full catalog; it advertises default"],
      skipped: [],
    },
    {
      name: "a mode an app advertises does not load",
      argv: [],
      modes: ["default", "full"],
      exitCode: 2,
      reasons: ["fake advertises a full catalog, but it did not load"],
      skipped: [],
    },
    {
      name: "an app picked by default does not advertise one of the modes",
      argv: ["--modes", "default,full"],
      modes: ["default"],
      exitCode: 0,
      reasons: [],
      skipped: ["fake has no full catalog; it advertises default"],
    },
  ] satisfies {
    name: string;
    argv: string[];
    modes: McpCatalogMode[];
    exitCode: number;
    reasons: string[];
    skipped: string[];
  }[])(
    "exits $exitCode when $name",
    async ({ argv, modes, exitCode, reasons, skipped }) => {
      stubProvider({ plain: "answer", forced: "answer" });
      const result = await run(argv, {
        loadCatalogs: async (_app, only) => ({ ...fakeTemplate(only), modes }),
      });

      expect(result.exitCode).toBe(exitCode);
      expect(
        result.lines.filter((line) => line.startsWith("Could not run: ")),
      ).toEqual(reasons.map((reason) => `Could not run: ${reason}`));
      expect(
        result.lines.filter((line) => line.startsWith("Skipped: ")),
      ).toEqual(skipped.map((reason) => `Skipped: ${reason}`));
      expect(result.lines.at(-1)).toContain(
        `${skipped.length} skipped mode(s).`,
      );
      const written = writtenResults();
      expect(written.skipped).toEqual(skipped);
      expect(written.results.map((check) => check.outcome)).toEqual(
        Array(3).fill("accepted"),
      );
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
    ...[
      ["--apps"],
      ["--apps", ""],
      ["--apps", "fake,"],
      ["--apps", "--dry-run"],
    ].map((argv) => ({
      name: `--apps has no value: ${JSON.stringify(argv)}`,
      argv,
      env: {},
      reasons: [
        "the run stopped: --apps needs a comma-separated list of names.",
      ],
    })),
    ...[
      ["--apps", "fake", "--modes"],
      ["--apps", "fake", "--modes", ""],
      ["--modes", "--apps", "fake"],
    ].map((argv) => ({
      name: `--modes has no value: ${JSON.stringify(argv)}`,
      argv,
      env: {},
      reasons: [
        "the run stopped: --modes needs a comma-separated list of names.",
      ],
    })),
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
      name: "the only app picked by default skips the one mode",
      argv: ["--modes", "full"],
      env: {},
      reasons: ["no catalog matched the selection"],
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
    {
      name: "the forced call returns valid arguments",
      forced: "answer",
      outcome: "accepted",
      exitCode: 0,
    },
    {
      name: "the forced call returns no arguments",
      forced: "empty",
      outcome: "accepted",
      exitCode: 0,
    },
    {
      name: "the action refuses the forced call's arguments",
      forced: "bad-arguments",
      outcome: "invalid-arguments",
      exitCode: 1,
    },
  ] as const)(
    "forces a call to an action whose arguments are all optional, and exits $exitCode when $name",
    async ({ forced, outcome, exitCode }) => {
      const fetchMock = stubProvider({ plain: "answer", forced });
      const result = await run(["--apps", "fake"], {
        loadCatalogs: async (_app, only) =>
          fakeTemplate(only, CHUNK_SIZE + 1, optionalSchema),
      });

      expect(result.exitCode).toBe(exitCode);
      const forcedChoice = JSON.stringify({
        type: "function",
        function: { name: "tool_0" },
      });
      expect(
        fetchMock.mock.calls
          .map(([, init]) =>
            JSON.stringify(JSON.parse(String(init?.body)).tool_choice),
          )
          .sort(),
      ).toEqual([...Array(3).fill('"none"'), ...Array(3).fill(forcedChoice)]);
      expect(
        result.lines.filter((line) => line.startsWith("Could not run: ")),
      ).toEqual([]);
      expect(writtenResults().results.map((check) => check.outcome)).toEqual(
        Array(3).fill(outcome),
      );
    },
  );

  it.each([
    {
      name: "every slice was accepted",
      plain: "answer",
      actions: {},
      exitCode: 2,
    },
    {
      name: "a slice was rejected",
      plain: "rejected",
      actions: {},
      exitCode: 1,
    },
    {
      name: "its only app action declares no input schema",
      plain: "answer",
      actions: {
        tool_0: { tool: { description: "Echoes x." }, run: async () => ({}) },
      },
      exitCode: 2,
    },
  ] satisfies {
    name: string;
    plain: Reply;
    actions: Record<string, ActionEntry>;
    exitCode: number;
  }[])(
    "exits $exitCode for a catalog with no forced-call candidate when $name",
    async ({ plain, actions, exitCode }) => {
      const fetchMock = stubProvider({ plain, forced: "answer" });
      const result = await run(["--apps", "fake"], {
        loadCatalogs: async (_app, only) => ({
          ...fakeTemplate(only),
          actions,
        }),
      });

      expect(result.exitCode).toBe(exitCode);
      expect(
        fetchMock.mock.calls.map(
          ([, init]) => JSON.parse(String(init?.body)).tool_choice,
        ),
      ).toEqual(Array(6).fill("none"));
      expect(result.lines).toContain(
        "Could not run: fake default has no forced-call candidate, an app action with an input schema, so no call's arguments were checked",
      );
      expect(writtenResults().results.map((check) => check.outcome)).toEqual(
        Array(3).fill(plain === "answer" ? "accepted" : "rejected"),
      );
    },
  );

  it.each([
    {
      name: "a forced request comes back calling another app action",
      replies: { plain: "answer", forced: "other-tool" },
      outcome: "invalid-arguments",
      detail: "called tool_1: forced tool_0, but tool_1 was called",
    },
    {
      name: "the retry on auto calls another app action",
      replies: { plain: "answer", forced: "rejected", auto: "other-tool" },
      outcome: "forced-rejected",
      detail: "retried on auto, called tool_1)",
    },
  ] as const)(
    "ends in $outcome when $name",
    async ({ replies, outcome, detail }) => {
      stubProvider(replies);
      const result = await run(["--apps", "fake"], {
        loadCatalogs: async (_app, only) => {
          const template = fakeTemplate(only);
          return {
            ...template,
            actions: { ...template.actions, tool_1: template.actions.tool_0! },
          };
        },
      });

      expect(result.exitCode).toBe(1);
      expect(writtenResults().results.map((check) => check.outcome)).toEqual(
        Array(3).fill(outcome),
      );
      expect(result.lines.filter((line) => line.includes(detail))).toHaveLength(
        3,
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

describe("provider smoke entry point", () => {
  const script = fileURLToPath(
    new URL("../../scripts/mcp-provider-smoke.ts", import.meta.url),
  );
  const moduleUrl = pathToFileURL(script).href;

  it("runs when node is pointed at the script through a linked directory", () => {
    // A junction needs no privileges on Windows; elsewhere this is a symlink.
    const link = path.join(outDir, "linked-scripts");
    symlinkSync(path.dirname(script), link, "junction");
    try {
      expect(
        isEntryPoint(moduleUrl, path.join(link, path.basename(script))),
      ).toBe(true);
    } finally {
      // Removed on its own, so cleaning up outDir cannot reach the scripts.
      unlinkSync(link);
    }
  });

  it.each([
    ["the script itself", true, () => script],
    ["another file", false, () => fileURLToPath(import.meta.url)],
    ["a path that does not exist", false, () => path.join(outDir, "x.ts")],
    ["no path at all", false, () => undefined],
  ] as const)("takes %s as the entry point: %s", (_label, expected, argv1) => {
    expect(isEntryPoint(moduleUrl, argv1())).toBe(expected);
  });
});
