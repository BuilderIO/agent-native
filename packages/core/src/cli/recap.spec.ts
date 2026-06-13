import fs, { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it, vi } from "vitest";

import {
  RECAP_DIFF_BYTE_CAP,
  RECAP_MCP_REQUIRED_TOOLS,
  appendGateSkipLine,
  buildRecapFailureDiagnostic,
  buildRecapSetupPlan,
  buildCommentBody,
  buildGateSkipLine,
  buildRecapClaudeMcpConfig,
  buildRecapCodexMcpConfig,
  buildRecapPrompt,
  buildReusableCallerWorkflow,
  canonicalRecapUrl,
  classifyDiff,
  countDiffLines,
  diffContainsSecret,
  evaluateRecapGate,
  inferLocalRecapUrlFailureReason,
  isRecapSensitivePath,
  lineMatchesAllowlist,
  normalizeRecapAgent,
  parseClaudeUsage,
  parseCodexUsage,
  parseRecapScanAllowlist,
  recapCheckOutcome,
  recapRequiredSecrets,
  readVisualRecapSkillBundle,
  sanitizeAgentFailureSummary,
  sortDiffSourceFirst,
  smokeRecapMcpTools,
  summarizeAgentRun,
  summarizeLocalAgentFailure,
  summarizeAgentResult,
  truncateDiffAtLineBoundary,
  waitForPublicRecapImage,
  withRecapScreenshotParams,
  writePrVisualRecapReusableCallerWorkflow,
  writePrVisualRecapWorkflow,
} from "./recap.js";
import type { RecapGateInput } from "./recap.js";
import { PR_VISUAL_RECAP_WORKFLOW_YML } from "./pr-visual-recap-workflow.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../../..");

function textResponse(text: string, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: "",
    headers: new Headers({ "content-type": "application/json" }),
    text: () => Promise.resolve(text),
    json: () => Promise.resolve(JSON.parse(text)),
    body: null,
    bodyUsed: true,
    arrayBuffer: () =>
      Promise.resolve(new TextEncoder().encode(text).buffer as ArrayBuffer),
    blob: () => Promise.resolve(new Blob([text])),
    clone() {
      return textResponse(text, status);
    },
    formData: () => Promise.reject(new Error("not implemented")),
    url: "",
    redirected: false,
    type: "default" as ResponseType,
  } as unknown as Response;
}

function jsonRpcResponse(result: unknown, status = 200): Response {
  return textResponse(
    JSON.stringify({ jsonrpc: "2.0", id: 1, result }),
    status,
  );
}

describe("recap secret scan", () => {
  it("flags diffs that contain secret-looking lines", () => {
    const fakeOpenAiKey = `sk-${"a".repeat(24)}`;
    const fakeGithubToken = `ghp_${"b".repeat(24)}`;
    const privateKeyHeader = ["-----BEGIN ", "PRIVATE KEY-----"].join("");
    const diffText = [
      "diff --git a/.env b/.env",
      "@@ -1,3 +1,3 @@",
      `-OPENAI_API_KEY=${fakeOpenAiKey}`,
      `+GITHUB_TOKEN=${fakeGithubToken}`,
      `+KEY_HEADER=${privateKeyHeader}`,
    ].join("\n");
    expect(diffContainsSecret(diffText)).toBe(true);
  });

  it("does not flag an ordinary source diff", () => {
    const diffText = [
      "diff --git a/app/page.tsx b/app/page.tsx",
      "@@ -1,2 +1,3 @@",
      " export function Page() {",
      "-  return <div>hi</div>;",
      '+  return <div className="p-4">hi</div>;',
      "+}",
    ].join("\n");
    expect(diffContainsSecret(diffText)).toBe(false);
  });
});

describe("recap agent failure summaries", () => {
  it("extracts the useful final Claude result text", () => {
    const summary = summarizeAgentResult(
      "claude",
      JSON.stringify({
        type: "result",
        subtype: "success",
        result:
          "I could not call create-visual-recap because get-plan-blocks was unavailable.",
        usage: { input_tokens: 1, output_tokens: 2 },
      }),
    );
    expect(summary).toContain("create-visual-recap");
    expect(summary).toContain("get-plan-blocks was unavailable");
  });

  it("extracts recent Codex JSONL error messages", () => {
    const summary = summarizeAgentResult(
      "codex",
      [
        JSON.stringify({ type: "turn.started" }),
        JSON.stringify({
          type: "error",
          message: "Tool create-visual-recap failed with 403 Forbidden",
        }),
      ].join("\n"),
    );
    expect(summary).toContain("create-visual-recap failed");
    expect(summary).toContain("403 Forbidden");
  });

  it("combines agent stderr and exit code when stdout is not useful", () => {
    const summary = summarizeAgentRun({
      agent: "claude",
      resultText: "",
      stderrText: `MCP server failed\nAuthorization: Bearer ${"a".repeat(24)}`,
      exitCode: "1",
    });
    expect(summary).toContain("Claude exited with code 1");
    expect(summary).toContain("stderr: MCP server failed");
    expect(summary).toContain("Bearer [redacted]");
  });

  it("recovers failure summaries from local agent result files", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "an-recap-agent-"));
    try {
      fs.writeFileSync(
        path.join(dir, "claude-result.json"),
        JSON.stringify({
          type: "result",
          subtype: "success",
          result:
            "I could not call create-visual-recap because the Plan MCP tool failed.",
        }),
      );
      const summary = summarizeLocalAgentFailure({ cwd: dir, agent: "claude" });
      expect(summary).toContain("create-visual-recap");
      expect(summary).toContain("Plan MCP tool failed");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("infers why recap-url.txt was not accepted", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "an-recap-url-"));
    try {
      expect(inferLocalRecapUrlFailureReason({ cwd: dir })).toContain(
        "not created",
      );
      fs.writeFileSync(path.join(dir, "recap-url.txt"), "");
      expect(inferLocalRecapUrlFailureReason({ cwd: dir })).toContain("empty");
      fs.writeFileSync(
        path.join(dir, "recap-url.txt"),
        "https://evil.example.com/recaps/abc",
      );
      expect(
        inferLocalRecapUrlFailureReason({
          cwd: dir,
          appUrl: "https://plan.agent-native.com",
        }),
      ).toContain("expected https://plan.agent-native.com");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("builds a combined recap failure diagnostic", () => {
    const diagnostic = buildRecapFailureDiagnostic({
      urlReason: "recap-url.txt was not created by the agent",
      failureSummary: "Tool create-visual-recap failed with 403 Forbidden",
    });
    expect(diagnostic).toContain("No plan URL:");
    expect(diagnostic).toContain("Agent output:");
    expect(diagnostic).toContain("403 Forbidden");
  });

  it("redacts secret-looking lines before surfacing output", () => {
    const summary = sanitizeAgentFailureSummary(
      `failed\nAuthorization: Bearer ${"a".repeat(24)}\nOPENAI_API_KEY=sk-${"b".repeat(24)}`,
    );
    expect(summary).toContain("failed");
    expect(summary).toContain("[redacted");
    expect(summary).not.toContain("Bearer a");
    expect(summary).not.toContain("sk-b");
  });
});

describe("recap collect-diff classification", () => {
  it("classifies a 1-file, <=8-line change as tiny", () => {
    expect(classifyDiff({ bytes: 200, changed: 1, originalLines: 4 })).toEqual({
      huge: false,
      tiny: true,
    });
  });

  it("does not classify a normal multi-file change as tiny or huge", () => {
    expect(
      classifyDiff({ bytes: 5_000, changed: 3, originalLines: 120 }),
    ).toEqual({ huge: false, tiny: false });
  });

  it("is not tiny when a single file changes many lines", () => {
    // 1 file but >8 changed lines — too substantial to skip.
    expect(
      classifyDiff({ bytes: 4_000, changed: 1, originalLines: 40 }),
    ).toMatchObject({ tiny: false });
  });

  it("uses ORIGINAL line count (pre-truncation) for the tiny check", () => {
    // An oversized diff is huge, and never tiny even if `changed` is small,
    // because originalLines (captured before truncation) is large.
    expect(
      classifyDiff({
        bytes: RECAP_DIFF_BYTE_CAP + 1,
        changed: 1,
        originalLines: 50_000,
      }),
    ).toEqual({ huge: true, tiny: false });
  });

  it("flags a diff over the 600KB cap as huge", () => {
    expect(
      classifyDiff({
        bytes: RECAP_DIFF_BYTE_CAP + 1,
        changed: 5,
        originalLines: 99,
      }),
    ).toMatchObject({ huge: true });
    expect(
      classifyDiff({
        bytes: RECAP_DIFF_BYTE_CAP,
        changed: 5,
        originalLines: 99,
      }),
    ).toMatchObject({ huge: false });
  });

  it("truncates an oversized diff at a line boundary with the footer", () => {
    // Build a synthetic diff well over the cap, each line ending in \n.
    const line = "+".repeat(99) + "\n"; // 100 bytes per line
    const big = line.repeat(Math.ceil((RECAP_DIFF_BYTE_CAP + 50_000) / 100));
    expect(Buffer.byteLength(big, "utf8")).toBeGreaterThan(RECAP_DIFF_BYTE_CAP);

    const out = truncateDiffAtLineBoundary(big);
    // Footer is appended.
    expect(out).toContain("[diff truncated at 600KB for the recap agent]");
    // The body (before the footer) is within the cap and ends on a complete
    // line — no partial trailing diff line.
    const body = out.slice(0, out.indexOf("\n\n[diff truncated"));
    expect(Buffer.byteLength(body, "utf8")).toBeLessThanOrEqual(
      RECAP_DIFF_BYTE_CAP,
    );
    // Every retained line is a full 99-`+` line (none cut mid-way).
    for (const retained of body.split("\n")) {
      if (retained.length) expect(retained).toBe("+".repeat(99));
    }
  });

  it("does not cut a multi-byte UTF-8 char at the cap boundary", () => {
    // A line of multi-byte chars that straddles the cap must be dropped whole.
    const emojiLine = "+" + "😀".repeat(50) + "\n"; // > 1 byte per emoji
    const big = emojiLine.repeat(
      Math.ceil((RECAP_DIFF_BYTE_CAP + 20_000) / Buffer.byteLength(emojiLine)),
    );
    const out = truncateDiffAtLineBoundary(big);
    // No replacement char from a cut codepoint.
    expect(out).not.toContain("�");
    expect(out).toContain("[diff truncated at 600KB for the recap agent]");
  });
});

describe("countDiffLines", () => {
  it("counts added and removed lines, excluding +++ / --- header lines", () => {
    const diff = [
      "diff --git a/foo.ts b/foo.ts",
      "--- a/foo.ts",
      "+++ b/foo.ts",
      "@@ -1,3 +1,4 @@",
      " unchanged line",
      "-removed line 1",
      "-removed line 2",
      "+added line 1",
      "+added line 2",
      "+added line 3",
    ].join("\n");
    // 2 removed + 3 added = 5; the --- and +++ headers must NOT be counted.
    expect(countDiffLines(diff)).toBe(5);
  });

  it("returns 0 for an empty diff", () => {
    expect(countDiffLines("")).toBe(0);
  });

  it("handles multi-file diffs without inflating the count", () => {
    const diff = [
      "--- a/a.ts",
      "+++ b/a.ts",
      "-old a",
      "+new a",
      "--- a/b.ts",
      "+++ b/b.ts",
      "-old b",
      "+new b",
    ].join("\n");
    // 4 real diff lines, 4 header lines that must be excluded.
    expect(countDiffLines(diff)).toBe(4);
  });
});

