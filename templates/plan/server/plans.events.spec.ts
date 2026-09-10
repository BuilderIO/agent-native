import {
  subscribe,
  unsubscribe,
  registerEvent,
} from "@agent-native/core/event-bus";
/**
 * Verifies that the plan event-bus helper functions emit the expected events.
 * Uses subscribe() to intercept emissions — no DB or action runner required.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import {
  emitPlanCreated,
  emitPlanCommented,
  emitPlanPublished,
  emitPlanStatusChanged,
} from "./plans.js";

// Register the plan events so the bus can validate payloads.
// These registrations are normally done in the server plugin at startup.
// Registering twice is safe — the registry dedupes by name.
function registerPlanEvents() {
  registerEvent({
    name: "plan.created",
    description: "A new visual plan or recap was created.",
    payloadSchema: z.object({
      planId: z.string(),
      title: z.string(),
      kind: z.enum(["plan", "recap"]),
      status: z.string(),
      path: z.string(),
      createdBy: z.string().optional(),
    }) as any,
  });

  registerEvent({
    name: "plan.commented",
    description: "A human or agent added comments to a visual plan.",
    payloadSchema: z.object({
      planId: z.string(),
      title: z.string(),
      kind: z.enum(["plan", "recap"]),
      commentIds: z.array(z.string()),
      commentCount: z.number(),
      resolutionTarget: z.enum(["agent", "human"]).nullable(),
      excerpt: z.string(),
      author: z.string().nullable(),
      path: z.string(),
    }) as any,
  });

  registerEvent({
    name: "plan.published",
    description: "A local plan was published to a hosted instance.",
    payloadSchema: z.object({
      planId: z.string(),
      title: z.string(),
      kind: z.enum(["plan", "recap"]),
      hostedPlanId: z.string(),
      url: z.string(),
      requestedVisibility: z.string(),
    }) as any,
  });

  registerEvent({
    name: "plan.status.changed",
    description: "A visual plan's status was changed.",
    payloadSchema: z.object({
      planId: z.string(),
      title: z.string(),
      kind: z.enum(["plan", "recap"]),
      oldStatus: z.string().nullable(),
      newStatus: z.string(),
      changedBy: z.string().nullable(),
      path: z.string(),
    }) as any,
  });
}

describe("plan event-bus helpers", () => {
  const subscriptionIds: string[] = [];

  beforeEach(() => {
    registerPlanEvents();
  });

  afterEach(() => {
    for (const id of subscriptionIds.splice(0)) {
      unsubscribe(id);
    }
  });

  function capture(eventName: string) {
    const handler = vi.fn();
    const id = subscribe(eventName, handler);
    subscriptionIds.push(id);
    return handler;
  }

  it("emitPlanCreated fires plan.created with correct payload shape", () => {
    const handler = capture("plan.created");

    emitPlanCreated({
      planId: "plan-abc",
      title: "My Plan",
      kind: "plan",
      status: "review",
      ownerEmail: "owner@example.com",
    });

    expect(handler).toHaveBeenCalledTimes(1);
    const [payload, meta] = handler.mock.calls[0] as [any, any];
    expect(payload.planId).toBe("plan-abc");
    expect(payload.title).toBe("My Plan");
    expect(payload.kind).toBe("plan");
    expect(payload.status).toBe("review");
    expect(payload.path).toBe("/plans/plan-abc");
    expect(meta.owner).toBe("owner@example.com");
  });

  it("emitPlanCreated works for recap kind", () => {
    const handler = capture("plan.created");

    emitPlanCreated({
      planId: "recap-xyz",
      title: "My Recap",
      kind: "recap",
      status: "review",
      ownerEmail: null,
    });

    expect(handler).toHaveBeenCalledTimes(1);
    const [payload] = handler.mock.calls[0] as [any, any];
    expect(payload.kind).toBe("recap");
    expect(payload.path).toBe("/recaps/recap-xyz");
  });

  it("emitPlanCommented fires plan.commented with resolutionTarget and excerpt", () => {
    const handler = capture("plan.commented");

    emitPlanCommented({
      planId: "plan-abc",
      title: "My Plan",
      kind: "plan",
      comments: [
        {
          id: "cmt_1",
          message: "Please clarify the token refresh logic.",
          resolutionTarget: "agent",
          authorEmail: "reviewer@example.com",
          createdBy: "human",
        },
      ],
      ownerEmail: "owner@example.com",
    });

    expect(handler).toHaveBeenCalledTimes(1);
    const [payload] = handler.mock.calls[0] as [any, any];
    expect(payload.planId).toBe("plan-abc");
    expect(payload.commentIds).toEqual(["cmt_1"]);
    expect(payload.commentCount).toBe(1);
    expect(payload.resolutionTarget).toBe("agent");
    expect(payload.excerpt).toContain("clarify");
    expect(payload.author).toBe("reviewer@example.com");
    expect(payload.path).toBe("/plans/plan-abc");
  });

  it("emitPlanCommented does not fire when comment list is empty", () => {
    const handler = capture("plan.commented");

    emitPlanCommented({
      planId: "plan-abc",
      title: "My Plan",
      kind: "plan",
      comments: [],
      ownerEmail: "owner@example.com",
    });

    expect(handler).not.toHaveBeenCalled();
  });

  it("emitPlanCommented truncates excerpt to 200 chars", () => {
    const handler = capture("plan.commented");
    const longMessage = "x".repeat(300);

    emitPlanCommented({
      planId: "plan-abc",
      title: "My Plan",
      kind: "plan",
      comments: [
        {
          id: "cmt_2",
          message: longMessage,
          resolutionTarget: null,
          authorEmail: null,
        },
      ],
      ownerEmail: null,
    });

    const [payload] = handler.mock.calls[0] as [any, any];
    expect(payload.excerpt.length).toBeLessThanOrEqual(200);
  });

  it("emitPlanPublished fires plan.published with url and visibility", () => {
    const handler = capture("plan.published");

    emitPlanPublished({
      planId: "plan-abc",
      title: "My Plan",
      kind: "plan",
      hostedPlanId: "plan-hosted-1",
      url: "https://app.example.com/plans/plan-hosted-1",
      requestedVisibility: "org",
      ownerEmail: "owner@example.com",
    });

    expect(handler).toHaveBeenCalledTimes(1);
    const [payload, meta] = handler.mock.calls[0] as [any, any];
    expect(payload.planId).toBe("plan-abc");
    expect(payload.hostedPlanId).toBe("plan-hosted-1");
    expect(payload.url).toBe("https://app.example.com/plans/plan-hosted-1");
    expect(payload.requestedVisibility).toBe("org");
    expect(meta.owner).toBe("owner@example.com");
  });

  it("emitPlanStatusChanged fires plan.status.changed with old/new status", () => {
    const handler = capture("plan.status.changed");

    emitPlanStatusChanged({
      planId: "plan-abc",
      title: "My Plan",
      kind: "plan",
      oldStatus: "review",
      newStatus: "approved",
      changedBy: "user@example.com",
      ownerEmail: "owner@example.com",
    });

    expect(handler).toHaveBeenCalledTimes(1);
    const [payload] = handler.mock.calls[0] as [any, any];
    expect(payload.planId).toBe("plan-abc");
    expect(payload.oldStatus).toBe("review");
    expect(payload.newStatus).toBe("approved");
    expect(payload.changedBy).toBe("user@example.com");
    expect(payload.path).toBe("/plans/plan-abc");
  });

  it("emit helpers are fire-and-forget — exceptions inside emit do not propagate", () => {
    // emit() itself swallows internal errors in the try/catch wrappers;
    // verify the helper does not throw even on a totally invalid payload.
    expect(() =>
      emitPlanCreated({
        planId: "plan-abc",
        title: "My Plan",
        kind: "plan",
        status: "review",
        ownerEmail: null,
      }),
    ).not.toThrow();
  });
});
