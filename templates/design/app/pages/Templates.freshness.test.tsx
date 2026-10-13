import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import Templates from "@/pages/Templates";

const mocks = vi.hoisted(() => ({
  listTemplates: vi.fn(),
}));

vi.mock("@agent-native/core/client/hooks", async () => {
  const { useQuery } = await import("@tanstack/react-query");
  return {
    actionErrorMessage: () => undefined,
    useActionQuery: (
      actionName: string,
      params?: unknown,
      options?: { refetchOnMount?: boolean | "always" },
    ) => {
      if (actionName !== "list-design-templates") {
        throw new Error(`Unexpected action query: ${actionName}`);
      }
      return useQuery({
        queryKey: ["action", actionName, params],
        queryFn: mocks.listTemplates,
        staleTime: 30_000,
        retry: false,
        ...(options?.refetchOnMount === undefined
          ? {}
          : { refetchOnMount: options.refetchOnMount }),
      });
    },
    useActionMutation: () => ({ mutateAsync: vi.fn() }),
  };
});

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

vi.mock("@agent-native/toolkit/app-shell", () => ({
  useSetPageTitle: vi.fn(),
}));

vi.mock("@/components/templates/DesignTemplateLibrary", () => ({
  DesignTemplateLibrary: ({
    templates,
    loading,
  }: {
    templates: readonly { id: string; title: string }[];
    loading: boolean;
  }) => (
    <div data-testid="template-library" data-loading={String(loading)}>
      {templates.map((template) => (
        <span key={template.id} data-template-id={template.id}>
          {template.title}
        </span>
      ))}
    </div>
  ),
}));

const queryKey = [
  "action",
  "list-design-templates",
  { includePreview: "true" },
] as const;

const cachedTemplates = [
  { id: "builtin-one", title: "Starter landscape", isBuiltIn: true },
  { id: "builtin-two", title: "Starter portrait", isBuiltIn: true },
];

const savedTemplate = {
  id: "saved-template",
  title: "Fresh private save",
  isBuiltIn: false,
};

let queryClient: QueryClient;
let container: HTMLDivElement;
let root: Root;
let cacheUpdatedAt: number;

beforeEach(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  mocks.listTemplates.mockReset();
  mocks.listTemplates.mockResolvedValue({
    templates: [...cachedTemplates, savedTemplate],
  });
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  cacheUpdatedAt = Date.now();
  queryClient.setQueryData(
    queryKey,
    { templates: cachedTemplates },
    { updatedAt: cacheUpdatedAt },
  );
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  queryClient.clear();
  container.remove();
});

describe("Templates cached-list freshness", () => {
  it.each([
    { status: 503, keepCachedList: true },
    { status: 408, keepCachedList: true },
    { status: 429, keepCachedList: true },
    { status: 401, keepCachedList: false },
    { status: 403, keepCachedList: false },
    { status: 404, keepCachedList: false },
  ])(
    "handles refresh failure $status without bypassing access errors",
    async ({ status, keepCachedList }) => {
      mocks.listTemplates.mockRejectedValue(
        Object.assign(new Error("Refresh failed"), { status }),
      );
      await act(async () => {
        root.render(
          <QueryClientProvider client={queryClient}>
            <MemoryRouter initialEntries={["/templates"]}>
              <Templates />
            </MemoryRouter>
          </QueryClientProvider>,
        );
      });
      await act(async () => {
        await vi.waitFor(() =>
          expect(queryClient.getQueryState(queryKey)?.status).toBe("error"),
        );
      });
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      expect(
        container.querySelector('[data-template-id="builtin-one"]') !== null,
      ).toBe(keepCachedList);
      expect(container.textContent).toContain("common.genericError");
    },
  );
  it("refetches a fresh cached list on mount and populates the library leaf", async () => {
    const cachedState = queryClient.getQueryState(queryKey);
    expect(cachedState?.isInvalidated).toBe(false);
    expect(cachedState?.dataUpdatedAt).toBe(cacheUpdatedAt);
    expect(Date.now() - cacheUpdatedAt).toBeLessThan(30_000);

    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <MemoryRouter
            initialEntries={["/templates?search=Fresh%20private%20save"]}
          >
            <Templates />
          </MemoryRouter>
        </QueryClientProvider>,
      );
    });

    await act(async () => {
      await vi.waitFor(() => {
        expect({
          queryCalls: mocks.listTemplates.mock.calls.length,
          savedLeafTitle:
            container.querySelector('[data-template-id="saved-template"]')
              ?.textContent ?? null,
        }).toEqual({
          queryCalls: 1,
          savedLeafTitle: savedTemplate.title,
        });
      });
    });

    expect(
      [...container.querySelectorAll("[data-template-id]")].map((node) =>
        node.getAttribute("data-template-id"),
      ),
    ).toEqual([savedTemplate.id]);
    expect(
      queryClient
        .getQueryData<{ templates: typeof cachedTemplates }>(queryKey)
        ?.templates.map((template) => template.id),
    ).toEqual(["builtin-one", "builtin-two", savedTemplate.id]);
  });
});
