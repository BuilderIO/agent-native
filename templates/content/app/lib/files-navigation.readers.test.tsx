// @vitest-environment happy-dom

import { setAgentNativeApiDisabled } from "@agent-native/core/client/api-surface";
import type { ContentDatabaseNavigationPageResponse } from "@shared/api";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { callActionWithRetry } = vi.hoisted(() => ({
  callActionWithRetry: vi.fn(),
}));

vi.mock("@agent-native/core/client/hooks", () => ({ callActionWithRetry }));

import {
  filesNavigationPageParams,
  filesNavigationQueryKey,
  useFilesNavigationPage,
} from "./files-navigation";

const FILES = "files-db";
const ROOT = filesNavigationPageParams({ databaseId: FILES, parentId: null });
const OPEN_FOLDERS: ReadonlySet<string> = new Set(["folder"]);
const OTHER_OPEN_FOLDERS: ReadonlySet<string> = new Set(["other-folder"]);

function empty(): ContentDatabaseNavigationPageResponse {
  return {
    items: [],
    pagination: { limit: 20, hasMore: false, nextCursor: null },
  };
}

function SidebarReader({
  folders = OPEN_FOLDERS,
}: {
  folders?: ReadonlySet<string>;
}) {
  useFilesNavigationPage(ROOT, folders);
  return null;
}

function BreadcrumbReader() {
  useFilesNavigationPage(ROOT);
  return null;
}

let queryClient: QueryClient;
let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  callActionWithRetry.mockReset();
  callActionWithRetry.mockImplementation(async () => empty());
  queryClient = new QueryClient();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  queryClient.clear();
  setAgentNativeApiDisabled(null);
});

describe("a Files read", () => {
  async function mountBreadcrumb() {
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <BreadcrumbReader />
        </QueryClientProvider>,
      );
    });
  }

  it("drops the rows it showed once a reread is refused", async () => {
    callActionWithRetry.mockImplementation(async () => ({
      ...empty(),
      items: [{ documentId: "page-1", type: "page" }],
    }));
    await mountBreadcrumb();
    expect(
      queryClient.getQueryData(filesNavigationQueryKey(ROOT)),
    ).toBeDefined();

    callActionWithRetry.mockRejectedValue(
      Object.assign(new Error("Forbidden"), { status: 403 }),
    );
    await act(async () => {
      await queryClient.refetchQueries({
        queryKey: filesNavigationQueryKey(ROOT),
        exact: true,
      });
    });

    expect(
      queryClient.getQueryData(filesNavigationQueryKey(ROOT)),
    ).toBeUndefined();
  });

  it("drops a folder's cached page once the top level is refused, for a breadcrumb that reads it alone", async () => {
    const folder = filesNavigationPageParams({
      databaseId: FILES,
      parentId: "folder",
    });
    const otherDatabase = filesNavigationPageParams({
      databaseId: "other-files-db",
      parentId: null,
    });
    queryClient.setQueryData(filesNavigationQueryKey(folder), {
      ...empty(),
      items: [{ documentId: "child", type: "page" }],
    });
    queryClient.setQueryData(filesNavigationQueryKey(otherDatabase), empty());
    function FolderReader() {
      useFilesNavigationPage(folder);
      return null;
    }
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <BreadcrumbReader />
          <FolderReader />
        </QueryClientProvider>,
      );
    });

    callActionWithRetry.mockRejectedValue(
      Object.assign(new Error("Forbidden"), { status: 403 }),
    );
    await act(async () => {
      await queryClient.refetchQueries({
        queryKey: filesNavigationQueryKey(ROOT),
        exact: true,
      });
    });

    expect(
      queryClient.getQueryData(filesNavigationQueryKey(folder)),
    ).toBeUndefined();
    expect(
      queryClient.getQueryData(filesNavigationQueryKey(otherDatabase)),
    ).toBeDefined();
  });

  it("isn't made while the app's API is off", async () => {
    setAgentNativeApiDisabled("builder shell canvas");
    await mountBreadcrumb();

    expect(callActionWithRetry).not.toHaveBeenCalled();
  });
});

describe("readers of one Files page", () => {
  it("ask for the sidebar's open folders whichever reader mounted last", async () => {
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <SidebarReader />
          <BreadcrumbReader />
        </QueryClientProvider>,
      );
    });
    callActionWithRetry.mockClear();

    await act(async () => {
      await queryClient.refetchQueries({
        queryKey: filesNavigationQueryKey(ROOT),
        exact: true,
      });
    });

    expect(callActionWithRetry).toHaveBeenCalledWith(
      "query-content-database-items",
      expect.objectContaining({
        navigation: expect.objectContaining({ expand: ["folder"] }),
      }),
      expect.anything(),
    );
  });

  it("ask for every sidebar's open folders when two are mounted", async () => {
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <SidebarReader />
          <SidebarReader folders={OTHER_OPEN_FOLDERS} />
        </QueryClientProvider>,
      );
    });
    callActionWithRetry.mockClear();

    await act(async () => {
      await queryClient.refetchQueries({
        queryKey: filesNavigationQueryKey(ROOT),
        exact: true,
      });
    });

    expect(callActionWithRetry).toHaveBeenCalledWith(
      "query-content-database-items",
      expect.objectContaining({
        navigation: expect.objectContaining({
          expand: expect.arrayContaining(["folder", "other-folder"]),
        }),
      }),
      expect.anything(),
    );
  });

  it("keep a sidebar's open folders after another sidebar unmounts", async () => {
    const render = (withOther: boolean) =>
      root.render(
        <QueryClientProvider client={queryClient}>
          <SidebarReader />
          {withOther ? <SidebarReader folders={OTHER_OPEN_FOLDERS} /> : null}
          <BreadcrumbReader />
        </QueryClientProvider>,
      );
    await act(async () => render(true));
    await act(async () => render(false));
    callActionWithRetry.mockClear();

    await act(async () => {
      await queryClient.refetchQueries({
        queryKey: filesNavigationQueryKey(ROOT),
        exact: true,
      });
    });

    expect(callActionWithRetry).toHaveBeenCalledWith(
      "query-content-database-items",
      expect.objectContaining({
        navigation: expect.objectContaining({ expand: ["folder"] }),
      }),
      expect.anything(),
    );
  });
});
