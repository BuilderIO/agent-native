// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";

import {
  commitTextContentChange,
  consumePendingTextCreation,
  deferPendingTextCreationCleanup,
  registerPendingTextCreation,
  retainPendingTextCreationForActiveEdit,
  type PendingTextCreationOwners,
} from "./text-content-change-result";

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

it("keeps an active text creation eligible for fallback after a long edit", () => {
  vi.useFakeTimers();
  const pending: PendingTextCreationOwners = new Map();
  registerPendingTextCreation(pending, "board", "text-long-edit");
  expect(
    retainPendingTextCreationForActiveEdit(pending, "board", "text-long-edit"),
  ).toBe(true);

  vi.advanceTimersByTime(30_001);
  const isPendingTextCreation = consumePendingTextCreation(
    pending,
    "board",
    "text-long-edit",
  );
  expect(isPendingTextCreation).toBe(true);

  const queueHostCommit = vi.fn(() => true);
  const requestSnapshot = vi.fn();
  expect(
    commitTextContentChange({
      owner: "board",
      nodeId: "text-long-edit",
      value: "Typed after thirty seconds",
      isPendingTextCreation,
      commit: () => "refused",
      queueHostCommit,
      cancelHostCommit: vi.fn(),
      requestSnapshot,
    }),
  ).toBe("fallback-queued");
  expect(queueHostCommit).toHaveBeenCalledWith(
    "board",
    "text-long-edit",
    "Typed after thirty seconds",
    expect.any(Function),
  );
  expect(requestSnapshot).not.toHaveBeenCalled();
});

it("still retires an empty active creation after Escape cleanup grace", () => {
  vi.useFakeTimers();
  const pending: PendingTextCreationOwners = new Map();
  registerPendingTextCreation(pending, "board", "text-empty-escape");
  expect(
    retainPendingTextCreationForActiveEdit(
      pending,
      "board",
      "text-empty-escape",
    ),
  ).toBe(true);

  vi.advanceTimersByTime(30_001);
  deferPendingTextCreationCleanup(pending, "board", "text-empty-escape");
  vi.advanceTimersByTime(5_000);

  expect(
    consumePendingTextCreation(pending, "board", "text-empty-escape"),
  ).toBe(false);
});

it("keeps the active token while evicting inactive entries at the map bound", () => {
  vi.useFakeTimers();
  const pending: PendingTextCreationOwners = new Map();
  registerPendingTextCreation(pending, "board", "text-active");
  expect(
    retainPendingTextCreationForActiveEdit(pending, "board", "text-active"),
  ).toBe(true);
  for (let index = 0; index < 63; index += 1) {
    registerPendingTextCreation(pending, "board", `text-inactive-${index}`);
  }
  registerPendingTextCreation(pending, "board", "text-newest");

  expect(pending.size).toBe(64);
  vi.advanceTimersByTime(30_001);
  expect(consumePendingTextCreation(pending, "board", "text-active")).toBe(
    true,
  );
});

it("retains a creation token when the active event precedes insert acknowledgement", () => {
  vi.useFakeTimers();
  const pending: PendingTextCreationOwners = new Map();
  // The active identity is recorded before the successful insert-result message.
  registerPendingTextCreation(pending, "board", "text-active-before-ack", true);

  vi.advanceTimersByTime(30_001);
  const isPendingTextCreation = consumePendingTextCreation(
    pending,
    "board",
    "text-active-before-ack",
  );
  expect(isPendingTextCreation).toBe(true);

  const queueHostCommit = vi.fn(() => true);
  expect(
    commitTextContentChange({
      owner: "board",
      nodeId: "text-active-before-ack",
      value: "Typed after thirty seconds",
      isPendingTextCreation,
      commit: () => "refused",
      queueHostCommit,
      cancelHostCommit: vi.fn(),
      requestSnapshot: vi.fn(),
    }),
  ).toBe("fallback-queued");
  expect(queueHostCommit).toHaveBeenCalledWith(
    "board",
    "text-active-before-ack",
    "Typed after thirty seconds",
    expect.any(Function),
  );
});
