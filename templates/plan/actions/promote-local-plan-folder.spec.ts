import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { writePlanLocalFolder } from "../server/lib/local-plan-files.js";
import { planContentSchema, type PlanContent } from "../shared/plan-content.js";
import promoteLocalPlanFolder from "./promote-local-plan-folder.js";

function sampleContent(): PlanContent {
  return planContentSchema.parse({
    version: 2,
    title: "Checkout review",
    brief: "Local MDX editing.",
    blocks: [
      {
        id: "summary",
        type: "rich-text",
        title: "Summary",
        data: { markdown: "Original local plan text." },
      },
    ],
  });
}

describe("promote-local-plan-folder", () => {
  let tmpDir: string;
  let savedDir: string | undefined;
  let savedMode: string | undefined;
  let savedNodeEnv: string | undefined;
  let savedAuthMode: string | undefined;
  let savedRepoRoot: string | undefined;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "plan-promote-action-"));
    savedDir = process.env.PLAN_LOCAL_DIR;
    savedMode = process.env.PLAN_LOCAL_MODE;
    savedNodeEnv = process.env.NODE_ENV;
    savedAuthMode = process.env.AUTH_MODE;
    savedRepoRoot = process.env.PLAN_REPO_ROOT;
    process.env.PLAN_LOCAL_DIR = path.join(tmpDir, "tmp-plans");
    process.env.PLAN_LOCAL_MODE = "1";
    process.env.NODE_ENV = "test";
    delete process.env.AUTH_MODE;
    delete process.env.PLAN_REPO_ROOT;
  });

  afterEach(async () => {
    if (savedDir === undefined) delete process.env.PLAN_LOCAL_DIR;
    else process.env.PLAN_LOCAL_DIR = savedDir;
    if (savedMode === undefined) delete process.env.PLAN_LOCAL_MODE;
    else process.env.PLAN_LOCAL_MODE = savedMode;
    if (savedNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = savedNodeEnv;
    if (savedAuthMode === undefined) delete process.env.AUTH_MODE;
    else process.env.AUTH_MODE = savedAuthMode;
    if (savedRepoRoot === undefined) delete process.env.PLAN_REPO_ROOT;
    else process.env.PLAN_REPO_ROOT = savedRepoRoot;
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("copies a temporary local plan into the configured repo plans folder", async () => {
    const repoRoot = path.join(tmpDir, "repo");
    process.env.PLAN_REPO_ROOT = repoRoot;
    await fs.mkdir(repoRoot, { recursive: true });
    await fs.writeFile(
      path.join(repoRoot, "agent-native.json"),
      JSON.stringify({
        version: 1,
        apps: {
          plan: {
            mode: "local-files",
            roots: [{ name: "Plans", path: "docs/plans", kind: "plans" }],
          },
        },
      }),
      "utf-8",
    );

    const content = sampleContent();
    await writePlanLocalFolder({
      slug: "checkout-review",
      planId: "local-checkout-review",
      title: content.title ?? "Checkout review",
      brief: content.brief,
      content,
      url: "/local-plans/checkout-review",
    });

    const result = await promoteLocalPlanFolder.run({
      slug: "checkout-review",
    });

    expect(result.localOnly).toBe(true);
    expect(result.targetPath).toBe("docs/plans/checkout-review");
    expect(result.repoPath).toBe("docs/plans/checkout-review");
    expect(result.path).toBe(
      "/local-plans/checkout-review?path=docs%2Fplans%2Fcheckout-review",
    );
    expect(result.folder).toBe(
      path.join(repoRoot, "docs/plans/checkout-review"),
    );
    expect(result.localFiles?.files).toContain("plan.mdx");
    expect(result.plan.content?.title).toBe("Checkout review");
    await expect(
      fs.stat(path.join(repoRoot, "docs/plans/checkout-review", "plan.mdx")),
    ).resolves.toBeTruthy();
  });

  it("refuses to promote outside local Plan runtime", async () => {
    process.env.PLAN_LOCAL_MODE = "0";
    await expect(
      promoteLocalPlanFolder.run({ slug: "checkout-review" }),
    ).rejects.toThrow(/only available in local Plan runtime/);
  });

  it("does not overwrite non-plan repo folders", async () => {
    const repoRoot = path.join(tmpDir, "repo");
    process.env.PLAN_REPO_ROOT = repoRoot;
    await fs.mkdir(path.join(repoRoot, "src"), { recursive: true });
    await fs.writeFile(
      path.join(repoRoot, "src", "important.ts"),
      "export const important = true;\n",
      "utf-8",
    );

    const content = sampleContent();
    await writePlanLocalFolder({
      slug: "checkout-review",
      planId: "local-checkout-review",
      title: content.title ?? "Checkout review",
      brief: content.brief,
      content,
      url: "/local-plans/checkout-review",
    });

    await expect(
      promoteLocalPlanFolder.run({
        slug: "checkout-review",
        targetPath: "src",
        overwrite: true,
      }),
    ).rejects.toThrow(/does not look like a local Plan folder/);

    await expect(
      fs.readFile(path.join(repoRoot, "src", "important.ts"), "utf-8"),
    ).resolves.toContain("important");
  });
});
