// @vitest-environment happy-dom
import { act } from "react";
import { createPortal } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from "vitest";

const mocks = vi.hoisted(() => ({
  queries: [] as Record<string, unknown>[],
  systems: [
    { id: "system-one", title: "First system" },
    { id: "system-two", title: "Second system" },
  ],
  empty: false,
  loading: false,
  error: null as Error | null,
  refetch: vi.fn(),
}));
vi.mock("@agent-native/core/client/hooks", () => ({
  actionErrorMessage: (error: unknown) =>
    error instanceof Error ? error.message : undefined,
  useActionQuery: (
    name: string,
    args: Record<string, unknown>,
    options: { enabled: boolean },
  ) => {
    if (options.enabled) mocks.queries.push({ name, ...args });
    return {
      data:
        name === "list-design-systems"
          ? { designSystems: mocks.systems }
          : {
              items: mocks.empty
                ? []
                : [
                    {
                      id: `source-${String(args.page)}`,
                      title: "Repeated title",
                    },
                  ],
              hasMore: !mocks.empty && args.page === 1,
              nextCursor: "page-two",
            },
      isLoading: mocks.loading,
      isFetching: mocks.loading,
      error: mocks.error,
      refetch: mocks.refetch,
    };
  },
}));
vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));
vi.mock("@agent-native/core/client/agent-chat", () => ({
  useDesignSystemWorkspaceOrigin: () => vi.fn(),
}));
vi.mock("@/pages/DesignSystemSetup", () => ({
  default: ({
    open,
    onReturnToPrompt,
    onContinueInChat,
  }: {
    open: boolean;
    onReturnToPrompt: () => void;
    onContinueInChat: () => void;
  }) =>
    open ? (
      <>
        <h2>Create design system</h2>
        <button
          type="button"
          aria-label="composerContext.back"
          onClick={onReturnToPrompt}
        >
          Back
        </button>
        <button type="button" onClick={onReturnToPrompt}>
          Finish setup
        </button>
        <button type="button" onClick={onContinueInChat}>
          Continue in chat
        </button>
      </>
    ) : null,
}));

import { DesignContextPage, DesignContextPicker } from "./DesignContextPicker";
import type { DesignPromptContextController } from "./use-design-prompt-context";

let root: Root;
let container: HTMLDivElement;
let controller: DesignPromptContextController;
let controls: Record<"onBack" | "onClose" | "onResume", Mock<() => void>>;
const button = (text: string) =>
  Array.from(
    document.querySelectorAll<HTMLElement>("button, [cmdk-item]"),
  ).find((item) => item.textContent === text)!;
const row = (value: string) =>
  document.querySelector<HTMLElement>(`[cmdk-item][data-value="${value}"]`)!;
