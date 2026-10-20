// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  queries: [] as Array<{
    name: string;
    params: unknown;
    enabled: boolean | undefined;
  }>,
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

vi.mock("@agent-native/core/client/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/client/hooks")>()),
  callAction: (name: string) => {
    throw new Error(`unexpected callAction: ${name}`);
  },
  useActionMutation: () => ({ mutate: vi.fn(), mutateAsync: vi.fn() }),
  useActionQuery: (
    name: string,
    params: unknown,
    options?: { enabled?: boolean },
  ) => {
    mocks.queries.push({ name, params, enabled: options?.enabled });
    return {
      data: undefined,
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    };
  },
}));

vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children?: unknown }) => children as never,
  TooltipTrigger: ({ children }: { children?: unknown }) => children as never,
  TooltipContent: () => null,
  TooltipProvider: ({ children }: { children?: unknown }) => children as never,
}));

import { EditPanel } from "./EditPanel";
import type { ElementInfo } from "./types";

const DELETED_SCREEN_ID = "about-screen";
const rectangle: ElementInfo = {
  tagName: "div",
  sourceId: "rect-1",
  selector: '[data-agent-native-node-id="rect-1"]',
  sourceLayerIdentity: { screenId: DELETED_SCREEN_ID, nodeId: "rect-1" },
  classes: [],
  computedStyles: { backgroundColor: "rgb(217, 217, 217)" },
  inlineStyles: { backgroundColor: "#d9d9d9" },
  boundingRect: { x: 0, y: 0, width: 100, height: 100 },
  isFlexChild: false,
  isFlexContainer: false,
  childElementCount: 0,
};

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  mocks.queries.length = 0;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("EditPanel — a selected screen deleted outside the editor", () => {
  it("does not read the deleted screen's source for its shader panel", async () => {
    await act(async () =>
      root.render(
        <QueryClientProvider client={new QueryClient()}>
          <EditPanel
            selectedElement={rectangle}
            viewMode="overview"
            mode="edit"
            designId="design_1"
            fileId={DELETED_SCREEN_ID}
            activeContent={undefined}
            files={[{ id: "home-screen", content: "<body></body>" }]}
            onStyleChange={vi.fn()}
          />
        </QueryClientProvider>,
      ),
    );

    expect(
      mocks.queries.filter(
        (query) =>
          query.name === "read-source-file" &&
          query.enabled !== false &&
          (query.params as { fileId?: string }).fileId === DELETED_SCREEN_ID,
      ),
    ).toEqual([]);
  });
});
