import { beforeEach, describe, expect, it, vi } from "vitest";

const hook = vi.hoisted(() => ({
  options: null as null | {
    onSettled?: (data: unknown, error: unknown, variables: unknown) => void;
  },
  invalidateQueries: vi.fn(),
}));

vi.mock("@agent-native/core/client/hooks", () => ({
  useActionMutation: (_name: string, options: typeof hook.options) => {
    hook.options = options;
    return {};
  },
}));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: hook.invalidateQueries }),
}));
vi.mock("react-router", () => ({ useLocation: () => ({ pathname: "/" }) }));
vi.mock("./use-db-sync", () => ({
  contentSyncInvalidatePredicate: () => () => true,
}));

import { useLinkGitHubFolder } from "./use-github-folder";

beforeEach(() => {
  hook.options = null;
  hook.invalidateQueries.mockReset();
});

describe("useLinkGitHubFolder", () => {
  it("refreshes the collection when a link fails after it may have been saved", () => {
    useLinkGitHubFolder();
    hook.options?.onSettled?.(undefined, new Error("First sync failed"), {
      databaseId: "db",
      url: "https://github.com/acme/site/tree/main/docs",
    });
    expect(hook.invalidateQueries).toHaveBeenCalledTimes(1);
  });

  it("leaves queries alone after a preview", () => {
    useLinkGitHubFolder();
    hook.options?.onSettled?.(undefined, new Error("No such folder"), {
      databaseId: "db",
      url: "https://github.com/acme/site/tree/main/docs",
      dryRun: true,
    });
    expect(hook.invalidateQueries).not.toHaveBeenCalled();
  });
});
