import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  buildCommentBody,
  buildRecapPrompt,
  diffContainsSecret,
} from "./recap.js";
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

describe("recap prompt builder", () => {
  const skillMd = "---\nname: visual-recap\n---\n\nUNIQUE_SKILL_MARKER body.";

  it("embeds the repo SKILL.md and the publish contract", () => {
    const prompt = buildRecapPrompt({
      skillMd,
      pr: "1095",
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
    // The publish path and the single hand-off are spelled out.
    expect(prompt).toContain("mcp__plan__create-visual-recap");
    expect(prompt).toContain("set-resource-visibility");
    expect(prompt).toContain("recap-url.txt");
    expect(prompt).toContain(
      "https://plan.agent-native.com/plans/<the returned plan id>",
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
});

describe("recap comment body", () => {
  it("embeds an inline screenshot + link and a plan-id marker on success", () => {
    const body = buildCommentBody({
      PLAN_URL: "https://plan.agent-native.com/plans/plan-abc123",
      PLAN_RECAP_APP_URL: "https://plan.agent-native.com",
      RECAP_IMAGE_URL:
        "https://plan.agent-native.com/_agent-native/recap-image/a1b2c3d4e5f6.png",
      HEAD_SHA: "abcdef1234567",
    } as NodeJS.ProcessEnv);
    expect(body).toContain(
      "[![Visual recap](https://plan.agent-native.com/_agent-native/recap-image/a1b2c3d4e5f6.png)](https://plan.agent-native.com/plans/plan-abc123)",
    );
    expect(body).toContain("Open the interactive recap");
    expect(body).toContain("<!-- plan-id: plan-abc123 -->");
    expect(body).toContain("<!-- pr-visual-recap -->");
  });

  it("rebuilds a canonical link (origin + plan id), dropping any crafted path/query", () => {
    const body = buildCommentBody({
      // Same-origin URL, but with markdown-breakout junk appended to the path.
      PLAN_URL:
        "https://plan.agent-native.com/plans/plan-abc123)](https://evil.example.com)",
      PLAN_RECAP_APP_URL: "https://plan.agent-native.com",
      HEAD_SHA: "abcdef1",
    } as NodeJS.ProcessEnv);
    expect(body).toContain(
      "[Open the interactive recap](https://plan.agent-native.com/plans/plan-abc123)",
    );
    expect(body).not.toContain("evil.example.com");
  });

  it("drops a same-origin image URL that is not a canonical recap-image path", () => {
    const body = buildCommentBody({
      PLAN_URL: "https://plan.agent-native.com/plans/plan-abc123",
      PLAN_RECAP_APP_URL: "https://plan.agent-native.com",
      RECAP_IMAGE_URL: "https://plan.agent-native.com/evil.png)](javascript:0)",
      HEAD_SHA: "abcdef1",
    } as NodeJS.ProcessEnv);
    expect(body).not.toContain("![Visual recap]");
    expect(body).not.toContain("javascript:");
    expect(body).toContain("Open the interactive recap");
  });

  it("refreshes to a skipped state on a tiny diff", () => {
    const body = buildCommentBody({
      DIFF_TINY: "true",
      HEAD_SHA: "abcdef1",
    } as NodeJS.ProcessEnv);
    expect(body).toContain("skipped");
    expect(body).toContain("too small");
    expect(body).not.toContain("Open the interactive recap");
  });

  it("falls back to a link-only comment when the screenshot upload failed", () => {
    const body = buildCommentBody({
      PLAN_URL: "https://plan.agent-native.com/plans/plan-abc123",
      PLAN_RECAP_APP_URL: "https://plan.agent-native.com",
      RECAP_IMAGE_URL: "",
      HEAD_SHA: "abcdef1",
    } as NodeJS.ProcessEnv);
    expect(body).not.toContain("![Visual recap]");
    expect(body).toContain("Open the interactive recap");
  });

  it("drops the link when the plan URL origin does not match the app origin", () => {
    const body = buildCommentBody({
      PLAN_URL: "https://evil.example.com/plans/plan-abc123",
      PLAN_RECAP_APP_URL: "https://plan.agent-native.com",
      RECAP_IMAGE_URL: "",
      HEAD_SHA: "abcdef1",
    } as NodeJS.ProcessEnv);
    expect(body).toContain("generation failed");
    expect(body).not.toContain("Open the interactive recap");
    expect(body).not.toContain("evil.example.com");
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
    expect(body).not.toContain("Open the interactive recap");
  });

  it("reports a generation failure when no plan URL was produced", () => {
    const body = buildCommentBody({
      PLAN_URL: "",
      HEAD_SHA: "abcdef1",
    } as NodeJS.ProcessEnv);
    expect(body).toContain("generation failed");
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