const setInput = async (input: HTMLInputElement, value: string) =>
  act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(HTMLElement.prototype, "scrollIntoView").mockImplementation(
    () => {},
  );
  mocks.queries = [];
  mocks.empty = false;
  mocks.loading = false;
  mocks.error = null;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  controller = {
    draftId: "qa-draft",
    systemReference: null,
    contextItems: [],
    contextMenuItems: [],
    view: "systems",
    setView: vi.fn(),
    inspected: null,
    selectedSystemId: "system-two",
    attach: vi.fn(),
    selectSource: vi.fn(),
    changeSystem: vi.fn(),
    createSystem: vi.fn(),
    resumePicker: vi.fn(),
    flush: vi.fn(),
    onRemoveContextItem: vi.fn(),
    onInspectContextItem: vi.fn(),
    onRetryContextItem: vi.fn(),
  };
  controls = { onBack: vi.fn(), onClose: vi.fn(), onResume: vi.fn() };
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Design inline context picker", () => {
  it("keeps one creation title and Back, but closes without resuming the picker for chat", async () => {
    await act(async () =>
      root.render(
        <DesignContextPicker controller={{ ...controller, view: "create" }} />,
      ),
    );
    expect(document.querySelectorAll('h1,h2,h3,[role="heading"]')).toHaveLength(
      1,
    );
    const back = document.querySelector<HTMLButtonElement>(
      '[aria-label="composerContext.back"]',
    )!;
    await act(async () => back.click());
    expect(controller.resumePicker).toHaveBeenCalledOnce();
    vi.mocked(controller.resumePicker).mockClear();
    await act(async () => button("Continue in chat").click());
    expect(controller.setView).toHaveBeenCalledWith(null);
    expect(controller.resumePicker).not.toHaveBeenCalled();
  });
  it("uses an inline command list with a trailing chosen check, separate from active highlight", async () => {
    await act(async () =>
      root.render(
        <>
          <DesignContextPage
            page="systems"
            controller={controller}
            controls={controls}
          />
          <DesignContextPicker controller={controller} />
        </>,
      ),
    );
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(row("system-two").querySelector("svg")).not.toBeNull();
    expect(row("system-one").querySelector("svg")).toBeNull();
    expect(row("no-system").getAttribute("aria-selected")).toBe("true");
    expect(row("system-two").getAttribute("aria-selected")).toBe("false");
    expect(row("create-system").closest("[cmdk-group]")).not.toBeNull();
    expect(document.querySelector("[cmdk-separator]")).not.toBeNull();
    expect(mocks.queries).toContainEqual({
      name: "list-design-systems",
      compact: "true",
    });
    await act(async () => row("system-one").click());
    expect(controller.changeSystem).toHaveBeenCalledWith("system-one");
    expect(controls.onClose).toHaveBeenCalledOnce();
  });

  it("keeps explicit none selectable and opens creation from a command row", async () => {
    vi.mocked(controller.createSystem).mockImplementation((next) =>
      next.onClose(),
    );
    await act(async () =>
      root.render(
        <DesignContextPage
          page="systems"
          controller={{ ...controller, selectedSystemId: null }}
          controls={controls}
        />,
      ),
    );
    expect(row("no-system").querySelector("svg")).not.toBeNull();
    await act(async () => row("no-system").click());
    expect(controller.changeSystem).toHaveBeenCalledWith(null);
    vi.mocked(controls.onClose).mockClear();
    await act(async () => row("create-system").click());
    expect(controller.createSystem).toHaveBeenCalledWith({
      ...controls,
      onClose: expect.any(Function),
    });
    expect(controls.onClose).toHaveBeenCalledExactlyOnceWith({
      restoreFocus: false,
    });
  });

  it("keeps Create system available when no system matches the search", async () => {
    await act(async () =>
      root.render(
        <DesignContextPage
          page="systems"
          controller={controller}
          controls={controls}
        />,
      ),
    );
    await setInput(
      container.querySelector("input")!,
      "nothing matches this query",
    );
    expect(row("system-one")).toBeNull();
    expect(row("create-system")).not.toBeNull();
    expect(row("create-system").closest("[hidden]")).toBeNull();
    await act(async () => row("create-system").click());
    expect(controller.createSystem).toHaveBeenCalledWith({
      ...controls,
      onClose: expect.any(Function),
    });
  });

  it("paginates repeated titles and selects the exact source immediately without an Attach footer", async () => {
    await act(async () =>
      root.render(
        <DesignContextPage
          page="design"
          controller={controller}
          controls={controls}
        />,
      ),
    );
    await act(async () => button("home.paginationNext").click());
    expect(mocks.queries).toContainEqual(
      expect.objectContaining({ page: 2, cursor: "page-two" }),
    );
    await act(async () => row("source-2").click());
    expect(controller.selectSource).toHaveBeenCalledWith({
      source: "design",
      id: "source-2",
      title: "Repeated title",
    });
    expect(controls.onClose).toHaveBeenCalledOnce();
    expect(button("composerContext.attach")).toBeUndefined();
    await act(async () => button("home.paginationPrevious").click());
    expect(mocks.queries[mocks.queries.length - 1]).toMatchObject({
      page: 1,
      cursor: undefined,
    });
  });

  it("shows a small empty result without a disabled submit action", async () => {
    mocks.empty = true;
    await act(async () =>
      root.render(
        <DesignContextPage
          page="design"
          controller={controller}
          controls={controls}
        />,
      ),
    );
    expect(container.textContent).toContain("composerContext.noResults");
    expect(container.querySelector("button[disabled]")).toBeNull();
    expect(container.querySelector("[cmdk-input]")).not.toBeNull();
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it("keeps the search header through loading and error with a working retry", async () => {
    mocks.loading = true;
    await act(async () =>
      root.render(
        <DesignContextPage
          page="design"
          controller={controller}
          controls={controls}
        />,
      ),
    );
    expect(container.querySelector('[role="status"]')).not.toBeNull();
    const search = container.querySelector("input");
    mocks.loading = false;
    mocks.error = new Error("Read denied");
    await act(async () =>
      root.render(
        <DesignContextPage
          page="design"
          controller={controller}
          controls={controls}
        />,
      ),
    );
    expect(container.querySelector("input")).toBe(search);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "Read denied",
    );
    await act(async () => button("composerContext.retry").click());
    expect(mocks.refetch).toHaveBeenCalled();
  });

  it("validates Figma before loading and never bubbles Browse/Enter to a parent composer form", async () => {
    const submitPrompt = vi.fn();
    const portal = document.createElement("div");
    document.body.append(portal);
    try {
      await act(async () =>
        root.render(
          <form onSubmit={submitPrompt}>
            {createPortal(
              <DesignContextPage
                page="figma"
                controller={controller}
                controls={controls}
              />,
              portal,
            )}
          </form>,
        ),
      );
      expect(portal.querySelectorAll("input")).toHaveLength(1);
      expect(portal.querySelectorAll("[cmdk-item]")).toHaveLength(1);
      expect(portal.textContent).not.toContain("composerContext.noResults");
      await act(async () => button("composerContext.browseFrames").click());
      expect(portal.querySelector('[role="alert"]')?.textContent).toContain(
        "composerContext.invalidFigmaUrl",
      );
      expect(mocks.queries.some((query) => query.source === "figma")).toBe(
        false,
      );
      expect(submitPrompt).not.toHaveBeenCalled();
      await setInput(
        portal.querySelector("input")!,
        "https://www.figma.com/design/exampleFile/Test",
      );
      const event = new Event("submit", { bubbles: true, cancelable: true });
      await act(async () => {
        portal.querySelector("form")!.dispatchEvent(event);
      });
      expect(event.defaultPrevented).toBe(true);
      expect(submitPrompt).not.toHaveBeenCalled();
      expect(mocks.queries).toContainEqual(
        expect.objectContaining({
          source: "figma",
          figmaUrl: "https://www.figma.com/design/exampleFile/Test",
        }),
      );
      expect(portal.querySelector("[cmdk-input]")).not.toBeNull();
      await act(async () =>
        portal
          .querySelector<HTMLButtonElement>("[cmdk-input-wrapper] button")!
          .click(),
      );
      const urlInput = portal.querySelector<HTMLInputElement>("input")!;
      expect(urlInput.value).toBe(
        "https://www.figma.com/design/exampleFile/Test",
      );
      const enter = new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        cancelable: true,
      });
      await act(async () => urlInput.dispatchEvent(enter));
      expect(enter.defaultPrevented).toBe(true);
      expect(submitPrompt).not.toHaveBeenCalled();
    } finally {
      portal.remove();
    }
  });
});
