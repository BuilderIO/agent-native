import { beforeEach, describe, expect, it, vi } from "vitest";

const mockTrack = vi.hoisted(() => vi.fn());
const requestUser = vi.hoisted(() => ({
  email: undefined as string | undefined,
}));

vi.mock("@agent-native/core/tracking", () => ({
  track: (...args: unknown[]) => mockTrack(...args),
}));

vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestUserEmail: () => requestUser.email,
}));

import { trackSlides } from "./slides-tracking";

describe("trackSlides", () => {
  beforeEach(() => {
    mockTrack.mockClear();
    requestUser.email = undefined;
  });

  it("attributes route calls without a ctx to the request's user", () => {
    requestUser.email = "owner@example.com";

    trackSlides("deck_exported", { output_id: "deck-1" });

    expect(mockTrack).toHaveBeenCalledWith(
      "deck_exported",
      { output_id: "deck-1", app_name: "slides", template_name: "slides" },
      { userId: "owner@example.com" },
    );
  });

  it("keeps an explicit source and adds its join keys", () => {
    requestUser.email = "someone-else@example.com";
    const ctx = {
      caller: "tool",
      runId: "run-1",
      turnId: "turn-1",
      threadId: "thread-1",
    } as never;

    trackSlides("deck_edited", { output_id: "deck-1" }, ctx);

    expect(mockTrack).toHaveBeenCalledWith(
      "deck_edited",
      {
        run_id: "run-1",
        turn_id: "turn-1",
        thread_id: "thread-1",
        caller: "tool",
        output_id: "deck-1",
        app_name: "slides",
        template_name: "slides",
      },
      ctx,
    );
  });

  it("stays anonymous only when there is no request user either", () => {
    trackSlides("deck_exported", { output_id: "deck-1" });

    expect(mockTrack.mock.calls[0]?.[2]).toBeUndefined();
  });
});
