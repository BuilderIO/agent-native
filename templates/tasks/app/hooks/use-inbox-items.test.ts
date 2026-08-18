import type { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

import { invalidateInboxItems, invalidateTasks } from "./cache";
import { runMarkInboxItemReadyInvalidation } from "./use-inbox-items";

vi.mock("./cache", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./cache")>();
  return {
    ...actual,
    invalidateInboxItems: vi.fn(actual.invalidateInboxItems),
    invalidateTasks: vi.fn(actual.invalidateTasks),
  };
});

describe("runMarkInboxItemReadyInvalidation", () => {
  it("invalidates inbox items then tasks", () => {
    const queryClient = {} as QueryClient;
    const callOrder: string[] = [];

    vi.mocked(invalidateInboxItems).mockImplementation(() => {
      callOrder.push("inbox");
      return Promise.resolve();
    });
    vi.mocked(invalidateTasks).mockImplementation(() => {
      callOrder.push("tasks");
      return Promise.resolve();
    });

    runMarkInboxItemReadyInvalidation(queryClient);

    expect(invalidateInboxItems).toHaveBeenCalledWith(queryClient);
    expect(invalidateTasks).toHaveBeenCalledWith(queryClient);
    expect(callOrder).toEqual(["inbox", "tasks"]);
  });
});
