import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { fetchPlanBlockCatalog } from "./plan-blocks.js";
import {
  buildLocalPlanPreviewHtml,
  localPlanFolderName,
  publishVisualAnswerSource,
  readLocalPlanFiles,
  runPlan,
  startLocalPlanBridge,
  validateLocalPlanFiles,
  verifyLocalPlanBridge,
  writeLocalPlanPreview,
} from "./plan-local.js";

const tmpRoots: string[] = [];
const originalCwd = process.cwd();
const originalEnv = {
  PLAN_LOCAL_DIR: process.env.PLAN_LOCAL_DIR,
  AGENT_NATIVE_MANIFEST: process.env.AGENT_NATIVE_MANIFEST,
  AGENT_NATIVE_MANIFEST_PATH: process.env.AGENT_NATIVE_MANIFEST_PATH,
};

afterEach(() => {
  process.chdir(originalCwd);
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  for (const root of tmpRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function tmpDir(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "an-plan-local-"));
  tmpRoots.push(root);
  return root;
}

async function captureRunPlan(argv: string[]) {
  const originalStdoutWrite = process.stdout.write;
  const originalStderrWrite = process.stderr.write;
  const originalExit = process.exit;
  let stdout = "";
  let stderr = "";
  let exitCode: string | number | null | undefined;

  process.stdout.write = ((chunk: string | Uint8Array) => {
    stdout += chunk.toString();
    return true;
  }) as typeof process.stdout.write;
  process.stderr.write = ((chunk: string | Uint8Array) => {
    stderr += chunk.toString();
    return true;
  }) as typeof process.stderr.write;
  process.exit = ((code?: string | number | null | undefined) => {
    exitCode = code;
    throw new Error(`process.exit(${code ?? 0})`);
  }) as typeof process.exit;

  try {
    await runPlan(argv);
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !error.message.startsWith("process.exit(")
    ) {
      throw error;
    }
  } finally {
    process.stdout.write = originalStdoutWrite;
    process.stderr.write = originalStderrWrite;
    process.exit = originalExit;
  }

  return { stdout, stderr, exitCode };
}

