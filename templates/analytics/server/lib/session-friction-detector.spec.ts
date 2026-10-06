import { describe, expect, it } from "vitest";

import {
  SESSION_REPLAY_CONSOLE_EVENT_TAG,
  SESSION_REPLAY_NETWORK_EVENT_TAG,
} from "../../shared/session-replay-diagnostics.js";
import { STALLED_REQUEST_THRESHOLD_MS } from "../../shared/stalled-requests.js";
import {
  detectReplayFriction,
  emptyReplayFrictionDetectorState,
  parseReplayFrictionDetectorState,
} from "./session-friction-detector";

const click = (timestamp: number, id = 7) => ({
  type: 3,
  timestamp,
  data: { source: 2, type: 2, id },
});
const focus = (timestamp: number, id = 7) => ({
  type: 3,
  timestamp,
  data: { source: 2, type: 5, id },
});
const mutation = (timestamp: number, data: Record<string, unknown> = {}) => ({
  type: 3,
  timestamp,
  data: {
    source: 0,
    adds: [],
    removes: [],
    texts: [],
    attributes: [],
    ...data,
  },
});
const mouseMove = (timestamp: number) => ({
  type: 3,
  timestamp,
  data: { source: 1, positions: [] },
});
const network = (timestamp: number, payload: Record<string, unknown>) => ({
  type: 5,
  timestamp,
  data: {
    tag: SESSION_REPLAY_NETWORK_EVENT_TAG,
    payload: { api: "fetch", method: "POST", ok: false, ...payload },
  },
});
const consoleError = (timestamp: number) => ({
  type: 5,
  timestamp,
  data: {
    tag: SESSION_REPLAY_CONSOLE_EVENT_TAG,
    payload: { level: "error", message: "boom" },
  },
});
const toastAdd = (timestamp: number, id: number, type: string) =>
  mutation(timestamp, {
    adds: [
      {
        parentId: 1,
        node: {
          type: 2,
          id,
          tagName: "li",
          attributes: { "data-sonner-toast": "", "data-type": type },
        },
      },
    ],
  });

