import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  planContentSchema,
  type PlanContent,
} from "../../shared/plan-content.js";
import type { PlanComment } from "../../shared/types.js";
import {
  promotePlanLocalFolder,
  writeLocalPlanComments,
  writePlanLocalFiles,
  writePlanLocalFolder,
} from "./local-plan-files.js";

// Local plan folders are repo files with no database in front of them, so each
// save reports itself before its first disk write. A refused overwrite reports
// nothing, because it stops before touching a single file.
const mocks = vi.hoisted(() => ({
  noteExternalWrite: vi.fn(),
}));

vi.mock("@agent-native/core/action", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/action")>()),
  noteExternalWrite: mocks.noteExternalWrite,
}));

type WriteSpy = { mock: { invocationCallOrder: number[] } };

/** The save reported itself with `channel`, and before the first `write` call. */
function expectReportedBefore(write: WriteSpy, channel: string) {
  expect(write.mock.invocationCallOrder.length).toBeGreaterThan(0);
  expect(mocks.noteExternalWrite).toHaveBeenCalledWith(channel);
  expect(
    Math.min(...mocks.noteExternalWrite.mock.invocationCallOrder),
  ).toBeLessThan(Math.min(...write.mock.invocationCallOrder));
}

function sampleContent(): PlanContent {
  return planContentSchema.parse({
    version: 2,
    title: "Observed write",
    brief: "Saved to local files.",
    blocks: [
      {
        id: "summary",
        type: "rich-text",
        title: "Summary",
        data: { markdown: "Body text." },
      },
    ],
  });
}

function comment(): PlanComment {
  return {
    id: "comment_1",
    planId: "plan_comments",
    parentCommentId: null,
    sectionId: null,
    kind: "comment",
    status: "open",
    anchor: null,
    message: "Looks right.",
    createdBy: "human",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

let sandbox: string;

beforeEach(async () => {
  sandbox = await fs.mkdtemp(path.join(os.tmpdir(), "plan-observed-"));
  vi.stubEnv("PLAN_LOCAL_DIR", path.join(sandbox, "local"));
  vi.stubEnv("PLAN_REPO_ROOT", path.join(sandbox, "repo"));
});

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  mocks.noteExternalWrite.mockClear();
  await fs.rm(sandbox, { recursive: true, force: true });
});

describe("writing a plan folder", () => {
  it("reports a repo folder save before its first mkdir", async () => {
    const mkdir = vi.spyOn(fs, "mkdir");

    const result = await writePlanLocalFolder({
      planId: "plan_folder",
      title: "Folder plan",
      slug: "folder-plan",
      path: "plans/folder-plan",
      content: sampleContent(),
    });

    expect(result.written).toBe(true);
    expect(result.files).toContain("plan.mdx");
    expectReportedBefore(mkdir, "local-file");
  });

  it("reports a plans-folder save before its first mkdir", async () => {
    const mkdir = vi.spyOn(fs, "mkdir");

    const result = await writePlanLocalFiles({
      planId: "plan_files",
      title: "Files plan",
      content: sampleContent(),
    });

    expect(result.written).toBe(true);
    expectReportedBefore(mkdir, "local-file");
  });
});

describe("promoting a plan folder over an existing one", () => {
  it("reports the overwrite once, before removing the plan files it replaces", async () => {
    await writePlanLocalFolder({
      planId: "plan_old",
      title: "Old plan",
      slug: "target",
      path: "plans/target",
      content: sampleContent(),
    });
    await writePlanLocalFolder({
      planId: "plan_new",
      title: "New plan",
      slug: "source",
      content: sampleContent(),
    });
    const rm = vi.spyOn(fs, "rm");
    mocks.noteExternalWrite.mockClear();

    const result = await promotePlanLocalFolder({
      slug: "source",
      targetPath: "plans/target",
      overwrite: true,
    });

    expect(result.alreadyPromoted).toBe(false);
    expect(rm.mock.invocationCallOrder.length).toBeGreaterThan(0);
    const firstRemoval = Math.min(...rm.mock.invocationCallOrder);
    const reportsBeforeRemoval =
      mocks.noteExternalWrite.mock.invocationCallOrder.filter(
        (order) => order < firstRemoval,
      );
    expect(reportsBeforeRemoval).toHaveLength(1);
    expect(mocks.noteExternalWrite).toHaveBeenCalledWith("local-file");
  });

  it("reports nothing when the target is not a plan folder", async () => {
    await writePlanLocalFolder({
      planId: "plan_src",
      title: "Source plan",
      slug: "source",
      content: sampleContent(),
    });
    const target = path.join(sandbox, "repo", "plans", "not-a-plan");
    await fs.mkdir(target, { recursive: true });
    await fs.writeFile(path.join(target, "notes.txt"), "keep me");
    mocks.noteExternalWrite.mockClear();

    await expect(
      promotePlanLocalFolder({
        slug: "source",
        targetPath: "plans/not-a-plan",
        overwrite: true,
      }),
    ).rejects.toThrow("does not look like a local Plan folder");
    expect(mocks.noteExternalWrite).not.toHaveBeenCalled();
    expect(await fs.readFile(path.join(target, "notes.txt"), "utf-8")).toBe(
      "keep me",
    );
  });
});

describe("writing local plan comments", () => {
  it("reports before removing comments.json when no comments are left", async () => {
    const folder = path.join(sandbox, "comments-empty");
    await fs.mkdir(folder, { recursive: true });
    await fs.writeFile(path.join(folder, "comments.json"), "[]\n");
    const rm = vi.spyOn(fs, "rm");

    await writeLocalPlanComments(folder, []);

    expectReportedBefore(rm, "local-file");
    await expect(
      fs.access(path.join(folder, "comments.json")),
    ).rejects.toThrow();
  });

  it("reports before writing comments.json", async () => {
    const folder = path.join(sandbox, "comments-saved");
    const writeFile = vi.spyOn(fs, "writeFile");

    await writeLocalPlanComments(folder, [comment()]);

    expectReportedBefore(writeFile, "local-file");
    const saved = await fs.readFile(
      path.join(folder, "comments.json"),
      "utf-8",
    );
    expect(JSON.parse(saved)).toEqual([comment()]);
  });
});
