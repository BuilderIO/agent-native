// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";
import {
  addPlanCommentToBundle,
  buildCommentThreads,
  canEditPlanContentRole,
  commentAuthorEmails,
  mentionQueryAtCaret,
  runtimeAnnotationFromThread,
  nativePointForAnchor,
  removePlanCommentFromBundle,
  removePlanCommentThreadFromBundle,
  resolveNativeAnchorTarget,
} from "./PlansPage";
import type { PlanBundle } from "@shared/types";

type PlanComment = PlanBundle["comments"][number];

function comment(
  id: string,
  overrides: Partial<PlanComment> = {},
): PlanComment {
  return {
    id,
    planId: "plan_1",
    parentCommentId: null,
    sectionId: null,
    kind: "comment",
    status: "open",
    anchor: null,
    message: id,
    createdBy: "human",
    authorEmail: `${id}@example.com`,
    authorName: id,
    consumedAt: null,
    createdAt: "2026-06-05T00:00:00.000Z",
    updatedAt: "2026-06-05T00:00:00.000Z",
    ...overrides,
  };
}

function bundleWithComments(comments: PlanComment[]): PlanBundle {
  return {
    plan: {
      id: "plan_1",
      title: "Plan",
      brief: "Brief",
      kind: "plan",
      status: "review",
      source: "manual",
      repoPath: null,
      currentFocus: null,
      hostedPlanId: null,
      hostedPlanUrl: null,
      html: null,
      markdown: null,
      content: null,
      createdAt: "2026-06-05T00:00:00.000Z",
      updatedAt: "2026-06-05T00:00:00.000Z",
      approvedAt: null,
    },
    sections: [],
    comments,
    events: [],
    summary: {
      sectionCounts: {},
      commentCount: comments.length,
      openCommentCount: comments.filter((item) => item.status === "open")
        .length,
    },
  };
}

