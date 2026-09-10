import { describe, expect, expectTypeOf, it, vi } from "vitest";

import {
  defineClientAction,
  type AgentNativeClientActionDefinition,
} from "./client-action.js";
import type {
  AgentNativeClientAction,
  AgentNativeClientActionRuntime,
} from "./host-bridge.js";

interface PublishArgs {
  contentId: string;
  notify?: boolean;
}

interface PublishResult {
  publishedId: string;
  notified: boolean;
  route?: string;
}

function runtime(): AgentNativeClientActionRuntime {
  return {
    requestId: "action-1",
    origin: "https://agent.example",
    context: { route: { name: "content-entry" } },
    session: {
      id: "tab-1",
      connectedAt: "2026-05-15T00:00:00.000Z",
    },
    event: {} as MessageEvent,
    refresh: vi.fn(async () => ({ refreshed: true })),
    command: vi.fn(async () => ({ ok: true })),
  };
}

function createPublishAction() {
  const schema = {
    type: "object",
    properties: { contentId: { type: "string" } },
    required: ["contentId"],
  };

  return {
    schema,
    action: defineClientAction<PublishArgs, PublishResult>({
      name: "publish-content",
      title: "Publish content",
      description: "Publish the selected content entry",
      schema,
      parameters: schema,
      availability: "current-page",
      destructive: false,
      customMetadata: { resource: "content" },
      run: (args, actionRuntime) => ({
        publishedId: args.contentId,
        notified: args.notify ?? false,
        route: actionRuntime.context.route?.name,
      }),
    }),
  };
}

describe("defineClientAction", () => {
  it("returns the existing AgentNativeClientAction shape with typed args and result", () => {
    const { action } = createPublishAction();
    const inferredAction = defineClientAction({
      name: "archive-content",
      description: "Archive content",
      run: async (args: PublishArgs): Promise<PublishResult> => ({
        publishedId: args.contentId,
        notified: args.notify ?? false,
      }),
    });

    expectTypeOf(action).toEqualTypeOf<
      AgentNativeClientAction<PublishArgs, PublishResult>
    >();
    expectTypeOf(inferredAction).toEqualTypeOf<
      AgentNativeClientAction<PublishArgs, PublishResult>
    >();
    expectTypeOf(action).toMatchTypeOf<
      AgentNativeClientActionDefinition<PublishArgs, PublishResult>
    >();
    expectTypeOf<
      Parameters<typeof action.run>[0]
    >().toEqualTypeOf<PublishArgs>();
    expectTypeOf<
      Parameters<typeof action.run>[1]
    >().toEqualTypeOf<AgentNativeClientActionRuntime>();
    expectTypeOf<
      Awaited<ReturnType<typeof action.run>>
    >().toEqualTypeOf<PublishResult>();
  });

  it("preserves action metadata at runtime", () => {
    const { action, schema } = createPublishAction();

    expect(action).toMatchObject({
      name: "publish-content",
      title: "Publish content",
      description: "Publish the selected content entry",
      availability: "current-page",
      destructive: false,
      customMetadata: { resource: "content" },
    });
    expect(action.schema).toBe(schema);
    expect(action.parameters).toBe(schema);
    expect(action.run).toEqual(expect.any(Function));
  });

  it("runs the provided client action implementation", async () => {
    const { action } = createPublishAction();
    const result = await action.run(
      { contentId: "content-123", notify: true },
      runtime(),
    );

    expect(result).toEqual({
      publishedId: "content-123",
      notified: true,
      route: "content-entry",
    });
  });
});
