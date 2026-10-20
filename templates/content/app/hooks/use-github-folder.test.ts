import { beforeEach, describe, expect, it, vi } from "vitest";

const hook = vi.hoisted(() => ({
  options: null as null | {
    onSettled?: (data: unknown, error: unknown, variables: unknown) => void;
    onSuccess?: (data: unknown, variables: unknown) => void;
  },
  invalidateQueries: vi.fn(),
  invalidatedKeys: [] as unknown[],
  placement: null as unknown,
  query: null as unknown,
}));

vi.mock("@agent-native/core/client/hooks", () => ({
  useActionMutation: (_name: string, options: typeof hook.options) => {
    hook.options = options;
    return {};
  },
  useActionQuery: (name: string, params: unknown, options: unknown) => {
    hook.query = { name, params, options };
    return {};
  },
}));
vi.mock("./use-content-action-mutation", () => ({
  contentPlacementTargets: (_client: unknown, request: unknown) => {
    hook.placement = request;
    return [["placement"]];
  },
  contentSpaceFilesDatabaseId: (_client: unknown, spaceId: string) =>
    `files-${spaceId}`,
  invalidateContentQueries: (_client: unknown, keys: unknown[]) => {
    hook.invalidatedKeys.push(...keys);
  },
}));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: hook.invalidateQueries }),
}));
vi.mock("react-router", () => ({ useLocation: () => ({ pathname: "/" }) }));
vi.mock("./use-db-sync", () => ({
  contentSyncInvalidatePredicate: () => () => true,
}));

import {
  useCreateGitHubCollection,
  useGitHubConnection,
  useLinkGitHubFolder,
} from "./use-github-folder";

beforeEach(() => {
  hook.options = null;
  hook.invalidateQueries.mockReset();
  hook.invalidatedKeys = [];
  hook.placement = null;
  hook.query = null;
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

describe("useCreateGitHubCollection", () => {
  const request = {
    url: "https://github.com/acme/site/tree/main/docs",
    spaceId: "space-1",
  };

  it("refreshes the sidebar and the new collection once it's made", () => {
    useCreateGitHubCollection();
    hook.options?.onSuccess?.(
      { dryRun: false, database: { documentId: "doc-new" } },
      request,
    );
    expect(hook.placement).toEqual({
      documentIds: ["doc-new"],
      parentIds: [null],
      databaseId: "files-space-1",
    });
    expect(hook.invalidatedKeys).toEqual([
      ["placement"],
      ["action", "list-documents"],
      ["action", "list-content-databases"],
    ]);
    // The new page's own query, then whatever a sync event spoils.
    expect(hook.invalidateQueries).toHaveBeenCalledTimes(2);
  });

  it("refreshes the parent page's children for a collection made inside it", () => {
    useCreateGitHubCollection();
    hook.options?.onSuccess?.(
      { dryRun: false, database: { documentId: "doc-new" } },
      { ...request, parentId: "parent-1" },
    );
    expect(hook.placement).toEqual({
      documentIds: ["doc-new"],
      parentIds: ["parent-1"],
      databaseId: undefined,
    });
  });

  it("leaves queries alone after a check", () => {
    useCreateGitHubCollection();
    hook.options?.onSuccess?.({ dryRun: true }, { ...request, dryRun: true });
    expect(hook.invalidatedKeys).toEqual([]);
    expect(hook.invalidateQueries).not.toHaveBeenCalled();
  });
});

describe("useGitHubConnection", () => {
  it("asks GitHub once a minute at most, and only when asked to", () => {
    useGitHubConnection(false);
    expect(hook.query).toEqual({
      name: "check-github-connection",
      params: {},
      options: expect.objectContaining({
        enabled: false,
        retry: false,
        staleTime: 60_000,
      }),
    });
  });
});
