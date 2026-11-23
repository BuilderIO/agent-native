// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

const actions = vi.hoisted(() => ({
  mutate: vi.fn(),
  touch: vi.fn(),
  refetch: vi.fn(),
}));
vi.mock("@agent-native/core/client/hooks", () => ({
  useActionMutation: () => ({
    mutate: actions.touch,
    mutateAsync: actions.mutate,
  }),
  useActionQuery: (
    name: string,
    input: { connectionId?: string; tableId?: string },
  ) => {
    if (name === "list-data-favorites")
      return {
        data: { favorites: [] },
        isPending: false,
        isError: false,
        refetch: actions.refetch,
      };
    if (name === "get-data-table-details") {
      const tableId = input.tableId?.split(":").at(-1) ?? "";
      return {
        data: {
          connectionId: input.connectionId,
          table: {
            projectId: "sample",
            datasetId: "PUBLIC",
            tableId,
            name: tableId,
            columns: [],
            columnCount: 0,
          },
        },
        isPending: false,
        isError: false,
      };
    }
    return { isPending: true, isError: false };
  },
}));
vi.mock("@agent-native/core/client/i18n", async () => {
  const { default: messages } = await import("@/i18n/en-US");
  return {
    useT: () => (key: string) => {
      const value: unknown = key
        .split(".")
        .reduce<unknown>(
          (current, part) =>
            typeof current === "object" && current !== null
              ? (current as Record<string, unknown>)[part]
              : undefined,
          messages,
        );
      if (typeof value !== "string")
        throw new Error(`Missing translation: ${key}`);
      return value;
    },
  };
});

import { DataTableDetail } from "./DataTableDetail";

it("keeps a new table's star independent while the previous table mutation is pending", async () => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  let finish: (() => void) | undefined;
  actions.mutate.mockReturnValue(
    new Promise<void>((resolve) => {
      finish = resolve;
    }),
  );
  actions.refetch.mockResolvedValue({});
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const client = new QueryClient();
  try {
    await act(async () =>
      root.render(
        <QueryClientProvider client={client}>
          <DataTableDetail
            connectionId="one"
            connectionName="Source"
            tableId="table:sample:PUBLIC:customers"
          />
        </QueryClientProvider>,
      ),
    );
    const first = container.querySelector<HTMLButtonElement>(
      '[aria-label="Add to favorites"]',
    );
    expect(first?.disabled).toBe(false);
    await act(async () => first?.click());
    expect(
      container
        .querySelector('[aria-label="Remove favorite"]')
        ?.getAttribute("aria-pressed"),
    ).toBe("true");
    await act(async () =>
      root.render(
        <QueryClientProvider client={client}>
          <DataTableDetail
            connectionId="two"
            connectionName="Source"
            tableId="table:sample:PUBLIC:products"
          />
        </QueryClientProvider>,
      ),
    );
    const second = container.querySelector<HTMLButtonElement>(
      '[aria-label="Add to favorites"]',
    );
    expect(second?.disabled).toBe(false);
    expect(second?.getAttribute("aria-pressed")).toBe("false");
    expect(actions.mutate).toHaveBeenCalledWith({
      connectionId: "one",
      tableId: "table:sample:PUBLIC:customers",
      favorited: true,
    });
    await act(async () => {
      finish?.();
    });
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
