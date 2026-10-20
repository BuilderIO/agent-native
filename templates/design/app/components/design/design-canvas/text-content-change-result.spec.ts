// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";

import { runPendingTextHostCommit } from "../../../pages/design-editor/commands/pending-text-host-commit";
import {
  runScreenTextContentChange,
  type ScreenTextContentChangeArgs,
} from "../../../pages/design-editor/commands/screen-text-content-change";
import {
  HOST_COMMIT_RETRY_DELAYS_MS,
  cancelPendingTextHostCommit,
  queuePendingTextHostCommit,
  registerPendingTextHostCommit,
} from "./pending-text-capture";
import {
  commitTextContentChange,
  consumePendingTextCreation,
  deferPendingTextCreationCleanup,
  registerPendingTextCreation,
  type PendingTextCreationOwners,
} from "./text-content-change-result";

const unregister: Array<() => void> = [];

afterEach(() => {
  while (unregister.length > 0) unregister.pop()!();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it("preserves the pending owner token through inactive-before-content delivery", () => {
  vi.useFakeTimers();
  const pending: PendingTextCreationOwners = new Map();
  registerPendingTextCreation(pending, "board", "text-1");
  deferPendingTextCreationCleanup(pending, "board", "text-1");

  expect(consumePendingTextCreation(pending, "screen", "text-1")).toBe(false);
  expect(consumePendingTextCreation(pending, "board", "different-node")).toBe(
    false,
  );
  expect(consumePendingTextCreation(pending, "board", "text-1")).toBe(true);
  vi.advanceTimersByTime(5_000);
  expect(consumePendingTextCreation(pending, "board", "text-1")).toBe(false);
});

it("defers owner and unmount cleanup through the delivery grace period", () => {
  vi.useFakeTimers();
  const pending: PendingTextCreationOwners = new Map();
  registerPendingTextCreation(pending, "board", "board-delivered");
  registerPendingTextCreation(pending, "board", "board-abandoned");
  registerPendingTextCreation(pending, "screen", "screen-active");

  deferPendingTextCreationCleanup(pending, "board");
  expect(consumePendingTextCreation(pending, "board", "board-delivered")).toBe(
    true,
  );
  vi.advanceTimersByTime(5_000);
  expect(consumePendingTextCreation(pending, "board", "board-abandoned")).toBe(
    false,
  );
  expect(consumePendingTextCreation(pending, "screen", "screen-active")).toBe(
    true,
  );

  deferPendingTextCreationCleanup(pending);
  vi.advanceTimersByTime(5_000);
  expect(consumePendingTextCreation(pending, "screen", "screen-active")).toBe(
    false,
  );
});

it("bounds pending creation owner records", () => {
  vi.useFakeTimers();
  const pending: PendingTextCreationOwners = new Map();

  for (let index = 0; index < 70; index += 1) {
    registerPendingTextCreation(pending, "board", `text-${index}`);
  }

  expect(pending.size).toBeLessThanOrEqual(64);
});

function readOnlyArgs(applyFileContentUpdate = vi.fn()) {
  return {
    args: {
      activeFile: { id: "board" },
      applyFileContentUpdate,
      canEditDesign: false,
      designSourceType: "inline",
      overviewScreens: [],
    } as unknown as ScreenTextContentChangeArgs,
    applyFileContentUpdate,
  };
}

it("keeps accepted creation commits on the normal single-write path", () => {
  const commit = vi.fn(() => "accepted" as const);
  const queue = vi.fn(() => true);
  const requestSnapshot = vi.fn();

  expect(
    commitTextContentChange({
      owner: "board",
      nodeId: "text-1",
      value: "Sta",
      isPendingTextCreation: true,
      commit,
      queueHostCommit: queue,
      cancelHostCommit: vi.fn(),
      requestSnapshot,
    }),
  ).toBe("published");
  expect(commit).toHaveBeenCalledOnce();
  expect(queue).not.toHaveBeenCalled();
  expect(requestSnapshot).toHaveBeenCalledOnce();
});

it("hands board and screen refusal statuses through to pending creation retry", () => {
  const queue = vi.fn(() => true);
  const requestSnapshot = vi.fn();
  const { args } = readOnlyArgs();
  const callbacks = [
    {
      owner: "board",
      invoke: (selector: string, value: string) =>
        runScreenTextContentChange(args, "board", selector, value),
    },
    {
      owner: "screen-1",
      invoke: (selector: string, value: string) =>
        runScreenTextContentChange(args, "screen-1", selector, value),
    },
  ];

  for (const { owner, invoke } of callbacks) {
    expect(
      commitTextContentChange({
        owner,
        nodeId: `node-${owner}`,
        value: "Typed",
        isPendingTextCreation: true,
        commit: () => invoke("#text", "Typed"),
        queueHostCommit: queue,
        cancelHostCommit: vi.fn(),
        requestSnapshot,
      }),
    ).toBe("fallback-queued");
  }

  expect(queue).toHaveBeenNthCalledWith(
    1,
    "board",
    "node-board",
    "Typed",
    expect.any(Function),
  );
  expect(queue).toHaveBeenNthCalledWith(
    2,
    "screen-1",
    "node-screen-1",
    "Typed",
    expect.any(Function),
  );
  expect(requestSnapshot).not.toHaveBeenCalled();
});

it("retries only a refused nonempty pending creation and snapshots after acceptance", () => {
  vi.useFakeTimers();
  let sourceText = "";
  let attempts = 0;
  const sourceCommit = vi.fn((_selector: string, value: string) => {
    attempts += 1;
    if (attempts < 3) return "refused" as const;
    sourceText = value;
    return "accepted" as const;
  });
  const args = {
    activeFile: { id: "board" },
    canEditDesign: true,
    designSourceType: "inline",
    handleTextContentChange: sourceCommit,
    overviewScreens: [],
  } as unknown as ScreenTextContentChangeArgs;
  const writer = vi.fn((owner: string, nodeId: string, value: string) =>
    runPendingTextHostCommit(
      (screenId, selector, text) =>
        runScreenTextContentChange(args, screenId, selector, text),
      owner,
      nodeId,
      value,
    ),
  );
  unregister.push(registerPendingTextHostCommit(writer));
  const requestSnapshot = vi.fn();

  expect(
    commitTextContentChange({
      owner: "board",
      nodeId: "text-1",
      value: "Sta",
      isPendingTextCreation: true,
      commit: () => runScreenTextContentChange(args, "board", "#text-1", "Sta"),
      queueHostCommit: queuePendingTextHostCommit,
      cancelHostCommit: cancelPendingTextHostCommit,
      requestSnapshot,
    }),
  ).toBe("fallback-queued");
  expect(sourceText).toBe("");
  expect(requestSnapshot).not.toHaveBeenCalled();
  expect(sourceCommit.mock.calls[1]?.[0]).toBe(
    '[data-agent-native-node-id="text-1"]',
  );

  vi.advanceTimersByTime(HOST_COMMIT_RETRY_DELAYS_MS[0]);
  expect(sourceText).toBe("Sta");
  expect(requestSnapshot).toHaveBeenCalledOnce();
  expect(sourceCommit).toHaveBeenCalledTimes(3);
});

it("uses the permission-safe host writer after the direct source callback throws", () => {
  vi.useFakeTimers();
  const error = new Error("transient source write error");
  let attempts = 0;
  const sourceCommit = vi.fn((_selector: string, _value: string) => {
    attempts += 1;
    if (attempts <= 2) throw error;
    return "accepted" as const;
  });
  const args = {
    activeFile: { id: "board" },
    canEditDesign: true,
    designSourceType: "inline",
    handleTextContentChange: sourceCommit,
    overviewScreens: [],
  } as unknown as ScreenTextContentChangeArgs;
  const hostWriter = vi.fn((owner: string, nodeId: string, value: string) =>
    runPendingTextHostCommit(
      (screenId, selector, text) =>
        runScreenTextContentChange(args, screenId, selector, text),
      owner,
      nodeId,
      value,
    ),
  );
  unregister.push(registerPendingTextHostCommit(hostWriter));
  const requestSnapshot = vi.fn();

  expect(
    commitTextContentChange({
      owner: "board",
      nodeId: "text-2",
      value: "Start",
      isPendingTextCreation: true,
      commit: () =>
        runScreenTextContentChange(args, "board", "#text-2", "Start"),
      queueHostCommit: queuePendingTextHostCommit,
      cancelHostCommit: cancelPendingTextHostCommit,
      requestSnapshot,
    }),
  ).toBe("fallback-queued");
  expect(requestSnapshot).not.toHaveBeenCalled();
  expect(hostWriter).toHaveBeenCalledOnce();

  vi.advanceTimersByTime(HOST_COMMIT_RETRY_DELAYS_MS[0]);
  expect(sourceCommit).toHaveBeenCalledTimes(3);
  expect(requestSnapshot).toHaveBeenCalledOnce();
});

it("updates a queued retry to the latest typed value", () => {
  vi.useFakeTimers();
  const writes: string[] = [];
  let savedText = "";
  const writer = vi.fn((_owner: string, _nodeId: string, value: string) => {
    writes.push(value);
    if (value !== "Start") return false;
    savedText = value;
    return true;
  });
  unregister.push(registerPendingTextHostCommit(writer));
  const requestSnapshot = vi.fn();
  const commit = (value: string) =>
    commitTextContentChange({
      owner: "board",
      nodeId: "text-latest",
      value,
      isPendingTextCreation: true,
      commit: () => "refused",
      queueHostCommit: queuePendingTextHostCommit,
      cancelHostCommit: cancelPendingTextHostCommit,
      requestSnapshot,
    });

  expect(commit("Sta")).toBe("fallback-queued");
  expect(commit("Start")).toBe("fallback-queued");
  vi.advanceTimersByTime(10_000);

  expect(writes).toEqual(["Sta", "Start"]);
  expect(savedText).toBe("Start");
  expect(requestSnapshot).toHaveBeenCalledOnce();
});

it("cancels an older host retry after a newer direct edit is accepted", () => {
  vi.useFakeTimers();
  const writer = vi.fn(() => false);
  unregister.push(registerPendingTextHostCommit(writer));
  const requestSnapshot = vi.fn();

  expect(
    commitTextContentChange({
      owner: "board",
      nodeId: "text-authoritative",
      value: "Sta",
      isPendingTextCreation: true,
      commit: () => "refused",
      queueHostCommit: queuePendingTextHostCommit,
      cancelHostCommit: cancelPendingTextHostCommit,
      requestSnapshot,
    }),
  ).toBe("fallback-queued");

  expect(
    commitTextContentChange({
      owner: "board",
      nodeId: "text-authoritative",
      value: "Started",
      isPendingTextCreation: false,
      commit: () => "accepted",
      queueHostCommit: queuePendingTextHostCommit,
      cancelHostCommit: cancelPendingTextHostCommit,
      requestSnapshot,
    }),
  ).toBe("published");
  vi.advanceTimersByTime(10_000);

  expect(writer).toHaveBeenCalledOnce();
  expect(requestSnapshot).toHaveBeenCalledOnce();
});

it("reports terminal fallback failure and leaves the typed frame text untouched", () => {
  vi.useFakeTimers();
  const report = vi.spyOn(console, "error").mockImplementation(() => {});
  const iframeText = { value: "Sta" };
  const savedLayerText = { value: "" };
  const args = {
    activeFile: { id: "board" },
    canEditDesign: true,
    designSourceType: "inline",
    handleTextContentChange: vi.fn(() => "refused" as const),
    overviewScreens: [],
  } as unknown as ScreenTextContentChangeArgs;
  const writer = vi.fn((owner: string, nodeId: string, value: string) =>
    runPendingTextHostCommit(
      (screenId, selector, text) =>
        runScreenTextContentChange(args, screenId, selector, text),
      owner,
      nodeId,
      value,
    ),
  );
  unregister.push(registerPendingTextHostCommit(writer));
  const requestSnapshot = vi.fn();

  expect(
    commitTextContentChange({
      owner: "board",
      nodeId: "text-terminal",
      value: iframeText.value,
      isPendingTextCreation: true,
      commit: () =>
        runScreenTextContentChange(
          args,
          "board",
          "#text-terminal",
          iframeText.value,
        ),
      queueHostCommit: queuePendingTextHostCommit,
      cancelHostCommit: cancelPendingTextHostCommit,
      requestSnapshot,
    }),
  ).toBe("fallback-queued");
  for (const delay of HOST_COMMIT_RETRY_DELAYS_MS) {
    vi.advanceTimersByTime(delay);
  }

  expect(writer).toHaveBeenCalledTimes(HOST_COMMIT_RETRY_DELAYS_MS.length + 1);
  expect(savedLayerText.value).toBe("");
  expect(iframeText.value).toBe("Sta");
  expect(requestSnapshot).not.toHaveBeenCalled();
  expect(report).toHaveBeenCalledOnce();
  expect(report.mock.calls[0]?.[0]).toContain(
    "typed text could not be written",
  );
  expect(report.mock.calls[0]?.[1]).toMatchObject({
    screenId: "board",
    nodeId: "text-terminal",
    reason: "commit-failed",
  });
});

it("reports terminal permission denial without a source write", () => {
  vi.useFakeTimers();
  const report = vi.spyOn(console, "error").mockImplementation(() => {});
  const { args, applyFileContentUpdate } = readOnlyArgs();
  const sourceCommit = vi.fn(
    (screenId: string, selector: string, value: string) =>
      runScreenTextContentChange(args, screenId, selector, value),
  );
  const writer = vi.fn((owner: string, nodeId: string, value: string) =>
    runPendingTextHostCommit(sourceCommit, owner, nodeId, value),
  );
  unregister.push(registerPendingTextHostCommit(writer));
  const requestSnapshot = vi.fn();

  expect(
    commitTextContentChange({
      owner: "board",
      nodeId: "text-readonly",
      value: "Sta",
      isPendingTextCreation: true,
      commit: () =>
        runScreenTextContentChange(args, "board", "#text-readonly", "Sta"),
      queueHostCommit: queuePendingTextHostCommit,
      cancelHostCommit: cancelPendingTextHostCommit,
      requestSnapshot,
    }),
  ).toBe("fallback-queued");
  for (const delay of HOST_COMMIT_RETRY_DELAYS_MS) {
    vi.advanceTimersByTime(delay);
  }

  expect(sourceCommit).toHaveBeenCalledTimes(
    HOST_COMMIT_RETRY_DELAYS_MS.length + 1,
  );
  expect(applyFileContentUpdate).not.toHaveBeenCalled();
  expect(requestSnapshot).not.toHaveBeenCalled();
  expect(report).toHaveBeenCalledOnce();
});

it("does not fallback existing text or an empty Escape", () => {
  const queue = vi.fn(() => true);
  const requestSnapshot = vi.fn();
  const refused = vi.fn(() => "refused" as const);

  commitTextContentChange({
    owner: "board",
    nodeId: "existing-node",
    value: "Changed",
    isPendingTextCreation: false,
    commit: refused,
    queueHostCommit: queue,
    cancelHostCommit: vi.fn(),
    requestSnapshot,
  });
  commitTextContentChange({
    owner: "board",
    nodeId: "text-empty",
    value: "",
    isPendingTextCreation: true,
    commit: refused,
    queueHostCommit: queue,
    cancelHostCommit: vi.fn(),
    requestSnapshot,
  });

  expect(queue).not.toHaveBeenCalled();
  expect(requestSnapshot).toHaveBeenCalledTimes(2);
});
