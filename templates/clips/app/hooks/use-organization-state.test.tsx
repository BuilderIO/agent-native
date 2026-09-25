// @vitest-environment happy-dom

import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchAction = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/client/hooks", () => ({
  useActionQuery: (name: string, params: unknown, options: object) =>
    useQuery({
      queryKey: ["action", name, params],
      queryFn: () => fetchAction(name, params),
      ...options,
    }),
  useActionMutation: vi.fn(),
}));

import { useFolders, useOrganizations, useSpaces } from "./use-library";

function organizationState(id: string) {
  return {
    organization: { id, name: `Org ${id}` },
    spaces: [{ id: `${id}-space` }],
    folders: [{ id: `${id}-folder`, spaceId: null }],
  };
}

let latest: { folderIds: string[]; spaceIds: string[] } | null = null;

function Shell({ organizationId }: { organizationId?: string }) {
  const { data: organizations } = useOrganizations();
  const currentId = organizationId ?? organizations.currentId;
  const { data: folders } = useFolders(
    { organizationId: currentId },
    { enabled: Boolean(currentId) },
  );
  const { data: spaces } = useSpaces(currentId, {
    enabled: Boolean(currentId),
  });
  latest = {
    folderIds: folders.folders.map((folder) => folder.id),
    spaceIds: spaces.spaces.map((space) => space.id),
  };
  return null;
}

describe("useOrganizationState", () => {
  let container: HTMLDivElement;
  let root: Root;
  let queryClient: QueryClient;

  beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    fetchAction.mockReset();
    fetchAction.mockImplementation(
      async (_name: string, params?: { organizationId?: string }) =>
        organizationState(params?.organizationId ?? "active"),
    );
    latest = null;
    container = document.createElement("div");
    root = createRoot(container);
    queryClient = new QueryClient({
      // Match the house staleTime so a hook enabling after data arrives reads
      // the cache instead of refetching.
      defaultOptions: { queries: { retry: false, staleTime: 30_000 } },
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    queryClient.clear();
  });

  async function renderShell(organizationId?: string) {
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <Shell organizationId={organizationId} />
        </QueryClientProvider>,
      );
    });
    // The explicit-org case settles in two steps (active org, then the
    // requested one); isFetching() reads 0 between them, so flush a fixed
    // number of ticks instead of stopping at the first idle moment.
    for (let tick = 0; tick < 10; tick++) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    }
  }

  it("serves folders and spaces for the active org from the one active-org request", async () => {
    await renderShell();

    expect(fetchAction).toHaveBeenCalledTimes(1);
    expect(fetchAction).toHaveBeenCalledWith(
      "list-organization-state",
      undefined,
    );
    expect(latest).toEqual({
      folderIds: ["active-folder"],
      spaceIds: ["active-space"],
    });
  });

  it("still fetches an explicitly requested org that is not the active one", async () => {
    await renderShell("other");

    expect(fetchAction).toHaveBeenCalledWith("list-organization-state", {
      organizationId: "other",
    });
    expect(latest).toEqual({
      folderIds: ["other-folder"],
      spaceIds: ["other-space"],
    });
  });
});
