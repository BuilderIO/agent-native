import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PlanComment } from "../../shared/types.js";
import {
  readLocalPlanComments,
  writeLocalPlanComments,
} from "./local-plan-files.js";

function sampleComment(overrides: Partial<PlanComment> = {}): PlanComment {
  return {
    id: "cmt_test",
    planId: "local-demo",
    parentCommentId: null,
    sectionId: null,
    kind: "annotation",
    status: "open",
    anchor: null,
    message: "Tighten the empty-state copy.",
    createdBy: "human",
    authorEmail: "dev@local",
    authorName: null,
    resolutionTarget: "agent",
    mentions: [],
    mentionsJson: null,
    resolvedBy: null,
    resolvedAt: null,
    consumedAt: null,
    deletedAt: null,
    deletedBy: null,
    createdAt: "2026-06-18T00:00:00.000Z",
    updatedAt: "2026-06-18T00:00:00.000Z",
    ...overrides,
  };
}

describe("local plan comments sidecar", () => {
  let folder: string;

  beforeEach(async () => {
    folder = await fs.mkdtemp(path.join(os.tmpdir(), "plan-comments-"));
  });

  afterEach(async () => {
    await fs.rm(folder, { recursive: true, force: true });
  });

  it("returns an empty array when comments.json is absent", async () => {
    expect(await readLocalPlanComments(folder)).toEqual([]);
  });

  it("round-trips comments through comments.json", async () => {
    const comments = [
      sampleComment(),
      sampleComment({ id: "cmt_reply", parentCommentId: "cmt_test" }),
    ];
    await writeLocalPlanComments(folder, comments);

    const onDisk = JSON.parse(
      await fs.readFile(path.join(folder, "comments.json"), "utf-8"),
    );
    expect(onDisk).toHaveLength(2);
    expect(await readLocalPlanComments(folder)).toEqual(comments);
  });

  it("removes comments.json when the array is empty", async () => {
    await writeLocalPlanComments(folder, [sampleComment()]);
    await writeLocalPlanComments(folder, []);
    await expect(
      fs.readFile(path.join(folder, "comments.json"), "utf-8"),
    ).rejects.toThrow();
    expect(await readLocalPlanComments(folder)).toEqual([]);
  });

  it("treats malformed JSON as no comments", async () => {
    await fs.writeFile(
      path.join(folder, "comments.json"),
      "{ not json",
      "utf-8",
    );
    expect(await readLocalPlanComments(folder)).toEqual([]);
  });
});