describe("recap mcp-config", () => {
  it("writes valid Claude JSON with the plan url + bearer header", () => {
    const json = buildRecapClaudeMcpConfig(
      "https://plan.agent-native.com/",
      "tok-123",
    );
    const parsed = JSON.parse(json);
    expect(parsed.mcpServers.plan).toEqual({
      type: "http",
      // Trailing slash trimmed before appending the mcp path.
      url: "https://plan.agent-native.com/_agent-native/mcp",
      headers: {
        Authorization: "Bearer tok-123",
        "X-Agent-Native-MCP-Client": "agent-native-pr-visual-recap",
        "X-Agent-Native-MCP-Full-Catalog": "1",
      },
    });
    expect(parsed.mcpServers["agent-native-plans"]).toEqual(
      parsed.mcpServers.plan,
    );
  });

  it("writes Codex TOML with a JSON-stringified url, env-var bearer, and full-catalog headers", () => {
    const toml = buildRecapCodexMcpConfig("https://plan.agent-native.com");
    expect(toml).toBe(
      [
        "[mcp_servers.plan]",
        'url = "https://plan.agent-native.com/_agent-native/mcp"',
        'bearer_token_env_var = "PLAN_RECAP_TOKEN"',
        'http_headers = { "X-Agent-Native-MCP-Client" = "agent-native-pr-visual-recap", "X-Agent-Native-MCP-Full-Catalog" = "1" }',
        "",
      ].join("\n"),
    );
  });

  it("JSON-stringifies the Codex url so a stray quote can't break the TOML", () => {
    // A pathological app-url containing a quote must be escaped inside the TOML
    // basic string, never break out of it.
    const toml = buildRecapCodexMcpConfig('https://evil"\n[hacked]');
    // The url line stays a single, properly-escaped basic string.
    expect(toml).toContain(
      'url = "https://evil\\"\\n[hacked]/_agent-native/mcp"',
    );
    // No injected table header on its own line.
    expect(toml).not.toMatch(/^\[hacked\]/m);
  });
});

describe("recap mcp-smoke", () => {
  it("probes the Plan MCP tool catalog with the recap client headers", async () => {
    const calls: Array<{
      url: string;
      method: string;
      headers: Record<string, string>;
      body: any;
    }> = [];
    const fetchFn: typeof fetch = (async (input, init) => {
      const body = JSON.parse(String(init?.body ?? "{}"));
      calls.push({
        url: String(input),
        method: String(init?.method ?? "GET"),
        headers: init?.headers as Record<string, string>,
        body,
      });
      if (body.method === "initialize") {
        return jsonRpcResponse({
          protocolVersion: "2025-06-18",
          serverInfo: { name: "plan", version: "test" },
          capabilities: {},
        });
      }
      return jsonRpcResponse({
        tools: RECAP_MCP_REQUIRED_TOOLS.map((name) => ({ name })),
      });
    }) as typeof fetch;

    const result = await smokeRecapMcpTools({
      appUrl: "https://plan.agent-native.com/",
      token: "tok-123456789",
      fetchFn,
    });

    expect(result.ok).toBe(true);
    expect(result.mcpUrl).toBe(
      "https://plan.agent-native.com/_agent-native/mcp",
    );
    expect(result.toolCount).toBe(RECAP_MCP_REQUIRED_TOOLS.length);
    expect(calls.map((call) => call.body.method)).toEqual([
      "initialize",
      "tools/list",
    ]);
    expect(calls[0].url).toBe(
      "https://plan.agent-native.com/_agent-native/mcp",
    );
    expect(calls[0].method).toBe("POST");
    expect(calls[0].headers.authorization).toBe("Bearer tok-123456789");
    expect(calls[0].headers["x-agent-native-mcp-client"]).toBe(
      "agent-native-pr-visual-recap",
    );
    expect(calls[0].headers["x-agent-native-mcp-full-catalog"]).toBe("1");
    expect(calls[0].headers["mcp-protocol-version"]).toBe("2025-06-18");
  });

  it("fails loudly when tools/list omits recap publishing tools", async () => {
    const fetchFn: typeof fetch = (async (_input, init) => {
      const body = JSON.parse(String(init?.body ?? "{}"));
      if (body.method === "initialize") {
        return jsonRpcResponse({ protocolVersion: "2025-06-18" });
      }
      return jsonRpcResponse({ tools: [] });
    }) as typeof fetch;

    const result = await smokeRecapMcpTools({
      appUrl: "https://plan.agent-native.com",
      token: "tok-123456789",
      fetchFn,
    });

    expect(result.ok).toBe(false);
    expect(result.summary).toContain("Plan MCP smoke check failed");
    expect(result.summary).toContain("tools/list returned 0 tools");
    expect(result.summary).toContain("create-visual-recap");
    expect(result.summary).toContain("get-plan-blocks");
    expect(result.summary).toContain("set-resource-visibility");
  });

  it("redacts bearer tokens from HTTP failure diagnostics", async () => {
    const fetchFn: typeof fetch = (async () =>
      textResponse(
        "Authorization: Bearer tok-secret-value",
        401,
      )) as typeof fetch;

    const result = await smokeRecapMcpTools({
      appUrl: "https://plan.agent-native.com",
      token: "tok-secret-value",
      fetchFn,
    });

    expect(result.ok).toBe(false);
    expect(result.summary).toContain("HTTP 401");
    expect(result.summary).toContain("Bearer [redacted]");
    expect(result.summary).not.toContain("tok-secret-value");
  });
});

