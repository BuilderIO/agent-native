import type { PromptComposerProps } from "@agent-native/core/client/composer";
import type {
  ComposerContextMenuAction,
  ComposerContextPageControls,
} from "@agent-native/toolkit/composer";
// @vitest-environment happy-dom
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import { createPortal } from "react-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SlidesComposerContext } from "../../../shared/composer-context";

const mocks = vi.hoisted(() => ({
  callAction: vi.fn(),
  refetch: vi.fn(async () => ({})),
  defaults: {} as Record<string, unknown>,
  sourceList: { items: [] } as {
    items: Array<{ id: string; title: string }>;
    hasMore?: boolean;
    nextCursor?: string;
  },
  systems: [] as Array<{ id: string; title: string }>,
  listError: null as Error | null,
  listFetching: false,
  queryArgs: [] as Array<{ name: string; args: Record<string, unknown> }>,
  decks: {} as Record<
    string,
    {
      composerContext?: SlidesComposerContext;
      generationContext?: Record<string, unknown>;
    }
  >,
  t: (key: string) => key,
  session: { id: "test-user" },
  composerProps: null as PromptComposerProps | null,
}));
vi.mock("@agent-native/core/client/hooks", () => ({
  callAction: mocks.callAction,
  actionErrorMessage: (error: unknown) =>
    error instanceof Error ? error.message : undefined,
  useSession: () => ({ session: mocks.session }),
  useActionQuery: (name: string, args: { id?: string } = {}) => {
    mocks.queryArgs.push({ name, args });
    return {
      data:
        name === "get-deck"
          ? mocks.decks[args?.id ?? ""]
          : name === "get-workspace-defaults"
            ? mocks.defaults
            : name === "list-design-systems"
              ? { designSystems: mocks.systems }
              : mocks.sourceList,
      refetch: mocks.refetch,
      isFetching:
        ["list-design-systems", "read-composer-source"].includes(name) &&
        mocks.listFetching,
      error: ["list-design-systems", "read-composer-source"].includes(name)
        ? mocks.listError
        : null,
    };
  },
}));
vi.mock("@agent-native/core/client/i18n", () => ({ useT: () => mocks.t }));
vi.mock("@agent-native/core/client/agent-chat", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@agent-native/core/client/agent-chat")
  >()),
  useDesignSystemWorkspaceOrigin: () => vi.fn(),
}));
vi.mock("@agent-native/core/client/composer", () => ({
  PromptComposer: (props: PromptComposerProps) => {
    mocks.composerProps = props;
    return null;
  },
}));
vi.mock("@/components/design-system/DesignSystemSetup", () => ({
  DesignSystemSetup: ({
    open,
    onClose,
    onComplete,
    onStartChat,
    preserveWorkspaceDefaults,
  }: {
    open: boolean;
    onClose: () => void;
    onComplete: () => void;
    onStartChat: () => void;
    preserveWorkspaceDefaults?: boolean;
  }) =>
    open ? (
      <div
        data-testid="system-setup"
        data-preserve-defaults={String(preserveWorkspaceDefaults)}
      >
        <button onClick={onClose}>cancel-setup</button>
        <button onClick={onComplete}>finish-setup</button>
        <button onClick={onStartChat}>start-chat</button>
      </div>
    ) : null,
}));

import {
  SlidesPromptComposer,
  useSlidesComposerContext,
} from "./SlidesComposerContext";

