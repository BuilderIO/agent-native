// @vitest-environment happy-dom

import type { PlanBundle } from "@shared/types";
import { describe, expect, it } from "vitest";

import { planBundleQueryKey } from "@/hooks/use-plans";

import {
  addPlanCommentToBundle,
  buildNativeAnchorFromElement,
  buildCommentThreads,
  canEditPlanContentRole,
  commentAuthorEmails,
  commentThreadsForVisualSurfaceMode,
  commentThreadsForVisibility,
  mentionQueryAtCaret,
  localPlanBridgeRetryDelay,
  nativeMarkerPlacementForAnchor,
  runtimeAnnotationFromThread,
  nativePointForAnchor,
  removePlanCommentFromBundle,
  removePlanCommentThreadFromBundle,
  resolveNativeAnchorTarget,
  selectorForElementWithin,
  shouldRetryLocalPlanBridgeBundle,
  shouldShowPlanLoadError,
  shouldKeepCommentPopoverOpenForTarget,
  resolvePlanOrgAccessPrompt,
} from "./PlansPage";

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

function rect(left: number, top: number, width: number, height: number) {
  return {
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    x: left,
    y: top,
    toJSON: () => ({}),
  } as DOMRect;
}

describe("plan comment thread UI model", () => {
  it("uses the exact get-visual-plan query key for optimistic bundle updates", () => {
    expect(planBundleQueryKey("plan_1")).toEqual([
      "action",
      "get-visual-plan",
      { id: "plan_1", includeMdx: false, includeHtml: true },
    ]);
  });

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

  it("keeps the comment popover open for portalled menu clicks", () => {
    const popover = document.createElement("div");
    const inside = document.createElement("button");
    const marker = document.createElement("button");
    const menu = document.createElement("div");
    const menuItem = document.createElement("button");
    const outside = document.createElement("button");

    popover.append(inside);
    marker.setAttribute("data-comment-marker", "");
    menu.setAttribute("data-comment-popover-portal", "");
    menu.append(menuItem);
    document.body.append(popover, marker, menu, outside);

    expect(shouldKeepCommentPopoverOpenForTarget(inside, popover)).toBe(true);
    expect(shouldKeepCommentPopoverOpenForTarget(marker, popover)).toBe(true);
    expect(shouldKeepCommentPopoverOpenForTarget(menuItem, popover)).toBe(true);
    expect(shouldKeepCommentPopoverOpenForTarget(outside, popover)).toBe(false);

    popover.remove();
    marker.remove();
    menu.remove();
    outside.remove();
  });

  it("filters comment threads for the toolbar visibility modes", () => {
    const openRoot = comment("open-root", {
      createdAt: "2026-06-05T00:00:01.000Z",
    });
    const resolvedRoot = comment("resolved-root", {
      status: "resolved",
      createdAt: "2026-06-05T00:00:02.000Z",
    });
    const mixedRoot = comment("mixed-root", {
      status: "resolved",
      createdAt: "2026-06-05T00:00:03.000Z",
    });
    const mixedReply = comment("mixed-reply", {
      parentCommentId: mixedRoot.id,
      status: "open",
      createdAt: "2026-06-05T00:00:04.000Z",
    });
    const threads = buildCommentThreads([
      resolvedRoot,
      mixedReply,
      openRoot,
      mixedRoot,
    ]);

    expect(
      commentThreadsForVisibility(threads, "hidden").map((thread) => thread.id),
    ).toEqual([]);
    expect(
      commentThreadsForVisibility(threads, "open").map((thread) => thread.id),
    ).toEqual(["open-root", "mixed-root"]);
    expect(
      commentThreadsForVisibility(threads, "all").map((thread) => thread.id),
    ).toEqual(["open-root", "resolved-root", "mixed-root"]);
  });

  it("keeps prototype and wireframe markers scoped to the active visual tab", () => {
    const prototypeRoot = comment("prototype-root", {
      anchor: JSON.stringify({
        x: 50,
        y: 20,
        targetKind: "prototype",
        screenId: "runs",
      }),
      createdAt: "2026-06-05T00:00:01.000Z",
    });
    const wireframeRoot = comment("wireframe-root", {
      anchor: JSON.stringify({
        x: 50,
        y: 30,
        targetKind: "wireframe",
        sectionId: "runs-frame",
      }),
      createdAt: "2026-06-05T00:00:02.000Z",
    });
    const canvasRoot = comment("canvas-root", {
      anchor: JSON.stringify({
        x: 50,
        y: 40,
        targetKind: "canvas",
        canvasX: 120,
        canvasY: 80,
      }),
      createdAt: "2026-06-05T00:00:03.000Z",
    });
    const documentRoot = comment("document-root", {
      anchor: JSON.stringify({
        x: 50,
        y: 70,
        targetKind: "text",
        textQuote: "Overview",
      }),
      createdAt: "2026-06-05T00:00:04.000Z",
    });
    const threads = buildCommentThreads([
      documentRoot,
      wireframeRoot,
      prototypeRoot,
      canvasRoot,
    ]);

    expect(
      commentThreadsForVisualSurfaceMode(threads, "prototype").map(
        (thread) => thread.id,
      ),
    ).toEqual(["prototype-root", "document-root"]);
    expect(
      commentThreadsForVisualSurfaceMode(threads, "wireframes").map(
        (thread) => thread.id,
      ),
    ).toEqual(["wireframe-root", "canvas-root", "document-root"]);
    expect(
      commentThreadsForVisualSurfaceMode(threads, "none").map(
        (thread) => thread.id,
      ),
    ).toEqual(["document-root"]);
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

  it("falls back from a broad text selector to the quoted target before positioning", () => {
    const reader = document.createElement("div");
    reader.innerHTML = `
      <div data-block-id="scope">
        <section><p id="wrong">Wrong first paragraph</p></section>
        <section><p id="target">Second target paragraph</p></section>
      </div>
    `;
    document.body.append(reader);

    const wrong = reader.querySelector<HTMLElement>("#wrong")!;
    const target = reader.querySelector<HTMLElement>("#target")!;
    Object.defineProperty(reader, "getBoundingClientRect", {
      value: () => rect(0, 0, 400, 400),
    });
    Object.defineProperty(wrong, "getBoundingClientRect", {
      value: () => rect(20, 40, 200, 24),
    });
    Object.defineProperty(target, "getBoundingClientRect", {
      value: () => rect(20, 140, 200, 24),
    });

    const anchor = {
      x: 50,
      y: 50,
      sectionId: "scope",
      textQuote: "Second target paragraph",
      targetSelector: '[data-block-id="scope"] p:nth-of-type(1)',
      targetX: 25,
      targetY: 50,
    };

    expect(resolveNativeAnchorTarget(anchor as any, reader)).toBe(target);
    expect(nativePointForAnchor(anchor as any, reader)).toEqual({
      left: 70,
      top: 152,
    });

    reader.remove();
  });

  it("stores a scoped child path for repeated nested block elements", () => {
    const reader = document.createElement("div");
    reader.innerHTML = `
      <div data-block-id="scope">
        <section><p id="wrong">Wrong first paragraph</p></section>
        <section><p id="target">Second target paragraph</p></section>
      </div>
    `;
    document.body.append(reader);

    const target = reader.querySelector<HTMLElement>("#target")!;
    const selector = selectorForElementWithin(reader, target);

    expect(selector).toBe(
      '[data-block-id="scope"] > section:nth-of-type(2) > p:nth-of-type(1)',
    );
    expect(reader.querySelector(selector!)).toBe(target);

    reader.remove();
  });

  it("prefers wireframe node identity over a stale block selector", () => {
    const reader = document.createElement("div");
    reader.innerHTML = `
      <div data-block-id="wire-block">
        <div id="wrong">Earlier block div</div>
        <div data-canvas-frame="frame_1">
          <div>
            <button id="target" data-wire-node-id="cta">Review CTA</button>
          </div>
        </div>
      </div>
    `;
    document.body.append(reader);

    const wrong = reader.querySelector<HTMLElement>("#wrong")!;
    const frame = reader.querySelector<HTMLElement>("[data-canvas-frame]")!;
    const target = reader.querySelector<HTMLElement>("#target")!;
    Object.defineProperty(reader, "getBoundingClientRect", {
      value: () => rect(0, 0, 500, 500),
    });
    Object.defineProperty(wrong, "getBoundingClientRect", {
      value: () => rect(20, 30, 120, 40),
    });
    Object.defineProperty(frame, "getBoundingClientRect", {
      value: () => rect(60, 180, 260, 160),
    });
    Object.defineProperty(target, "getBoundingClientRect", {
      value: () => rect(100, 240, 80, 32),
    });

    const anchor = {
      x: 40,
      y: 50,
      sectionId: "frame_1",
      targetKind: "wireframe",
      targetNodeId: "cta",
      targetSelector: '[data-block-id="wire-block"] div:nth-of-type(1)',
      targetX: 50,
      targetY: 50,
    };

    expect(resolveNativeAnchorTarget(anchor as any, reader)).toBe(target);
    expect(nativePointForAnchor(anchor as any, reader)).toEqual({
      left: 140,
      top: 256,
    });

    reader.remove();
  });

  it("measures wireframe element clicks against the stored node target", () => {
    const reader = document.createElement("div");
    reader.innerHTML = `
      <div data-block-id="canvas-block">
        <div data-canvas-frame="frame_1">
          <div id="card" data-wire-node-id="card" data-wire-node-el="card">
            <button id="target">Save</button>
          </div>
        </div>
      </div>
    `;
    document.body.append(reader);

    const card = reader.querySelector<HTMLElement>("#card")!;
    const target = reader.querySelector<HTMLElement>("#target")!;
    Object.defineProperties(reader, {
      scrollWidth: { value: 1000, configurable: true },
      scrollHeight: { value: 1000, configurable: true },
      scrollLeft: { value: 0, configurable: true },
      scrollTop: { value: 0, configurable: true },
      getBoundingClientRect: {
        value: () => rect(0, 0, 1000, 1000),
        configurable: true,
      },
    });
    Object.defineProperty(card, "getBoundingClientRect", {
      value: () => rect(100, 200, 300, 200),
    });
    Object.defineProperty(target, "getBoundingClientRect", {
      value: () => rect(200, 260, 100, 40),
    });

    const anchor = buildNativeAnchorFromElement({
      reader,
      target,
      pointX: 250,
      pointY: 280,
      planTitle: "Wireframe",
    });

    expect(anchor.sectionId).toBe("frame_1");
    expect(anchor.targetNodeId).toBe("card");
    expect(anchor.targetSelector).toBe(
      '[data-canvas-frame="frame_1"] [data-wire-node-id="card"]',
    );
    expect(anchor.targetX).toBeCloseTo(50);
    expect(anchor.targetY).toBeCloseTo(40);
    expect(resolveNativeAnchorTarget(anchor, reader)).toBe(card);
    expect(nativePointForAnchor(anchor, reader)).toEqual({
      left: 250,
      top: 280,
    });

    reader.remove();
  });

  it("measures generic wireframe child clicks against the saved selector target", () => {
    const reader = document.createElement("div");
    reader.innerHTML = `
      <section class="plan-canvas">
        <div data-plan-canvas-viewport>
          <div data-plan-canvas-world>
            <div data-canvas-frame="frame_1">
              <div>
                <button id="target">New run</button>
              </div>
            </div>
          </div>
        </div>
      </section>
    `;
    document.body.append(reader);

    const frame = reader.querySelector<HTMLElement>("[data-canvas-frame]")!;
    const target = reader.querySelector<HTMLElement>("#target")!;
    Object.defineProperties(reader, {
      scrollWidth: { value: 1000, configurable: true },
      scrollHeight: { value: 1000, configurable: true },
      scrollLeft: { value: 0, configurable: true },
      scrollTop: { value: 0, configurable: true },
    });
    Object.defineProperty(reader, "getBoundingClientRect", {
      value: () => rect(0, 0, 1000, 800),
    });
    Object.defineProperty(frame, "getBoundingClientRect", {
      value: () => rect(100, 200, 300, 200),
    });
    Object.defineProperty(target, "getBoundingClientRect", {
      value: () => rect(250, 260, 80, 40),
    });

    const anchor = buildNativeAnchorFromElement({
      reader,
      target,
      pointX: 290,
      pointY: 280,
      planTitle: "Wireframe",
    });

    expect(anchor.sectionId).toBe("frame_1");
    expect(anchor.targetKind).toBe("wireframe");
    expect(anchor.targetSelector).toBe(
      '[data-canvas-frame="frame_1"] > div:nth-of-type(1) > button:nth-of-type(1)',
    );
    expect(anchor.targetX).toBeCloseTo(50);
    expect(anchor.targetY).toBeCloseTo(50);
    expect(resolveNativeAnchorTarget(anchor, reader)).toBe(target);
    expect(nativePointForAnchor(anchor, reader)).toEqual({
      left: 290,
      top: 280,
    });

    reader.remove();
  });

  it("clips canvas comment markers to the canvas viewport instead of the document", () => {
    const reader = document.createElement("div");
    reader.innerHTML = `
      <section class="plan-canvas">
        <div data-plan-canvas-viewport>
          <div data-plan-canvas-world></div>
        </div>
      </section>
      <article><h1>Overview</h1></article>
    `;
    document.body.append(reader);

    const viewport = reader.querySelector<HTMLElement>(
      "[data-plan-canvas-viewport]",
    )!;
    const world = reader.querySelector<HTMLElement>(
      "[data-plan-canvas-world]",
    )!;
    Object.defineProperty(reader, "getBoundingClientRect", {
      value: () => rect(0, 0, 1000, 800),
    });
    Object.defineProperty(viewport, "getBoundingClientRect", {
      value: () => rect(0, -240, 1000, 650),
    });
    Object.defineProperty(world, "getBoundingClientRect", {
      value: () => rect(0, -280, 1800, 1400),
    });

    const anchor = {
      x: 50,
      y: 80,
      anchorKind: "visual",
      targetKind: "canvas",
      visualX: 50,
      visualY: 90,
      canvasX: 900,
      canvasY: 1260,
    };

    const placement = nativeMarkerPlacementForAnchor(anchor as any, reader);

    expect(placement).toEqual({
      clip: {
        left: 0,
        top: -240,
        width: 1000,
        height: 650,
      },
      marker: {
        left: 900,
        top: 1220,
      },
    });

    reader.remove();
  });

  it("clips legacy canvas-world visual markers to the canvas viewport", () => {
    const reader = document.createElement("div");
    reader.innerHTML = `
      <section class="plan-canvas">
        <div data-plan-canvas-viewport>
          <div data-plan-canvas-world></div>
        </div>
      </section>
      <article><h1>Overview</h1></article>
    `;
    document.body.append(reader);

    const viewport = reader.querySelector<HTMLElement>(
      "[data-plan-canvas-viewport]",
    )!;
    const world = reader.querySelector<HTMLElement>(
      "[data-plan-canvas-world]",
    )!;
    Object.defineProperty(reader, "getBoundingClientRect", {
      value: () => rect(0, 0, 1000, 800),
    });
    Object.defineProperty(viewport, "getBoundingClientRect", {
      value: () => rect(0, -240, 1000, 650),
    });
    Object.defineProperty(world, "getBoundingClientRect", {
      value: () => rect(0, -280, 1800, 1400),
    });

    const anchor = {
      x: 50,
      y: 80,
      anchorKind: "visual",
      targetSelector: "[data-plan-canvas-world]",
      visualX: 50,
      visualY: 90,
    };

    const placement = nativeMarkerPlacementForAnchor(anchor as any, reader);

    expect(placement).toEqual({
      clip: {
        left: 0,
        top: -240,
        width: 1000,
        height: 650,
      },
      marker: {
        left: 900,
        top: 1220,
      },
    });

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

  it("retries transient local plan bridge startup failures only", () => {
    expect(
      shouldRetryLocalPlanBridgeBundle(0, new TypeError("fetch failed")),
    ).toBe(true);
    expect(
      shouldRetryLocalPlanBridgeBundle(
        1,
        new Error("Local plan bridge returned 503."),
      ),
    ).toBe(true);
    expect(
      shouldRetryLocalPlanBridgeBundle(
        5,
        new Error("Local plan bridge returned 503."),
      ),
    ).toBe(false);
    expect(
      shouldRetryLocalPlanBridgeBundle(
        0,
        new Error("Local plan bridge must point to localhost."),
      ),
    ).toBe(false);
    expect(
      shouldRetryLocalPlanBridgeBundle(
        0,
        new Error("Local plan bridge response was not a Plan MDX folder."),
      ),
    ).toBe(false);
    expect(localPlanBridgeRetryDelay(0)).toBe(500);
    expect(localPlanBridgeRetryDelay(4)).toBe(2_500);
  });

  it("surfaces the retry card instead of an endless skeleton for a stalled read", () => {
    const base = {
      hasSelectedId: true,
      localPlanMode: false,
      hasBundle: false,
      planQueryPending: false,
      planQueryError: false,
      planQueryPaused: false,
      accessStatusPending: false,
      accessStatusPaused: false,
      accessDenied: false,
    };
    // A paused read (offline at mount, or tab blurred mid-retry) never errors
    // and never resolves — must show the retryable card, not the skeleton.
    expect(shouldShowPlanLoadError({ ...base, planQueryPaused: true })).toBe(
      true,
    );
    expect(shouldShowPlanLoadError({ ...base, accessStatusPaused: true })).toBe(
      true,
    );
    // A genuinely in-flight initial load keeps the skeleton (no regression).
    expect(
      shouldShowPlanLoadError({
        ...base,
        planQueryPending: true,
        planQueryPaused: true,
      }),
    ).toBe(false);
    // Real errors and access denials still show the card.
    expect(shouldShowPlanLoadError({ ...base, planQueryError: true })).toBe(
      true,
    );
    expect(shouldShowPlanLoadError({ ...base, accessDenied: true })).toBe(true);
    // An access denial that hasn't settled yet should not flash the card.
    expect(
      shouldShowPlanLoadError({
        ...base,
        accessDenied: true,
        accessStatusPending: true,
      }),
    ).toBe(false);
    // Healthy / local / already-loaded states never show the card.
    expect(shouldShowPlanLoadError(base)).toBe(false);
    expect(shouldShowPlanLoadError({ ...base, hasBundle: true })).toBe(false);
    expect(shouldShowPlanLoadError({ ...base, localPlanMode: true })).toBe(
      false,
    );
    expect(shouldShowPlanLoadError({ ...base, hasSelectedId: false })).toBe(
      false,
    );
  });

  it("prefers accepting an existing org invite on the plan access wall", () => {
    const prompt = resolvePlanOrgAccessPrompt({
      accessStatus: {
        exists: true,
        hasAccess: false,
        signedIn: true,
        viewerEmail: "sami@builder.io",
        viewerName: "Sami",
        role: null,
        orgId: "org_builder",
        orgName: "Builder.io",
        visibility: "org",
      },
      org: {
        email: "sami@builder.io",
        pendingInvitations: [
          {
            id: "invite_1",
            orgId: "org_builder",
            orgName: "Builder.io",
            invitedBy: "Milos",
          },
        ],
        domainMatches: [{ orgId: "org_builder", orgName: "Builder.io" }],
      },
    });

    expect(prompt).toMatchObject({
      kind: "invitation",
      invitationId: "invite_1",
      organizationName: "Builder.io",
      invitedBy: "Milos",
    });
  });

  it("offers domain join for org plan access when no invite is pending", () => {
    const prompt = resolvePlanOrgAccessPrompt({
      accessStatus: {
        exists: true,
        hasAccess: false,
        signedIn: true,
        viewerEmail: "sami@builder.io",
        viewerName: "Sami",
        role: null,
        orgId: "org_builder",
        orgName: "Builder.io",
        visibility: "org",
      },
      org: {
        email: "sami@builder.io",
        pendingInvitations: [],
        domainMatches: [{ orgId: "org_builder", orgName: "Builder.io" }],
      },
    });

    expect(prompt).toMatchObject({
      kind: "domain",
      organizationId: "org_builder",
      organizationName: "Builder.io",
      domain: "builder.io",
    });
  });

  it("keeps private plan denials on the existing request-access path", () => {
    const prompt = resolvePlanOrgAccessPrompt({
      accessStatus: {
        exists: true,
        hasAccess: false,
        signedIn: true,
        viewerEmail: "sami@builder.io",
        viewerName: "Sami",
        role: null,
        orgId: null,
        orgName: null,
        visibility: "private",
      },
      org: {
        email: "sami@builder.io",
        pendingInvitations: [
          {
            id: "invite_1",
            orgId: "org_builder",
            orgName: "Builder.io",
            invitedBy: "Milos",
          },
        ],
        domainMatches: [{ orgId: "org_builder", orgName: "Builder.io" }],
      },
    });

    expect(prompt).toBeNull();
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
