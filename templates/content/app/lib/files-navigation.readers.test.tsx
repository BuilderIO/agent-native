// @vitest-environment happy-dom

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

function empty(): ContentDatabaseNavigationPageResponse {
  return {
    items: [],
    pagination: { limit: 20, hasMore: false, nextCursor: null },
  };
}

function SidebarReader() {
  useFilesNavigationPage(ROOT, OPEN_FOLDERS);
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
});