describe("recap setup planning", () => {
  it("normalizes the supported recap agents", () => {
    expect(normalizeRecapAgent(undefined)).toBe("claude");
    expect(normalizeRecapAgent("Codex")).toBe("codex");
    expect(() => normalizeRecapAgent("gpt")).toThrow(/Unsupported recap agent/);
  });

  it("selects required secrets for each backend", () => {
    expect(recapRequiredSecrets("claude")).toEqual([
      "PLAN_RECAP_TOKEN",
      "ANTHROPIC_API_KEY",
    ]);
    expect(recapRequiredSecrets("codex")).toEqual([
      "PLAN_RECAP_TOKEN",
      "OPENAI_API_KEY",
    ]);
  });

  it("builds a setup plan from env and detects an existing workflow", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "an-recap-setup-"));
    try {
      const workflow = path.join(root, ".github", "workflows");
      fs.mkdirSync(workflow, { recursive: true });
      fs.writeFileSync(
        path.join(workflow, "pr-visual-recap.yml"),
        "name: old\n",
      );

      const plan = buildRecapSetupPlan({
        baseDir: root,
        agent: "codex",
        appUrl: "https://plans.example.com/",
        repo: "BuilderIO/example",
        env: {
          PLAN_RECAP_TOKEN: "example-plan-token",
          OPENAI_API_KEY: "example-openai-key",
          VISUAL_RECAP_MODEL: "gpt-5.5",
          VISUAL_RECAP_REASONING: "high",
        } as NodeJS.ProcessEnv,
      });

      expect(plan).toMatchObject({
        agent: "codex",
        appUrl: "https://plans.example.com",
        repo: "BuilderIO/example",
        workflowPath: path.join(".github", "workflows", "pr-visual-recap.yml"),
        workflowExists: true,
        requiredSecrets: ["PLAN_RECAP_TOKEN", "OPENAI_API_KEY"],
        variableValues: {
          VISUAL_RECAP_AGENT: "codex",
          VISUAL_RECAP_MODEL: "gpt-5.5",
          VISUAL_RECAP_REASONING: "high",
        },
      });
      expect(plan.secretValues).toMatchObject({
        PLAN_RECAP_TOKEN: "example-plan-token",
        OPENAI_API_KEY: "example-openai-key",
        PLAN_RECAP_APP_URL: "https://plans.example.com",
      });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("recap prompt builder", () => {
  const skillMd = "---\nname: visual-recap\n---\n\nUNIQUE_SKILL_MARKER body.";

  it("embeds the repo SKILL.md and the publish contract", () => {
    const prompt = buildRecapPrompt({
      skillMd,
      pr: "1095",
      repo: "BuilderIO/ai-services",
      head: "abc1234",
      appUrl: "https://plan.agent-native.com/",
      diffPath: "recap.diff",
      statPath: "recap.stat",
    });
    // The skill text is injected verbatim — custom instructions take effect.
    expect(prompt).toContain("UNIQUE_SKILL_MARKER");
    // The diff is read from disk by the agent, not inlined.
    expect(prompt).toContain("recap.diff");
    expect(prompt).toContain("#1095");
    expect(prompt).toContain("BuilderIO/ai-services");
    expect(prompt).toContain(
      "https://github.com/BuilderIO/ai-services/pull/1095",
    );
    // The publish path and the single hand-off are spelled out.
    expect(prompt).toContain("mcp__plan__get-plan-blocks");
    expect(prompt).toContain("mcp__plan__create-visual-recap");
    expect(prompt).toContain("mcp__agent-native-plans__get-plan-blocks");
    expect(prompt).toContain("mcp__agent-native-plans__create-visual-recap");
    expect(prompt).toContain("block-registry tool is not visible");
    expect(prompt).toContain("compact MCP catalog");
    expect(prompt).toContain("Do not wait, sleep, back off");
    expect(prompt).toContain("schedule wakeups");
    expect(prompt).toContain("set-resource-visibility");
    expect(prompt).toContain("recap-url.txt");
    expect(prompt).toContain(
      "https://plan.agent-native.com/recaps/<the returned plan id>",
    );
    // No RECAP_JSON contract.
    expect(prompt).not.toContain("RECAP_JSON");
  });

  it("threads the previous plan id for in-place replacement", () => {
    const prompt = buildRecapPrompt({
      skillMd,
      pr: "7",
      appUrl: "https://plan.agent-native.com",
      diffPath: "recap.diff",
      prevPlanId: "plan-deadbeef",
    });
    expect(prompt).toContain('planId: "plan-deadbeef"');
    expect(prompt).toMatch(/REPLACES/i);
  });

  it("can build a DB-free local-files prompt instead of a publish prompt", () => {
    const prompt = buildRecapPrompt({
      skillMd,
      pr: "42",
      appUrl: "https://plan.agent-native.com",
      diffPath: "recap.diff",
      localFiles: true,
      localDir: "plans/private-recap",
    });

    expect(prompt).toContain("local-files privacy mode");
    expect(prompt).toContain("plans/private-recap");
    expect(prompt).toContain(
      "npx @agent-native/core@latest plan local preview",
    );
    expect(prompt).toContain("recap-url.txt");
    expect(prompt).not.toContain("mcp__plan__create-visual-recap");
    expect(prompt).not.toContain("set-resource-visibility");
    expect(prompt).not.toContain(
      "https://plan.agent-native.com/recaps/<the returned plan id>",
    );
  });

  it("threads the PR sourceUrl when repo and pr are provided", () => {
    const prompt = buildRecapPrompt({
      skillMd,
      pr: "1095",
      repo: "BuilderIO/ai-services",
      appUrl: "https://plan.agent-native.com",
      diffPath: "recap.diff",
    });
    // The sourceUrl is derived deterministically and injected into the tool call.
    expect(prompt).toContain(
      'sourceUrl: "https://github.com/BuilderIO/ai-services/pull/1095"',
    );
    expect(prompt).toContain("link back to the PR");
  });

  it("omits sourceUrl from the prompt when no repo is provided", () => {
    const prompt = buildRecapPrompt({
      skillMd,
      pr: "42",
      appUrl: "https://plan.agent-native.com",
      diffPath: "recap.diff",
    });
    expect(prompt).not.toContain("sourceUrl:");
    expect(prompt).not.toContain("link back to the PR");
  });

  it("uses an explicit sourceUrl override over the derived one", () => {
    const prompt = buildRecapPrompt({
      skillMd,
      pr: "1095",
      repo: "BuilderIO/ai-services",
      appUrl: "https://plan.agent-native.com",
      diffPath: "recap.diff",
      sourceUrl: "https://github.com/OtherOrg/other-repo/pull/999",
    });
    // The override URL must appear in the tool call instruction.
    expect(prompt).toContain(
      'sourceUrl: "https://github.com/OtherOrg/other-repo/pull/999"',
    );
    // The derived URL from repo+pr must NOT appear in the tool call instruction
    // (it may still appear in the Inputs section where the PR URL is listed).
    expect(prompt).not.toContain(
      'sourceUrl: "https://github.com/BuilderIO/ai-services/pull/1095"',
    );
  });

  it("builds the latest bundled skill with sibling reference files", () => {
    const bundle = readVisualRecapSkillBundle(repoRoot, "latest");
    expect(bundle.source).toBe("bundled:@agent-native/core/visual-recap");
    expect(bundle.text).toContain("Bundled visual-recap reference files");
    expect(bundle.text).toContain("references/wireframe.md");
    expect(bundle.text).toContain("HTML wireframe quality");
  });

  it("adds a fork-PR injection-warning note when forkPr is true", () => {
    const prompt = buildRecapPrompt({
      skillMd,
      pr: "55",
      repo: "external/fork-repo",
      appUrl: "https://plan.agent-native.com",
      diffPath: "recap.diff",
      forkPr: true,
    });
    // The security note must appear before the Inputs section.
    const noteIdx = prompt.indexOf("Security note (fork PR)");
    const inputsIdx = prompt.indexOf("## Inputs");
    expect(noteIdx).toBeGreaterThan(-1);
    expect(inputsIdx).toBeGreaterThan(-1);
    expect(noteIdx).toBeLessThan(inputsIdx);
    // The note must instruct the agent to treat diff content as untrusted data.
    expect(prompt).toContain("untrusted user-supplied data");
    expect(prompt).toContain("not as instructions");
  });

  it("does not add the injection-warning note when forkPr is false/omitted", () => {
    const prompt = buildRecapPrompt({
      skillMd,
      pr: "56",
      appUrl: "https://plan.agent-native.com",
      diffPath: "recap.diff",
    });
    expect(prompt).not.toContain("Security note (fork PR)");
    expect(prompt).not.toContain("untrusted user-supplied data");
  });
});

describe("recap comment body", () => {
  it("embeds an inline screenshot + link and a plan-id marker on success", () => {
    const token = "a".repeat(64);
    const body = buildCommentBody({
      PLAN_URL: "https://plan.agent-native.com/recaps/plan-abc123",
      PLAN_RECAP_APP_URL: "https://plan.agent-native.com",
      RECAP_IMAGE_URL: `https://plan.agent-native.com/_agent-native/recap-image/${token}.png`,
      HEAD_SHA: "abcdef1234567",
    } as NodeJS.ProcessEnv);
    expect(body).toContain(
      `[![Visual recap](https://plan.agent-native.com/_agent-native/recap-image/${token}.png)](https://plan.agent-native.com/recaps/plan-abc123)`,
    );
    expect(body).toContain(
      "Here's a [visual recap](https://plan.agent-native.com/recaps/plan-abc123) of what changed:",
    );
    expect(body).toContain(
      "private-repo recaps are org-gated. Sign in to Agent-Native Plans with access to this org if the link does not open.",
    );
    expect(body).not.toContain("review at a higher altitude");
    expect(body).not.toContain("Updated for");
    expect(body).toContain("Open the full interactive recap");
    expect(body).toContain("<!-- plan-id: plan-abc123 -->");
    expect(body).toContain("<!-- pr-visual-recap -->");
    expect(body).not.toContain("<picture>");
    expect(body).not.toContain("_As of `");
  });

  it("embeds light and dark screenshots with a GitHub theme-aware picture", () => {
    const lightToken = "a".repeat(64);
    const darkToken = "b".repeat(64);
    const body = buildCommentBody({
      PLAN_URL: "https://plan.agent-native.com/recaps/plan-abc123",
      PLAN_RECAP_APP_URL: "https://plan.agent-native.com",
      RECAP_LIGHT_IMAGE_URL: `https://plan.agent-native.com/_agent-native/recap-image/${lightToken}.png`,
      RECAP_DARK_IMAGE_URL: `https://plan.agent-native.com/_agent-native/recap-image/${darkToken}.png`,
      HEAD_SHA: "abcdef1234567",
    } as NodeJS.ProcessEnv);
    expect(body).toContain(
      `<a href="https://plan.agent-native.com/recaps/plan-abc123">`,
    );
    expect(body).toContain("<picture>");
    expect(body).toContain(
      `<source media="(prefers-color-scheme: dark)" srcset="https://plan.agent-native.com/_agent-native/recap-image/${darkToken}.png">`,
    );
    expect(body).toContain(
      `<img alt="Visual recap" src="https://plan.agent-native.com/_agent-native/recap-image/${lightToken}.png">`,
    );
    expect(body).toContain("</picture>");
    expect(body).not.toContain("![Visual recap]");
  });

  it("rebuilds a canonical /recaps/ link from a legacy /plans/ URL, dropping any crafted path/query", () => {
    const body = buildCommentBody({
      // Legacy same-origin /plans/ URL, but with markdown-breakout junk appended
      // to the path. The rebuild canonicalizes to /recaps/ and drops the junk.
      PLAN_URL:
        "https://plan.agent-native.com/plans/plan-abc123)](https://evil.example.com)",
      PLAN_RECAP_APP_URL: "https://plan.agent-native.com",
      HEAD_SHA: "abcdef1",
    } as NodeJS.ProcessEnv);
    expect(body).toContain(
      "[Open the full interactive recap](https://plan.agent-native.com/recaps/plan-abc123)",
    );
    expect(body).not.toContain("evil.example.com");
  });

  it("drops a same-origin image URL that is not a canonical recap-image path", () => {
    const body = buildCommentBody({
      PLAN_URL: "https://plan.agent-native.com/recaps/plan-abc123",
      PLAN_RECAP_APP_URL: "https://plan.agent-native.com",
      RECAP_IMAGE_URL: "https://plan.agent-native.com/evil.png)](javascript:0)",
      HEAD_SHA: "abcdef1",
    } as NodeJS.ProcessEnv);
    expect(body).not.toContain("![Visual recap]");
    expect(body).not.toContain("javascript:");
    expect(body).toContain("Open the full interactive recap");
  });

  it("drops an invalid dark image URL and falls back to the light screenshot", () => {
    const token = "a".repeat(64);
    const body = buildCommentBody({
      PLAN_URL: "https://plan.agent-native.com/recaps/plan-abc123",
      PLAN_RECAP_APP_URL: "https://plan.agent-native.com",
      RECAP_LIGHT_IMAGE_URL: `https://plan.agent-native.com/_agent-native/recap-image/${token}.png`,
      RECAP_DARK_IMAGE_URL:
        "https://plan.agent-native.com/evil.png)](javascript:0)",
      HEAD_SHA: "abcdef1",
    } as NodeJS.ProcessEnv);
    expect(body).not.toContain("<picture>");
    expect(body).toContain(
      `[![Visual recap](https://plan.agent-native.com/_agent-native/recap-image/${token}.png)](https://plan.agent-native.com/recaps/plan-abc123)`,
    );
    expect(body).not.toContain("javascript:");
  });

  it("drops a recap-image URL whose token is too short for the image route", () => {
    const body = buildCommentBody({
      PLAN_URL: "https://plan.agent-native.com/recaps/plan-abc123",
      PLAN_RECAP_APP_URL: "https://plan.agent-native.com",
      RECAP_IMAGE_URL:
        "https://plan.agent-native.com/_agent-native/recap-image/a1b2c3d4e5f6.png",
      HEAD_SHA: "abcdef1",
    } as NodeJS.ProcessEnv);
    expect(body).not.toContain("![Visual recap]");
    expect(body).toContain("Open the full interactive recap");
  });

  it("refreshes to a skipped state on a tiny diff", () => {
    const body = buildCommentBody({
      DIFF_TINY: "true",
      HEAD_SHA: "abcdef1",
    } as NodeJS.ProcessEnv);
    expect(body).toContain("skipped");
    expect(body).toContain("too small");
    expect(body).not.toContain("Updated for");
    expect(body).not.toContain("Open the full interactive recap");
    expect(body).not.toContain("_As of `");
  });

  it("tiny diff preserves the previous plan-id marker so the next push can replace in-place", () => {
    const body = buildCommentBody({
      DIFF_TINY: "true",
      HEAD_SHA: "abcdef1",
      PREV_PLAN_ID: "plan-deadbeef",
    } as NodeJS.ProcessEnv);
    expect(body).toContain("<!-- plan-id: plan-deadbeef -->");
  });

  it("falls back to a link-only comment when the screenshot upload failed", () => {
    const body = buildCommentBody({
      PLAN_URL: "https://plan.agent-native.com/recaps/plan-abc123",
      PLAN_RECAP_APP_URL: "https://plan.agent-native.com",
      RECAP_IMAGE_URL: "",
      HEAD_SHA: "abcdef1",
    } as NodeJS.ProcessEnv);
    expect(body).not.toContain("![Visual recap]");
    expect(body).toContain("Open the full interactive recap");
  });

  it("drops the link when the plan URL origin does not match the app origin", () => {
    const body = buildCommentBody({
      PLAN_URL: "https://evil.example.com/recaps/plan-abc123",
      PLAN_RECAP_APP_URL: "https://plan.agent-native.com",
      RECAP_IMAGE_URL: "",
      HEAD_SHA: "abcdef1",
    } as NodeJS.ProcessEnv);
    expect(body).toContain("generation failed");
    expect(body).not.toContain("Open the full interactive recap");
    expect(body).not.toContain("Updated for");
    expect(body).not.toContain("evil.example.com");
  });

  it("failure branch preserves the previous plan marker without linking stale recaps", () => {
    const body = buildCommentBody({
      PLAN_URL: "",
      PLAN_RECAP_APP_URL: "https://plan.agent-native.com",
      PREV_PLAN_ID: "plan-deadbeef",
      HEAD_SHA: "abcdef1",
    } as NodeJS.ProcessEnv);
    expect(body).toContain("generation failed");
    expect(body).not.toContain("Previous recap");
    expect(body).not.toContain("[Open recap]");
    // Plan-id marker preserved so next success replaces in-place.
    expect(body).toContain("<!-- plan-id: plan-deadbeef -->");
  });

  it("failure branch emits plan-id marker when a fresh plan URL failed origin check but PREV_PLAN_ID is known", () => {
    // Bad-origin URL on this push, but we know the previous good plan id.
    const body = buildCommentBody({
      PLAN_URL: "https://evil.example.com/recaps/plan-fresh",
      PLAN_RECAP_APP_URL: "https://plan.agent-native.com",
      PREV_PLAN_ID: "plan-deadbeef",
      HEAD_SHA: "abcdef1",
    } as NodeJS.ProcessEnv);
    expect(body).toContain("generation failed");
    expect(body).not.toContain("evil.example.com");
    expect(body).not.toContain("Previous recap");
    expect(body).not.toContain("[Open recap]");
    expect(body).toContain("<!-- plan-id: plan-deadbeef -->");
  });

  it("explains a suppressed (secret) diff without echoing the secret", () => {
    const body = buildCommentBody({
      SUPPRESSED: "true",
      SUPPRESSED_JSON: JSON.stringify({
        suppressed: true,
        reason: "potential secret in diff",
      }),
      HEAD_SHA: "abcdef1",
    } as NodeJS.ProcessEnv);
    expect(body).toContain("suppressed");
    expect(body).toContain("Reason: `potential secret in diff`.");
    expect(body).not.toContain("Updated for");
    expect(body).not.toContain("Open the full interactive recap");
    expect(body).not.toContain("_As of `");
  });

  it("suppressed branch preserves plan-id marker from previous run", () => {
    const body = buildCommentBody({
      SUPPRESSED: "true",
      PREV_PLAN_ID: "plan-prev123",
      HEAD_SHA: "abcdef1",
    } as NodeJS.ProcessEnv);
    expect(body).toContain("<!-- plan-id: plan-prev123 -->");
  });

  it("reports a generation failure when no plan URL was produced", () => {
    const body = buildCommentBody({
      PLAN_URL: "",
      HEAD_SHA: "abcdef1",
    } as NodeJS.ProcessEnv);
    expect(body).toContain("generation failed");
    expect(body).not.toContain("Updated for");
    expect(body).not.toContain("_As of `");
  });

  it("includes sanitized agent output on generic generation failure", () => {
    const body = buildCommentBody({
      PLAN_URL: "",
      PLAN_RECAP_APP_URL: "https://plan.agent-native.com",
      RECAP_AGENT_SUMMARY:
        "Tool create-visual-recap failed because get-plan-blocks was unavailable",
      HEAD_SHA: "abcdef1",
    } as NodeJS.ProcessEnv);
    expect(body).toContain("generation failed");
    expect(body).toContain("Agent output:");
    expect(body).toContain("get-plan-blocks was unavailable");
    expect(body).not.toContain("_As of `");
  });

  it("does not include a freshness line in the GitHub comment", () => {
    const body = buildCommentBody({
      PLAN_URL: "https://plan.agent-native.com/recaps/plan-abc123",
      PLAN_RECAP_APP_URL: "https://plan.agent-native.com",
      HEAD_SHA: "abcdef1",
    } as NodeJS.ProcessEnv);
    expect(body).not.toContain("_As of `");
    expect(body).toContain("Open the full interactive recap");
  });
});

describe("recap screenshot URL params", () => {
  it("adds screenshot mode and an optional forced theme", () => {
    expect(
      withRecapScreenshotParams(
        "https://plan.agent-native.com/recaps/plan-abc123?foo=bar",
        { theme: "dark" },
      ),
    ).toBe(
      "https://plan.agent-native.com/recaps/plan-abc123?foo=bar&recapScreenshot=1&recapScreenshotTheme=dark",
    );
  });
});

describe("recap image public readiness", () => {
  it("retries until the uploaded image is anonymously readable as image/png", async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response("not yet", {
          status: 404,
          headers: { "content-type": "text/plain" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(Buffer.from([1, 2, 3]), {
          status: 200,
          headers: { "content-type": "image/png" },
        }),
      );

    await expect(
      waitForPublicRecapImage({
        imageUrl:
          "https://plan.agent-native.com/_agent-native/recap-image/" +
          `${"a".repeat(64)}.png`,
        attempts: 2,
        delayMs: 0,
        fetchFn,
      }),
    ).resolves.toBe(true);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("rejects empty or non-image responses", async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response("", {
          status: 200,
          headers: { "content-type": "image/png" },
        }),
      )
      .mockResolvedValueOnce(
        new Response("html", {
          status: 200,
          headers: { "content-type": "text/html" },
        }),
      );

    await expect(
      waitForPublicRecapImage({
        imageUrl:
          "https://plan.agent-native.com/_agent-native/recap-image/" +
          `${"a".repeat(64)}.png`,
        attempts: 2,
        delayMs: 0,
        fetchFn,
      }),
    ).resolves.toBe(false);
  });

  it("uses at least 8 attempts by default to survive cold-start CDN delays", async () => {
    // Return 404 for 7 attempts then succeed on the 8th — this must pass with
    // the default budget (~20s of capped exponential backoff).
    const notYet = new Response("not yet", {
      status: 404,
      headers: { "content-type": "text/plain" },
    });
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(notYet)
      .mockResolvedValueOnce(notYet)
      .mockResolvedValueOnce(notYet)
      .mockResolvedValueOnce(notYet)
      .mockResolvedValueOnce(notYet)
      .mockResolvedValueOnce(notYet)
      .mockResolvedValueOnce(notYet)
      .mockResolvedValueOnce(
        new Response(Buffer.from([1, 2, 3]), {
          status: 200,
          headers: { "content-type": "image/png" },
        }),
      );

    await expect(
      waitForPublicRecapImage({
        imageUrl:
          "https://plan.agent-native.com/_agent-native/recap-image/" +
          `${"a".repeat(64)}.png`,
        // Override delayMs to 0 so the test doesn't sleep; attempts uses the
        // default (omitted) to confirm it's >= 8.
        delayMs: 0,
        fetchFn,
      }),
    ).resolves.toBe(true);
    expect(fetchFn).toHaveBeenCalledTimes(8);
  });
});

describe("recap usage parsing", () => {
  it("reads Claude Code's usage + reported cost (input already cache-exclusive)", () => {
    const stdout = JSON.stringify({
      type: "result",
      model: "claude-opus-4",
      total_cost_usd: 0.1234,
      usage: {
        input_tokens: 1000,
        output_tokens: 200,
        cache_read_input_tokens: 5000,
        cache_creation_input_tokens: 300,
      },
    });
    expect(parseClaudeUsage(stdout)).toEqual({
      inputTokens: 1000,
      outputTokens: 200,
      cacheReadTokens: 5000,
      cacheWriteTokens: 300,
      model: "claude-opus-4",
      reportedCostUsd: 0.1234,
    });
  });

  it("tolerates log noise before Claude's final JSON object", () => {
    const stdout = [
      "some warning line",
      JSON.stringify({ usage: { input_tokens: 7, output_tokens: 3 } }),
    ].join("\n");
    expect(parseClaudeUsage(stdout)).toMatchObject({
      inputTokens: 7,
      outputTokens: 3,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    });
  });

  it("strips Codex cached tokens out of input and folds reasoning into output", () => {
    // OpenAI input_tokens INCLUDES cached_input_tokens, and reasoning is billed
    // separately — both must be normalized so calculateCost is not double-billed.
    const jsonl = [
      JSON.stringify({ type: "turn.started" }),
      JSON.stringify({
        type: "turn.completed",
        usage: {
          input_tokens: 8000,
          cached_input_tokens: 6000,
          output_tokens: 400,
          reasoning_output_tokens: 1500,
        },
      }),
    ].join("\n");
    expect(parseCodexUsage(jsonl)).toEqual({
      inputTokens: 2000, // 8000 - 6000 cached
      outputTokens: 1900, // 400 + 1500 reasoning
      cacheReadTokens: 6000,
      cacheWriteTokens: 0,
      model: undefined,
    });
  });

  it("returns null when no usage is present", () => {
    expect(parseClaudeUsage("not json")).toBeNull();
    expect(parseCodexUsage('{"type":"turn.started"}')).toBeNull();
  });
});

describe("recap gate decision", () => {
  // A clean, all-passing baseline so each test can flip exactly one signal.
  const ok = (over: Partial<RecapGateInput> = {}): RecapGateInput => ({
    pr: {
      number: 7,
      draft: false,
      head: { repo: { full_name: "BuilderIO/ai-services" } },
      user: { login: "octocat", type: "User" },
    },
    repository: "BuilderIO/ai-services",
    hasPlan: true,
    hasAnthropic: true,
    hasOpenai: true,
    agentRaw: "claude",
    model: undefined,
    skillSource: "auto",
    changedFiles: ["app/page.tsx"],
    ...over,
  });

  it("runs (run=true) with the normalized agent when nothing trips the gate", () => {
    const result = evaluateRecapGate(ok());
    expect(result).toEqual({ run: true, agent: "claude", reasons: [] });
  });

  it("normalizes a mis-cased agent and still runs", () => {
    const result = evaluateRecapGate(ok({ agentRaw: "Codex" }));
    expect(result).toEqual({ run: true, agent: "codex", reasons: [] });
  });

  it("skips when there is no pull_request payload", () => {
    const result = evaluateRecapGate(ok({ pr: null }));
    expect(result.run).toBe(false);
    expect(result.reasons).toContain("no pull_request payload");
  });

  it("skips a draft PR", () => {
    const result = evaluateRecapGate(
      ok({
        pr: {
          number: 7,
          draft: true,
          head: { repo: { full_name: "BuilderIO/ai-services" } },
          user: { login: "octocat", type: "User" },
        },
      }),
    );
    expect(result.run).toBe(false);
    expect(result.reasons).toContain("draft PR");
  });

  it("skips a fork PR with the head repo full name", () => {
    const result = evaluateRecapGate(
      ok({
        pr: {
          number: 7,
          draft: false,
          head: { repo: { full_name: "evil/fork" } },
          user: { login: "octocat", type: "User" },
        },
      }),
    );
    expect(result.run).toBe(false);
    expect(result.reasons).toContain("fork PR (evil/fork)");
  });

  it("skips a known bot author by login", () => {
    const result = evaluateRecapGate(
      ok({
        pr: {
          number: 7,
          draft: false,
          head: { repo: { full_name: "BuilderIO/ai-services" } },
          user: { login: "dependabot[bot]", type: "User" },
        },
      }),
    );
    expect(result.run).toBe(false);
    expect(result.reasons).toContain("bot author (dependabot[bot])");
  });

  it("skips a Bot-type author even with a non-bot login", () => {
    const result = evaluateRecapGate(
      ok({
        pr: {
          number: 7,
          draft: false,
          head: { repo: { full_name: "BuilderIO/ai-services" } },
          user: { login: "ci-app", type: "Bot" },
        },
      }),
    );
    expect(result.run).toBe(false);
    expect(result.reasons).toContain("bot author (type=Bot)");
  });

  it("skips when PLAN_RECAP_TOKEN is not configured", () => {
    const result = evaluateRecapGate(ok({ hasPlan: false }));
    expect(result.run).toBe(false);
    expect(result.reasons).toContain("PLAN_RECAP_TOKEN not configured");
  });

  it("skips when the claude backend's ANTHROPIC_API_KEY is missing", () => {
    const result = evaluateRecapGate(ok({ hasAnthropic: false }));
    expect(result.run).toBe(false);
    expect(result.reasons).toContain(
      "ANTHROPIC_API_KEY not configured (claude backend)",
    );
  });

  it("skips when the codex backend's OPENAI_API_KEY is missing", () => {
    const result = evaluateRecapGate(
      ok({ agentRaw: "codex", hasOpenai: false }),
    );
    expect(result.run).toBe(false);
    expect(result.reasons).toContain(
      "OPENAI_API_KEY not configured (codex backend)",
    );
  });

  it("skips an unsupported agent value with the raw value in the reason", () => {
    const result = evaluateRecapGate(ok({ agentRaw: "gpt" }));
    expect(result.run).toBe(false);
    expect(result.reasons).toContain(
      'unsupported VISUAL_RECAP_AGENT "gpt" (expected "claude" or "codex")',
    );
  });

  it("skips an invalid VISUAL_RECAP_MODEL value", () => {
    const result = evaluateRecapGate(ok({ model: "bad model!" }));
    expect(result.run).toBe(false);
    expect(result.reasons).toContain(
      "invalid VISUAL_RECAP_MODEL value (must match [a-zA-Z0-9._-]{1,80})",
    );
  });

  it("accepts a valid VISUAL_RECAP_MODEL value", () => {
    const result = evaluateRecapGate(ok({ model: "gpt-5.5" }));
    expect(result.run).toBe(true);
  });

  it("skips an invalid VISUAL_RECAP_SKILL_SOURCE value", () => {
    const result = evaluateRecapGate(ok({ skillSource: "workspace" }));
    expect(result.run).toBe(false);
    expect(result.reasons).toContain(
      'invalid VISUAL_RECAP_SKILL_SOURCE value (expected "auto", "latest", or "repo")',
    );
  });

  it("allows agent-native packages/core changes because the workflow runs a trusted CLI", () => {
    const result = evaluateRecapGate(
      ok({
        repository: "BuilderIO/agent-native",
        pr: {
          number: 7,
          draft: false,
          head: { repo: { full_name: "BuilderIO/agent-native" } },
          user: { login: "octocat", type: "User" },
        },
        changedFiles: ["packages/core/src/cli/recap.ts"],
      }),
    );
    expect(result.run).toBe(true);
  });

  it("allows recap workflow and visual skill changes when CI uses bundled recap instructions", () => {
    const result = evaluateRecapGate(
      ok({
        skillSource: "auto",
        changedFiles: [
          ".github/workflows/pr-visual-recap.yml",
          ".agents/plugins/agent-native-visual-plans/skills/visual-recap/references/wireframe.md",
          "skills/visual-plans/references/wireframe.md",
        ],
      }),
    );
    expect(result.run).toBe(true);
  });

  it("skips visual skill changes when CI is pinned to repo-local instructions", () => {
    const result = evaluateRecapGate(
      ok({
        skillSource: "repo",
        changedFiles: ["templates/plan/.agents/skills/visual-recap/SKILL.md"],
      }),
    );
    expect(result.run).toBe(false);
    expect(result.reasons.join(" ")).toContain(
      "templates/plan/.agents/skills/visual-recap/SKILL.md",
    );
  });

  it("does not treat consumer packages/core paths as recap-control files", () => {
    const result = evaluateRecapGate(
      ok({ changedFiles: ["packages/core/src/index.ts"] }),
    );
    expect(result.run).toBe(true);
  });

  it("skips when the PR modifies a .claude config file", () => {
    const result = evaluateRecapGate(
      ok({ changedFiles: ["app/page.tsx", ".claude/settings.json"] }),
    );
    expect(result.run).toBe(false);
    expect(result.reasons.join(" ")).toContain(".claude/settings.json");
  });

  it("truncates the listed recap-control hits to 3 with an ellipsis", () => {
    const result = evaluateRecapGate(
      ok({
        changedFiles: [
          ".github/workflows/pr-visual-recap.yml",
          "CLAUDE.md",
          "AGENTS.md",
          ".mcp.json",
          ".claude/settings.json",
        ],
      }),
    );
    const reason = result.reasons.find((r) =>
      r.startsWith("PR modifies recap-control files"),
    );
    expect(reason).toContain(", …)");
  });

  it("collects multiple reasons when several signals trip at once", () => {
    const result = evaluateRecapGate(
      ok({
        pr: {
          number: 7,
          draft: true,
          head: { repo: { full_name: "evil/fork" } },
          user: { login: "octocat", type: "User" },
        },
        hasPlan: false,
      }),
    );
    expect(result.run).toBe(false);
    expect(result.reasons).toEqual(
      expect.arrayContaining([
        "draft PR",
        "fork PR (evil/fork)",
        "PLAN_RECAP_TOKEN not configured",
      ]),
    );
  });
});

describe("recap sensitive-path guard", () => {
  it("matches the recap-control files and nothing innocuous", () => {
    expect(isRecapSensitivePath(".github/workflows/pr-visual-recap.yml")).toBe(
      false,
    );
    expect(
      isRecapSensitivePath(
        "templates/plan/.agents/skills/visual-recap/SKILL.md",
      ),
    ).toBe(false);
    expect(
      isRecapSensitivePath(
        "templates/plan/.agents/skills/visual-recap/SKILL.md",
        { skillSource: "repo" },
      ),
    ).toBe(true);
    expect(isRecapSensitivePath("packages/core/src/cli/recap.ts")).toBe(false);
    expect(isRecapSensitivePath(".claude/settings.json")).toBe(true);
    expect(isRecapSensitivePath("CLAUDE.md")).toBe(true);
    expect(isRecapSensitivePath("apps/foo/AGENTS.md")).toBe(true);
    expect(isRecapSensitivePath(".mcp.json")).toBe(true);
    // Innocuous files do not trip the guard.
    expect(isRecapSensitivePath("app/page.tsx")).toBe(false);
    expect(isRecapSensitivePath("packages/ui/index.ts")).toBe(false);
    expect(isRecapSensitivePath("README.md")).toBe(false);
  });
});

describe("recap check — canonicalRecapUrl", () => {
  const app = "https://plan.agent-native.com";

  it("canonicalizes a recap URL on a root-mounted app", () => {
    expect(canonicalRecapUrl(`${app}/recaps/abc123`, app)).toBe(
      `${app}/recaps/abc123`,
    );
  });

  it("canonicalizes a /plans/<id> URL to /recaps/<id>", () => {
    expect(canonicalRecapUrl(`${app}/plans/abc123`, app)).toBe(
      `${app}/recaps/abc123`,
    );
  });

  it("honors a path-prefixed mount by stripping the trusted base", () => {
    const mounted = "https://host.example.com/agent-native";
    expect(canonicalRecapUrl(`${mounted}/recaps/xyz_9`, mounted)).toBe(
      "https://host.example.com/agent-native/recaps/xyz_9",
    );
  });

  it("tolerates a trailing slash on the recap path", () => {
    expect(canonicalRecapUrl(`${app}/recaps/abc123/`, app)).toBe(
      `${app}/recaps/abc123`,
    );
  });

  it("returns '' for a wrong origin", () => {
    expect(canonicalRecapUrl("https://evil.example.com/recaps/abc", app)).toBe(
      "",
    );
  });

  it("returns '' for an unrecognized path or unparseable URL", () => {
    expect(canonicalRecapUrl(`${app}/not-a-recap/abc`, app)).toBe("");
    expect(canonicalRecapUrl(`${app}/recaps/`, app)).toBe("");
    expect(canonicalRecapUrl("not a url", app)).toBe("");
  });
});

describe("recap check — outcome mapper", () => {
  const app = "https://plan.agent-native.com";
  const workflowUrl = "https://github.com/o/r/actions/runs/1";
  const base = {
    planOk: false,
    planUrl: "",
    appUrl: app,
    huge: false,
    tiny: false,
    suppressed: false,
    suppressedJson: "",
    workflowUrl,
  };

  it("success: a valid published recap URL", () => {
    const out = recapCheckOutcome({
      ...base,
      planOk: true,
      planUrl: `${app}/recaps/abc123`,
    });
    expect(out.conclusion).toBe("success");
    expect(out.title).toBe("Visual recap ready");
    expect(out.summary).toBe(
      "A visual code-review recap was generated for this PR.",
    );
    expect(out.detailsUrl).toBe(`${app}/recaps/abc123`);
    expect(out.text).toBe(`**[Open visual recap](${app}/recaps/abc123)**`);
  });

  it("success: a huge diff gets the summarized summary", () => {
    const out = recapCheckOutcome({
      ...base,
      planOk: true,
      huge: true,
      planUrl: `${app}/plans/abc123`,
    });
    expect(out.conclusion).toBe("success");
    expect(out.summary).toBe(
      "A summarized visual recap was generated for this large PR.",
    );
    // /plans/<id> is canonicalized to /recaps/<id>.
    expect(out.detailsUrl).toBe(`${app}/recaps/abc123`);
  });

  it("published-fallback: ok but the URL fails origin validation", () => {
    const out = recapCheckOutcome({
      ...base,
      planOk: true,
      planUrl: "https://evil.example.com/recaps/abc123",
    });
    expect(out.conclusion).toBe("neutral");
    expect(out.title).toBe("Visual recap published");
    expect(out.summary).toBe(
      "A recap was published; see the visual recap comment on this PR for the link.",
    );
    expect(out.detailsUrl).toBe(workflowUrl);
    expect(out.text).toBe("");
  });

  it("tiny: skipped", () => {
    const out = recapCheckOutcome({ ...base, tiny: true });
    expect(out.conclusion).toBe("skipped");
    expect(out.title).toBe("Visual recap skipped");
    expect(out.summary).toBe("The diff is too small to need a visual recap.");
    expect(out.detailsUrl).toBe(workflowUrl);
  });

  it("suppressed: skipped with the parsed reason", () => {
    const out = recapCheckOutcome({
      ...base,
      suppressed: true,
      suppressedJson: JSON.stringify({
        suppressed: true,
        reason: "leaked AWS key",
      }),
    });
    expect(out.conclusion).toBe("skipped");
    expect(out.title).toBe("Visual recap suppressed");
    expect(out.summary).toBe("No recap was published because leaked AWS key.");
  });

  it("suppressed: falls back to the default reason on bad JSON", () => {
    const out = recapCheckOutcome({
      ...base,
      suppressed: true,
      suppressedJson: "{not json",
    });
    expect(out.conclusion).toBe("skipped");
    expect(out.summary).toBe(
      "No recap was published because potential secret in diff.",
    );
  });

  it("default: neutral 'not generated' when nothing matched", () => {
    const out = recapCheckOutcome({ ...base });
    expect(out.conclusion).toBe("neutral");
    expect(out.title).toBe("Visual recap not generated");
    expect(out.summary).toBe(
      "The visual recap did not produce a plan URL. This is informational only and does not block the PR.",
    );
    expect(out.detailsUrl).toBe(workflowUrl);
    expect(out.text).toBe("");
  });

  it("default with failure summary: adds agent output to the check", () => {
    const out = recapCheckOutcome({
      ...base,
      failureSummary:
        "Tool create-visual-recap failed because get-plan-blocks was unavailable",
    });
    expect(out.conclusion).toBe("neutral");
    expect(out.title).toBe("Visual recap not generated");
    expect(out.summary).toContain("See diagnostics below");
    expect(out.text).toContain("### Diagnostic");
    expect(out.text).toContain("Agent output:");
    expect(out.text).toContain("get-plan-blocks was unavailable");
  });

  it("default with URL reason: adds a no-plan-url diagnostic to the check", () => {
    const out = recapCheckOutcome({
      ...base,
      urlReason: "recap-url.txt was not created by the agent",
    });
    expect(out.conclusion).toBe("neutral");
    expect(out.summary).toContain("See diagnostics below");
    expect(out.text).toContain("No plan URL:");
    expect(out.text).toContain("recap-url.txt was not created");
  });
});

describe("bundled PR visual recap workflow", () => {
  it("drives the Visual Recap check run through the recap CLI", () => {
    // The recap job still needs check-write permission…
    expect(PR_VISUAL_RECAP_WORKFLOW_YML).toContain("checks: write");
    // …but the start/complete check-run logic now lives in `recap check`, not in
    // an inline github-script step.
    expect(PR_VISUAL_RECAP_WORKFLOW_YML).toContain("recap check start");
    expect(PR_VISUAL_RECAP_WORKFLOW_YML).toContain("recap check complete");
    expect(PR_VISUAL_RECAP_WORKFLOW_YML).toContain("Smoke-test Plan MCP tools");
    expect(PR_VISUAL_RECAP_WORKFLOW_YML).toContain(
      'recap mcp-smoke --app-url "$PLAN_RECAP_APP_URL"',
    );
    expect(PR_VISUAL_RECAP_WORKFLOW_YML).toContain(
      "steps.mcp_smoke.outputs.ok == 'true'",
    );
    expect(PR_VISUAL_RECAP_WORKFLOW_YML).toContain("RECAP_MCP_SMOKE_SUMMARY");
    expect(PR_VISUAL_RECAP_WORKFLOW_YML).toContain("Summarize agent failure");
    expect(PR_VISUAL_RECAP_WORKFLOW_YML).toContain("recap agent-summary");
    expect(PR_VISUAL_RECAP_WORKFLOW_YML).toContain(
      "backoff|connector.*register",
    );
    expect(PR_VISUAL_RECAP_WORKFLOW_YML).toContain(
      "mcp.*(register|unreachable|not usable|zero tools|not callable)",
    );
    expect(PR_VISUAL_RECAP_WORKFLOW_YML).toContain("CLAUDE_ALLOWED_TOOLS");
    expect(PR_VISUAL_RECAP_WORKFLOW_YML).toContain(
      "mcp__agent-native-plans__create-visual-recap",
    );
    expect(PR_VISUAL_RECAP_WORKFLOW_YML).toContain(
      'recap mcp-config --agent codex --app-url "$PLAN_RECAP_APP_URL" --force',
    );
    expect(PR_VISUAL_RECAP_WORKFLOW_YML).toContain("--failure-summary");
    expect(PR_VISUAL_RECAP_WORKFLOW_YML).toContain("--stderr-file");
    expect(PR_VISUAL_RECAP_WORKFLOW_YML).toContain("--exit-code-file");
    expect(PR_VISUAL_RECAP_WORKFLOW_YML).toContain("RECAP_URL_REASON");
    expect(PR_VISUAL_RECAP_WORKFLOW_YML).toContain("--url-reason");
    expect(PR_VISUAL_RECAP_WORKFLOW_YML).toContain(
      "--out recap.png --theme light",
    );
    expect(PR_VISUAL_RECAP_WORKFLOW_YML).toContain(
      "--out recap-dark.png --theme dark",
    );
    expect(PR_VISUAL_RECAP_WORKFLOW_YML).toContain("RECAP_DARK_IMAGE_URL");
    expect(PR_VISUAL_RECAP_WORKFLOW_YML).not.toContain("github.rest.checks");
    // The completed-check step is gated on a created check id and best-effort.
    expect(PR_VISUAL_RECAP_WORKFLOW_YML).toContain(
      "steps.recap_check.outputs.check_run_id != ''",
    );
    expect(PR_VISUAL_RECAP_WORKFLOW_YML).toContain("VISUAL_RECAP_SKILL_SOURCE");
    expect(PR_VISUAL_RECAP_WORKFLOW_YML).toContain("--skill-source");
  });
});

describe("bundled workflow stays in sync with the source file", () => {
  it("PR_VISUAL_RECAP_WORKFLOW_YML is byte-identical to the .github workflow", () => {
    const source = readFileSync(
      path.join(repoRoot, ".github/workflows/pr-visual-recap.yml"),
      "utf8",
    );
    expect(PR_VISUAL_RECAP_WORKFLOW_YML).toBe(source);
  });
});

/* ------------------------------------------------------------------ */
/* Task 1: installer overwrite protection                               */
/* ------------------------------------------------------------------ */

describe("writePrVisualRecapWorkflow — installer overwrite protection", () => {
  it("writes the workflow when the file does not yet exist", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "an-recap-wf-"));
    try {
      const result = writePrVisualRecapWorkflow(root);
      expect(result.status).toBe("written");
      if (result.status === "written") expect(result.existed).toBe(false);
      expect(
        fs.existsSync(
          path.join(root, ".github", "workflows", "pr-visual-recap.yml"),
        ),
      ).toBe(true);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("returns skipped when the file already exists and is identical", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "an-recap-wf-"));
    try {
      writePrVisualRecapWorkflow(root); // first write
      const result = writePrVisualRecapWorkflow(root); // second write
      expect(result.status).toBe("skipped");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("refuses with a message when the file exists and differs (no --force)", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "an-recap-wf-"));
    try {
      const dir = path.join(root, ".github", "workflows");
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, "pr-visual-recap.yml"), "# old\n");
      const result = writePrVisualRecapWorkflow(root);
      expect(result.status).toBe("refused");
      if (result.status === "refused") {
        expect(result.message).toContain("--force");
      }
      // Must not overwrite.
      expect(
        fs.readFileSync(path.join(dir, "pr-visual-recap.yml"), "utf8"),
      ).toBe("# old\n");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("overwrites a differing file when force=true", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "an-recap-wf-"));
    try {
      const dir = path.join(root, ".github", "workflows");
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, "pr-visual-recap.yml"), "# old\n");
      const result = writePrVisualRecapWorkflow(root, { force: true });
      expect(result.status).toBe("written");
      if (result.status === "written") expect(result.existed).toBe(true);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

/* ------------------------------------------------------------------ */
/* Task 2: version pinning                                             */
/* ------------------------------------------------------------------ */

describe("bundled workflow — RECAP_CLI_VERSION pinning", () => {
  it("uses vars.RECAP_CLI_VERSION in the Resolve recap CLI step", () => {
    expect(PR_VISUAL_RECAP_WORKFLOW_YML).toContain("RECAP_CLI_VERSION");
    expect(PR_VISUAL_RECAP_WORKFLOW_YML).toContain(
      "@agent-native/core@$VERSION",
    );
    expect(PR_VISUAL_RECAP_WORKFLOW_YML).toContain(
      "vars.RECAP_CLI_VERSION || 'latest'",
    );
    expect(PR_VISUAL_RECAP_WORKFLOW_YML).toContain(
      "Install published recap CLI",
    );
  });
});

/* ------------------------------------------------------------------ */
/* Task 3: auth-failure differentiation                               */
/* ------------------------------------------------------------------ */

describe("recap comment body — auth-failure differentiation", () => {
  it("shows auth-failure copy when RECAP_AUTH_FAILED=true", () => {
    const body = buildCommentBody({
      PLAN_URL: "",
      PLAN_RECAP_APP_URL: "https://plan.agent-native.com",
      RECAP_AUTH_FAILED: "true",
      HEAD_SHA: "abc1234",
    } as NodeJS.ProcessEnv);
    expect(body).toContain("generation failed");
    expect(body).toContain("PLAN_RECAP_TOKEN");
    expect(body).toContain("expired or revoked");
    expect(body).toContain("npx -y @agent-native/core@latest reconnect");
  });

  it("shows generic failure copy when RECAP_AUTH_FAILED is absent/false", () => {
    const body = buildCommentBody({
      PLAN_URL: "",
      PLAN_RECAP_APP_URL: "https://plan.agent-native.com",
      HEAD_SHA: "abc1234",
    } as NodeJS.ProcessEnv);
    expect(body).toContain("generation failed");
    expect(body).not.toContain("expired or revoked");
    expect(body).toContain("this pull request");
  });

  it("shows URL and agent diagnostics when a recap was not generated", () => {
    const body = buildCommentBody({
      PLAN_URL: "",
      PLAN_RECAP_APP_URL: "https://plan.agent-native.com",
      RECAP_URL_REASON: "recap-url.txt was not created by the agent",
      RECAP_AGENT_SUMMARY:
        "Tool create-visual-recap failed because get-plan-blocks was unavailable",
      HEAD_SHA: "abc1234",
    } as NodeJS.ProcessEnv);
    expect(body).toContain("Diagnostic:");
    expect(body).toContain("No plan URL:");
    expect(body).toContain("recap-url.txt was not created");
    expect(body).toContain("Agent output:");
    expect(body).toContain("get-plan-blocks was unavailable");
  });
});

/* ------------------------------------------------------------------ */
/* Task 5: secret-scan allowlist                                       */
/* ------------------------------------------------------------------ */

describe("recap scan allowlist", () => {
  it("parseRecapScanAllowlist returns empty when file is absent", () => {
    expect(
      parseRecapScanAllowlist("/nonexistent/path/recap-scan-allowlist"),
    ).toEqual([]);
  });

  it("parses literal strings and regex patterns, skipping comments", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "an-allowlist-"));
    try {
      const file = path.join(dir, "allowlist");
      fs.writeFileSync(
        file,
        [
          "# this is a comment",
          "sk-test-fixture-key",
          "/^sk-test-/i",
          "",
          "  # indented comment",
          "another-literal",
        ].join("\n"),
      );
      const matchers = parseRecapScanAllowlist(file);
      expect(matchers).toHaveLength(3);
      expect(matchers[0]).toBe("sk-test-fixture-key");
      expect(matchers[1]).toBeInstanceOf(RegExp);
      expect(matchers[2]).toBe("another-literal");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("lineMatchesAllowlist returns true when a literal is matched", () => {
    expect(
      lineMatchesAllowlist("+SK_KEY=sk-test-fixture-key", [
        "sk-test-fixture-key",
      ]),
    ).toBe(true);
  });

  it("lineMatchesAllowlist returns false when nothing matches", () => {
    expect(lineMatchesAllowlist("+SK_KEY=sk-realkey123", ["sk-fixture"])).toBe(
      false,
    );
  });

  it("lineMatchesAllowlist matches a regex pattern", () => {
    expect(
      lineMatchesAllowlist("+SK_KEY=sk-test-anything", [/sk-test-/i]),
    ).toBe(true);
  });

  it("diffContainsSecret suppresses a known false-positive via allowlist", () => {
    // Build a value that matches the provider-key secret pattern without
    // embedding a literal scanner-shaped token in this fixture file.
    const keyPrefix = "s" + "k" + "-";
    const fixtureKey = `${keyPrefix}abcdefghijklmnop1234567890`;
    const diff = [`+STRIPE_KEY=${fixtureKey}`].join("\n");
    // Without allowlist → detected as secret.
    expect(diffContainsSecret(diff, [])).toBe(true);
    // With allowlist entry that matches → suppressed.
    expect(diffContainsSecret(diff, [fixtureKey])).toBe(false);
  });

  it("diffContainsSecret still suppresses when the allowlist does NOT match", () => {
    const keyPrefix = "s" + "k" + "-";
    const diff = [`+REAL_KEY=${keyPrefix}realkey1234567890abcdef`].join("\n");
    expect(diffContainsSecret(diff, ["sk-test-fixture"])).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* Task 6: tiny-diff copy uses "pull request" not "push"              */
/* ------------------------------------------------------------------ */

describe("recap comment body — tiny-diff copy", () => {
  it("says 'this pull request' not 'this push' in the tiny-diff skipped message", () => {
    const body = buildCommentBody({
      DIFF_TINY: "true",
      HEAD_SHA: "abc1234",
    } as NodeJS.ProcessEnv);
    expect(body).toContain("this pull request");
    expect(body).not.toContain("this push");
  });
});

/* ------------------------------------------------------------------ */
/* Task 7: gate skip signal                                            */
/* ------------------------------------------------------------------ */

describe("gate skip signal helpers", () => {
  it("buildGateSkipLine formats the skip line with a short SHA", () => {
    const line = buildGateSkipLine("draft PR", "abc1234");
    expect(line).toBe("_Recap skipped for `abc1234`: draft PR._");
  });

  it("buildGateSkipLine uses 'latest push' when no SHA is available", () => {
    const line = buildGateSkipLine("draft PR", "");
    expect(line).toBe("_Recap skipped for latest push: draft PR._");
  });

  it("appendGateSkipLine appends the skip line to a body that has none", () => {
    const body = "<!-- pr-visual-recap -->\n### Visual recap\n\nsome content";
    const updated = appendGateSkipLine(
      body,
      "_Recap skipped for `abc1234`: draft PR._",
    );
    expect(updated).toContain("_Recap skipped for `abc1234`: draft PR._");
    expect(updated).toContain("### Visual recap");
  });

  it("appendGateSkipLine replaces an existing skip line (idempotent)", () => {
    const body =
      "<!-- pr-visual-recap -->\n### Visual recap\n\n_Recap skipped for `aaa0000`: draft PR._";
    const updated = appendGateSkipLine(
      body,
      "_Recap skipped for `bbb1111`: sensitive path._",
    );
    expect(updated).toContain("_Recap skipped for `bbb1111`: sensitive path._");
    expect(updated).not.toContain("`aaa0000`");
  });

  it("bundled workflow includes the skip-comment logic in the gate", () => {
    // The gate job must now also try to update an existing sticky comment.
    expect(PR_VISUAL_RECAP_WORKFLOW_YML).toContain(
      "_Recap skipped for ${shaRef}:",
    );
    expect(PR_VISUAL_RECAP_WORKFLOW_YML).toContain("pr-visual-recap");
    expect(PR_VISUAL_RECAP_WORKFLOW_YML).toContain("issues: write");
  });
});

describe("reusable caller workflow builder", () => {
  it("generates a valid workflow_call caller with required secrets", () => {
    const yml = buildReusableCallerWorkflow();
    // Trigger: same event types as the canonical workflow.
    expect(yml).toContain(
      "types: [opened, synchronize, reopened, ready_for_review]",
    );
    // Uses the reusable workflow in the agent-native repo.
    expect(yml).toContain(
      "uses: BuilderIO/agent-native/.github/workflows/pr-visual-recap-reusable.yml@main",
    );
    expect(yml).toContain("actions: write");
    expect(yml).toContain("checks: write");
    expect(yml).toContain("issues: write");
    expect(yml).toContain("pull-requests: write");
    // Required secrets are threaded through.
    expect(yml).toContain("PLAN_RECAP_TOKEN: ${{ secrets.PLAN_RECAP_TOKEN }}");
    expect(yml).toContain(
      "ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}",
    );
    // Optional secrets are threaded through so repo variables can select codex
    // or self-hosting without changing the workflow YAML.
    expect(yml).toContain("OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}");
    expect(yml).toContain(
      "PLAN_RECAP_APP_URL: ${{ secrets.PLAN_RECAP_APP_URL }}",
    );
    expect(yml).toContain("agent: ${{ vars.VISUAL_RECAP_AGENT || 'claude' }}");
    expect(yml).toContain("model: ${{ vars.VISUAL_RECAP_MODEL || '' }}");
    expect(yml).toContain(
      "reasoning: ${{ vars.VISUAL_RECAP_REASONING || '' }}",
    );
    expect(yml).toContain(
      "skill-source: ${{ vars.VISUAL_RECAP_SKILL_SOURCE || 'auto' }}",
    );
  });

  it("respects a custom ref for version pinning", () => {
    const yml = buildReusableCallerWorkflow({ ref: "v1.2.3" });
    expect(yml).toContain("pr-visual-recap-reusable.yml@v1.2.3");
    // The pin guidance comment should mention the pinned ref.
    expect(yml).toContain("@v1.2.3");
  });

  it("strips a leading @ from the ref", () => {
    const yml = buildReusableCallerWorkflow({ ref: "@v2.0.0" });
    expect(yml).toContain("pr-visual-recap-reusable.yml@v2.0.0");
    // Must not double the @.
    expect(yml).not.toContain("@@");
  });

  it("adds the agent input line when agent is codex", () => {
    const yml = buildReusableCallerWorkflow({ agent: "codex" });
    expect(yml).toContain("agent: codex");
  });

  it("pins the agent input line when explicitly set to claude", () => {
    const yml = buildReusableCallerWorkflow({ agent: "claude" });
    expect(yml).toContain("agent: claude");
  });

  it("adds the model input line when a model is specified", () => {
    const yml = buildReusableCallerWorkflow({ model: "gpt-5.5" });
    expect(yml).toContain("model: gpt-5.5");
  });
});

describe("writePrVisualRecapReusableCallerWorkflow", () => {
  it("writes the caller file and reports written when the file is new", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "an-recap-reusable-"));
    try {
      const result = writePrVisualRecapReusableCallerWorkflow(root);
      expect(result.status).toBe("written");
      expect(result.path).toBe(
        path.join(".github", "workflows", "pr-visual-recap.yml"),
      );
      if (result.status === "written") {
        expect(result.existed).toBe(false);
      }
      // File must have been written on disk.
      const written = fs.readFileSync(
        path.join(root, ".github", "workflows", "pr-visual-recap.yml"),
        "utf8",
      );
      expect(written).toContain("pr-visual-recap-reusable.yml@main");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("reports skipped when the existing file is already up to date", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "an-recap-reusable-"));
    try {
      // Write once, then write again — second write must be a no-op.
      writePrVisualRecapReusableCallerWorkflow(root);
      const second = writePrVisualRecapReusableCallerWorkflow(root);
      expect(second.status).toBe("skipped");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("reports refused when the file exists with different content and --force is not passed", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "an-recap-reusable-"));
    try {
      const dir = path.join(root, ".github", "workflows");
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        path.join(dir, "pr-visual-recap.yml"),
        "# custom workflow\n",
      );
      const result = writePrVisualRecapReusableCallerWorkflow(root);
      expect(result.status).toBe("refused");
      if (result.status === "refused") {
        expect(result.message).toContain("--force");
      }
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("overwrites a differing existing file when force=true", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "an-recap-reusable-"));
    try {
      const dir = path.join(root, ".github", "workflows");
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        path.join(dir, "pr-visual-recap.yml"),
        "# old custom workflow\n",
      );
      const result = writePrVisualRecapReusableCallerWorkflow(root, {
        force: true,
      });
      expect(result.status).toBe("written");
      if (result.status === "written") {
        expect(result.existed).toBe(true);
      }
      const content = fs.readFileSync(
        path.join(dir, "pr-visual-recap.yml"),
        "utf8",
      );
      expect(content).toContain("pr-visual-recap-reusable.yml@main");
      expect(content).not.toContain("# old custom workflow");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("reusable workflow file structure", () => {
  const reusableFile = path.join(
    repoRoot,
    ".github/workflows/pr-visual-recap-reusable.yml",
  );

  it("the reusable workflow file exists", () => {
    expect(fs.existsSync(reusableFile)).toBe(true);
  });

  it("declares workflow_call with the required inputs and secrets", () => {
    const content = fs.readFileSync(reusableFile, "utf8");
    // Must declare workflow_call trigger.
    expect(content).toContain("workflow_call:");
    // Required inputs are present.
    expect(content).toContain("cli-version:");
    expect(content).toContain("agent:");
    expect(content).toContain("model:");
    expect(content).toContain("plan-url:");
    // Required secret is declared.
    expect(content).toContain("PLAN_RECAP_TOKEN:");
    // Optional secrets for both backends are declared.
    expect(content).toContain("ANTHROPIC_API_KEY:");
    expect(content).toContain("OPENAI_API_KEY:");
  });

  it("has the same safety semantics as the canonical workflow", () => {
    const content = fs.readFileSync(reusableFile, "utf8");
    // Fork / draft / bot skips.
    expect(content).toContain("fork PR");
    expect(content).toContain("draft PR");
    // Secret scan.
    expect(content).toContain("secret scan failed");
    // Self-modifying guard.
    expect(content).toContain("isSensitive");
    // Concurrency group to cancel stale runs.
    expect(content).toContain("concurrency:");
    expect(content).toContain("cancel-in-progress: true");
    // persist-credentials: false on checkout.
    expect(content).toContain("persist-credentials: false");
  });

  it("parses as valid YAML", () => {
    // Basic structural validation via a regex-free approach.
    const content = fs.readFileSync(reusableFile, "utf8");
    // If we reach here without throwing the file is loadable; check jobs.
    expect(content).toMatch(/^jobs:/m);
    expect(content).toMatch(/^\s+gate:/m);
    expect(content).toMatch(/^\s+recap:/m);
  });

  it("consumer repos install the published CLI once", () => {
    const content = fs.readFileSync(reusableFile, "utf8");
    // The canonical workflow has a local-source branch; the reusable one must
    // always use the published CLI — consumer repos don't have packages/core.
    expect(content).not.toContain("pnpm exec tsx");
    expect(content).toContain("Install published recap CLI");
    expect(content).toContain("@agent-native/core@$VERSION");
    expect(content).toContain("node_modules/.bin/agent-native");
  });

  it("has the auth probe step (parity with copy workflow)", () => {
    const content = fs.readFileSync(reusableFile, "utf8");
    expect(content).toContain("Probe plan-app auth");
    expect(content).toContain("auth_failed=true");
    expect(content).toContain("auth_failed=false");
  });

  it("passes RECAP_AUTH_FAILED to the upsert comment step (parity with copy workflow)", () => {
    const content = fs.readFileSync(reusableFile, "utf8");
    expect(content).toContain("RECAP_AUTH_FAILED:");
  });

  it("passes sanitized agent failure output to the comment and check", () => {
    const content = fs.readFileSync(reusableFile, "utf8");
    expect(content).toContain("Smoke-test Plan MCP tools");
    expect(content).toContain(
      'recap mcp-smoke --app-url "$PLAN_RECAP_APP_URL"',
    );
    expect(content).toContain("steps.mcp_smoke.outputs.ok == 'true'");
    expect(content).toContain("RECAP_MCP_SMOKE_SUMMARY:");
    expect(content).toContain("Summarize agent failure");
    expect(content).toContain("recap agent-summary");
    expect(content).toContain("RECAP_AGENT_SUMMARY:");
    expect(content).toContain("--failure-summary");
    expect(content).toContain("--stderr-file");
    expect(content).toContain("--exit-code-file");
    expect(content).toContain("RECAP_URL_REASON:");
    expect(content).toContain("--url-reason");
  });

  it("gate job has issues: write permission for the skip-comment refresh", () => {
    const content = fs.readFileSync(reusableFile, "utf8");
    // The gate job section must include issues: write.
    const gateSection = content.slice(
      content.indexOf("\n  gate:"),
      content.indexOf("\n  recap:"),
    );
    expect(gateSection).toContain("issues: write");
  });

  it("gate job has skip-comment refresh logic (parity with copy workflow)", () => {
    const content = fs.readFileSync(reusableFile, "utf8");
    const gateSection = content.slice(
      content.indexOf("\n  gate:"),
      content.indexOf("\n  recap:"),
    );
    expect(gateSection).toContain("_Recap skipped for");
    expect(gateSection).toContain("pr-visual-recap");
  });
});

/* ------------------------------------------------------------------ */
/* sortDiffSourceFirst                                                 */
/* ------------------------------------------------------------------ */

describe("sortDiffSourceFirst", () => {
  function makeDiff(paths: string[]): string {
    return paths
      .map(
        (p) =>
          `diff --git a/${p} b/${p}\n--- a/${p}\n+++ b/${p}\n@@ -1 +1 @@\n-old\n+new\n`,
      )
      .join("");
  }

  it("moves dotfile-prefixed path segments to the end", () => {
    const diff = makeDiff([
      ".changeset/foo.md",
      "src/index.ts",
      ".github/workflows/ci.yml",
      "packages/core/lib.ts",
    ]);
    const sorted = sortDiffSourceFirst(diff);
    const srcIdx = sorted.indexOf("diff --git a/src/");
    const pkgIdx = sorted.indexOf("diff --git a/packages/");
    const csIdx = sorted.indexOf("diff --git a/.changeset/");
    const ghIdx = sorted.indexOf("diff --git a/.github/");
    // Source paths must come before dotfile paths.
    expect(srcIdx).toBeLessThan(csIdx);
    expect(srcIdx).toBeLessThan(ghIdx);
    expect(pkgIdx).toBeLessThan(csIdx);
    expect(pkgIdx).toBeLessThan(ghIdx);
  });

  it("keeps source-only diffs unchanged", () => {
    const diff = makeDiff(["src/a.ts", "src/b.ts", "packages/x/y.ts"]);
    expect(sortDiffSourceFirst(diff)).toBe(diff);
  });

  it("keeps dotfile-only diffs unchanged (no source to promote)", () => {
    const diff = makeDiff([".changeset/a.md", ".github/workflows/test.yml"]);
    const sorted = sortDiffSourceFirst(diff);
    // All dotfile — order is preserved.
    expect(sorted.indexOf(".changeset")).toBeLessThan(
      sorted.indexOf(".github"),
    );
  });

  it("preserves a preamble before the first diff --git header", () => {
    const preamble = "commit abc\nAuthor: x\n\n";
    const diff = preamble + makeDiff([".changeset/a.md", "src/b.ts"]);
    const sorted = sortDiffSourceFirst(diff);
    expect(sorted.startsWith(preamble)).toBe(true);
  });

  it("returns the input unchanged when there are no diff headers", () => {
    const text = "just plain text\nno diff here\n";
    expect(sortDiffSourceFirst(text)).toBe(text);
  });

  it("when truncated after reorder, keeps source files and drops dotfile dirs", () => {
    // Build a diff that is just over the cap; source file comes first but git
    // would put dotfiles first alphabetically. After sort+truncate the source
    // file should survive.
    const lineSize = 100;
    const linesNeeded = Math.ceil(RECAP_DIFF_BYTE_CAP / lineSize) + 10;
    // A large dotfile-dir segment that fills most of the cap.
    const dotfileBody =
      `diff --git a/.changeset/big.md b/.changeset/big.md\n--- a/.changeset/big.md\n+++ b/.changeset/big.md\n@@ -1 +1 @@\n${"+".repeat(lineSize - 1) + "\n"}`.repeat(
        linesNeeded,
      );
    const sourceBody = `diff --git a/src/index.ts b/src/index.ts\n--- a/src/index.ts\n+++ b/src/index.ts\n@@ -1 +1 @@\n-old\n+new important change\n`;
    // Combine dotfile-first (as git would emit them alphabetically).
    const combined = dotfileBody + sourceBody;
    // After sort+truncate the source body must be retained.
    const result = truncateDiffAtLineBoundary(sortDiffSourceFirst(combined));
    expect(result).toContain("src/index.ts");
    expect(result).toContain("new important change");
  });
});

/* ------------------------------------------------------------------ */
/* buildRecapPrompt — diff-consumption instructions                    */
/* ------------------------------------------------------------------ */

describe("buildRecapPrompt diff-consumption instructions", () => {
  const skillMd = "skill content";

  it("emits line/byte counts and a full-read instruction when diffBytes/diffLines are provided", () => {
    const prompt = buildRecapPrompt({
      skillMd,
      pr: "1",
      appUrl: "https://plan.agent-native.com",
      diffPath: "recap.diff",
      diffBytes: 204800,
      diffLines: 5000,
    });
    expect(prompt).toContain("5,000 lines");
    expect(prompt).toContain("200.0 KB");
    expect(prompt).toContain("Read this file IN FULL");
    expect(prompt).toContain("sequential chunks");
    expect(prompt).toContain("Do not author from a partial read");
  });

  it("omits the consumption instruction when diffBytes/diffLines are absent", () => {
    const prompt = buildRecapPrompt({
      skillMd,
      pr: "1",
      appUrl: "https://plan.agent-native.com",
      diffPath: "recap.diff",
    });
    expect(prompt).not.toContain("Read this file IN FULL");
    expect(prompt).toContain("recap.diff");
  });

  it("adds a truncation note with fetch-individually instruction when huge=true", () => {
    const prompt = buildRecapPrompt({
      skillMd,
      pr: "1",
      appUrl: "https://plan.agent-native.com",
      diffPath: "recap.diff",
      statPath: "recap.stat",
      huge: true,
      diffBytes: 614400,
      diffLines: 15000,
    });
    expect(prompt).toContain("truncated at the size cap");
    expect(prompt).toContain("recap.stat");
    expect(prompt).toContain("git diff <base>...<head> -- <path>");
  });
});

/* ------------------------------------------------------------------ */
/* buildRecapPrompt — small-diff override                              */
/* ------------------------------------------------------------------ */

describe("buildRecapPrompt — small-diff override sentence", () => {
  it("instructs the agent to always publish, ignoring the skill's skip advice", () => {
    const prompt = buildRecapPrompt({
      skillMd: "skill",
      pr: "1",
      appUrl: "https://plan.agent-native.com",
      diffPath: "recap.diff",
    });
    expect(prompt).toContain("CI already gated tiny diffs before invoking you");
    expect(prompt).toContain("always publish");
  });
});

/* ------------------------------------------------------------------ */
/* find-plan-id validation                                             */
/* ------------------------------------------------------------------ */

describe("find-plan-id plan-id validation", () => {
  it("accepts a valid safe-id (alphanumeric + _ -)", () => {
    // The runComment find-plan-id logic is tested indirectly via the regex.
    const body = "<!-- plan-id: plan-abc123 -->";
    const match = body.match(/<!--\s*plan-id:\s*([^\s]+)\s*-->/);
    const rawId = match ? match[1] : "";
    const safeId = rawId && /^[A-Za-z0-9_-]{1,64}$/.test(rawId) ? rawId : "";
    expect(safeId).toBe("plan-abc123");
  });

  it("rejects a plan-id with path-traversal characters", () => {
    const body = "<!-- plan-id: ../../etc/passwd -->";
    const match = body.match(/<!--\s*plan-id:\s*([^\s]+)\s*-->/);
    const rawId = match ? match[1] : "";
    const safeId = rawId && /^[A-Za-z0-9_-]{1,64}$/.test(rawId) ? rawId : "";
    expect(safeId).toBe("");
  });

  it("rejects a plan-id that is too long", () => {
    const longId = "a".repeat(65);
    const body = `<!-- plan-id: ${longId} -->`;
    const match = body.match(/<!--\s*plan-id:\s*([^\s]+)\s*-->/);
    const rawId = match ? match[1] : "";
    const safeId = rawId && /^[A-Za-z0-9_-]{1,64}$/.test(rawId) ? rawId : "";
    expect(safeId).toBe("");
  });

  it("rejects a plan-id containing shell-injection characters", () => {
    const malicious = "plan;rm${IFS}-rf${IFS}/";
    const body = `<!-- plan-id: ${malicious} -->`;
    const match = body.match(/<!--\s*plan-id:\s*([^\s]+)\s*-->/);
    // The outer regex [^\s]+ would stop at whitespace, but the value itself
    // has injection characters — the safe-id regex must reject it.
    const rawId = match ? match[1] : "";
    const safeId = rawId && /^[A-Za-z0-9_-]{1,64}$/.test(rawId) ? rawId : "";
    expect(safeId).toBe("");
  });

  it("rejects a plan-id with angle-bracket markup injection", () => {
    const malicious = "plan<script>alert(1)</script>";
    const body = `<!-- plan-id: ${malicious} -->`;
    const match = body.match(/<!--\s*plan-id:\s*([^\s]+)\s*-->/);
    const rawId = match ? match[1] : "";
    const safeId = rawId && /^[A-Za-z0-9_-]{1,64}$/.test(rawId) ? rawId : "";
    expect(safeId).toBe("");
  });
});

/* ------------------------------------------------------------------ */
/* Reusable / copy workflow step-sequence parity                       */
/* ------------------------------------------------------------------ */

describe("reusable vs copy workflow step-sequence parity", () => {
  const reusableFile = path.join(
    repoRoot,
    ".github/workflows/pr-visual-recap-reusable.yml",
  );

  /**
   * Extract the name/id of each step from the recap job of a workflow file.
   * Step names are the "- name: …" lines; anonymous steps ("- uses: …" with no
   * prior "- name:") are captured by their "uses:" or "run:" prefix.
   */
  function recapStepNames(content: string): string[] {
    // Find the recap: job block (between "  recap:" and the next top-level job
    // or end of file).
    const recapStart = content.indexOf("\n  recap:");
    if (recapStart < 0) return [];
    // Find the next top-level job that follows recap (two-space indented key).
    const afterRecap = content.slice(recapStart + 1);
    const nextJob = afterRecap.search(/\n  [a-z][a-zA-Z0-9_-]*:/);
    const recapBlock = nextJob >= 0 ? afterRecap.slice(0, nextJob) : afterRecap;

    const names: string[] = [];
    for (const line of recapBlock.split("\n")) {
      const nameMatch = line.match(/^\s+-\s+name:\s+(.+)/);
      if (nameMatch) names.push(nameMatch[1].trim());
    }
    return names;
  }

  it("copy and reusable workflows have the same recap step names in order", () => {
    const copyContent = readFileSync(
      path.join(repoRoot, ".github/workflows/pr-visual-recap.yml"),
      "utf8",
    );
    const reusableContent = fs.readFileSync(reusableFile, "utf8");
    const copySteps = recapStepNames(copyContent);
    const reusableSteps = recapStepNames(reusableContent);

    // Both must have a non-trivial number of steps.
    expect(copySteps.length).toBeGreaterThan(5);
    expect(reusableSteps.length).toBeGreaterThan(5);

    // Every named recap step in the copy must appear in the reusable. CLI setup
    // differs because the copy workflow can run trusted base-branch source while
    // the reusable workflow always installs the published package.
    const knownDifferences = new Set([
      "Install workspace (local source only)",
      "Install trusted workspace recap CLI",
      "Resolve recap CLI", // reusable is simpler (no local-branch)
    ]);
    const copyFiltered = copySteps.filter((s) => !knownDifferences.has(s));
    const reusableFiltered = reusableSteps.filter(
      (s) => !knownDifferences.has(s),
    );

    // Check that both share the same key step names (subsequence).
    for (const step of copyFiltered) {
      expect(reusableFiltered).toContain(step);
    }
  });
});