async function waitForOutput(
  predicate: () => boolean,
  description: string,
): Promise<void> {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > 5_000) {
      throw new Error(`Timed out waiting for ${description}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

async function captureRunningServe(argv: string[]) {
  const originalStdoutWrite = process.stdout.write;
  const originalStderrWrite = process.stderr.write;
  let stdout = "";
  let stderr = "";
  let runError: unknown;
  let stopped = false;

  process.stdout.write = ((chunk: string | Uint8Array) => {
    stdout += chunk.toString();
    return true;
  }) as typeof process.stdout.write;
  process.stderr.write = ((chunk: string | Uint8Array) => {
    stderr += chunk.toString();
    return true;
  }) as typeof process.stderr.write;

  const running = runPlan(argv).catch((error: unknown) => {
    runError = error;
  });

  try {
    await waitForOutput(
      () => Boolean(runError) || stderr.includes("Local Plan bridge running"),
      "Plan local bridge startup",
    );
    if (runError) throw runError;
    stopped = process.emit("SIGTERM");
    await running;
    if (runError) throw runError;
  } finally {
    if (!stopped) process.emit("SIGTERM");
    process.stdout.write = originalStdoutWrite;
    process.stderr.write = originalStderrWrite;
  }

  return { stdout, stderr };
}

function writeSamplePlan(dir: string) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "plan.mdx"),
    [
      "---",
      'title: "Private Checkout Plan"',
      'brief: "No database writes."',
      'kind: "recap"',
      "---",
      "",
      "# Private Checkout Plan",
      "",
      "This plan stays local.",
      "",
      '<WireframeBlock id="wf" title="Checkout">',
      '  <Screen surface="browser" html={`<div>Pay</div>`} />',
      "</WireframeBlock>",
      "",
    ].join("\n"),
    "utf-8",
  );
}

function writeInvalidSelfClosingWireframe(dir: string) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "plan.mdx"),
    [
      "---",
      'title: "Invalid Wireframe"',
      'kind: "plan"',
      "---",
      "",
      "# Invalid Wireframe",
      "",
      '<WireframeBlock id="wf" screens={[{ name: "Checkout", elements: [] }]} />',
      "",
    ].join("\n"),
    "utf-8",
  );
}

function writeEmptyWireframe(dir: string) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "plan.mdx"),
    [
      "---",
      'title: "Empty Wireframe"',
      'kind: "recap"',
      "---",
      "",
      "# Empty Wireframe",
      "",
      '<WireframeBlock id="wf" title="Checkout">',
      '  <Screen surface="browser" />',
      "</WireframeBlock>",
      "",
    ].join("\n"),
    "utf-8",
  );
}

function writeChecklistMissingItemId(dir: string) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "plan.mdx"),
    [
      "---",
      'title: "Checklist missing ids"',
      'kind: "plan"',
      "---",
      "",
      "# Checklist missing ids",
      "",
      '<Checklist id="todo" items={[{ label: "Ship it" }]} />',
      "",
    ].join("\n"),
    "utf-8",
  );
}

function writeQuestionFormMissingIds(dir: string) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "plan.mdx"),
    [
      "---",
      'title: "Question form missing ids"',
      'kind: "plan"',
      "---",
      "",
      "# Question form missing ids",
      "",
      '<QuestionForm id="questions" questions={[{ title: "Pick one", mode: "single", options: [{ label: "A" }] }]} />',
      "",
    ].join("\n"),
    "utf-8",
  );
}

function writeChecklistMissingItemLabel(dir: string) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "plan.mdx"),
    [
      "---",
      'title: "Checklist missing label"',
      'kind: "plan"',
      "---",
      "",
      "# Checklist missing label",
      "",
      '<Checklist items={[{ id: "ship" }]} />',
      "",
    ].join("\n"),
    "utf-8",
  );
}

function writeQuestionFormMissingTitleAndMode(dir: string) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "plan.mdx"),
    [
      "---",
      'title: "Question form missing title/mode"',
      'kind: "plan"',
      "---",
      "",
      "# Question form missing title and mode",
      "",
      '<QuestionForm questions={[{ id: "q1", options: [{ id: "o1" }] }]} />',
      "",
    ].join("\n"),
    "utf-8",
  );
}

function writeQuestionFormInvalidMode(dir: string) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "plan.mdx"),
    [
      "---",
      'title: "Question form invalid mode"',
      'kind: "plan"',
      "---",
      "",
      "# Question form invalid mode",
      "",
      '<QuestionForm questions={[{ id: "q1", title: "Pick", mode: "checkbox" }]} />',
      "",
    ].join("\n"),
    "utf-8",
  );
}

function writeScaffoldExamplePlan(dir: string) {
  // Mirrors the `plan local init` scaffold prose, which documents block usage
  // with an inline-code example. That example must NOT be linted as a real
  // block (it previously tripped the wireframe linter → init → serve failed).
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "plan.mdx"),
    [
      "---",
      'title: "Scaffold"',
      'kind: "plan"',
      "localOnly: true",
      "---",
      "",
      "# Scaffold",
      "",
      "Author the structured plan or recap here. You can add Agent-Native Plan MDX",
      'blocks such as `<WireframeBlock><Screen surface="browser">...</Screen></WireframeBlock>`,',
      "`<Diagram />`, `<TabsBlock />`, `<FileTree />`, or `<Diff />`; the local",
      "preview will show the source without publishing it to the Plan app.",
      "",
    ].join("\n"),
    "utf-8",
  );
}

describe("local plan CLI helpers", () => {
  it("keeps plan serve as a compatibility alias for plan local serve", async () => {
    const result = await captureRunPlan(["serve", "--help"]);

    expect(result.exitCode).toBeUndefined();
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("agent-native plan serve --dir <folder>");
    expect(result.stdout).toContain(
      "compatibility alias for `plan local serve`",
    );
    expect(result.stdout).toContain(
      "agent-native plan local serve --dir <folder>",
    );
  });

  it("starts the bridge through both plan serve and plan local serve", async () => {
    const dir = path.join(tmpDir(), "checkout");
    writeSamplePlan(dir);
    const aliasUrlFile = path.join(dir, "alias.plan-url");
    const localUrlFile = path.join(dir, "local.plan-url");

    const alias = await captureRunningServe([
      "serve",
      "--dir",
      dir,
      "--app-url",
      "https://plan.example.com",
      "--url-file",
      aliasUrlFile,
    ]);
    const local = await captureRunningServe([
      "local",
      "serve",
      "--dir",
      dir,
      "--app-url",
      "https://plan.example.com",
      "--url-file",
      localUrlFile,
    ]);

    for (const [label, captured, urlFile] of [
      ["alias", alias, aliasUrlFile],
      ["local", local, localUrlFile],
    ] as const) {
      const result = JSON.parse(captured.stdout) as {
        ok: boolean;
        url: string;
        bridgeUrl: string;
        appUrl: string;
        urlFile: string;
      };
      expect(result.ok, label).toBe(true);
      expect(result.appUrl, label).toBe("https://plan.example.com");
      expect(result.bridgeUrl, label).toContain("http://127.0.0.1:");
      expect(result.url, label).toBe(
        `https://plan.example.com/local-plans/checkout?bridge=${encodeURIComponent(
          result.bridgeUrl,
        )}`,
      );
      expect(result.urlFile, label).toBe(urlFile);
      expect(fs.readFileSync(urlFile, "utf-8"), label).toBe(`${result.url}\n`);
      expect(captured.stderr, label).toContain("Local Plan bridge running at");
      expect(captured.stderr, label).toContain(
        `Open URL written to ${urlFile}`,
      );
    }
  });

  it("builds the same safe folder names as the Plan app local mirror", () => {
    expect(localPlanFolderName("Private / no-DB recap!")).toBe(
      "private-no-db-recap",
    );
  });

  it("reads only the expected local plan source files", () => {
    const dir = path.join(tmpDir(), "checkout");
    writeSamplePlan(dir);

    const files = readLocalPlanFiles(dir);

    expect(files.planMdx).toContain("Private Checkout Plan");
    expect(files.canvasMdx).toBeUndefined();
  });

  it("generates a self-contained preview with a no-DB notice", () => {
    const dir = path.join(tmpDir(), "checkout");
    writeSamplePlan(dir);

    const html = buildLocalPlanPreviewHtml({ dir });

    expect(html).toContain("Private Checkout Plan");
    expect(html).toContain("No DB writes");
    expect(html).toContain("does not call");
    expect(html).toContain("&lt;WireframeBlock");
  });

  it("returns the local Plan app route by default", () => {
    const dir = path.join(tmpDir(), "checkout");
    writeSamplePlan(dir);

    const result = writeLocalPlanPreview({
      dir,
      appUrl: "http://localhost:8096",
    });

    expect(result.kind).toBe("recap");
    expect(result.files).toContain("plan.mdx");
    expect(result.out).toBeUndefined();
    expect(result.url).toBe("http://localhost:8096/local-plans/checkout");
  });

  it("includes a repo-relative path for direct local Plan app routes", () => {
    const repo = tmpDir();
    fs.mkdirSync(path.join(repo, ".git"));
    const dir = path.join(repo, "plans", "checkout");
    writeSamplePlan(dir);
    process.chdir(repo);
    delete process.env.AGENT_NATIVE_MANIFEST;
    delete process.env.AGENT_NATIVE_MANIFEST_PATH;

    const result = writeLocalPlanPreview({
      dir,
      appUrl: "http://localhost:8096",
    });

    expect(result.url).toBe(
      "http://localhost:8096/local-plans/checkout?path=plans%2Fcheckout",
    );
  });

  it("writes standalone HTML only when --out is provided", () => {
    const dir = path.join(tmpDir(), "checkout");
    writeSamplePlan(dir);
    const out = path.join(dir, "preview.html");

    const result = writeLocalPlanPreview({ dir, out });

    expect(result.url).toMatch(/^file:\/\//);
    expect(result.out).toBe(out);
    expect(fs.readFileSync(out, "utf-8")).toContain("Local-files mode");
  });

  it("can open the generated preview when requested", () => {
    const dir = path.join(tmpDir(), "checkout");
    writeSamplePlan(dir);
    let openedUrl = "";

    const result = writeLocalPlanPreview({
      dir,
      open: true,
      openUrl: (url) => {
        openedUrl = url;
        return { ok: true, command: "test-open" };
      },
    });

    expect(openedUrl).toBe(result.url);
    expect(result.opened).toBe(true);
    expect(result.openCommand).toBe("test-open");
  });

  it("rejects self-closing local wireframes before opening a preview", async () => {
    const dir = path.join(tmpDir(), "bad-wireframe");
    writeInvalidSelfClosingWireframe(dir);

    expect(() => writeLocalPlanPreview({ dir })).toThrow(
      /WireframeBlock must wrap a <Screen> child/,
    );
    await expect(startLocalPlanBridge({ dir })).rejects.toThrow(
      /WireframeBlock must wrap a <Screen> child/,
    );
  });

  it("rejects empty local wireframes before opening a preview", async () => {
    const dir = path.join(tmpDir(), "empty-wireframe");
    writeEmptyWireframe(dir);

    expect(() => writeLocalPlanPreview({ dir })).toThrow(/empty <Screen>/);
    await expect(startLocalPlanBridge({ dir })).rejects.toThrow(
      /empty <Screen>/,
    );
  });

  it("rejects missing checklist item ids before opening or serving", async () => {
    const dir = path.join(tmpDir(), "bad-checklist");
    writeChecklistMissingItemId(dir);

    expect(() => writeLocalPlanPreview({ dir })).toThrow(
      /Checklist items\[0\]\.id is required/,
    );
    await expect(startLocalPlanBridge({ dir })).rejects.toThrow(
      /Checklist items\[0\]\.id is required/,
    );
  });

  it("rejects missing question-form question and option ids", async () => {
    const dir = path.join(tmpDir(), "bad-question-form");
    writeQuestionFormMissingIds(dir);

    expect(() => writeLocalPlanPreview({ dir })).toThrow(
      /QuestionForm questions\[0\]\.id is required/,
    );
    await expect(startLocalPlanBridge({ dir })).rejects.toThrow(
      /QuestionForm questions\[0\]\.id is required/,
    );
  });

  it("rejects missing checklist item labels (renderer schema parity)", () => {
    const dir = path.join(tmpDir(), "bad-checklist-label");
    writeChecklistMissingItemLabel(dir);

    expect(() => writeLocalPlanPreview({ dir })).toThrow(
      /Checklist items\[0\]\.label is required/,
    );
  });

  it("rejects missing question title, mode, and option label", () => {
    const dir = path.join(tmpDir(), "bad-question-required");
    writeQuestionFormMissingTitleAndMode(dir);

    const issues = validateLocalPlanFiles(readLocalPlanFiles(dir));
    const messages = issues.map((issue) => issue.message);
    expect(messages).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/questions\[0\]\.title is required/),
        expect.stringMatching(/questions\[0\]\.mode is required/),
        expect.stringMatching(
          /questions\[0\]\.options\[0\]\.label is required/,
        ),
      ]),
    );
  });

  it("rejects an invalid question mode value", () => {
    const dir = path.join(tmpDir(), "bad-question-mode");
    writeQuestionFormInvalidMode(dir);

    expect(() => writeLocalPlanPreview({ dir })).toThrow(
      /questions\[0\]\.mode is required by the Plan renderer schema/,
    );
  });

  it("does not lint block tags written inside inline code (init scaffold passes)", () => {
    const dir = path.join(tmpDir(), "scaffold");
    writeScaffoldExamplePlan(dir);
    // The scaffold's `<WireframeBlock><Screen>...` is a documentation example in
    // inline code, not a real block — validation must not trip on it so the
    // default `init` → `serve`/`check` flow works out of the box.
    expect(() => writeLocalPlanPreview({ dir })).not.toThrow();
  });

  it("serves a tokened localhost bridge for the hosted local plan UI", async () => {
    const dir = path.join(tmpDir(), "checkout");
    writeSamplePlan(dir);

    const bridge = await startLocalPlanBridge({
      dir,
      appUrl: "https://plan.example.com",
      token: "test-token",
    });

    try {
      expect(bridge.result.url).toBe(
        `https://plan.example.com/local-plans/checkout?bridge=${encodeURIComponent(
          bridge.result.bridgeUrl,
        )}`,
      );
      expect(bridge.result.bridgeUrl).toContain("127.0.0.1");
      expect(bridge.result.files).toContain("plan.mdx");
      expect(bridge.result.urlFile).toBe(path.join(dir, ".plan-url"));
      expect(fs.readFileSync(path.join(dir, ".plan-url"), "utf-8")).toBe(
        `${bridge.result.url}\n`,
      );

      const response = await fetch(bridge.result.bridgeUrl);
      expect(response.ok).toBe(true);
      expect(response.headers.get("x-agent-native-local-bridge")).toBe("1");
      const payload = (await response.json()) as {
        ok: boolean;
        source: string;
        mdx: { "plan.mdx": string };
      };
      expect(payload.ok).toBe(true);
      expect(payload.source).toBe("agent-native-local-bridge");
      expect(payload.mdx["plan.mdx"]).toContain("Private Checkout Plan");

      const preflight = await fetch(bridge.result.bridgeUrl, {
        method: "OPTIONS",
        headers: {
          origin: "https://plan.example.com",
          "access-control-request-method": "GET",
          "access-control-request-private-network": "true",
        },
      });
      expect(preflight.status).toBe(204);
      expect(preflight.headers.get("access-control-allow-origin")).toBe("*");
      expect(
        preflight.headers.get("access-control-allow-private-network"),
      ).toBe("true");

      const denied = await fetch(
        bridge.result.bridgeUrl.replace("test-token", "wrong-token"),
      );
      expect(denied.status).toBe(403);
    } finally {
      await new Promise<void>((resolve) =>
        bridge.server.close(() => resolve()),
      );
    }
  });

  it("verifies the localhost bridge headlessly and reports Safari guidance", async () => {
    const dir = path.join(tmpDir(), "checkout");
    writeSamplePlan(dir);

    const result = await verifyLocalPlanBridge({
      dir,
      appUrl: "https://plan.example.com",
      token: "test-token",
      urlFile: false,
    });

    expect(result.ok).toBe(true);
    expect(result.preflight.status).toBe(204);
    expect(result.preflight.allowPrivateNetwork).toBe("true");
    expect(result.bridge.ok).toBe(true);
    expect(result.bridge.source).toBe("agent-native-local-bridge");
    expect(result.bridge.mdxFiles).toContain("plan.mdx");
    expect(result.warnings.join("\n")).toContain("Safari may block");
    expect(fs.existsSync(path.join(dir, ".plan-url"))).toBe(false);
  });

  it("fetches the no-auth block catalog for local authoring", async () => {
    const dir = tmpDir();
    const calls: Array<{ url: string; method: string }> = [];
    const fetchFn: typeof fetch = (async (input, init) => {
      calls.push({
        url: String(input),
        method: String(init?.method ?? "GET"),
      });
      return new Response(
        JSON.stringify({
          reference: "## Blocks\n\n| type | tag |",
          count: 12,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as typeof fetch;

    const out = path.join(dir, "plan-blocks.md");
    const result = await fetchPlanBlockCatalog({
      appUrl: "https://plan.agent-native.com/",
      out,
      fetchFn,
    });

    expect(result).toEqual({
      ok: true,
      out,
      count: 12,
      format: "reference",
    });
    expect(calls[0].url).toBe(
      "https://plan.agent-native.com/_agent-native/actions/get-plan-blocks?format=reference",
    );
    expect(calls[0].method).toBe("GET");
    expect(fs.readFileSync(out, "utf8")).toContain("## Blocks");
  });

  it("writes schema catalog output when requested", async () => {
    const dir = tmpDir();
    const fetchFn: typeof fetch = (async () =>
      new Response(
        JSON.stringify({
          reference: "## Blocks",
          blocks: [{ type: "rich-text", tag: "RichText" }],
          count: 1,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      )) as typeof fetch;

    const out = path.join(dir, "plan-blocks.schema.json");
    const result = await fetchPlanBlockCatalog({
      appUrl: "https://plans.example.com",
      format: "schema",
      out,
      fetchFn,
    });

    expect(result.format).toBe("schema");
    expect(JSON.parse(fs.readFileSync(out, "utf8"))).toEqual({
      count: 1,
      blocks: [{ type: "rich-text", tag: "RichText" }],
    });
  });

  it("publishes a visual answer source file to the Plan action", async () => {
    const dir = tmpDir();
    const source = path.join(dir, "visual-answer-source.json");
    const out = path.join(dir, "visual-answer-url.txt");
    fs.writeFileSync(
      source,
      JSON.stringify({
        question: "What is the billing API shape?",
        title: "Billing API visual answer",
        brief: "Shows the request and response contract.",
        repoPath: "BuilderIO/agent-native",
        mdx: {
          "plan.mdx":
            '---\ntitle: Billing API visual answer\n---\n\n<RichText id="summary" data={{ markdown: "## Billing API" }} />\n',
        },
      }),
      "utf-8",
    );

    const bodies: unknown[] = [];
    const fetchFn: typeof fetch = (async (input, init) => {
      expect(String(input)).toBe(
        "https://plan.agent-native.com/_agent-native/actions/visual-answer",
      );
      const headers = init?.headers as Record<string, string>;
      expect(headers.authorization).toBe("Bearer plan-token");
      bodies.push(JSON.parse(String(init?.body ?? "{}")));
      return new Response(
        JSON.stringify({ planId: "plan_answer", url: "/plans/plan_answer" }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as typeof fetch;

    const result = await publishVisualAnswerSource({
      appUrl: "https://plan.agent-native.com",
      token: "plan-token",
      sourcePath: source,
      out,
      sourceUrl: "https://github.com/BuilderIO/agent-native",
      fetchFn,
      cwd: dir,
    });

    expect(result.url).toBe("https://plan.agent-native.com/plans/plan_answer");
    expect(fs.readFileSync(out, "utf8").trim()).toBe(result.url);
    expect(bodies[0]).toMatchObject({
      question: "What is the billing API shape?",
      title: "Billing API visual answer",
      brief: "Shows the request and response contract.",
      repoPath: "BuilderIO/agent-native",
      sourceUrl: "https://github.com/BuilderIO/agent-native",
      sourceType: "code",
      visibility: "org",
      status: "review",
    });
  });
});