describe("plan comment thread UI model", () => {
  it("updates the bundle immediately for optimistic comment markers", () => {
    const existing = comment("existing");
    const optimistic = comment("optimistic", {
      anchor: JSON.stringify({ x: 20, y: 40, sectionTitle: "Canvas" }),
    });
    const base = bundleWithComments([existing]);

    const withOptimistic = addPlanCommentToBundle(base, optimistic);
    const replaced = addPlanCommentToBundle(
      withOptimistic,
      comment("optimistic", { status: "resolved" }),
    );
    const removed = removePlanCommentFromBundle(replaced, "optimistic");

    expect(withOptimistic.comments.map((item) => item.id)).toEqual([
      "existing",
      "optimistic",
    ]);
    expect(withOptimistic.summary).toMatchObject({
      commentCount: 2,
      openCommentCount: 2,
    });
    expect(replaced.comments.map((item) => item.id)).toEqual([
      "existing",
      "optimistic",
    ]);
    expect(replaced.summary).toMatchObject({
      commentCount: 2,
      openCommentCount: 1,
    });
    expect(removed.comments.map((item) => item.id)).toEqual(["existing"]);
    expect(removed.summary).toMatchObject({
      commentCount: 1,
      openCommentCount: 1,
    });
  });

  it("removes a whole comment thread for optimistic delete", () => {
    const root = comment("root");
    const reply = comment("reply", {
      parentCommentId: root.id,
      status: "resolved",
    });
    const nestedReply = comment("nested", {
      parentCommentId: reply.id,
    });
    const sibling = comment("sibling");
    const base = bundleWithComments([root, reply, nestedReply, sibling]);

    const removed = removePlanCommentThreadFromBundle(base, root.id);

    expect(removed.comments.map((item) => item.id)).toEqual(["sibling"]);
    expect(removed.summary).toMatchObject({
      commentCount: 1,
      openCommentCount: 1,
    });
  });

  it("removes a reply without deleting the rest of the thread", () => {
    const root = comment("root");
    const reply = comment("reply", { parentCommentId: root.id });
    const siblingReply = comment("sibling-reply", { parentCommentId: root.id });
    const base = bundleWithComments([root, reply, siblingReply]);

    const removed = removePlanCommentThreadFromBundle(base, reply.id);

    expect(removed.comments.map((item) => item.id)).toEqual([
      "root",
      "sibling-reply",
    ]);
    expect(removed.summary).toMatchObject({
      commentCount: 2,
      openCommentCount: 2,
    });
  });

  it("groups replies and exposes participant avatars for Figma-style pins", () => {
    const anchor = JSON.stringify({ x: 42, y: 24, sectionTitle: "Summary" });
    const root = comment("root", {
      authorEmail: "damian@example.com",
      authorName: "Damian",
      anchor,
      createdAt: "2026-06-05T00:00:01.000Z",
    });
    const emma = comment("emma", {
      parentCommentId: root.id,
      authorEmail: "emma@example.com",
      authorName: "Emma",
      createdAt: "2026-06-05T00:00:02.000Z",
    });
    const steve = comment("steve", {
      parentCommentId: root.id,
      authorEmail: "steve@example.com",
      authorName: "Steve Sewell",
      createdAt: "2026-06-05T00:00:03.000Z",
    });

    const threads = buildCommentThreads([steve, root, emma]);
    const annotation = runtimeAnnotationFromThread(threads[0]!, 0, {
      "damian@example.com": "https://example.test/damian.png",
      "emma@example.com": "https://example.test/emma.png",
      "steve@example.com": null,
    });

    expect(threads).toHaveLength(1);
    expect(threads[0]!.comments.map((item) => item.id)).toEqual([
      root.id,
      emma.id,
      steve.id,
    ]);
    expect(annotation).toMatchObject({
      id: root.id,
      commentCount: 3,
      anchor: { x: 42, y: 24, sectionTitle: "Summary" },
      replies: [
        { id: emma.id, authorName: "Emma" },
        { id: steve.id, authorName: "Steve Sewell" },
      ],
      participants: [
        {
          authorEmail: "damian@example.com",
          authorName: "Damian",
          authorAvatarUrl: "https://example.test/damian.png",
        },
        {
          authorEmail: "emma@example.com",
          authorName: "Emma",
          authorAvatarUrl: "https://example.test/emma.png",
        },
        {
          authorEmail: "steve@example.com",
          authorName: "Steve Sewell",
          authorAvatarUrl: null,
        },
      ],
    });
  });

  it("collects unique comment author emails for avatar image lookup", () => {
    expect(
      commentAuthorEmails(
        [
          comment("a", { authorEmail: "Damian@Example.com" }),
          comment("b", { authorEmail: "emma@example.com" }),
          comment("c", { authorEmail: "damian@example.com" }),
        ],
        "steve@example.com",
      ),
    ).toEqual(["damian@example.com", "emma@example.com", "steve@example.com"]);
  });

  it("presents local logged-out comments as the current reviewer", () => {
    const root = comment("root", {
      authorEmail: "local@agent-native.local",
      authorName: "Dev",
      anchor: JSON.stringify({ x: 12, y: 18, sectionTitle: "Prototype" }),
    });

    const [thread] = buildCommentThreads([root]);
    const annotation = thread && runtimeAnnotationFromThread(thread, 0, {});

    expect(annotation).toMatchObject({
      authorEmail: null,
      authorName: "You",
      authorInitials: "You",
      authorColor: "#2563eb",
      participants: [
        {
          authorEmail: null,
          authorName: "You",
          authorInitials: "You",
          authorColor: "#2563eb",
        },
      ],
    });
  });

  it("uses the signed-in profile for local plan-owner comments", () => {
    const root = comment("root", {
      authorEmail: "local@agent-native.local",
      authorName: "Dev",
      anchor: JSON.stringify({ x: 12, y: 18, sectionTitle: "Prototype" }),
    });

    const [thread] = buildCommentThreads([root]);
    const annotation =
      thread &&
      runtimeAnnotationFromThread(
        thread,
        0,
        {},
        {
          email: "steve@example.com",
          name: "Steve Sewell",
          avatarUrl: "https://example.test/steve.png",
          color: "#123456",
        },
      );

    expect(annotation).toMatchObject({
      authorEmail: "steve@example.com",
      authorName: "Steve Sewell",
      authorInitials: "SS",
      authorColor: "#123456",
      authorAvatarUrl: "https://example.test/steve.png",
      participants: [
        {
          authorEmail: "steve@example.com",
          authorName: "Steve Sewell",
          authorInitials: "SS",
          authorColor: "#123456",
          authorAvatarUrl: "https://example.test/steve.png",
        },
      ],
    });
  });

  it("does not treat the auto-dev account as personal initials", () => {
    const root = comment("root", {
      authorEmail: "local@agent-native.local",
      authorName: "Dev",
      anchor: JSON.stringify({ x: 12, y: 18, sectionTitle: "Prototype" }),
    });

    const [thread] = buildCommentThreads([root]);
    const annotation =
      thread &&
      runtimeAnnotationFromThread(
        thread,
        0,
        {},
        {
          email: "dev@local.test",
          name: "Dev",
          avatarUrl: null,
          color: "#2563eb",
        },
      );

    expect(annotation).toMatchObject({
      authorEmail: null,
      authorName: "You",
      authorInitials: "You",
      authorColor: "#2563eb",
    });
  });

  it("merges queryable resolver metadata into runtime annotation anchors", () => {
    const root = comment("root", {
      anchor: JSON.stringify({ x: 12, y: 34, sectionTitle: "Summary" }),
      resolutionTarget: "human",
      mentions: [{ label: "Tiana", email: "tiana@example.com" }],
    });

    const [thread] = buildCommentThreads([root]);
    const annotation = thread && runtimeAnnotationFromThread(thread, 0, {});

    expect(thread?.anchor).toMatchObject({
      x: 12,
      y: 34,
      sectionTitle: "Summary",
      resolutionTarget: "human",
      mentions: [{ label: "Tiana", email: "tiana@example.com" }],
    });
    expect(annotation?.anchor).toMatchObject({
      resolutionTarget: "human",
      mentions: [{ label: "Tiana", email: "tiana@example.com" }],
    });
  });

  it("does not resolve prototype comment anchors against the wrong active screen", () => {
    const reader = document.createElement("div");
    reader.innerHTML = `
      <section data-prototype-screen="start">
        <h1>Start</h1>
        <p>Reusable approval copy</p>
      </section>
    `;
    document.body.append(reader);

    const offscreenAnchor = {
      x: 50,
      y: 50,
      targetKind: "prototype",
      sectionId: "confirm",
      screenId: "confirm",
      textQuote: "Reusable approval copy",
      targetSelector: '[data-prototype-screen="confirm"] p:nth-of-type(1)',
    };

    expect(
      resolveNativeAnchorTarget(offscreenAnchor as any, reader),
    ).toBeNull();
    expect(nativePointForAnchor(offscreenAnchor as any, reader)).toBeNull();

    const legacyOffscreenAnchor = {
      ...offscreenAnchor,
      screenId: undefined,
      targetSelector: undefined,
    };
    expect(
      resolveNativeAnchorTarget(legacyOffscreenAnchor as any, reader),
    ).toBeNull();

    const activeAnchor = {
      ...offscreenAnchor,
      sectionId: "start",
      screenId: "start",
      targetSelector: '[data-prototype-screen="start"] p:nth-of-type(1)',
    };
    expect(
      resolveNativeAnchorTarget(activeAnchor as any, reader)?.tagName,
    ).toBe("P");

    reader.remove();
  });

  it("limits canvas markup content edits to editor-capable roles", () => {
    expect(canEditPlanContentRole("owner")).toBe(true);
    expect(canEditPlanContentRole("admin")).toBe(true);
    expect(canEditPlanContentRole("editor")).toBe(true);
    expect(canEditPlanContentRole("viewer")).toBe(false);
    expect(canEditPlanContentRole(null)).toBe(false);
    expect(canEditPlanContentRole(undefined)).toBe(false);
  });

  it("detects mention queries when Chrome splits typed content into text nodes", () => {
    const root = document.createElement("div");
    root.contentEditable = "true";
    root.append(
      document.createTextNode("@"),
      document.createTextNode("t"),
      document.createTextNode("i"),
    );
    document.body.append(root);
    const selection = window.getSelection();
    const range = document.createRange();
    range.setStart(root, root.childNodes.length);
    range.collapse(true);
    selection?.removeAllRanges();
    selection?.addRange(range);

    const query = mentionQueryAtCaret(root);

    expect(query?.query).toBe("ti");
    expect(query?.range.toString()).toBe("@ti");
    root.remove();
  });
});
