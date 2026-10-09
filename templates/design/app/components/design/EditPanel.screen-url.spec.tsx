// @vitest-environment happy-dom

import {
  QueryClient,
  QueryClientProvider,
  useMutation,
} from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { EditPanel } from "./EditPanel";
import { useEditorScreenInspector } from "../../pages/design-editor/domains/use-editor-screen-inspector";

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

function renderUrlInspector(props: {
  onScreenUrlChange?: (screenId: string, url: string) => void;
  onScreenSourceChange?: (
    screenId: string,
    next: {
      sourceType: "static" | "url";
      url?: string;
      connectionId?: string;
    },
    onSettled?: () => void,
  ) => void;
  screenSourcePending?: boolean;
}) {
  act(() =>
    root.render(
      <EditPanel
        selectedElement={null}
        selectedScreenGeometry={{
          id: "screen-1",
          title: "Students",
          x: 0,
          y: 0,
          width: 1440,
          height: 900,
        }}
        selectedScreenSource={{
          sourceType: "url",
          url: "http://localhost:5173/students",
          connectionId: "localhost-1",
        }}
        viewMode="overview"
        mode="edit"
        onStyleChange={vi.fn()}
        readOnly={false}
        screenSourcePending={props.screenSourcePending}
        {...props}
      />,
    ),
  );
}

function screenInspectorDependencies(
  updateScreenSourceMutation: unknown,
): Parameters<typeof useEditorScreenInspector>[0] {
  return {
    editorCore: {
      id: "design-1",
      viewMode: "overview",
      selectedElement: null,
    },
    editorHistory: { overviewSelectedScreenIds: [] },
    editorGenerationAndAccess: {
      canEditDesign: true,
      canEditPublicLiveScreenUrl: false,
      updateScreenSourceMutation,
    },
    editorFilesAndSaving: {
      liveScreenSnapshotsById: {},
      runtimeLayerSnapshotsById: {},
      screenRootComputedStylesById: {},
      designDataJson: {},
      designSourceType: "inline",
      canvasFrameGeometryById: {},
      overviewScreens: [],
    },
    editorActiveScreenAndGeometry: {
      screenContentNaturalHeights: {},
      activeFile: null,
      activeScreenSnapshotOnly: false,
    },
    editorCanvasAndScreens: {
      activeContent: "",
      getScreenContent: vi.fn(() => ""),
      getProjectionContentForScreen: vi.fn(() => ""),
    },
    editorLiveEditsAndPresence: { selectedStateId: null },
    editorContentAndComponents: {},
    editorToolsAndVectors: { canvasBackgroundRef: { current: null } },
    editorSelectionAndStyles: {},
    editorClipboard: {},
    editorEditCommands: {},
    editorLayerModels: {
      selectedInspectorElements: [],
      selectedLayerTargets: [],
    },
  } as unknown as Parameters<typeof useEditorScreenInspector>[0];
}

