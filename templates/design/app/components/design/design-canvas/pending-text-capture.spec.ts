// @vitest-environment jsdom
import { readFileSync } from "node:fs";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  acknowledgePendingTextInsert,
  armPendingTextCapture,
  beginPendingTextDelivery,
  beginTextEditForOwner,
  failPendingTextCapture,
  HOST_COMMIT_RETRY_DELAYS_MS,
  isPendingTextCaptureBound,
  isPendingTextRequestLive,
  isPendingTextWriteInFlight,
  onPendingTextCaptureCancel,
  peekPendingTextCapture,
  registerPendingTextHostCommit,
  registerTextEditOwner,
  releasePendingTextCapture,
  returnPendingTextCapture,
  takePendingTextCapture,
} from "./pending-text-capture";
import type { BeginTextEditFn } from "./pending-text-capture";
import {
  PENDING_TEXT_EDIT_TIMEOUT_MS,
  PENDING_TEXT_INTERCEPT_CAP_MS,
} from "./pending-text-edit";

const unregisterAll: Array<() => void> = [];

function register(identity: string, fn: BeginTextEditFn) {
  const unregister = registerTextEditOwner(identity, fn);
  unregisterAll.push(unregister);
  return unregister;
}

function type(text: string) {
  for (const char of text) {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: char }));
  }
}

afterEach(() => {
  while (unregisterAll.length > 0) unregisterAll.pop()!();
  armPendingTextCapture({ owner: "reset" }).cancel();
  vi.useRealTimers();
});

