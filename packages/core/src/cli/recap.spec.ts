import fs, { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it, vi } from "vitest";

import {
  RECAP_DIFF_BYTE_CAP,
  buildRecapSetupPlan,
  buildCommentBody,
  buildRecapClaudeMcpConfig,
  buildRecapCodexMcpConfig,
  buildRecapPrompt,
  canonicalRecapUrl,
  classifyDiff,
  countDiffLines,
  diffContainsSecret,
  evaluateRecapGate,
  isRecapSensitivePath,
  normalizeRecapAgent,
  parseClaudeUsage,
  parseCodexUsage,
  recapCheckOutcome,
  recapRequiredSecrets,
  readVisualRecapSkillBundle,
  truncateDiffAtLineBoundary,
  waitForPublicRecapImage,
} from "./recap.js";
import type { RecapGateInput } from "./recap.js";
import { PR_VISUAL_RECAP_WORKFLOW_YML } from "./pr-visual-recap-workflow.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../../..");

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
      headers: { Authorization: "Bearer tok-123" },
    });
  });

  it("writes Codex TOML with a JSON-stringified url and env-var bearer", () => {
    const toml = buildRecapCodexMcpConfig("https://plan.agent-native.com");
    expect(toml).toBe(
      [
        "[mcp_servers.plan]",
        'url = "https://plan.agent-native.com/_agent-native/mcp"',
        'bearer_token_env_var = "PLAN_RECAP_TOKEN"',
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
    expect(prompt).toContain("workflow/tool allowlist is stale");
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
    expect(prompt).toContain("agent-native plan local preview");
    expect(prompt).toContain("recap-url.txt");
    expect(prompt).not.toContain("mcp__plan__create-visual-recap");
    expect(prompt).not.toContain("set-resource-visibility");
    expect(prompt).not.toContain(
      "https://plan.agent-native.com/recaps/<the returned plan id>",
    );
  });

  it("builds the latest bundled skill with sibling reference files", () => {
    const bundle = readVisualRecapSkillBundle(repoRoot, "latest");
    expect(bundle.source).toBe("bundled:@agent-native/core/visual-recap");
    expect(bundle.text).toContain("Bundled visual-recap reference files");
    expect(bundle.text).toContain("references/wireframe.md");
    expect(bundle.text).toContain("HTML wireframe quality");
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
    expect(body).toContain("### Visual recap\n");
    expect(body).not.toContain("review at a higher altitude");
    expect(body).not.toContain("Updated for");
    expect(body).toContain("Open the interactive recap");
    expect(body).toContain("<!-- plan-id: plan-abc123 -->");
    expect(body).toContain("<!-- pr-visual-recap -->");
    // Freshness line should include the shortened head SHA.
    expect(body).toContain("_As of `abcdef1`_");
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
      "[Open the interactive recap](https://plan.agent-native.com/recaps/plan-abc123)",
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
    expect(body).toContain("Open the interactive recap");
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
    expect(body).toContain("Open the interactive recap");
  });

  it("refreshes to a skipped state on a tiny diff", () => {
    const body = buildCommentBody({
      DIFF_TINY: "true",
      HEAD_SHA: "abcdef1",
    } as NodeJS.ProcessEnv);
    expect(body).toContain("skipped");
    expect(body).toContain("too small");
    expect(body).not.toContain("Updated for");
    expect(body).not.toContain("Open the interactive recap");
    // Freshness line present even on tiny.
    expect(body).toContain("_As of `abcdef1`_");
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
    expect(body).toContain("Open the interactive recap");
  });

  it("drops the link when the plan URL origin does not match the app origin", () => {
    const body = buildCommentBody({
      PLAN_URL: "https://evil.example.com/recaps/plan-abc123",
      PLAN_RECAP_APP_URL: "https://plan.agent-native.com",
      RECAP_IMAGE_URL: "",
      HEAD_SHA: "abcdef1",
    } as NodeJS.ProcessEnv);
    expect(body).toContain("generation failed");
    expect(body).not.toContain("Open the interactive recap");
    expect(body).not.toContain("Updated for");
    expect(body).not.toContain("evil.example.com");
  });

  it("failure branch keeps the last-good plan link labeled as stale when PREV_PLAN_ID is set", () => {
    const body = buildCommentBody({
      PLAN_URL: "",
      PLAN_RECAP_APP_URL: "https://plan.agent-native.com",
      PREV_PLAN_ID: "plan-deadbeef",
      HEAD_SHA: "abcdef1",
    } as NodeJS.ProcessEnv);
    expect(body).toContain("generation failed");
    // Stale link to the previous recap should be present.
    expect(body).toContain(
      "[Open recap](https://plan.agent-native.com/recaps/plan-deadbeef)",
    );
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
    // Stale link uses the previous plan, not the rejected fresh URL.
    expect(body).toContain("plan-deadbeef");
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
    expect(body).not.toContain("Open the interactive recap");
    // Freshness line still present.
    expect(body).toContain("_As of `abcdef1`_");
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
  });

  it("omits the freshness line when no HEAD_SHA is available", () => {
    const body = buildCommentBody({
      PLAN_URL: "https://plan.agent-native.com/recaps/plan-abc123",
      PLAN_RECAP_APP_URL: "https://plan.agent-native.com",
    } as NodeJS.ProcessEnv);
    expect(body).not.toContain("_As of `");
    expect(body).toContain("Open the interactive recap");
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

  it("skips when the PR modifies packages/core (self-modifying guard)", () => {
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
    expect(result.run).toBe(false);
    expect(
      result.reasons.some((r) =>
        r.startsWith("PR modifies recap-control files"),
      ),
    ).toBe(true);
    expect(result.reasons.join(" ")).toContain(
      "packages/core/src/cli/recap.ts",
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
      true,
    );
    expect(
      isRecapSensitivePath(
        "templates/plan/.agents/skills/visual-recap/SKILL.md",
      ),
    ).toBe(true);
    expect(
      isRecapSensitivePath(
        "packages/core/src/cli/recap.ts",
        "BuilderIO/agent-native",
      ),
    ).toBe(true);
    expect(
      isRecapSensitivePath(
        "packages/core/src/cli/recap.ts",
        "BuilderIO/ai-services",
      ),
    ).toBe(false);
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
});

describe("bundled PR visual recap workflow", () => {
  it("drives the Visual Recap check run through the recap CLI", () => {
    // The recap job still needs check-write permission…
    expect(PR_VISUAL_RECAP_WORKFLOW_YML).toContain("checks: write");
    // …but the start/complete check-run logic now lives in `recap check`, not in
    // an inline github-script step.
    expect(PR_VISUAL_RECAP_WORKFLOW_YML).toContain("recap check start");
    expect(PR_VISUAL_RECAP_WORKFLOW_YML).toContain("recap check complete");
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
