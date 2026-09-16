// @vitest-environment happy-dom
import type { ReactNode } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const mocks = vi.hoisted(() => ({
  calls: [] as Array<{
    name: string;
    options?: { enabled?: boolean };
  }>,
  fetches: 0,
  refetch: vi.fn(),
  mutations: [] as Array<{
    name: string;
    options?: { onSettled?: () => void };
  }>,
  triggerVariantCommit: false,
}));

const detailsData = {
  name: "Button",
  sourceType: "inline",
  observedProps: [{ name: "variant", value: "solid" }],
  persistedVariants: { variant: ["solid", "outline"] },
  sourceLocation: null,
  instance: { alpineData: "{}", nodeId: "node_1" },
  capabilities: {
    canResolveToFile: false,
    hasFullIndex: false,
    canEditProps: true,
    ctaRequired: false,
  },
};

vi.mock("@agent-native/core/client/hooks", () => ({
  useActionQuery: (
    name: string,
    _params: unknown,
    options?: { enabled?: boolean },
  ) => {
    mocks.calls.push({ name, options });
    if (name !== "get-component-details") {
      return { data: undefined, isLoading: false, error: null };
    }
    if (options?.enabled === false) {
      return {
        data: undefined,
        isLoading: false,
        error: null,
        refetch: mocks.refetch,
      };
    }
    mocks.fetches += 1;
    return {
      data: detailsData,
      isLoading: false,
      error: null,
      refetch: mocks.refetch,
    };
  },
  useActionMutation: (name: string) => ({
    mutate: (_args: unknown, options?: { onSettled?: () => void }) => {
      mocks.mutations.push({ name, options });
    },
    isPending: false,
  }),
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ setQueryData: vi.fn(), invalidateQueries: vi.fn() }),
}));

vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children?: ReactNode }) => children,
  TooltipTrigger: ({ children }: { children?: ReactNode }) => children,
  TooltipContent: () => null,
  TooltipProvider: ({ children }: { children?: ReactNode }) => children,
}));
vi.mock("@/components/ui/button", () => ({
  Button: ({ children }: { children?: ReactNode }) => children,
}));
vi.mock("@/components/ui/label", () => ({
  Label: ({ children }: { children?: ReactNode }) => children,
}));
vi.mock("@/components/ui/input", () => ({ Input: () => null }));
vi.mock("@/components/ui/switch", () => ({ Switch: () => null }));
vi.mock("@/components/ui/select", () => ({
  Select: ({
    children,
    onValueChange,
  }: {
    children?: ReactNode;
    onValueChange?: (value: string) => void;
  }) => {
    if (mocks.triggerVariantCommit) {
      mocks.triggerVariantCommit = false;
      onValueChange?.("outline");
    }
    return children;
  },
  SelectContent: ({ children }: { children?: ReactNode }) => children,
  SelectItem: ({ children }: { children?: ReactNode }) => children,
  SelectTrigger: ({ children }: { children?: ReactNode }) => children,
  SelectValue: () => null,
}));
vi.mock("@/components/ui/popover", () => ({
  Popover: ({ children }: { children?: ReactNode }) => children,
  PopoverContent: ({ children }: { children?: ReactNode }) => children,
  PopoverTrigger: ({ children }: { children?: ReactNode }) => children,
}));

import { ComponentSection } from "./component-section";

async function mount(): Promise<{
  container: HTMLDivElement;
  root: Root;
}> {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  return { container, root };
}

describe("ComponentSection source readiness", () => {
  beforeEach(() => {
    mocks.calls.length = 0;
    mocks.fetches = 0;
    mocks.refetch.mockClear();
    mocks.mutations.length = 0;
    mocks.triggerVariantCommit = false;
  });

  it("holds the metadata read during optimistic selection, then fetches when accepted", async () => {
    const { container, root } = await mount();
    const props = {
      designId: "design_1",
      fileId: "screen_1",
      nodeId: "node_1",
    };
    const iframe = document.createElement("iframe");
    iframe.setAttribute("data-design-preview-iframe", "");
    document.body.append(iframe);
    const notifySelected = () =>
      window.dispatchEvent(
        new MessageEvent("message", {
          data: { type: "element-select" },
          source: iframe.contentWindow,
        }),
      );

    await act(async () =>
      root.render(
        <ComponentSection {...props} componentDetailsReady={false} />,
      ),
    );

    expect(
      mocks.calls.find((call) => call.name === "get-component-details")?.options
        ?.enabled,
    ).toBe(false);
    expect(mocks.fetches).toBe(0);
    expect(container.querySelector("section")).not.toBeNull();
    notifySelected();
    expect(mocks.refetch).not.toHaveBeenCalled();

    await act(async () =>
      root.render(<ComponentSection {...props} componentDetailsReady />),
    );

    expect(mocks.fetches).toBe(1);
    expect(container.textContent).toContain("Button");
    notifySelected();
    expect(mocks.refetch).toHaveBeenCalledOnce();
    await act(async () => root.unmount());
    iframe.remove();
    container.remove();
  });

  it("keeps the metadata query enabled when callers omit inline readiness", async () => {
    const { container, root } = await mount();

    await act(async () =>
      root.render(<ComponentSection designId="design_1" nodeId="node_1" />),
    );

    expect(
      mocks.calls.find((call) => call.name === "get-component-details")?.options
        ?.enabled,
    ).toBe(true);
    expect(mocks.fetches).toBe(1);
    await act(async () => root.unmount());
    container.remove();
  });

  it("does not refetch a completed edit into a newly pending selection", async () => {
    const { container, root } = await mount();
    const props = { designId: "design_1", fileId: "screen_1" };
    mocks.triggerVariantCommit = true;

    await act(async () =>
      root.render(
        <ComponentSection {...props} nodeId="node_1" componentDetailsReady />,
      ),
    );

    const mutation = mocks.mutations.find(
      (call) => call.name === "apply-component-prop-edit",
    );
    expect(mutation?.options?.onSettled).toBeTypeOf("function");
    expect(mocks.refetch).not.toHaveBeenCalled();

    await act(async () =>
      root.render(
        <ComponentSection
          {...props}
          nodeId="node_2"
          componentDetailsReady={false}
        />,
      ),
    );
    await act(async () => mutation?.options?.onSettled?.());

    expect(mocks.refetch).not.toHaveBeenCalled();
    expect(container.querySelector("section")).not.toBeNull();
    await act(async () => root.unmount());
    container.remove();
  });
});
