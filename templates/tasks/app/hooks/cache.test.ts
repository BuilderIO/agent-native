import type { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

import {
  invalidateInboxItems,
  invalidateTasks,
  LIST_INBOX_ITEMS_QUERY_KEY,
  LIST_TASKS_QUERY_KEY,
} from "./cache";

describe("cache invalidators", () => {
  it("invalidateInboxItems targets list-inbox-items", () => {
    const invalidateQueries = vi.fn();
    const qc = { invalidateQueries } as unknown as QueryClient;

    invalidateInboxItems(qc);

    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: LIST_INBOX_ITEMS_QUERY_KEY,
    });
  });

  it("invalidateTasks targets list-tasks", () => {
    const invalidateQueries = vi.fn();
    const qc = { invalidateQueries } as unknown as QueryClient;

    invalidateTasks(qc);

    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: LIST_TASKS_QUERY_KEY,
    });
  });
});
