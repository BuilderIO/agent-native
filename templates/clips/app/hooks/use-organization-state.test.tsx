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
const orgState = vi.hoisted(() => ({
  data: undefined as { orgId: string | null } | undefined,
}));

vi.mock("@agent-native/core/client/org", () => ({
  useOrg: () => orgState,
}));

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
    orgState.data = { orgId: "active" };
    latest = null;
    container = document.createElement("div");
    root = createRoot(container);
    queryClient = new QueryClient({
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
    for (let tick = 0; tick < 10; tick++) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    }
  }

  it("serves folders and spaces for the active org from one org-scoped request", async () => {
    await renderShell();

    expect(fetchAction).toHaveBeenCalledTimes(1);
    expect(fetchAction).toHaveBeenCalledWith("list-organization-state", {
      organizationId: "active",
    });
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

  it("never serves the previous org's state after an org switch", async () => {
    await renderShell();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    fetchAction.mockImplementation(
      async (_name: string, params?: { organizationId?: string }) => {
        await gate;
        return organizationState(params?.organizationId ?? "unscoped");
      },
    );

    orgState.data = { orgId: "next" };
    await renderShell();
    expect(latest).toEqual({ folderIds: [], spaceIds: [] });

    release();
    await renderShell();
    expect(latest).toEqual({
      folderIds: ["next-folder"],
      spaceIds: ["next-space"],
    });
  });

  it("serves nothing once there is no active org", async () => {
    await renderShell();
    fetchAction.mockClear();

    orgState.data = { orgId: null };
    await renderShell();

    expect(fetchAction).not.toHaveBeenCalled();
    expect(latest).toEqual({ folderIds: [], spaceIds: [] });
  });
});