const ref = { source: "slides" as const, id: "source", title: "Layout deck" };
type Context = ReturnType<typeof useSlidesComposerContext>;
function pickerAction(context: Context, id: string): ComposerContextMenuAction {
  const action = context.props.contextMenuItems
    .flatMap((category) => category.children ?? [])
    .find((item) => item.id === id);
  if (!action || action.children || !action.render)
    throw new Error(`Missing picker: ${id}`);
  return action;
}
function pickerControls(context: () => Context, id: string) {
  return {
    onBack: vi.fn(() => pickerAction(context(), id).onDismiss?.()),
    onClose: vi.fn(() => pickerAction(context(), id).onDismiss?.()),
    onResume: vi.fn(),
  } satisfies ComposerContextPageControls;
}
function pickerPage(
  context: Context,
  id: string,
  controls: ComposerContextPageControls,
) {
  return (
    <>
      {pickerAction(context, id).render?.(controls)}
      {context.dialogs}
    </>
  );
}
beforeEach(() => {
  localStorage.clear();
  mocks.callAction.mockReset();
  mocks.refetch.mockClear();
  mocks.defaults = {};
  mocks.sourceList = { items: [] };
  mocks.systems = [];
  mocks.listError = null;
  mocks.listFetching = false;
  mocks.queryArgs = [];
  mocks.decks = {};
  mocks.composerProps = null;
  mocks.callAction.mockImplementation(async (name: string, args: any) => {
    if (name === "get-design-system")
      return {
        title: "Brand",
        agentContext: "Brand tokens",
        data: JSON.stringify({ typography: { bodyFont: "Inter" } }),
      };
    if (name === "read-composer-source")
      return { id: args.id, title: "Layout deck", context: "Reference grid" };
    if (name === "get-deck") return mocks.decks[args.id] ?? {};
    if (name === "patch-deck") {
      mocks.decks[args.deckId] = {
        ...mocks.decks[args.deckId],
        ...args.operations[0].fields,
      };
      return { id: args.deckId };
    }
    throw new Error(`Unexpected action: ${name}`);
  });
});
afterEach(cleanup);

