import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createAgentChatPlugin: vi.fn((options: unknown) => options),
  resolveAccess: vi.fn(),
  checkpoint: vi.fn(),
}));

vi.mock("@agent-native/core/server", () => ({
  createAgentChatPlugin: mocks.createAgentChatPlugin,
  loadActionsFromStaticRegistry: () => ({}),
}));
vi.mock("@agent-native/core/sharing", () => ({
  resolveAccess: mocks.resolveAccess,
}));
vi.mock("../../.generated/actions-registry.js", () => ({ default: {} }));
vi.mock("../register-secrets.js", () => ({}));
vi.mock("../lib/design-versions.js", () => ({
  createDesignChatBeginningSnapshot: mocks.checkpoint,
}));
vi.mock("../lib/reprompt-action-guard.js", () => ({
  guardRepromptActionRegistry: (actions: unknown) => actions,
}));
vi.mock("../lib/review-agent-surface.js", () => ({
  finalizeReviewAgentRun: vi.fn(),
  resolveReviewAgentActionSurface: vi.fn(),
}));
vi.mock("../lib/design-response-guard.js", () => ({
  designFinalResponseGuard: vi.fn(),
}));
vi.mock("../lib/realtime-voice.js", () => ({ DESIGN_REALTIME_VOICE: {} }));

import plugin from "./agent-chat.js";

const options = plugin as unknown as {
  requireAgentTurnStart?: boolean;
  onAgentTurnStart: (
    scope: { type: string; id: string },
    run: { threadId?: string; runId?: string },
  ) => Promise<void>;
};
const scope = { type: "design", id: "design-1" };
const run = { threadId: "thread-1", runId: "run-1" };

beforeEach(() => {
  mocks.resolveAccess.mockReset();
  mocks.checkpoint.mockReset();
});

describe("Design pre-turn checkpoint", () => {
  it("requires successful editor checkpoints and propagates real failures", async () => {
    const error = new Error("checkpoint unavailable");
    mocks.resolveAccess.mockResolvedValue({ role: "editor" });
    mocks.checkpoint.mockRejectedValue(error);

    expect(options.requireAgentTurnStart).toBe(true);
    await expect(options.onAgentTurnStart(scope, run)).rejects.toBe(error);
    expect(mocks.checkpoint).toHaveBeenCalledWith("design-1", run);
  });

  it.each(["viewer", "commenter", null])(
    "does not checkpoint read-only or inaccessible scope %s",
    async (role) => {
      mocks.resolveAccess.mockResolvedValue(role ? { role } : null);
      await expect(
        options.onAgentTurnStart(scope, run),
      ).resolves.toBeUndefined();
      expect(mocks.checkpoint).not.toHaveBeenCalled();
    },
  );

  it("skips non-design and incomplete runs without access checks", async () => {
    await options.onAgentTurnStart({ type: "other", id: "x" }, run);
    await options.onAgentTurnStart(scope, { threadId: "thread-1" });
    expect(mocks.resolveAccess).not.toHaveBeenCalled();
  });

  it("does not disguise an access lookup failure as a read-only no-op", async () => {
    const error = new Error("access lookup unavailable");
    mocks.resolveAccess.mockRejectedValue(error);
    await expect(options.onAgentTurnStart(scope, run)).rejects.toBe(error);
    expect(mocks.checkpoint).not.toHaveBeenCalled();
  });
});
