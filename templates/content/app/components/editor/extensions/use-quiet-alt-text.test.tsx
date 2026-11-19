// @vitest-environment happy-dom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({
  start: vi.fn(),
  open: vi.fn(),
}));

vi.mock("@agent-native/core/client/agent-chat", () => ({
  startBackgroundAgentSession: session.start,
  requestAgentChatThreadOpen: session.open,
  isAgentChatAiSetupRequiredError: (error: unknown) =>
    (error as { code?: string } | null)?.code === "AI_SETUP_REQUIRED",
}));

import { QUIET_ALT_TEXT_SCOPE_TYPE } from "@shared/quiet-agent-runs";

import {
  useQuietAltText,
  type QuietAltTextRequest,
} from "./use-quiet-alt-text";

type Hook = ReturnType<typeof useQuietAltText>;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function fakeHandle(statuses: string[] = ["completed"]) {
  const accepted = deferred<unknown>();
  const completion = deferred<void>();
  const handle = {
    operationId: "op-1",
    threadId: "thread-1",
    turnId: "turn-1",
    accepted: accepted.promise,
    completion: completion.promise,
    status: vi.fn(async () => ({
      operationId: "op-1",
      threadId: "thread-1",
      turnId: "turn-1",
      status: (statuses.length > 1 ? statuses.shift() : statuses[0]) ?? "",
    })),
    cancel: vi.fn(async () => {}),
    open: vi.fn(),
  };
  void accepted.promise.catch(() => {});
  void completion.promise.catch(() => {});
  return { handle, accepted, completion };
}

const request: QuietAltTextRequest = {
  documentId: "doc-1",
  message: "Generate alt text for this image.",
  instructions: "Call set-image-alt-text.",
  imageDataUrl: "data:image/png;base64,AAAA",
  altAtStart: "",
};

describe("quiet alt text runs", () => {
  let container: HTMLDivElement;
  let root: Root;
  let hook: Hook;

  function Probe({ alt }: { alt: string }) {
    hook = useQuietAltText({ currentAlt: alt });
    return null;
  }

  function render(alt: string) {
    act(() => root.render(createElement(Probe, { alt })));
  }

  async function flush() {
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.useFakeTimers();
    session.start.mockReset();
    session.open.mockReset();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    document.body.replaceChildren();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("runs as a scoped background session and reports the alt text that lands", async () => {
    const { handle, accepted, completion } = fakeHandle();
    session.start.mockReturnValue(handle);
    render("");

    let run!: Promise<void>;
    act(() => {
      run = hook.start(request);
    });
    expect(session.start).toHaveBeenCalledWith({
      message: request.message,
      instructions: request.instructions,
      scope: { type: QUIET_ALT_TEXT_SCOPE_TYPE, id: "doc-1" },
      attachments: [
        {
          type: "image",
          name: "image.png",
          contentType: "image/png",
          data: request.imageDataUrl,
        },
      ],
      usageLabel: "content:image-alt-text",
    });
    expect(hook.state).toEqual({ phase: "running", threadId: "thread-1" });
    expect(session.open).not.toHaveBeenCalled();

    accepted.resolve(handle);
    completion.resolve();
    await flush();
    render("A bar chart of monthly signups");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
      await run;
    });
    expect(hook.state).toEqual({ phase: "done", threadId: "thread-1" });

    act(() => hook.openChat());
    expect(session.open).toHaveBeenCalledWith({ threadId: "thread-1" });
  });

  it("says AI isn't set up, and opens the agent panel for its setup", async () => {
    const { handle, accepted } = fakeHandle();
    session.start.mockReturnValue(handle);
    render("");
    const panelOpened = vi.fn();
    window.addEventListener("agent-panel:open", panelOpened);

    let run!: Promise<void>;
    act(() => {
      run = hook.start(request);
    });
    accepted.reject({ code: "AI_SETUP_REQUIRED" });
    await act(async () => {
      await run;
    });
    expect(hook.state).toEqual({
      phase: "failed",
      reason: "setup",
      threadId: null,
    });

    act(() => hook.openChat());
    expect(session.open).not.toHaveBeenCalled();
    expect(panelOpened).toHaveBeenCalledTimes(1);
    window.removeEventListener("agent-panel:open", panelOpened);
  });

  it("reports a run that errored, with its chat to open", async () => {
    const { handle, accepted, completion } = fakeHandle(["errored"]);
    session.start.mockReturnValue(handle);
    render("");

    let run!: Promise<void>;
    act(() => {
      run = hook.start(request);
    });
    accepted.resolve(handle);
    completion.reject(new Error("stream closed"));
    await act(async () => {
      await run;
    });
    expect(hook.state).toEqual({
      phase: "failed",
      reason: "error",
      threadId: "thread-1",
    });
  });

  it("calls a finished run that wrote nothing a failure", async () => {
    const { handle, accepted, completion } = fakeHandle();
    session.start.mockReturnValue(handle);
    render("");

    let run!: Promise<void>;
    act(() => {
      run = hook.start(request);
    });
    accepted.resolve(handle);
    completion.resolve();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6_000);
      await run;
    });
    expect(hook.state).toMatchObject({ phase: "failed", reason: "error" });
  });

  it("stops the run and keeps alt text the person types meanwhile", async () => {
    const { handle, accepted } = fakeHandle(["running"]);
    session.start.mockReturnValue(handle);
    render("");

    act(() => {
      void hook.start(request);
    });
    accepted.resolve(handle);
    await flush();

    render("My own words");
    act(() => hook.keepTypedAlt());
    expect(handle.cancel).toHaveBeenCalledWith("user-typed-alt-text");
    expect(hook.state).toEqual({ phase: "kept" });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(hook.state).toEqual({ phase: "kept" });
  });
});