describe("Slides composer adapter", () => {
  it("uses icons for source menus and an inline system list with selected checks and explicit none", async () => {
    mocks.defaults = { designSystem: { id: "brand" } };
    mocks.systems = [{ id: "brand", title: "Brand" }];
    const { result } = renderHook(() => useSlidesComposerContext());
    await waitFor(() =>
      expect(result.current.props.contextItems[0]?.status).toBe("ready"),
    );
    for (const category of result.current.props.contextMenuItems) {
      expect(category.icon).toBeTruthy();
      for (const item of category.children ?? [])
        expect(item.icon).toBeTruthy();
    }
    act(() => {
      void pickerAction(result.current, "system").onSelect();
    });
    const controls = pickerControls(() => result.current, "system");
    render(pickerPage(result.current, "system", controls));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(
      screen
        .getByRole("option", { name: "Brand" })
        .getAttribute("data-checked"),
    ).toBe("true");
    expect(
      screen
        .getByRole("option", { name: "home.none" })
        .getAttribute("data-checked"),
    ).toBe("false");
    expect(
      screen.getByRole("option", { name: "promptContext.createNew" }),
    ).toBeTruthy();
    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(
      screen.getByRole("button", { name: "Back" }).getAttribute("type"),
    ).toBe("button");
    fireEvent.click(screen.getByRole("option", { name: "home.none" }));
    expect(controls.onClose).toHaveBeenCalledOnce();
    await waitFor(() => expect(result.current.props.contextItems).toEqual([]));
    expect(result.current.selection.designSystemId).toBeNull();
  });

  it("attaches a reference immediately as pending and closes without an Attach footer", async () => {
    mocks.sourceList = { items: [{ id: "source", title: "Layout deck" }] };
    let finishRead!: (value: unknown) => void;
    mocks.callAction.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishRead = resolve;
        }),
    );
    const { result } = renderHook(() => useSlidesComposerContext());
    await waitFor(() => expect(result.current.props.contextItems).toEqual([]));
    act(() => {
      void pickerAction(result.current, "deck-reference").onSelect();
    });
    const controls = pickerControls(() => result.current, "deck-reference");
    render(pickerPage(result.current, "deck-reference", controls));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getAllByRole("button")).toHaveLength(1);
    fireEvent.click(screen.getByRole("option", { name: "Layout deck" }));
    expect(controls.onClose).toHaveBeenCalledOnce();
    expect(result.current.props.contextItems[0]).toMatchObject({
      key: "slides:source:",
      status: "pending",
    });
    await act(async () =>
      finishRead({
        id: "source",
        title: "Layout deck",
        context: "Reference grid",
      }),
    );
    expect(result.current.props.contextItems[0]?.status).toBe("ready");
  });

  it.each(["empty", "loading", "error"])(
    "keeps the search header in the compact %s page",
    async (state) => {
      const { result } = renderHook(() => useSlidesComposerContext());
      await waitFor(() =>
        expect(result.current.props.contextItems).toEqual([]),
      );
      mocks.listFetching = state === "loading";
      mocks.listError =
        state === "error" ? new Error("Reference unavailable") : null;
      act(() => {
        void pickerAction(result.current, "deck-reference").onSelect();
      });
      const controls = pickerControls(() => result.current, "deck-reference");
      const page = render(
        pickerPage(result.current, "deck-reference", controls),
      );
      expect(
        screen.getByRole("combobox", { name: "promptContext.search" }),
      ).toBeTruthy();
      expect(
        screen
          .getByRole("button", { name: "Back" })
          .closest("[cmdk-input-wrapper]"),
      ).toBeTruthy();
      expect(screen.queryByRole("dialog")).toBeNull();
      if (state === "empty")
        expect(screen.getByText("home.emptyTitle")).toBeTruthy();
      if (state === "loading")
        expect(page.container.querySelector('[aria-busy="true"]')).toBeTruthy();
      if (state === "error") {
        expect(screen.getByRole("alert").textContent).toBe(
          "Reference unavailable",
        );
        fireEvent.click(
          screen.getByRole("option", { name: "promptContext.retry" }),
        );
        expect(mocks.refetch).toHaveBeenCalledOnce();
      }
    },
  );

  it.each(["submit", "enter", "click"])(
    "Figma %s loads frames without submitting the outer composer form",
    async (method) => {
      const { result } = renderHook(() => useSlidesComposerContext());
      await waitFor(() =>
        expect(result.current.props.contextItems).toEqual([]),
      );
      act(() => {
        void pickerAction(result.current, "figma").onSelect();
      });
      const controls = pickerControls(() => result.current, "figma");
      const submitPrompt = vi.fn();
      const content = () => (
        <form onSubmit={submitPrompt}>
          {createPortal(
            pickerPage(result.current, "figma", controls),
            document.body,
          )}
        </form>
      );
      const page = render(content());
      const input = screen.getByRole("combobox", {
        name: "promptContext.figmaUrl",
      });
      expect(screen.queryByPlaceholderText("promptContext.search")).toBeNull();
      expect(screen.queryByText("promptContext.empty")).toBeNull();
      expect(screen.queryByRole("dialog")).toBeNull();
      fireEvent.change(input, {
        target: { value: "https://www.figma.com/design/ExampleFile/Test" },
      });
      page.rerender(content());
      if (method === "submit") {
        expect(fireEvent.submit(input.closest("form")!)).toBe(false);
      } else if (method === "enter") {
        await waitFor(() =>
          expect(
            screen
              .getByRole("option", { name: "promptContext.browse" })
              .getAttribute("data-selected"),
          ).toBe("true"),
        );
        fireEvent.keyDown(input, { key: "Enter", code: "Enter" });
      } else
        fireEvent.click(
          screen.getByRole("option", { name: "promptContext.browse" }),
        );
      expect(submitPrompt).not.toHaveBeenCalled();
      expect(
        mocks.queryArgs
          .filter((query) => query.name === "read-composer-source")
          .at(-1)?.args,
      ).toMatchObject({
        source: "figma",
        figmaUrl: "https://www.figma.com/design/ExampleFile/Test",
      });
      page.rerender(content());
      expect(
        screen.getByRole("combobox", { name: "promptContext.search" }),
      ).toBeTruthy();
    },
  );

  it("keeps the Figma URL and retry visible on an unavailable source", async () => {
    const { result } = renderHook(() => useSlidesComposerContext());
    await waitFor(() => expect(result.current.props.contextItems).toEqual([]));
    act(() => {
      void pickerAction(result.current, "figma").onSelect();
    });
    const controls = pickerControls(() => result.current, "figma");
    const page = render(pickerPage(result.current, "figma", controls));
    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "https://www.figma.com/design/ExampleFile/Test" },
    });
    page.rerender(pickerPage(result.current, "figma", controls));
    mocks.listError = new Error("Reference unavailable");
    fireEvent.click(
      screen.getByRole("option", { name: "promptContext.browse" }),
    );
    page.rerender(pickerPage(result.current, "figma", controls));
    expect(
      screen
        .getByRole("combobox", { name: "promptContext.figmaUrl" })
        .getAttribute("value"),
    ).toBe("https://www.figma.com/design/ExampleFile/Test");
    expect(screen.queryByPlaceholderText("promptContext.search")).toBeNull();
    expect(screen.getByRole("alert").textContent).toBe("Reference unavailable");
    fireEvent.click(
      screen.getByRole("option", { name: "promptContext.browse" }),
    );
    expect(mocks.refetch).toHaveBeenCalledOnce();
  });

  it.each([
    { data: "{}" },
    { data: '{"colors":{},"typography":{"bodyFont":""}}' },
    {
      data: '{"source":"builder","builderStatus":"ready"}',
      builder: { builderStatus: "ready", docCount: 0, tokenValues: {} },
    },
  ])(
    "rejects placeholder systems even when generic agentContext exists: %j",
    async (payload) => {
      mocks.defaults = { designSystem: { id: "empty" } };
      mocks.callAction.mockResolvedValue({
        title: "Placeholder",
        agentContext: "Use this design system",
        ...payload,
      });
      const { result } = renderHook(() => useSlidesComposerContext());
      await waitFor(() =>
        expect(result.current.props.contextItems[0]?.status).toBe("error"),
      );
      expect(result.current.props.contextItems[0]?.context).toBe("");
      await expect(
        result.current.beforeSend({
          contextItems: result.current.props.contextItems,
        }),
      ).rejects.toThrow("unfinished context");
    },
  );

  it("does not leak a standalone draft selection into another chat thread", async () => {
    mocks.defaults = { referenceDeck: { id: "source", title: "Layout deck" } };
    const { result, rerender } = renderHook(
      ({ scope }) => useSlidesComposerContext(null, scope),
      { initialProps: { scope: "chat:first" } },
    );
    await waitFor(() =>
      expect(result.current.props.contextItems[0]?.status).toBe("ready"),
    );
    mocks.defaults = {};
    rerender({ scope: "chat:second" });
    await waitFor(() => expect(result.current.props.contextItems).toEqual([]));
    expect(result.current.selection.references).toEqual([]);
  });

  it("restores each standalone thread's explicit draft choice without remounting", async () => {
    mocks.defaults = { designSystem: { id: "brand" } };
    const { result, rerender } = renderHook(
      ({ scope }) => useSlidesComposerContext(null, scope),
      { initialProps: { scope: "chat:first" } },
    );
    await waitFor(() =>
      expect(result.current.props.contextItems[0]?.status).toBe("ready"),
    );
    act(() => result.current.props.onRemoveContextItem("system:brand"));
    await waitFor(() => expect(result.current.props.contextItems).toEqual([]));
    rerender({ scope: "chat:second" });
    await waitFor(() =>
      expect(result.current.props.contextItems[0]?.status).toBe("ready"),
    );
    rerender({ scope: "chat:first" });
    await waitFor(() => expect(result.current.props.contextItems).toEqual([]));
    expect(result.current.selection.designSystemId).toBeNull();
  });

  it("passes opaque pagination cursors and cancel cannot attach late list results", async () => {
    mocks.sourceList = { items: [], hasMore: true, nextCursor: "opaque-next" };
    const { result, rerender } = renderHook(() => useSlidesComposerContext());
    await waitFor(() => expect(result.current.props.contextItems).toEqual([]));
    act(() => {
      void pickerAction(result.current, "deck-reference").onSelect();
    });
    const controls = pickerControls(() => result.current, "deck-reference");
    const dialog = render(
      pickerPage(result.current, "deck-reference", controls),
    );
    fireEvent.click(screen.getByText("promptContext.next"));
    dialog.rerender(pickerPage(result.current, "deck-reference", controls));
    expect(
      mocks.queryArgs
        .filter((query) => query.name === "read-composer-source")
        .at(-1)?.args,
    ).toMatchObject({ page: 2, cursor: "opaque-next" });
    fireEvent.click(screen.getByText("promptContext.previous"));
    dialog.rerender(pickerPage(result.current, "deck-reference", controls));
    expect(
      mocks.queryArgs
        .filter((query) => query.name === "read-composer-source")
        .at(-1)?.args.cursor,
    ).toBeUndefined();
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    dialog.rerender(result.current.dialogs);
    mocks.sourceList = { items: [{ id: "late", title: "Late result" }] };
    rerender();
    expect(result.current.selection.references).toEqual([]);
    expect(
      mocks.callAction.mock.calls.some(
        ([name, args]) =>
          name === "read-composer-source" && args.operation === "read",
      ),
    ).toBe(false);
  });
  it("shows workspace defaults and never silently restores a removed system", async () => {
    mocks.defaults = { designSystem: { id: "brand" } };
    const { result, rerender } = renderHook(() => useSlidesComposerContext());
    await waitFor(() =>
      expect(result.current.props.contextItems).toMatchObject([
        { key: "system:brand", status: "ready" },
      ]),
    );
    act(() => result.current.props.onRemoveContextItem("system:brand"));
    await waitFor(() => expect(result.current.props.contextItems).toEqual([]));
    mocks.defaults = { designSystem: { id: "new-default" } };
    rerender();
    expect(result.current.selection.designSystemId).toBeNull();
    expect(
      mocks.callAction.mock.calls.some(
        ([name]) => name === "set-workspace-defaults",
      ),
    ).toBe(false);
  });

  it("rehydrates project context without leaking references across deck switches", async () => {
    mocks.decks.first = {
      composerContext: { designSystemId: null, references: [ref] },
    };
    mocks.decks.second = {
      composerContext: { designSystemId: null, references: [] },
    };
    const { result, rerender } = renderHook(
      ({ id }) => useSlidesComposerContext(id),
      { initialProps: { id: "first" } },
    );
    await waitFor(() =>
      expect(result.current.props.contextItems).toMatchObject([
        { key: "slides:source:", status: "ready" },
      ]),
    );
    rerender({ id: "second" });
    await waitFor(() => expect(result.current.props.contextItems).toEqual([]));
    expect(result.current.selection.references).toEqual([]);
  });

  it("lets users remove an unresolved source without late hydration restoring it", async () => {
    let resolveRead!: (value: unknown) => void;
    mocks.defaults = { referenceDeck: { id: "source", title: "Layout deck" } };
    mocks.callAction.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveRead = resolve;
        }),
    );
    const { result } = renderHook(() => useSlidesComposerContext());
    await waitFor(() =>
      expect(result.current.props.contextItems[0]?.status).toBe("pending"),
    );
    act(() => result.current.props.onRemoveContextItem("slides:source:"));
    await waitFor(() => expect(result.current.props.contextItems).toEqual([]));
    await act(async () => {
      resolveRead({ title: "Layout deck", context: "Late context" });
    });
    expect(result.current.props.contextItems).toEqual([]);
  });

  it("keeps unavailable sources visible and blocks the send", async () => {
    mocks.defaults = { referenceDeck: { id: "source", title: "Layout deck" } };
    mocks.callAction.mockRejectedValue(new Error("No access"));
    const { result } = renderHook(() => useSlidesComposerContext());
    await waitFor(() =>
      expect(result.current.props.contextItems[0]).toMatchObject({
        status: "error",
        statusMessage: "No access",
      }),
    );
    await expect(
      result.current.beforeSend({
        contextItems: result.current.props.contextItems,
      }),
    ).rejects.toThrow("unfinished context");
  });

  it("keeps a failed save visible until retry succeeds", async () => {
    mocks.decks.target = {
      composerContext: { designSystemId: "brand", references: [] },
    };
    const { result } = renderHook(() => useSlidesComposerContext("target"));
    await waitFor(() =>
      expect(result.current.props.contextItems[0]?.status).toBe("ready"),
    );
    mocks.callAction.mockRejectedValueOnce(new Error("Write unavailable"));
    act(() => result.current.props.onRemoveContextItem("system:brand"));
    await waitFor(() =>
      expect(result.current.props.contextItems).toContainEqual(
        expect.objectContaining({ key: "context-state", status: "error" }),
      ),
    );
    act(() => result.current.props.onRetryContextItem());
    await waitFor(() => expect(result.current.props.contextItems).toEqual([]));
    expect(mocks.decks.target.composerContext?.designSystemId).toBeNull();
  });

  it("persists the captured send while retaining a later removal for the next prompt", async () => {
    mocks.decks.target = {
      composerContext: { designSystemId: null, references: [ref] },
      generationContext: { originalPrompt: "Original" },
    };
    const { result } = renderHook(() => useSlidesComposerContext("target"));
    await waitFor(() =>
      expect(result.current.props.contextItems[0]?.status).toBe("ready"),
    );
    const captured = result.current.props.contextItems.map((item) =>
      Object.freeze({ ...item }),
    );
    act(() => result.current.props.onRemoveContextItem("slides:source:"));
    await waitFor(() => expect(result.current.props.contextItems).toEqual([]));
    await act(async () =>
      result.current.beforeSend({ contextItems: captured }),
    );
    expect(mocks.decks.target.composerContext?.references).toEqual([]);
    expect(mocks.decks.target.generationContext).toMatchObject({
      originalPrompt: "Original",
      composerContext: { references: [ref] },
      contextItems: captured,
    });
  });

  it("forwards the exact structured snapshot and mentioned references without changing the visible prompt", async () => {
    mocks.defaults = { referenceDeck: { id: "source", title: "Layout deck" } };
    const submit = vi.fn();
    render(<SlidesPromptComposer onSubmit={submit} />);
    await waitFor(() =>
      expect(mocks.composerProps?.contextItems?.[0]?.status).toBe("ready"),
    );
    const contextItems = Object.freeze(
      mocks.composerProps!.contextItems!.map((item) =>
        Object.freeze({ ...item }),
      ),
    );
    const references = [
      {
        type: "mention" as const,
        path: "/guide",
        name: "Guide",
        source: "files",
        refId: "guide",
      },
    ];
    await act(async () =>
      mocks.composerProps!.onSubmit("Original user prompt", [], references, {
        model: "test-model",
        contextItems,
      }),
    );
    expect(submit).toHaveBeenCalledWith(
      "Original user prompt",
      [],
      references,
      expect.objectContaining({
        model: "test-model",
        contextItems: expect.arrayContaining([...contextItems]),
        slidesContext: { designSystemId: null, references: [ref] },
        slidesContextText: expect.stringContaining("Mentioned mention: Guide"),
      }),
    );
  });

  it("leaves the picker closed when setup starts chat without changing the draft selection", async () => {
    mocks.defaults = { referenceDeck: { id: "source", title: "Layout deck" } };
    const { result } = renderHook(() => useSlidesComposerContext());
    await waitFor(() =>
      expect(result.current.props.contextItems[0]?.status).toBe("ready"),
    );
    act(() => {
      void pickerAction(result.current, "system").onSelect();
    });
    const controls = pickerControls(() => result.current, "system");
    const view = render(pickerPage(result.current, "system", controls));
    fireEvent.click(screen.getByText("promptContext.createNew"));
    view.rerender(result.current.dialogs);
    fireEvent.click(screen.getByText("start-chat"));
    view.rerender(result.current.dialogs);
    expect(controls.onResume).not.toHaveBeenCalled();
    expect(screen.queryByTestId("system-setup")).toBeNull();
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(result.current.selection).toEqual({
      designSystemId: null,
      references: [ref],
    });
    expect(mocks.refetch).not.toHaveBeenCalled();
  });

  it.each(["cancel-setup", "finish-setup"])(
    "returns from %s to the anchored picker without changing selection or defaults",
    async (exit) => {
      mocks.defaults = {
        referenceDeck: { id: "source", title: "Layout deck" },
      };
      const { result } = renderHook(() => useSlidesComposerContext());
      await waitFor(() =>
        expect(result.current.props.contextItems[0]?.status).toBe("ready"),
      );
      act(() => {
        void pickerAction(result.current, "system").onSelect();
      });
      const controls = pickerControls(() => result.current, "system");
      const dialog = render(pickerPage(result.current, "system", controls));
      fireEvent.change(screen.getByRole("combobox"), {
        target: { value: "Brand" },
      });
      dialog.rerender(pickerPage(result.current, "system", controls));
      fireEvent.click(screen.getByText("promptContext.createNew"));
      dialog.rerender(result.current.dialogs);
      expect(controls.onClose).toHaveBeenCalledExactlyOnceWith({
        restoreFocus: false,
      });
      expect(
        screen
          .getByTestId("system-setup")
          .getAttribute("data-preserve-defaults"),
      ).toBe("true");
      fireEvent.click(screen.getByText(exit));
      expect(controls.onResume).toHaveBeenCalledOnce();
      dialog.rerender(pickerPage(result.current, "system", controls));
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(screen.getByRole("combobox").getAttribute("value")).toBe("Brand");
      expect(screen.getByText("promptContext.createNew")).toBeTruthy();
      expect(result.current.selection).toEqual({
        designSystemId: null,
        references: [ref],
      });
      if (exit === "finish-setup") expect(mocks.refetch).toHaveBeenCalled();
      expect(
        mocks.callAction.mock.calls.some(
          ([name]) => name === "set-workspace-defaults",
        ),
      ).toBe(false);
    },
  );
});
