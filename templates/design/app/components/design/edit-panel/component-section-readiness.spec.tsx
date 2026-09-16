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
  isMain: false,
  canRestore: false,
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
  Button: ({
    children,
    "aria-label": label,
    disabled,
    onClick,
  }: {
    children?: ReactNode;
    "aria-label"?: string;
    disabled?: boolean;
    onClick?: () => void;
  }) => (
    <button aria-label={label} disabled={disabled} onClick={onClick}>
      {children}
    </button>
  ),
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
    detailsData.isMain = false;
    detailsData.canRestore = false;
  });

  it("shows instance operations only for instances", async () => {
    const { container, root } = await mount();
    const render = () =>
      root.render(<ComponentSection designId="design_1" nodeId="node_1" />);
    await act(async () => render());
    expect(
      container.querySelector(
        '[aria-label="designEditor.componentInstances.swap"]',
      ),
    ).not.toBeNull();
    detailsData.isMain = true;
    await act(async () => render());
    for (const operation of ["goToMain", "swap", "detach"]) {
      expect(
        container.querySelector(
          `[aria-label="designEditor.componentInstances.${operation}"]`,
        ),
      ).toBeNull();
    }
    await act(async () => root.unmount());
    container.remove();
  });

  it("shows Restore component and keeps the other instance operations", async () => {
    const { container, root } = await mount();
    const onRestoreComponent = vi.fn();
    detailsData.canRestore = true;
    await act(async () =>
      root.render(
        <ComponentSection
          designId="design_1"
          nodeId="node_1"
          onRestoreComponent={onRestoreComponent}
        />,
      ),
    );

    const restoreButton = container.querySelector<HTMLButtonElement>(
      '[aria-label="designEditor.componentInstances.restore"]',
    );
    expect(restoreButton).not.toBeNull();
    expect(
      container.querySelector(
        '[aria-label="designEditor.componentInstances.goToMain"]',
      ),
    ).toBeNull();
    expect(
      container.querySelector(
        '[aria-label="designEditor.componentInstances.swap"]',
      ),
    ).not.toBeNull();
    expect(
      container.querySelector(
        '[aria-label="designEditor.componentInstances.detach"]',
      ),
    ).not.toBeNull();
    restoreButton?.click();
    expect(onRestoreComponent).toHaveBeenCalledOnce();

    await act(async () => root.unmount());
    container.remove();
  });

  it("prefers the replayed source archive over stale component details", async () => {
    const { container, root } = await mount();
    const onRestoreComponent = vi.fn();
    const archive = encodeURIComponent(
      JSON.stringify({
        schemaVersion: 1,
        versionId: "version_1",
        fileId: "screen_1",
        componentId: "component_1",
        mainNodeId: "main_1",
        sourceVersionHash: "hash_1",
      }),
    );
    detailsData.canRestore = false;

    await act(async () =>
      root.render(
        <ComponentSection
          designId="design_1"
          fileId="screen_1"
          nodeId="node_1"
          activeContent={`<button data-agent-native-component="Button" data-agent-native-node-id="node_1" data-agent-native-component-ref="component_1" data-agent-native-component-archive="${archive}"></button>`}
          onRestoreComponent={onRestoreComponent}
        />,
      ),
    );

    expect(
      container.querySelector(
        '[aria-label="designEditor.componentInstances.restore"]',
      ),
    ).not.toBeNull();
    expect(
      container.querySelector(
        '[aria-label="designEditor.componentInstances.goToMain"]',
      ),
    ).toBeNull();

    detailsData.canRestore = true;
    await act(async () =>
      root.render(
        <ComponentSection
          designId="design_1"
          fileId="screen_1"
          nodeId="node_1"
          activeContent='<button data-agent-native-component="Button" data-agent-native-node-id="node_1" data-agent-native-component-ref="component_1"></button>'
          onRestoreComponent={onRestoreComponent}
        />,
      ),
    );

    expect(
      container.querySelector(
        '[aria-label="designEditor.componentInstances.goToMain"]',
      ),
    ).not.toBeNull();

    await act(async () => root.unmount());
    container.remove();
  });

  it("does not restore from a malformed replay archive", async () => {
    const { container, root } = await mount();
    detailsData.canRestore = true;
    await act(async () =>
      root.render(
        <ComponentSection
          designId="design_1"
          fileId="screen_1"
          nodeId="node_1"
          activeContent='<button data-agent-native-component="Button" data-agent-native-node-id="node_1" data-agent-native-component-ref="component_1" data-agent-native-component-archive="%7B%7D"></button>'
        />,
      ),
    );

    expect(
      container.querySelector(
        '[aria-label="designEditor.componentInstances.restore"]',
      ),
    ).toBeNull();
    expect(
      container.querySelector(
        '[aria-label="designEditor.componentInstances.goToMain"]',
      ),
    ).not.toBeNull();

    await act(async () => root.unmount());
    container.remove();
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

  it("previews a prop in the selected screen iframe when siblings are mounted", async () => {
    const { container, root } = await mount();
    const firstScreenIframe = document.createElement("iframe");
    firstScreenIframe.dataset.designPreviewIframe = "";
    firstScreenIframe.dataset.screenIframeId = "screen_1";
    const selectedScreenIframe = document.createElement("iframe");
    selectedScreenIframe.dataset.designPreviewIframe = "";
    selectedScreenIframe.dataset.screenIframeId = "screen_2";
    document.body.append(firstScreenIframe, selectedScreenIframe);
    const firstPostMessage = vi.spyOn(
      firstScreenIframe.contentWindow!,
      "postMessage",
    );
    const selectedPostMessage = vi.spyOn(
      selectedScreenIframe.contentWindow!,
      "postMessage",
    );
    mocks.triggerVariantCommit = true;

    await act(async () =>
      root.render(
        <ComponentSection
          designId="design_1"
          fileId="screen_2"
          nodeId="node_1"
          componentDetailsReady
        />,
      ),
    );

    expect(firstPostMessage).not.toHaveBeenCalled();
    expect(selectedPostMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "style-change",
        attributeOverrides: { "data-agent-native-prop-variant": "outline" },
      }),
      "*",
    );

    await act(async () => root.unmount());
    firstScreenIframe.remove();
    selectedScreenIframe.remove();
    container.remove();
  });

  it("previews a prop in the Board iframe without touching a Screen sibling", async () => {
    const { container, root } = await mount();
    const screenIframe = document.createElement("iframe");
    screenIframe.dataset.designPreviewIframe = "";
    screenIframe.dataset.screenIframeId = "screen_1";
    const boardLayer = document.createElement("div");
    boardLayer.dataset.boardSurfaceLayer = "";
    const boardIframe = document.createElement("iframe");
    boardIframe.dataset.designPreviewIframe = "";
    boardLayer.append(boardIframe);
    document.body.append(screenIframe, boardLayer);
    const screenPostMessage = vi.spyOn(
      screenIframe.contentWindow!,
      "postMessage",
    );
    const boardPostMessage = vi.spyOn(
      boardIframe.contentWindow!,
      "postMessage",
    );
    mocks.triggerVariantCommit = true;

    await act(async () =>
      root.render(
        <ComponentSection
          designId="design_1"
          fileId="board_1"
          boardFileId="board_1"
          nodeId="node_1"
          componentDetailsReady
        />,
      ),
    );

    expect(screenPostMessage).not.toHaveBeenCalled();
    expect(boardPostMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "style-change" }),
      "*",
    );

    await act(async () => root.unmount());
    screenIframe.remove();
    boardLayer.remove();
    container.remove();
  });

  it("previews a prop in the selected breakpoint iframe", async () => {
    const { container, root } = await mount();
    const primaryIframe = document.createElement("iframe");
    primaryIframe.dataset.designPreviewIframe = "";
    primaryIframe.dataset.screenIframeId = "screen_2";
    const breakpointIframe = document.createElement("iframe");
    breakpointIframe.dataset.designPreviewIframe = "";
    breakpointIframe.dataset.screenIframeId = "screen_2::bp-390";
    document.body.append(primaryIframe, breakpointIframe);
    const primaryPostMessage = vi.spyOn(
      primaryIframe.contentWindow!,
      "postMessage",
    );
    const breakpointPostMessage = vi.spyOn(
      breakpointIframe.contentWindow!,
      "postMessage",
    );
    mocks.triggerVariantCommit = true;

    await act(async () =>
      root.render(
        <ComponentSection
          designId="design_1"
          fileId="screen_2"
          previewFrameId="screen_2::bp-390"
          nodeId="node_1"
          componentDetailsReady
        />,
      ),
    );

    expect(primaryPostMessage).not.toHaveBeenCalled();
    expect(breakpointPostMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "style-change" }),
      "*",
    );

    await act(async () => root.unmount());
    primaryIframe.remove();
    breakpointIframe.remove();
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
