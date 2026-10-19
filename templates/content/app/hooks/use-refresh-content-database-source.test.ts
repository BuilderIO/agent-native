import { beforeEach, describe, expect, it, vi } from "vitest";

const hook = vi.hoisted(() => ({
  options: null as null | {
    onSuccess?: (data: unknown, variables: unknown) => void;
    onSettled?: (data: unknown, error: unknown, variables: unknown) => void;
  },
  invalidateQueries: vi.fn(),
}));

vi.mock("@agent-native/core/client/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/client/hooks")>()),
  useActionMutation: (_name: string, options: typeof hook.options) => {
    hook.options = options;
    return {};
  },
}));
vi.mock("@tanstack/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-query")>()),
  useQueryClient: () => ({ invalidateQueries: hook.invalidateQueries }),
}));

import { useRefreshContentDatabaseSource } from "./use-content-database";

beforeEach(() => {
  hook.options = null;
  hook.invalidateQueries.mockReset();
});

describe("useRefreshContentDatabaseSource", () => {
  it("rereads the source status after a refresh fails, since a GitHub sync stores its problem first", () => {
    useRefreshContentDatabaseSource("database-page");
    hook.options?.onSettled?.(undefined, new Error("socket hang up"), {
      databaseId: "db",
    });
    expect(hook.invalidateQueries).toHaveBeenCalledWith({
      queryKey: [
        "action",
        "get-content-database-source",
        { documentId: "database-page" },
      ],
    });
  });
});