describe("pending text capture", () => {
  it("buffers the gesture's keystrokes and hands them to the owner that mounts later", () => {
    const capture = armPendingTextCapture({ owner: "board" });
    capture.bind("text-1");
    beginTextEditForOwner("board", "text-1", { afterPointerGesture: true });
    type("Bee");

    const begun = vi.fn(() => true);
    register("board", begun);

    expect(begun).toHaveBeenCalledExactlyOnceWith("text-1", {
      afterPointerGesture: true,
    });
    expect(takePendingTextCapture("board", "text-1")).toBe("Bee");
  });

  it("routes synchronously to an already-mounted owner and never to a foreign one", () => {
    const board = vi.fn(() => true);
    const screen = vi.fn(() => true);
    register("board", board);
    register("screen", screen);

    const capture = armPendingTextCapture({ owner: "screen" });
    capture.bind("text-2");
    beginTextEditForOwner("screen", "text-2");

    expect(screen).toHaveBeenCalledExactlyOnceWith("text-2", undefined);
    expect(board).not.toHaveBeenCalled();
    expect(takePendingTextCapture("board", "text-2")).toBeNull();
  });

  it("supersedes creation A with B, and cancelling A cannot cancel B", () => {
    const a = armPendingTextCapture({ owner: "board" });
    a.bind("text-a");
    beginTextEditForOwner("board", "text-a", { afterPointerGesture: true });
    type("A");

    const b = armPendingTextCapture({ owner: "board" });
    b.bind("text-b");
    beginTextEditForOwner("board", "text-b", { afterPointerGesture: true });
    type("Bee");

    // A's late exhaustion cleanup must not disarm the live creation B.
    a.cancel();
    expect(isPendingTextCaptureBound("board", "text-b")).toBe(true);

    const begun = vi.fn(() => true);
    register("board", begun);
    expect(begun).toHaveBeenCalledExactlyOnceWith("text-b", {
      afterPointerGesture: true,
    });
    expect(takePendingTextCapture("board", "text-a")).toBeNull();
    expect(takePendingTextCapture("board", "text-b")).toBe("Bee");
  });

  it("stands down on undo before the owner mounts: no begin, nothing captured", () => {
    const capture = armPendingTextCapture({ owner: "board" });
    capture.bind("text-3");
    beginTextEditForOwner("board", "text-3", { afterPointerGesture: true });

    const undo = new KeyboardEvent("keydown", {
      key: "z",
      metaKey: true,
      cancelable: true,
    });
    window.dispatchEvent(undo);
    // The chord itself must still reach the host's undo handler.
    expect(undo.defaultPrevented).toBe(false);

    const shortcut = new KeyboardEvent("keydown", {
      key: "r",
      cancelable: true,
    });
    window.dispatchEvent(shortcut);
    expect(shortcut.defaultPrevented).toBe(false);

    const begun = vi.fn(() => true);
    register("board", begun);
    expect(begun).not.toHaveBeenCalled();
    expect(takePendingTextCapture("board", "text-3")).toBeNull();
    expect(isPendingTextCaptureBound("board", "text-3")).toBe(false);
  });

  it("stands down when the user clicks elsewhere in the host", () => {
    const capture = armPendingTextCapture({ owner: "board" });
    capture.bind("text-4");
    type("Lost");
    window.dispatchEvent(new PointerEvent("pointerdown"));

    expect(takePendingTextCapture("board", "text-4")).toBeNull();
  });

  it("stands the WHOLE request down on pointer-away, and only that request's", () => {
    const cancelA = vi.fn();
    const a = armPendingTextCapture({ owner: "board" });
    a.bind("text-a");
    // The owning canvas's delayed activation and the editor's retry ladder
    // both hang off the creation that started them.
    onPendingTextCaptureCancel("board", "text-a", cancelA);
    onPendingTextCaptureCancel("board", "other-node", () => {
      throw new Error("a foreign identity must never be torn down");
    });

    window.dispatchEvent(new PointerEvent("pointerdown"));
    expect(cancelA).toHaveBeenCalledOnce();

    const cancelB = vi.fn();
    const b = armPendingTextCapture({ owner: "board" });
    b.bind("text-b");
    onPendingTextCaptureCancel("board", "text-b", cancelB);
    expect(cancelA).toHaveBeenCalledOnce();
    expect(cancelB).not.toHaveBeenCalled();
  });

  it("keeps the request cancellable after the owning canvas takes the buffer", () => {
    const cancel = vi.fn();
    const capture = armPendingTextCapture({ owner: "screen" });
    capture.bind("text-6");
    type("Hi");
    expect(takePendingTextCapture("screen", "text-6")).toBe("Hi");
    onPendingTextCaptureCancel("screen", "text-6", cancel);
    // The canvas captures from here, so the host buffer is no longer the one
    // holding keys for an unstarted session...
    expect(isPendingTextCaptureBound("screen", "text-6")).toBe(false);

    // ...but the request it started is still the thing pointer-away cancels.
    window.dispatchEvent(new PointerEvent("pointerdown"));
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("holds keystrokes past 3s while the ladder retries, and stops intercepting at the cap, not the ladder deadline", () => {
    vi.useFakeTimers();
    const capture = armPendingTextCapture({ owner: "board" });
    capture.bind("text-7");

    // A board canvas can take seconds to mount; the old 3s stand-down dropped
    // exactly the keys typed while it was mounting.
    vi.advanceTimersByTime(3_500);
    type("Late");
    expect(isPendingTextCaptureBound("board", "text-7")).toBe(true);
    expect(takePendingTextCapture("board", "text-7")).toBe("Late");

    const expired = armPendingTextCapture({ owner: "board" });
    expired.bind("text-8");
    // The ladder's deadline is not the cap: a board still mounting keeps its
    // interception.
    vi.advanceTimersByTime(PENDING_TEXT_EDIT_TIMEOUT_MS + 1);
    expect(isPendingTextCaptureBound("board", "text-8")).toBe(true);
    vi.advanceTimersByTime(PENDING_TEXT_INTERCEPT_CAP_MS);
    expect(isPendingTextCaptureBound("board", "text-8")).toBe(false);
    expect(takePendingTextCapture("board", "text-8")).toBeNull();
  });

  it("does not let the clock discard text a node is still owed", () => {
    vi.useFakeTimers();
    const teardown = vi.fn();
    const capture = armPendingTextCapture({ owner: "board" });
    capture.bind("text-15");
    onPendingTextCaptureCancel("board", "text-15", teardown);
    type("Sta");
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", cancelable: true }),
    );

    // Escape promised the text to the node and the frame has not acknowledged
    // the commit; this record holds the only copy, so the deadline firing here
    // would delete exactly what the user typed.
    vi.advanceTimersByTime(PENDING_TEXT_EDIT_TIMEOUT_MS + 1);
    expect(peekPendingTextCapture("board", "text-15")).toBe("Sta");
    expect(isPendingTextRequestLive("board", "text-15")).toBe(true);
    expect(teardown).not.toHaveBeenCalled();

    // Abandonment still stands the delivery down — only the clock is disarmed.
    window.dispatchEvent(new PointerEvent("pointerdown"));
    expect(isPendingTextRequestLive("board", "text-15")).toBe(false);
    expect(teardown).toHaveBeenCalledOnce();
  });

  it("delivers text typed before the cap to an owner that registers after it, and intercepts nothing after the cap", () => {
    vi.useFakeTimers();
    const capture = armPendingTextCapture({ owner: "board" });
    capture.bind("text-owed");
    beginTextEditForOwner("board", "text-owed", { afterPointerGesture: true });
    type("Standalone");

    // The board is still mounting when the cap passes. Interception ends; the
    // obligation to deliver what was typed does not.
    vi.advanceTimersByTime(PENDING_TEXT_INTERCEPT_CAP_MS + 1);
    const late = new KeyboardEvent("keydown", { key: "x", cancelable: true });
    window.dispatchEvent(late);
    expect(late.defaultPrevented).toBe(false);
    expect(peekPendingTextCapture("board", "text-owed")).toBe("Standalone");

    // The owner finally mounts: the session opens holding the text, and stays
    // open for more typing.
    const begun = vi.fn(() => true);
    register("board", begun);
    expect(begun).toHaveBeenCalledExactlyOnceWith("text-owed", {
      deliverOwed: true,
    });

    // The begin command already carried the text, so this session is sent no
    // second copy — and the request ends only when the frame says it landed.
    expect(beginPendingTextDelivery("board", "text-owed", "")).toEqual({
      text: "",
      alreadyPosted: true,
    });
    expect(isPendingTextRequestLive("board", "text-owed")).toBe(true);
    acknowledgePendingTextInsert("board", "text-owed", true);
    expect(isPendingTextRequestLive("board", "text-owed")).toBe(false);
  });

  it("stops intercepting when the owner unmounts with no replacement, and owes the typed text to the next owner", async () => {
    const capture = armPendingTextCapture({ owner: "screen-a" });
    capture.bind("text-gone");
    const unregister = register(
      "screen-a",
      vi.fn(() => true),
    );
    type("Standalone");

    // The canvas that owned the creation is gone (the user switched screens)
    // and nothing replaced it in that commit. Holding keys for it swallowed
    // everything typed until the cap.
    unregister();
    await Promise.resolve();
    const next = new KeyboardEvent("keydown", { key: "r", cancelable: true });
    window.dispatchEvent(next);
    expect(next.defaultPrevented).toBe(false);
    expect(peekPendingTextCapture("screen-a", "text-gone")).toBe("Standalone");

    const begun = vi.fn(() => true);
    register("screen-a", begun);
    expect(begun).toHaveBeenCalledExactlyOnceWith("text-gone", {
      deliverOwed: true,
    });
  });

  it("revokes the frame's copy before it commits owed text host-side", async () => {
    vi.useFakeTimers();
    const order: string[] = [];
    unregisterAll.push(
      registerPendingTextHostCommit(() => {
        order.push("host-commit");
        return true;
      }),
    );
    const capture = armPendingTextCapture({ owner: "board" });
    capture.bind("text-race");
    type("Standalone");
    // The frame is handed the delivery and has NOT acknowledged it.
    register(
      "board",
      vi.fn(() => true),
    );
    onPendingTextCaptureCancel("board", "text-race", () =>
      order.push("revoke-frame-copy"),
    );

    vi.advanceTimersByTime(PENDING_TEXT_INTERCEPT_CAP_MS + 1);
    vi.advanceTimersByTime(PENDING_TEXT_INTERCEPT_CAP_MS);

    // The revoke has to reach the frame BEFORE the source is written, or the
    // frame inserts the same characters afterwards and the node ends up with
    // two copies.
    expect(order).toEqual(["revoke-frame-copy", "host-commit"]);
  });

  it("commits owed text host-side when no owner ever becomes ready", () => {
    vi.useFakeTimers();
    const commit = vi.fn(() => true);
    unregisterAll.push(registerPendingTextHostCommit(commit));
    const teardown = vi.fn();
    const capture = armPendingTextCapture({ owner: "board" });
    capture.bind("text-orphan");
    onPendingTextCaptureCancel("board", "text-orphan", teardown);
    type("Standalone");

    vi.advanceTimersByTime(PENDING_TEXT_INTERCEPT_CAP_MS + 1);
    expect(commit).not.toHaveBeenCalled();
    // A full save-and-mount window after interception ended, still no owner.
    vi.advanceTimersByTime(PENDING_TEXT_INTERCEPT_CAP_MS);
    expect(commit).toHaveBeenCalledExactlyOnceWith(
      "board",
      "text-orphan",
      "Standalone",
    );
    expect(isPendingTextRequestLive("board", "text-orphan")).toBe(false);
    // What the creation started for an owner that never came goes with it.
    expect(teardown).toHaveBeenCalledOnce();
  });

  it("retries a refused host commit and lands exactly one copy", () => {
    vi.useFakeTimers();
    const commit = vi
      .fn<(owner: string, nodeId: string, text: string) => boolean>()
      .mockImplementationOnce(() => false)
      .mockImplementationOnce(() => true);
    unregisterAll.push(registerPendingTextHostCommit(commit));
    const capture = armPendingTextCapture({ owner: "board" });
    capture.bind("text-retry");
    type("Standalone");

    vi.advanceTimersByTime(PENDING_TEXT_INTERCEPT_CAP_MS + 1);
    vi.advanceTimersByTime(PENDING_TEXT_INTERCEPT_CAP_MS);
    expect(commit).toHaveBeenCalledTimes(1);

    // The refusal left the text owed rather than discarded, so the next attempt
    // carries the same characters — and only one of them lands.
    vi.advanceTimersByTime(HOST_COMMIT_RETRY_DELAYS_MS[0]);
    expect(commit.mock.calls).toEqual([
      ["board", "text-retry", "Standalone"],
      ["board", "text-retry", "Standalone"],
    ]);
    vi.advanceTimersByTime(60_000);
    expect(commit).toHaveBeenCalledTimes(2);
  });

  it("keeps the node, and never logs the text, when every host commit throws", () => {
    vi.useFakeTimers();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const commit = vi.fn(() => {
      throw new Error("source temporarily unreadable");
    });
    unregisterAll.push(registerPendingTextHostCommit(commit));
    const removeNode = vi.fn();
    const capture = armPendingTextCapture({ owner: "board" });
    capture.bind("text-throw");
    onPendingTextCaptureCancel("board", "text-throw", removeNode, {
      kind: "cleanup",
    });
    type("Standalone");

    vi.advanceTimersByTime(PENDING_TEXT_INTERCEPT_CAP_MS + 1);
    vi.advanceTimersByTime(PENDING_TEXT_INTERCEPT_CAP_MS);
    // A throw is not a discard: the payload is still owed, and still retried.
    expect(commit).toHaveBeenCalledTimes(1);
    for (const delay of HOST_COMMIT_RETRY_DELAYS_MS) {
      vi.advanceTimersByTime(delay);
    }
    expect(commit).toHaveBeenCalledTimes(
      HOST_COMMIT_RETRY_DELAYS_MS.length + 1,
    );

    // The node is the recoverable place, so this path never deletes it — and
    // the report names the layer without ever carrying the characters.
    expect(removeNode).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledOnce();
    const reported = error.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(reported).toMatchObject({ screenId: "board", nodeId: "text-throw" });
    expect(reported).not.toHaveProperty("text");
    error.mockRestore();
  });

  it("unregistering one editor settles only its own queued write", () => {
    vi.useFakeTimers();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    // Two owed writes queued at the same time, each bound to its OWN
    // registration — the only shape in which "settle mine" and "settle
    // everything" differ.
    const writerA = vi.fn(() => false);
    const unregisterA = registerPendingTextHostCommit(writerA);
    const a = armPendingTextCapture({ owner: "board-a" });
    a.bind("text-a");
    type("Alpha");
    failPendingTextCapture("board-a");
    expect(writerA).toHaveBeenCalledTimes(1);

    const writerB = vi.fn(() => false);
    unregisterAll.push(registerPendingTextHostCommit(writerB));
    const b = armPendingTextCapture({ owner: "board-b" });
    b.bind("text-b");
    type("Beta");
    failPendingTextCapture("board-b");
    expect(writerB).toHaveBeenCalledTimes(1);

    // A's editor goes away mid-backoff. B's write is a different editor's and
    // is still owed.
    unregisterA();
    vi.advanceTimersByTime(HOST_COMMIT_RETRY_DELAYS_MS[0]);

    expect(writerB).toHaveBeenCalledTimes(2);
    expect(writerA).toHaveBeenCalledTimes(1);
    // Each writer only ever sees its own editor's screen, node and text —
    // crossing them would write one design's text through another's writer.
    expect(writerA.mock.calls).toEqual([["board-a", "text-a", "Alpha"]]);
    expect(writerB.mock.calls).toEqual([
      ["board-b", "text-b", "Beta"],
      ["board-b", "text-b", "Beta"],
    ]);
    error.mockRestore();
  });

  it("never lets an error CODE carry the text into the log", () => {
    vi.useFakeTimers();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const secret = "Standalone";
    // A code is as free-form as a message: anything that reaches the log can
    // carry the payload, so nothing free-form may reach it.
    const commit = vi.fn(() => {
      const thrown = new Error("write failed");
      (thrown as { code?: string }).code = `E_WRITE_${secret}`;
      throw thrown;
    });
    unregisterAll.push(registerPendingTextHostCommit(commit));
    const capture = armPendingTextCapture({ owner: "board" });
    capture.bind("text-code");
    type(secret);

    vi.advanceTimersByTime(PENDING_TEXT_INTERCEPT_CAP_MS + 1);
    vi.advanceTimersByTime(PENDING_TEXT_INTERCEPT_CAP_MS);
    for (const delay of HOST_COMMIT_RETRY_DELAYS_MS) {
      vi.advanceTimersByTime(delay);
    }

    expect(error).toHaveBeenCalledOnce();
    const logged = error.mock.calls[0]!.map((argument) => {
      try {
        return typeof argument === "string"
          ? argument
          : JSON.stringify(argument, (_key, value) =>
              value instanceof Error
                ? {
                    name: value.name,
                    message: value.message,
                    code: (value as { code?: string }).code,
                  }
                : value,
            );
      } catch {
        return String(argument);
      }
    }).join(" ");
    expect(logged).not.toContain(secret);
    error.mockRestore();
  });

  it("still reports an owed write after the record detaches out of `active`", () => {
    vi.useFakeTimers();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    // Refuses, so the record stays queued and mid-backoff for this whole test.
    const commit = vi.fn(() => false);
    unregisterAll.push(registerPendingTextHostCommit(commit));
    const capture = armPendingTextCapture({ owner: "board" });
    capture.bind("text-detached");
    type("Standalone");

    // The rolled-back save hands the payload to the writer: `active` is empty
    // from here, but the node is still owed its text.
    expect(failPendingTextCapture("board")).toBe("write-queued");
    expect(isPendingTextRequestLive("board", "text-detached")).toBe(false);
    expect(isPendingTextWriteInFlight("board", "text-detached")).toBe(true);

    // Asked AGAIN — exactly what the node-missing path does — the answer has
    // to stay "owed". Reading `active` alone answered "nothing-owed" here, and
    // the creation deleted the node out from under the retrying write. This
    // pins that guard ON ITS OWN, where the cleanup-side guard cannot mask it.
    expect(failPendingTextCapture("board", "text-detached")).toBe(
      "write-queued",
    );
    error.mockRestore();
  });

  it("never lets a thrown error carry the text into the log", () => {
    vi.useFakeTimers();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const secret = "Standalone";
    // A writer that quotes the value it failed on — the ordinary shape of a
    // validation or parse error, and the way the characters we refuse to log
    // come back in through the error object.
    const commit = vi.fn(() => {
      const thrown = new RangeError(`could not write ${secret} to source`);
      (thrown as { payload?: string }).payload = secret;
      throw thrown;
    });
    unregisterAll.push(registerPendingTextHostCommit(commit));
    const capture = armPendingTextCapture({ owner: "board" });
    capture.bind("text-secret");
    type(secret);

    vi.advanceTimersByTime(PENDING_TEXT_INTERCEPT_CAP_MS + 1);
    vi.advanceTimersByTime(PENDING_TEXT_INTERCEPT_CAP_MS);
    for (const delay of HOST_COMMIT_RETRY_DELAYS_MS) {
      vi.advanceTimersByTime(delay);
    }

    expect(error).toHaveBeenCalledOnce();
    // Across EVERY argument, not just the payload object.
    const logged = error.mock.calls[0]!.map((argument) => {
      try {
        return typeof argument === "string"
          ? argument
          : JSON.stringify(argument, (_key, value) =>
              value instanceof Error
                ? { name: value.name, message: value.message }
                : value,
            );
      } catch {
        return String(argument);
      }
    }).join(" ");
    expect(logged).not.toContain(secret);
    expect(error.mock.calls[0]?.[1]).toMatchObject({
      screenId: "board",
      nodeId: "text-secret",
      length: secret.length,
      errorType: "RangeError",
    });
    error.mockRestore();
  });

  it("fails loudly with the screen and node once the retries are exhausted", () => {
    vi.useFakeTimers();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    unregisterAll.push(registerPendingTextHostCommit(() => false));
    const capture = armPendingTextCapture({ owner: "board" });
    capture.bind("text-lost");
    type("Standalone");

    vi.advanceTimersByTime(PENDING_TEXT_INTERCEPT_CAP_MS * 2 + 1);
    // Still retrying: a refused write is not yet a lost one, so nothing is
    // reported while the text is still owed.
    expect(error).not.toHaveBeenCalled();
    for (const delay of HOST_COMMIT_RETRY_DELAYS_MS) {
      vi.advanceTimersByTime(delay);
    }

    expect(error).toHaveBeenCalledOnce();
    expect(error.mock.calls[0]?.[1]).toMatchObject({
      screenId: "board",
      nodeId: "text-lost",
      reason: "commit-failed",
    });
    error.mockRestore();
  });

  it("reports a stood-down request as no longer live, so a late bridge reply arms nothing", () => {
    const capture = armPendingTextCapture({ owner: "board" });
    capture.bind("text-9");
    expect(isPendingTextRequestLive("board", "text-9")).toBe(true);
    // Still live once the owning canvas has the buffer — the request is open
    // until it activates or stands down, not until the handoff.
    expect(takePendingTextCapture("board", "text-9")).toBe("");
    expect(isPendingTextRequestLive("board", "text-9")).toBe(true);

    window.dispatchEvent(new PointerEvent("pointerdown"));
    expect(isPendingTextRequestLive("board", "text-9")).toBe(false);
  });

  it("takes the buffer back when the owning canvas unmounts before activation", () => {
    const capture = armPendingTextCapture({ owner: "board" });
    capture.bind("text-10");
    type("Un");
    expect(takePendingTextCapture("board", "text-10")).toBe("Un");

    // The canvas unmounted holding the only copy of the gesture's keystrokes.
    returnPendingTextCapture("board", "text-10", "Un");
    type("mount");
    const remounted = vi.fn(() => true);
    register("board", remounted);
    expect(takePendingTextCapture("board", "text-10")).toBe("Unmount");
    // A canvas that already lost the request cannot resurrect it.
    returnPendingTextCapture("board", "text-stale", "Ghost");
    expect(takePendingTextCapture("board", "text-stale")).toBeNull();
  });

  it("takes an EMPTY buffer back too, so a remount before the first keystroke loses nothing", () => {
    const capture = armPendingTextCapture({ owner: "board" });
    capture.bind("text-11");
    expect(takePendingTextCapture("board", "text-11")).toBe("");

    // Unmounted before the user typed anything: with the capture still marked
    // handed off, nothing anywhere buffers the keys they type next.
    returnPendingTextCapture("board", "text-11", "");
    expect(isPendingTextCaptureBound("board", "text-11")).toBe(true);
    type("First");
    expect(takePendingTextCapture("board", "other-node")).toBeNull();
    expect(takePendingTextCapture("other-owner", "text-11")).toBeNull();
    expect(takePendingTextCapture("board", "text-11")).toBe("First");
  });

  it("keeps the begin intent when the owner could not deliver it yet", () => {
    const capture = armPendingTextCapture({ owner: "board" });
    capture.bind("text-12");
    beginTextEditForOwner("board", "text-12", { afterPointerGesture: true });

    // A canvas can register before its iframe is attached. Consuming the intent
    // there left the creation with nothing to open it.
    const notReady = vi.fn(() => false);
    const unregisterNotReady = register("board", notReady);
    expect(notReady).toHaveBeenCalledOnce();

    unregisterNotReady();
    const ready = vi.fn(() => true);
    register("board", ready);
    expect(ready).toHaveBeenCalledExactlyOnceWith("text-12", {
      afterPointerGesture: true,
    });

    // Delivered exactly once: a third registration gets nothing.
    const later = vi.fn(() => true);
    register("board", later);
    expect(later).not.toHaveBeenCalled();
  });

  it("keeps escaped text owed, without intercepting again, when the buffer comes back", () => {
    const capture = armPendingTextCapture({ owner: "board" });
    capture.bind("text-13");
    type("Sta");
    // Escape hands the text to the owner to commit and ends interception.
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", cancelable: true }),
    );
    expect(peekPendingTextCapture("board", "text-13")).toBe("Sta");

    // The owning canvas unmounted before the commit landed.
    returnPendingTextCapture("board", "text-13", "");
    const after = new KeyboardEvent("keydown", { key: "M", cancelable: true });
    window.dispatchEvent(after);
    expect(after.defaultPrevented).toBe(false);
    expect(takePendingTextCapture("board", "text-13")).toBeNull();

    // The next owner is asked to commit exactly what was escaped.
    const begun = vi.fn(() => true);
    register("board", begun);
    expect(begun).toHaveBeenCalledExactlyOnceWith("text-13", {
      commitImmediately: true,
    });
    expect(peekPendingTextCapture("board", "text-13")).toBe("Sta");
  });

  it("releases the request without abandoning it once the frame has the text", () => {
    const teardown = vi.fn();
    const capture = armPendingTextCapture({ owner: "board" });
    capture.bind("text-14");
    onPendingTextCaptureCancel("board", "text-14", teardown);
    type("Sta");
    expect(peekPendingTextCapture("board", "text-14")).toBe("Sta");

    releasePendingTextCapture("board", "text-14");
    expect(isPendingTextRequestLive("board", "text-14")).toBe(false);
    // A completed request is not an abandoned one: nothing gets torn down and
    // no cleanup is scheduled against a node that now has content.
    expect(teardown).not.toHaveBeenCalled();
  });

  it("a stale unregister cannot remove a replacement owner", () => {
    const first = vi.fn();
    const unregisterFirst = register("board", first);
    const second = vi.fn();
    register("board", second);

    unregisterFirst();
    beginTextEditForOwner("board", "text-5");

    expect(second).toHaveBeenCalledExactlyOnceWith("text-5", undefined);
    expect(first).not.toHaveBeenCalled();
  });
});

it("only DesignCanvas's primary frame registers as a text-edit owner", () => {
  // A breakpoint preview renders the same screen under the same screenId and
  // would collide with the primary frame on that key, stealing its activation.
  const source = readFileSync("app/components/design/DesignCanvas.tsx", "utf8");
  expect(source).toMatch(
    /if \(previewFrameId\) return;\s+const owner = screenId;[\s\S]{0,400}?registerTextEditOwner\(\s*owner,/,
  );
  // ...and the same exclusion for every other identity check, which read the
  // bare screenId a preview also carries.
  expect(source).toContain(
    "capturedOwnerRef.current = previewFrameId ? null : (screenId ?? null);",
  );
});