it("lets a live-screen editor update only the URL", async () => {
  const onScreenUrlChange = vi.fn();
  renderUrlInspector({ onScreenUrlChange });

  const url = container.querySelector<HTMLInputElement>(
    'input[aria-label="editPanel.screenSource.urlLabel"]',
  );
  const update = Array.from(container.querySelectorAll("button")).find(
    (button) => button.textContent === "editPanel.screenSource.update",
  );
  expect(url?.disabled).toBe(false);
  expect(update?.disabled).toBe(false);

  await act(() => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(url, "http://localhost:5173/students?filter=active");
    url!.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(() => url!.blur());
  expect(onScreenUrlChange).not.toHaveBeenCalled();
  await act(() => update!.click());

  expect(onScreenUrlChange).toHaveBeenCalledTimes(1);
  expect(onScreenUrlChange).toHaveBeenCalledWith(
    "screen-1",
    "http://localhost:5173/students?filter=active",
  );
  const sourceTabs = Array.from(
    container.querySelectorAll('[role="tab"]'),
  ).filter((tab) =>
    ["editPanel.positionOptions.static", "editPanel.screenSource.url"].includes(
      tab.textContent ?? "",
    ),
  );
  expect(sourceTabs).toHaveLength(2);
  expect(sourceTabs.every((tab) => (tab as HTMLButtonElement).disabled)).toBe(
    true,
  );
});

it("dispatches one source transition for one tab selection", async () => {
  const onScreenSourceChange = vi.fn();
  renderUrlInspector({ onScreenSourceChange });

  const staticTab = Array.from(
    container.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
  ).find((tab) => tab.textContent === "editPanel.positionOptions.static");
  expect(staticTab).toBeDefined();

  await act(() => {
    staticTab!.dispatchEvent(
      new MouseEvent("mousedown", {
        bubbles: true,
        button: 0,
        ctrlKey: false,
      }),
    );
    staticTab!.focus();
  });

  expect(onScreenSourceChange).toHaveBeenCalledTimes(1);
  expect(onScreenSourceChange).toHaveBeenCalledWith(
    "screen-1",
    {
      sourceType: "static",
    },
    expect.any(Function),
  );

  renderUrlInspector({ onScreenSourceChange, screenSourcePending: true });
  renderUrlInspector({ onScreenSourceChange, screenSourcePending: false });
  const retryStaticTab = Array.from(
    container.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
  ).find((tab) => tab.textContent === "editPanel.positionOptions.static");
  await act(() => {
    retryStaticTab!.dispatchEvent(
      new MouseEvent("mousedown", {
        bubbles: true,
        button: 0,
        ctrlKey: false,
      }),
    );
    retryStaticTab!.focus();
  });
  expect(onScreenSourceChange).toHaveBeenCalledTimes(2);
});

it("allows retry when a source transition fails before pending renders", async () => {
  let settleTransition: (() => void) | undefined;
  const onScreenSourceChange = vi.fn(
    (
      _screenId: string,
      _next: {
        sourceType: "static" | "url";
        url?: string;
        connectionId?: string;
      },
      onSettled?: () => void,
    ) => {
      settleTransition = onSettled;
    },
  );
  const selectStaticTab = async () => {
    const staticTab = Array.from(
      container.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
    ).find((tab) => tab.textContent === "editPanel.positionOptions.static");
    expect(staticTab).toBeDefined();
    await act(() => {
      staticTab!.dispatchEvent(
        new MouseEvent("mousedown", {
          bubbles: true,
          button: 0,
          ctrlKey: false,
        }),
      );
      staticTab!.focus();
    });
  };

  renderUrlInspector({ onScreenSourceChange, screenSourcePending: false });
  await selectStaticTab();
  expect(onScreenSourceChange).toHaveBeenCalledTimes(1);

  act(() => settleTransition?.());
  await selectStaticTab();
  expect(onScreenSourceChange).toHaveBeenCalledTimes(2);
});

it("releases the transition guard when the source mutation rejects", async () => {
  let attempts = 0;
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  });

  function HookBackedUrlInspector() {
    const updateScreenSourceMutation = useMutation({
      mutationFn: async () => {
        attempts += 1;
        throw new Error("source update failed");
      },
      retry: false,
    });
    const { handleScreenSourceChange } = useEditorScreenInspector(
      screenInspectorDependencies(updateScreenSourceMutation),
    );

    return (
      <EditPanel
        selectedElement={null}
        selectedScreenGeometry={{
          id: "screen-1",
          title: "Students",
          x: 0,
          y: 0,
          width: 1440,
          height: 900,
        }}
        selectedScreenSource={{
          sourceType: "url",
          url: "http://localhost:5173/students",
          connectionId: "localhost-1",
        }}
        viewMode="overview"
        mode="edit"
        onStyleChange={vi.fn()}
        onScreenSourceChange={handleScreenSourceChange}
        readOnly={false}
        screenSourcePending={false}
      />
    );
  }

  await act(() =>
    root.render(
      <QueryClientProvider client={queryClient}>
        <HookBackedUrlInspector />
      </QueryClientProvider>,
    ),
  );

  const selectStaticTab = async () => {
    const staticTab = Array.from(
      container.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
    ).find((tab) => tab.textContent === "editPanel.positionOptions.static");
    expect(staticTab).toBeDefined();
    await act(async () => {
      staticTab!.dispatchEvent(
        new MouseEvent("mousedown", {
          bubbles: true,
          button: 0,
          ctrlKey: false,
        }),
      );
      staticTab!.focus();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  };

  await selectStaticTab();
  expect(attempts).toBe(1);
  await selectStaticTab();
  expect(attempts).toBe(2);

  queryClient.clear();
});

it("keeps live URL controls disabled without the URL permission", () => {
  renderUrlInspector({});
  expect(
    container.querySelector<HTMLInputElement>(
      'input[aria-label="editPanel.screenSource.urlLabel"]',
    )?.disabled,
  ).toBe(true);
  expect(
    Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "editPanel.screenSource.update",
    )?.disabled,
  ).toBe(true);
});
