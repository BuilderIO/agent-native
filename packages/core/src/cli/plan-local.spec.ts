import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  buildLocalPlanPreviewHtml,
  localPlanFolderName,
  readLocalPlanFiles,
  startLocalPlanBridge,
  verifyLocalPlanBridge,
  writeLocalPlanPreview,
} from "./plan-local.js";
import { fetchPlanBlockCatalog } from "./plan-blocks.js";

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
});