describe("detectReplayFriction", () => {
  it("counts a click nothing answered within the window as dead", () => {
    const { delta } = detectReplayFriction(
      [click(1_000), mouseMove(1_500), mouseMove(2_100)],
      null,
    );
    expect(delta.deadClicks).toBe(1);
  });

  it("does not count a click the page answered", () => {
    const { delta, state } = detectReplayFriction(
      [click(1_000), mutation(1_400), mouseMove(3_000)],
      null,
    );
    expect(delta.deadClicks).toBe(0);
    expect(state.pendingClickAt).toBeNull();
  });

  it("treats a focus on the clicked node as the click's answer", () => {
    const { delta } = detectReplayFriction(
      [focus(990), click(1_000), mouseMove(3_000)],
      null,
    );
    expect(delta.deadClicks).toBe(0);
  });

  it("resolves a click from one batch with the next batch's events", () => {
    const first = detectReplayFriction([click(1_000)], null);
    expect(first.delta.deadClicks).toBe(0);
    expect(first.state.pendingClickAt).toBe(1_000);

    const answered = detectReplayFriction([mutation(1_200)], first.state);
    expect(answered.delta.deadClicks).toBe(0);

    const dead = detectReplayFriction([mouseMove(2_500)], first.state);
    expect(dead.delta.deadClicks).toBe(1);
  });

  it("counts Sonner error toasts, including a toast turned into an error", () => {
    const { delta } = detectReplayFriction(
      [
        toastAdd(1_000, 40, "error"),
        toastAdd(1_100, 41, "success"),
        toastAdd(1_200, 42, "loading"),
        mutation(1_300, {
          attributes: [{ id: 42, attributes: { "data-type": "error" } }],
        }),
        // Not a toast, so its data-type means nothing.
        mutation(1_400, {
          attributes: [{ id: 99, attributes: { "data-type": "error" } }],
        }),
      ],
      null,
    );
    expect(delta.errorToasts).toBe(2);
  });

  it("counts stalled requests and 4xx and 5xx responses separately", () => {
    const { delta } = detectReplayFriction(
      [
        network(1_000, {
          url: "/a",
          status: 200,
          ok: true,
          durationMs: STALLED_REQUEST_THRESHOLD_MS,
        }),
        network(2_000, {
          url: "/b",
          status: 200,
          ok: true,
          durationMs: STALLED_REQUEST_THRESHOLD_MS - 1,
        }),
        network(3_000, { url: "/c", status: 404 }),
        network(4_000, { url: "/d", status: 422 }),
        network(5_000, { url: "/e", status: 503 }),
      ],
      null,
    );
    expect(delta).toMatchObject({ stalledRequests: 1, http4xx: 2, http5xx: 1 });
  });

  it("counts one retry loop for repeated failures to one endpoint", () => {
    const { delta } = detectReplayFriction(
      [
        network(1_000, { url: "/api/save?try=1", status: 500 }),
        network(2_000, { url: "/api/save?try=2", status: 500 }),
        network(3_000, { url: "/api/save?try=3", status: 0 }),
        network(4_000, { url: "/api/save?try=4", status: 500 }),
      ],
      null,
    );
    expect(delta.retryLoops).toBe(1);
  });

  it("ignores requests the page aborted, and still counts network failures", () => {
    const aborted = detectReplayFriction(
      [
        network(1_000, {
          url: "/api/models",
          status: 0,
          error: "signal is aborted without reason",
        }),
        network(2_000, {
          url: "/api/models",
          status: 0,
          error: "The user aborted a request.",
        }),
        network(3_000, {
          api: "xhr",
          url: "/api/models",
          status: 0,
          error: "XMLHttpRequest aborted",
        }),
      ],
      null,
    );
    expect(aborted.delta.retryLoops).toBe(0);
    expect(aborted.errorThenLeave).toBe(false);

    const failed = detectReplayFriction(
      [
        network(1_000, {
          url: "/api/models",
          status: 0,
          error: "Failed to fetch",
        }),
        network(2_000, {
          url: "/api/models",
          status: 0,
          error: "Failed to fetch",
        }),
        network(3_000, {
          api: "xhr",
          url: "/api/models",
          status: 0,
          error: "XMLHttpRequest failed",
        }),
      ],
      null,
    );
    expect(failed.delta.retryLoops).toBe(1);
    expect(failed.errorThenLeave).toBe(true);
  });

  it("does not call a request cancelled by leaving the page an error", () => {
    const { delta, errorThenLeave } = detectReplayFriction(
      [
        network(1_000, {
          url: "/api/poll",
          status: 0,
          durationMs: 4_000,
          error: "Failed to fetch",
          pageLeaving: true,
        }),
      ],
      null,
    );
    expect(errorThenLeave).toBe(false);
    expect(delta.stalledRequests).toBe(1);
  });

  it("does not call failures a retry loop once a success breaks them up", () => {
    const { delta } = detectReplayFriction(
      [
        network(1_000, { url: "/api/save", status: 500 }),
        network(2_000, { url: "/api/save", status: 500 }),
        network(3_000, { url: "/api/save", status: 200, ok: true }),
        network(4_000, { url: "/api/save", status: 500 }),
        network(5_000, { url: "/api/other", status: 500 }),
      ],
      null,
    );
    expect(delta.retryLoops).toBe(0);
  });

  it("counts errors Monitoring could make an issue of, never a plain console error", () => {
    const consoleEvent = (payload: Record<string, unknown>) => ({
      type: 5,
      timestamp: 1_000,
      data: {
        tag: SESSION_REPLAY_CONSOLE_EVENT_TAG,
        payload: { level: "error", message: "boom", ...payload },
      },
    });
    const { delta } = detectReplayFriction(
      [
        consoleEvent({ source: "console", exception: false }),
        consoleEvent({ source: "console", exception: false, repeat: 4 }),
        consoleEvent({ source: "console", exception: true }),
        // An older recorder does not say, so it may have been an exception.
        consoleEvent({ source: "console" }),
        consoleEvent({ source: "window-error" }),
        consoleEvent({ source: "unhandledrejection", repeat: 2 }),
        consoleEvent({ source: "window-error", level: "warn" }),
      ],
      null,
    );
    expect(delta.issueErrors).toBe(5);
  });

  it("flags leaving soon after an error, and not once the person carried on", () => {
    expect(
      detectReplayFriction([mouseMove(1_000), consoleError(2_000)], null)
        .errorThenLeave,
    ).toBe(true);

    const first = detectReplayFriction([consoleError(1_000)], null);
    expect(
      detectReplayFriction([mouseMove(60_000)], first.state).errorThenLeave,
    ).toBe(false);
  });

  it("keeps request URLs and page text out of its stored state", () => {
    const { state } = detectReplayFriction(
      [
        network(1_000, {
          url: "https://example.test/api/users/someone@example.com",
          status: 500,
        }),
        toastAdd(1_100, 40, "error"),
      ],
      null,
    );
    const stored = JSON.stringify(state);
    expect(stored).not.toContain("example");
    expect(stored).not.toContain("/api/");
  });
});

describe("parseReplayFrictionDetectorState", () => {
  it("round-trips the state it stores", () => {
    const { state } = detectReplayFriction(
      [click(1_000), network(1_100, { url: "/a", status: 500 })],
      null,
    );
    expect(parseReplayFrictionDetectorState(JSON.stringify(state))).toEqual(
      state,
    );
  });

  it("returns null for state it cannot continue from", () => {
    expect(parseReplayFrictionDetectorState("{")).toBeNull();
    expect(parseReplayFrictionDetectorState("{}")).toBeNull();
    expect(
      parseReplayFrictionDetectorState(
        JSON.stringify({ ...emptyReplayFrictionDetectorState(), v: 2 }),
      ),
    ).toBeNull();
    expect(
      parseReplayFrictionDetectorState(
        JSON.stringify({
          ...emptyReplayFrictionDetectorState(),
          failures: { key: { n: "3", at: 1, counted: false } },
        }),
      ),
    ).toBeNull();
  });
});
