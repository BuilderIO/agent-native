// @vitest-environment happy-dom
import type { AssistantChatComposerContext } from "@agent-native/toolkit/app/chat/chat";
import {
  writeAssistantChatComposerContextDraft,
  snapshotComposerContextItems,
} from "@agent-native/toolkit/app/chat/composer/index";
import {
  act,
  type ComponentProps,
  type ReactElement,
  type ReactNode,
} from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FIGMA_REFERENCE_CONTEXT_BUDGET } from "@/lib/figma-attachment";

import { DesignComposerContextProvider } from "./DesignComposerContextProvider";
import type { FigmaAttachDialog } from "./FigmaAttachDialog";
import { useHomePromptContext } from "./HomePromptContext";

const figImages = vi.hoisted(() => ({
  finalize: vi.fn(async () => 0),
  cleanup: vi.fn(async () => 0),
}));
vi.mock("@/lib/fig-client-import", () => ({
  prepareFigImport: async () => ({
    summary: { frameCount: 1, pages: [{ id: "p1", frameCount: 1 }] },
    render: async () => ({ frames: [], skippedEmbeddedImageCount: 0 }),
    dispose: () => {},
  }),
  browserImageUploader: () => vi.fn(),
  browserImportId: () => "import-1",
  completeFigInBrowser: async () => ({
    files: [
      {
        filename: "Home.html",
        content: "<main>Home</main>",
        source: { figPageName: "Web" },
        preferredFrame: { title: "Home", width: 1280, height: 800 },
      },
    ],
    stats: { unresolvedImageRefCount: 0 },
    finalize: figImages.finalize,
    cleanup: figImages.cleanup,
  }),
}));

const mocks = vi.hoisted(() => ({
  call: vi.fn(),
  refresh: 0,
  enabled: true,
  select: vi.fn(),
  navigate: vi.fn(),
  capabilities: {
    data: {
      sources: { figma: { available: true } },
      integrations: [] as Array<{
        id: string;
        label: string;
        kind: "provider-api" | "mcp";
      }>,
    },
  },
  session: {
    email: "user@example.com",
    orgId: "org-one",
    authUserId: undefined as string | undefined,
  },
}));
vi.mock(
  "@agent-native/toolkit/app/chat/composer/index",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("@agent-native/toolkit/app/chat/composer/index")
    >()),
    useAgentKitCapabilities: () => mocks.capabilities,
  }),
);
vi.mock("@/hooks/use-design-system-workflows", () => ({
  useDesignSystemWorkflows: () => mocks.enabled,
}));
vi.mock("@/hooks/use-design-systems", () => ({
  useDesignSystems: () => ({
    designSystems: [],
    isLoading: false,
    refetch: vi.fn(),
  }),
}));
vi.mock("./design-start-pickers", () => ({
  designSystemPickerOptions: () => [],
}));
vi.mock("@agent-native/core/client/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/client/hooks")>()),
  getBrowserTabId: () => "tab-1",
  useSession: () => ({ session: mocks.session }),
  callAction: (...args: unknown[]) => mocks.call(...args),
  useChangeVersions: () => mocks.refresh,
  actionErrorMessage: (error: unknown) =>
    error instanceof Error
      ? error.message.replace(/^Action failed: /, "")
      : undefined,
}));
const translate = (key: string) => key;
vi.mock("@agent-native/core/client/i18n", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/client/i18n")>()),
  useT: () => translate,
  useFormatters: () => ({ formatDate: (value: string) => value }),
}));
vi.mock("@/components/design/DesignThumbnail", () => ({
  DesignThumbnail: () => null,
}));
vi.mock("react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-router")>()),
  useNavigate: () => mocks.navigate,
}));
type Props = Parameters<typeof useHomePromptContext>[0];
const defaults: Props = {
  systems: [],
  systemId: null,
  onSystemChange: mocks.select,
  templates: [],
  templateId: null,
  onTemplateChange: mocks.select,
};
const cleanups: (() => void)[] = [];
function render(element: ReactNode) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  act(() => root.render(element));
  cleanups.push(() => {
    act(() => root.unmount());
    container.remove();
  });
  return {
    container,
    rerender: (next: ReactNode) => act(() => root.render(next)),
  };
}
function renderHook<T>(
  hook: (props: Props) => T,
  options?: { initialProps: Props },
) {
  const result = {} as { current: T };
  function Harness({ props }: { props: Props }) {
    result.current = hook(props);
    return null;
  }
  const view = render(<Harness props={options?.initialProps ?? defaults} />);
  return {
    result,
    rerender: (props = options?.initialProps ?? defaults) =>
      view.rerender(<Harness props={props} />),
  };
}
async function waitFor(assertion: () => unknown) {
  await act(async () => {});
  assertion();
}
const request = (extra = {}) => ({
  search: "",
  page: 1,
  signal: new AbortController().signal,
  ...extra,
});
const url = "https://www.figma.com/design/example-one/Example";
const website = "https://example.com/reference";
function menuEntry(
  controller: ReturnType<typeof useHomePromptContext>,
  id: string,
) {
  return controller.menuItems
    .flatMap((item) => item.children ?? [item])
    .find((item) => item.id === id);
}
function picker(
  controller: ReturnType<typeof useHomePromptContext>,
  id = "design-reference",
) {
  const item = menuEntry(controller, id);
  if (!item || !("picker" in item) || !item.picker)
    throw new Error("Missing picker");
  return item.picker;
}
function load(controller: ReturnType<typeof useHomePromptContext>) {
  const config = picker(controller);
  if (!("load" in config) || !config.load) throw new Error("Missing load");
  return config.load;
}
function batch(
  controller: ReturnType<typeof useHomePromptContext>,
  items: { id: string; title: string }[],
) {
  const presentation = picker(controller).presentation;
  if (
    !presentation ||
    presentation === "submenu" ||
    presentation.mode !== "multiple"
  )
    throw new Error("Missing dialog");
  return presentation.onAttach(items, request());
}
const designItem = (id: string) => ({ id, title: `Design ${id}` });
const figmaClipboard = (html: string) =>
  ({
    getData: (type: string) => (type === "text/html" ? html : ""),
  }) as unknown as DataTransfer;
const figmaSelectionHtml = `<span data-metadata="<!--(figmeta)${btoa(
  JSON.stringify({ fileKey: "abc", pasteID: 1 }),
)}(/figmeta)-->"></span>`;
const figmaSelectionKey = "figma-reference:clipboard:abc:1";
function pasteFigmaSelection(
  controller: ReturnType<typeof useHomePromptContext>,
) {
  let handled!: boolean;
  act(() => {
    handled = controller.onPasteContext(figmaClipboard(figmaSelectionHtml));
  });
  return handled;
}
function addWebsite(
  controller: ReturnType<typeof useHomePromptContext>,
  value = website,
) {
  return picker(controller, "website-reference").onSelect!(
    { id: value, title: value, url: value },
    request({ url: value }),
  );
}
function deferred() {
  let resolve!: (value: unknown) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
beforeEach(() => {
  figImages.finalize.mockClear();
  figImages.cleanup.mockClear();
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks();
  const storage = new Map<string, string>();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
      clear: () => storage.clear(),
      key: (index: number) => [...storage.keys()][index] ?? null,
      get length() {
        return storage.size;
      },
    },
  });
  mocks.enabled = true;
  mocks.refresh = 0;
  mocks.session = {
    email: "user@example.com",
    orgId: "org-one",
    authUserId: undefined,
  };
  mocks.capabilities = {
    data: { sources: { figma: { available: true } }, integrations: [] },
  };
  mocks.navigate.mockReset();
  mocks.call.mockImplementation(async (_action, args) => ({
    id: args.id ?? "website-hash",
    title: "Reference",
    context: "Bounded visual context",
    agentContext: "System tokens",
  }));
});
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

describe("home prompt context", () => {
  it("rejects unsupported app source IDs before partially hydrating references or changing the system", async () => {
    const scope = "design-source-scope";
    writeAssistantChatComposerContextDraft(scope, {
      designSystemId: "saved-system",
      references: [
        { source: "design", id: "first", title: "First design" },
        { source: "google-slides", id: "unsupported", title: "Google source" },
      ],
    });
    const key = `agent-chat-composer-context:${scope}`;
    const stored = window.localStorage.getItem(key);
    const { result } = renderHook(() =>
      useHomePromptContext({ ...defaults, draftScope: scope }),
    );
    await waitFor(() =>
      expect(result.current.contextItems).toEqual([
        expect.objectContaining({
          key: "design-context-draft",
          status: "error",
          statusMessage: "homeContext.loadFailed",
        }),
      ]),
    );
    expect(mocks.call).not.toHaveBeenCalled();
    expect(mocks.select).not.toHaveBeenCalled();
    expect(window.localStorage.getItem(key)).toBe(stored);
  });
  it.each(["design", "slides", "figma", "website", "integration"])(
    "still hydrates supported %s draft references",
    async (source) => {
      const scope = `design-known-${source}`;
      writeAssistantChatComposerContextDraft(scope, {
        designSystemId: null,
        references: [
          {
            source,
            id: "one",
            title: "Saved source",
            url: website,
            ...(source === "figma" ? { figmaUrl: url } : {}),
          },
        ],
      });
      const { result } = renderHook(() =>
        useHomePromptContext({ ...defaults, draftScope: scope }),
      );
      await waitFor(() =>
        expect(
          result.current.contextItems.some(
            (item) =>
              item.status === "ready" &&
              item.context === "Bounded visual context",
          ),
        ).toBe(true),
      );
      expect(mocks.call).toHaveBeenCalledWith(
        "read-composer-source",
        expect.objectContaining({ source }),
        { method: "GET" },
      );
    },
  );

  it("restores only reference metadata across same-thread surface remounts and re-reads its content", async () => {
    let model!: AssistantChatComposerContext;
    const provider = (threadId: string, tabId: string) => (
      <MemoryRouter initialEntries={["/design/d1"]}>
        <DesignComposerContextProvider
          threadId={threadId}
          tabId={tabId}
          isActive
        >
          {(value) => {
            model = value;
            return null;
          }}
        </DesignComposerContextProvider>
      </MemoryRouter>
    );
    const view = render(provider("thread", "sidebar-tab"));
    const action = model.menuItems
      .flatMap((item) => item.children ?? [item])
      .find((item) => item.id === "website-reference");
    if (!action || !("picker" in action) || !action.picker?.onSelect)
      throw new Error("Missing website picker");
    await act(async () =>
      action.picker!.onSelect!({ id: website, title: "Website" }, request()),
    );
    expect(model.contextItems[0].status).toBe("ready");
    view.rerender(null);
    mocks.call.mockResolvedValueOnce({
      id: "website-hash",
      title: "Website",
      context: "Fresh after handoff",
    });
    await act(async () => view.rerender(provider("thread", "page-tab")));
    expect(model.contextItems).toEqual([
      expect.objectContaining({
        context: "Fresh after handoff",
        status: "ready",
      }),
    ]);
    const stored = [...Array(window.localStorage.length)]
      .map((_, index) =>
        window.localStorage.getItem(window.localStorage.key(index)!),
      )
      .join("");
    expect(stored).toContain(website);
    expect(stored).not.toContain("Bounded visual context");
    expect(stored).not.toContain("Fresh after handoff");
    view.rerender(provider("other-thread", "other-tab"));
    expect(model.contextItems).toEqual([]);
    mocks.session.authUserId = "different-auth-user";
    view.rerender(provider("thread", "page-tab"));
    expect(model.contextItems).toEqual([]);
    mocks.session.authUserId = undefined;
    mocks.session.orgId = "different-org";
    view.rerender(provider("thread", "page-tab"));
    expect(model.contextItems).toEqual([]);
    mocks.session.orgId = "org-one";
    await act(async () => view.rerender(provider("thread", "page-tab")));
    expect(model.contextItems[0]?.status).toBe("ready");
    let prepared!: typeof model.contextItems;
    await act(async () => {
      prepared = await model.prepareSubmission(model.contextItems);
    });
    act(() => model.submissionAccepted(prepared));
    view.rerender(null);
    await act(async () => view.rerender(provider("thread", "sidebar-tab")));
    expect(model.contextItems).toEqual([]);
  });
  it("isolates provider selections by thread and account and hides inactive menus", async () => {
    const models = new Map<string, AssistantChatComposerContext>();
    const providers = (active: string) => (
      <MemoryRouter initialEntries={["/design/d1"]}>
        {["one", "two"].map((threadId) => (
          <DesignComposerContextProvider
            key={threadId}
            threadId={threadId}
            tabId={threadId}
            isActive={active === threadId}
          >
            {(model) => {
              models.set(threadId, model);
              return null;
            }}
          </DesignComposerContextProvider>
        ))}
      </MemoryRouter>
    );
    const view = render(providers("one"));
    const action = models
      .get("one")!
      .menuItems.flatMap((item) => item.children ?? [item])
      .find((item) => item.id === "design-reference")!;
    if (
      !("picker" in action) ||
      !action.picker ||
      !action.picker.presentation ||
      action.picker.presentation === "submenu" ||
      action.picker.presentation.mode !== "multiple"
    )
      throw new Error("Missing gallery");
    const gallery = action.picker.presentation;
    await act(async () =>
      gallery.onAttach([{ id: "one", title: "Reference" }], request()),
    );
    expect(models.get("one")!.contextItems).toHaveLength(1);
    expect(models.get("two")!.contextItems).toEqual([]);
    expect(models.get("two")!.menuItems).toEqual([]);
    view.rerender(providers("two"));
    expect(models.get("one")!.menuItems).toEqual([]);
    expect(() =>
      gallery.onAttach([{ id: "stale", title: "Stale" }], request()),
    ).toThrow("homeContext.loadFailed");
    mocks.session.orgId = "another-org";
    view.rerender(providers("one"));
    expect(models.get("one")!.contextItems).toEqual([]);
    expect(models.get("two")!.contextItems).toEqual([]);
    const newAction = models
      .get("one")!
      .menuItems.flatMap((item) => item.children ?? [item])
      .find((item) => item.id === "website-reference");
    if (!newAction || !("picker" in newAction) || !newAction.picker?.onSelect)
      throw new Error("Missing website action");
    await act(async () =>
      newAction.picker!.onSelect!({ id: website, title: "Website" }, request()),
    );
    expect(models.get("one")!.contextItems).toHaveLength(1);
    mocks.session.authUserId = "another-auth-identity";
    view.rerender(providers("one"));
    expect(models.get("one")!.contextItems).toEqual([]);
  });

  it("clears a successfully revalidated reference even when its fetched content changes", async () => {
    const { result } = renderHook(() => useHomePromptContext(defaults));
    await act(async () => addWebsite(result.current));
    const captured = snapshotComposerContextItems(result.current.contextItems);
    mocks.call.mockResolvedValueOnce({
      id: "website-hash",
      title: "Updated",
      context: "Refreshed context",
    });
    const prepared = await result.current.prepareSubmission(captured);
    expect(prepared![0].context).toBe("Refreshed context");
    expect(result.current.contextItems).toHaveLength(1);
    if (!prepared) throw new Error("Submission was not prepared");
    const accepted = prepared;
    act(() => result.current.submissionAccepted(accepted));
    expect(result.current.contextItems).toEqual([]);
  });

  it("preserves replacements and additions while a captured submission is resolving", async () => {
    const { result } = renderHook(() => useHomePromptContext(defaults));
    await act(async () => addWebsite(result.current));
    const captured = snapshotComposerContextItems(result.current.contextItems);
    let resolve!: (value: unknown) => void;
    mocks.call.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const pending = result.current.prepareSubmission(captured);
    await act(async () => {
      addWebsite(result.current);
      addWebsite(result.current, "https://example.com/second");
    });
    resolve({
      id: "website-hash",
      title: "Original",
      context: "Revalidated original",
    });
    const prepared = await pending;
    expect(prepared).toHaveLength(1);
    if (!prepared) throw new Error("Submission was not prepared");
    const accepted = prepared;
    act(() => result.current.submissionAccepted(accepted));
    expect(result.current.contextItems).toHaveLength(2);
    expect(
      result.current.contextItems.every((item) => item.status === "ready"),
    ).toBe(true);
  });

  it("uses captured versions even when preparation starts after the selection changes", async () => {
    const { result } = renderHook(() => useHomePromptContext(defaults));
    await act(async () => addWebsite(result.current));
    const captured = snapshotComposerContextItems(result.current.contextItems);
    const capturedController = result.current;
    await act(async () => addWebsite(result.current));
    const prepared = await capturedController.prepareSubmission(captured);
    if (!prepared) throw new Error("Submission was not prepared");
    const accepted = prepared;
    act(() => result.current.submissionAccepted(accepted));
    expect(result.current.contextItems).toHaveLength(1);
  });
  it("does not clear a newer design system when an older selection is accepted", async () => {
    const { result, rerender } = renderHook(
      (props: Props) => useHomePromptContext(props),
      { initialProps: { ...defaults, systemId: "first" } },
    );
    await waitFor(() =>
      expect(result.current.contextItems[0]?.status).toBe("ready"),
    );
    const capturedController = result.current;
    const captured = snapshotComposerContextItems(result.current.contextItems);
    rerender({ ...defaults, systemId: "second" });
    await waitFor(() =>
      expect(result.current.contextItems[0]?.status).toBe("ready"),
    );
    const prepared = await capturedController.prepareSubmission(captured);
    expect(mocks.call).toHaveBeenLastCalledWith(
      "get-design-system",
      { id: "first" },
      { method: "GET" },
    );
    mocks.select.mockClear();
    if (!prepared) throw new Error("Submission was not prepared");
    const accepted = prepared;
    act(() => result.current.submissionAccepted(accepted));
    expect(mocks.select).not.toHaveBeenCalled();
    expect(result.current.contextItems).toHaveLength(1);
  });
  it("does not remove staged references when submit-time revalidation fails", async () => {
    const { result } = renderHook(() => useHomePromptContext(defaults));
    await act(async () => addWebsite(result.current));
    mocks.call.mockRejectedValueOnce(new Error("Access revoked"));
    await act(async () => {
      await expect(
        result.current.prepareSubmission(
          snapshotComposerContextItems(result.current.contextItems),
        ),
      ).rejects.toThrow("Access revoked");
    });
    expect(result.current.contextItems).toHaveLength(1);
    expect(result.current.contextItems[0].status).toBe("error");
  });
  // oracle-change: workspace integration selection and revocation are owned by the shared composer.

  it("keeps references available with design systems disabled, with no hidden system read", () => {
    mocks.enabled = false;
    const { result } = renderHook(() =>
      useHomePromptContext({ ...defaults, systemId: "saved-system" }),
    );
    expect(result.current.menuItems.map((item) => item.id)).toEqual([
      "figma-reference",
      "design-reference",
      "website-reference",
    ]);
    expect(result.current.contextItems).toEqual([]);
    expect(mocks.call).not.toHaveBeenCalled();
  });
  it("lists, attaches, revalidates and removes a design through the source action", async () => {
    const id = "design-reference";
    const source = "design";
    mocks.enabled = false;
    const { result } = renderHook(() => useHomePromptContext(defaults));
    const referenceMenu = result.current.menuItems.find(
      (entry) => entry.id === "design-reference",
    );
    expect(referenceMenu).toMatchObject({ order: 20 });
    const figmaEntry = result.current.menuItems.find(
      (entry) => entry.id === "figma-reference",
    );
    expect(figmaEntry).toMatchObject({ order: 10 });
    expect(figmaEntry?.icon).toMatchObject({
      type: "img",
      props: {
        alt: "",
        src: expect.stringMatching(/^data:image\/svg\+xml;base64,/),
      },
    });
    expect(
      result.current.menuItems.flatMap((item) => item.children ?? [item]),
    ).toContainEqual(
      expect.objectContaining({
        id,
        label: "homeContext.referenceDesign",
        intent: "add-context",
      }),
    );
    const input = request({ search: "campaign", page: 2, cursor: "next" });
    const references = [{ id: "reference-one", title: "Campaign" }];
    mocks.call.mockResolvedValueOnce({
      designs: references.map((item) => ({
        ...item,
        updatedAt: "2026-09-28T00:00:00Z",
        previewHtml: "<h1>Campaign</h1>",
      })),
      hasMore: false,
    });
    const sourcePicker = picker(result.current, id);
    const listed = await sourcePicker.load!(input);
    expect(mocks.call).toHaveBeenLastCalledWith(
      "list-designs",
      {
        includePreview: "true",
        pageSize: 12,
        search: "campaign",
        page: 2,
      },
      { method: "GET", signal: input.signal },
    );
    expect(result.current.contextItems).toEqual([]);
    expect(sourcePicker.link).toBeUndefined();
    expect(sourcePicker.presentation).toMatchObject({ layout: "gallery" });
    expect(listed.items[0].preview).toBeDefined();
    const presentation = sourcePicker.presentation;
    if (
      !presentation ||
      presentation === "submenu" ||
      presentation.mode !== "multiple"
    )
      throw new Error("Missing reference dialog");
    await act(async () => presentation.onAttach(listed.items, input));
    expect(mocks.call).toHaveBeenLastCalledWith(
      "read-composer-source",
      { source, operation: "read", id: "reference-one", page: 1 },
      { method: "GET" },
    );
    expect(picker(result.current, id).selectedIds).toEqual(["reference-one"]);
    expect(result.current.contextItems[0]).toMatchObject({
      status: "ready",
      context: "Bounded visual context",
    });
    mocks.call.mockResolvedValueOnce({
      id: "reference-one",
      title: "Campaign",
      context: "Fresh reference",
    });
    const submitted = await result.current.prepareSubmission(
      snapshotComposerContextItems(result.current.contextItems),
    );
    expect(submitted?.[0].context).toBe("Fresh reference");
    expect(mocks.call).toHaveBeenLastCalledWith(
      "read-composer-source",
      { source, operation: "read", id: "reference-one", page: 1 },
      { method: "GET" },
    );
    act(() => result.current.remove(result.current.contextItems[0].key));
    expect(result.current.contextItems).toEqual([]);
    expect(picker(result.current, id).selectedIds).toEqual([]);
  });
  it("restores the real system creator only when enabled; empty has no None", () => {
    const { result } = renderHook(() => useHomePromptContext(defaults));
    const system = picker(result.current, "system");
    expect(system.items).toEqual([]);
    expect(system.emptyMessage).toBe("homeContext.noSystems");
    expect(system.clearSelection).toBeUndefined();
    const view = render(
      <MemoryRouter>
        {system.footerAction!.renderLink!(system.footerAction!.label)}
      </MemoryRouter>,
    );
    expect(view.container.querySelector("a")?.getAttribute("href")).toBe(
      "/design-systems/setup",
    );
  });
  it("uses ordinary shared dialogs with source labels, no app render slots or URL list", () => {
    const { result } = renderHook(() => useHomePromptContext(defaults));
    expect(picker(result.current)).toMatchObject({
      presentation: { type: "dialog", mode: "multiple", layout: "gallery" },
      searchPlaceholder: "homeContext.searchDesigns",
    });
    expect(picker(result.current).link).toBeUndefined();
    expect(picker(result.current).onSelect).toBeUndefined();
    expect(picker(result.current, "website-reference")).toMatchObject({
      presentation: { type: "dialog", mode: "url" },
    });
    expect(picker(result.current, "website-reference").load).toBeUndefined();
    expect(
      result.current.menuItems.every((entry) => !("render" in entry)),
    ).toBe(true);
  });
  it("opens the Figma dialog from the menu across pending, unavailable, disconnected, and connected capabilities", () => {
    const states = [
      {
        data: undefined,
        integrationsLoading: true,
        integrationsError: undefined,
      },
      {
        data: undefined,
        integrationsLoading: false,
        integrationsError: new Error("read failed"),
      },
      {
        data: { sources: { figma: { available: false } }, integrations: [] },
        integrationsLoading: false,
        integrationsError: undefined,
      },
      {
        data: { sources: { figma: { available: true } }, integrations: [] },
        integrationsLoading: false,
        integrationsError: undefined,
      },
    ];
    const { result, rerender } = renderHook(() =>
      useHomePromptContext(defaults),
    );
    for (const state of states) {
      Object.assign(mocks.capabilities, state);
      rerender();
      const entry = menuEntry(result.current, "figma-reference");
      expect(entry).toMatchObject({
        referenceType: "figma",
        opensDialog: true,
        onSelect: expect.any(Function),
      });
      expect(entry && "picker" in entry).toBe(false);
      expect(
        result.current.menuItems.some((item) => item.id === "integrations"),
      ).toBe(false);
    }
    const dialog = () =>
      result.current.dialogs as ReactElement<{
        open: boolean;
        figmaConnected?: boolean;
      }>;
    expect(dialog().props).toMatchObject({
      open: false,
      figmaConnected: true,
    });
    const entry = menuEntry(result.current, "figma-reference");
    const onSelect = entry && "onSelect" in entry ? entry.onSelect : undefined;
    if (!onSelect) throw new Error("Missing Figma action");
    act(() => {
      void onSelect();
    });
    expect(dialog().props.open).toBe(true);
  });
  it("decodes a copied Figma selection into a reference on paste and ignores other clipboards", async () => {
    mocks.call.mockImplementation(async (action) =>
      action === "read-figma-clipboard"
        ? {
            frames: [
              {
                name: "Pricing",
                width: 1440,
                height: 900,
                html: "<main>Plans</main>",
              },
              { name: "Checkout", html: "<form>Pay</form>" },
            ],
            unresolvedImages: 0,
          }
        : { id: "x", title: "x", context: "x" },
    );
    const { result } = renderHook(() => useHomePromptContext(defaults));
    let handled!: boolean;
    act(() => {
      handled = result.current.onPasteContext(
        figmaClipboard("<p>Plain text</p>"),
      );
    });
    expect(handled).toBe(false);
    expect(result.current.contextItems).toEqual([]);
    expect(pasteFigmaSelection(result.current)).toBe(true);
    expect(result.current.contextItems).toEqual([
      {
        key: figmaSelectionKey,
        title: "homeContext.figmaSelection",
        context: "",
        status: "pending",
      },
    ]);
    await waitFor(() => {
      expect(result.current.contextItems).toEqual([
        expect.objectContaining({
          key: figmaSelectionKey,
          title: "homeContext.figmaReferenceMore",
          status: "ready",
          context: expect.stringContaining("<main>Plans</main>"),
        }),
      ]);
    });
    expect(mocks.call).toHaveBeenCalledWith(
      "read-figma-clipboard",
      expect.objectContaining({ figmetaFileKey: "abc" }),
    );
    expect(mocks.call).not.toHaveBeenCalledWith(
      "import-figma-clipboard",
      expect.anything(),
    );
  });
  it("sends a Figma reference as is and imports nothing", async () => {
    mocks.call.mockImplementation(async (action) =>
      action === "read-figma-clipboard"
        ? {
            frames: [{ name: "Pricing", html: "<main>Plans</main>" }],
            unresolvedImages: 0,
          }
        : { id: "x", title: "x", context: "x" },
    );
    const { result } = renderHook(() => useHomePromptContext(defaults));
    pasteFigmaSelection(result.current);
    await waitFor(() => {
      expect(result.current.contextItems[0]?.status).toBe("ready");
    });
    const snapshot = snapshotComposerContextItems(result.current.contextItems);
    const calls = mocks.call.mock.calls.length;
    let prepared!: Awaited<ReturnType<typeof result.current.prepareSubmission>>;
    await act(async () => {
      prepared = await result.current.prepareSubmission(snapshot);
    });
    expect(mocks.call).toHaveBeenCalledTimes(calls);
    expect(prepared?.[0]).toMatchObject({
      key: figmaSelectionKey,
      title: "Pricing",
      context: expect.stringContaining("do not put it on the canvas"),
    });
    if (!prepared) throw new Error("Submission was not prepared");
    const accepted = prepared;
    act(() => result.current.submissionAccepted(accepted));
    expect(result.current.contextItems).toEqual([]);
  });
  it("deletes a .fig chip's staged images when it is removed, and keeps them once sent", async () => {
    mocks.call.mockImplementation(async (action) =>
      action === "stage-figma-reference"
        ? { ref: "attachment:v1:fig" }
        : { id: "x", title: "x", context: "x" },
    );
    const { result } = renderHook(() => useHomePromptContext(defaults));
    // Decoding a .fig streams through gzip, which takes real ticks to settle.
    const untilReady = async () => {
      for (let attempt = 0; attempt < 50; attempt += 1) {
        if (result.current.contextItems[0]?.status === "ready") return;
        await act(() => new Promise((resolve) => setTimeout(resolve, 10)));
      }
      expect(result.current.contextItems[0]?.status).toBe("ready");
    };
    const attachFile = () =>
      act(() =>
        (
          result.current.dialogs as ReactElement<{
            onAttachFile: (file: File) => void;
          }>
        ).props.onAttachFile(new File(["fig"], "App.fig")),
      );

    attachFile();
    await untilReady();
    const key = result.current.contextItems[0]?.key ?? "";
    act(() => result.current.remove(key));
    expect(figImages.cleanup).toHaveBeenCalledOnce();
    expect(figImages.finalize).not.toHaveBeenCalled();
    // The dropped chip's stored frames go too, not just its images.
    expect(mocks.call).toHaveBeenCalledWith("discard-figma-reference", {
      ref: "attachment:v1:fig",
    });

    attachFile();
    await untilReady();
    let prepared!: Awaited<ReturnType<typeof result.current.prepareSubmission>>;
    await act(async () => {
      prepared = await result.current.prepareSubmission(
        snapshotComposerContextItems(result.current.contextItems),
      );
    });
    // Nothing is kept until the chat accepts the message.
    expect(figImages.finalize).not.toHaveBeenCalled();
    const discards = () =>
      mocks.call.mock.calls.filter(
        ([action]) => action === "discard-figma-reference",
      ).length;
    const before = discards();
    if (!prepared) throw new Error("Submission was not prepared");
    const accepted = prepared;
    act(() => result.current.submissionAccepted(accepted));
    expect(figImages.finalize).toHaveBeenCalledOnce();
    expect(result.current.contextItems).toEqual([]);
    // Once accepted, the agent may still place it: nothing is deleted.
    expect(discards()).toBe(before);
  });

  it("splits one context budget across Figma chips so several still send", async () => {
    mocks.call.mockImplementation(async (action) =>
      action === "read-figma-clipboard"
        ? {
            frames: Array.from({ length: 4 }, (_, index) => ({
              name: `Frame ${index + 1}`,
              html: `<main>${"x".repeat(15_000)}</main>`,
            })),
            unresolvedImages: 0,
            ref: "attachment:v1:clip",
          }
        : { id: "x", title: "x", context: "x" },
    );
    const { result } = renderHook(() => useHomePromptContext(defaults));
    for (const pasteID of [1, 2]) {
      act(() => {
        result.current.onPasteContext(
          figmaClipboard(
            `<span data-metadata="<!--(figmeta)${btoa(
              JSON.stringify({ fileKey: "abc", pasteID }),
            )}(/figmeta)-->"></span>`,
          ),
        );
      });
    }
    await waitFor(() => {
      expect(result.current.contextItems.map((item) => item.status)).toEqual([
        "ready",
        "ready",
      ]);
    });
    const bytes = result.current.contextItems.map(
      (item) => new TextEncoder().encode(item.context).length,
    );
    expect(bytes.reduce((total, size) => total + size, 0)).toBeLessThanOrEqual(
      FIGMA_REFERENCE_CONTEXT_BUDGET,
    );
    expect(() =>
      snapshotComposerContextItems(result.current.contextItems),
    ).not.toThrow();

    act(() => result.current.remove("figma-reference:clipboard:abc:2"));
    // With one chip left, it gets the whole budget back.
    expect(
      result.current.contextItems.map(
        (item) => new TextEncoder().encode(item.context).length,
      ),
    ).toEqual([expect.any(Number)]);
    expect(
      result.current.contextItems.every(
        (item) =>
          new TextEncoder().encode(item.context).length > Math.max(...bytes),
      ),
    ).toBe(true);
  });

  it("fits many linked Figma frames in one send by sharing the budget", async () => {
    // Quotes cost an escape each in the composer's JSON snapshot.
    const structure = `Frame structure: ${'{"a":"b"}'.repeat(2_000)}`;
    mocks.call.mockImplementation(
      async (action: string, params: { nodeId?: string }) =>
        action === "read-composer-source"
          ? { id: params.nodeId, title: params.nodeId, context: structure }
          : { id: "x", title: "x", context: "x" },
    );
    const { result } = renderHook(() => useHomePromptContext(defaults));
    const dialog = result.current.dialogs as ReactElement<
      ComponentProps<typeof FigmaAttachDialog>
    >;
    act(() =>
      dialog.props.onAttachLinks(
        Array.from({ length: 6 }, (_, index) => ({
          id: `1:${index}`,
          title: `Frame ${index}`,
          url: `https://www.figma.com/design/abcDEF12345?node-id=1-${index}`,
        })),
      ),
    );
    await waitFor(() =>
      expect(
        result.current.contextItems.every((item) => item.status === "ready"),
      ).toBe(true),
    );
    const snapshot = snapshotComposerContextItems(result.current.contextItems);
    expect(snapshot).toHaveLength(6);
    const prepared = await result.current.prepareSubmission(snapshot);
    expect(() => snapshotComposerContextItems(prepared)).not.toThrow();
    expect(
      prepared?.every((item) => item.context.endsWith("[truncated]")),
    ).toBe(true);

    const before = result.current.contextItems[0]?.context.length ?? 0;
    act(() =>
      result.current.remove("design-home-reference:figma:abcDEF12345:1:5"),
    );
    expect(result.current.contextItems[0]?.context.length).toBeGreaterThan(
      before,
    );
  });

  it("gives Figma only the room a large design system leaves in one send", async () => {
    const structure = `Frame structure: ${"x".repeat(15_000)}`;
    mocks.call.mockImplementation(
      async (action: string, params: { nodeId?: string }) =>
        action === "read-composer-source"
          ? { id: params.nodeId, title: params.nodeId, context: structure }
          : { id: "system", agentContext: "s".repeat(50_000) },
    );
    const { result } = renderHook(() =>
      useHomePromptContext({ ...defaults, systemId: "system" }),
    );
    const dialog = result.current.dialogs as ReactElement<
      ComponentProps<typeof FigmaAttachDialog>
    >;
    act(() =>
      dialog.props.onAttachLinks(
        [0, 1, 2].map((index) => ({
          id: `1:${index}`,
          title: `Frame ${index}`,
          url: `https://www.figma.com/design/abcDEF12345?node-id=1-${index}`,
        })),
      ),
    );
    await waitFor(() =>
      expect(
        result.current.contextItems.length === 4 &&
          result.current.contextItems.every((item) => item.status === "ready"),
      ).toBe(true),
    );
    await waitFor(() =>
      expect(() =>
        snapshotComposerContextItems(result.current.contextItems),
      ).not.toThrow(),
    );
    const prepared = await result.current.prepareSubmission(
      snapshotComposerContextItems(result.current.contextItems),
    );
    expect(() => snapshotComposerContextItems(prepared)).not.toThrow();
  });

  it("shows a failed Figma decode on its chip and retries it", async () => {
    mocks.call.mockRejectedValueOnce(
      Object.assign(new Error("Action failed: Too large"), {
        actionMessage: "Too large",
      }),
    );
    const { result } = renderHook(() => useHomePromptContext(defaults));
    pasteFigmaSelection(result.current);
    await waitFor(() => {
      expect(result.current.contextItems).toEqual([
        expect.objectContaining({
          key: figmaSelectionKey,
          status: "error",
          statusMessage: "Too large",
        }),
      ]);
    });
    expect(() =>
      snapshotComposerContextItems(result.current.contextItems),
    ).toThrow();
    mocks.call.mockResolvedValueOnce({
      frames: [{ name: "Pricing", html: "<main>Plans</main>" }],
      unresolvedImages: 0,
    });
    act(() => result.current.retry(figmaSelectionKey));
    await waitFor(() => {
      expect(result.current.contextItems[0]).toMatchObject({
        title: "Pricing",
        status: "ready",
      });
    });
  });
  it("deduplicates before enforcing the 20-reference limit, with no partial staging", async () => {
    const { result } = renderHook(() => useHomePromptContext(defaults));
    await act(async () =>
      batch(
        result.current,
        Array.from({ length: 19 }, (_, i) => designItem(`design-${i}`)),
      ),
    );
    await act(async () =>
      batch(result.current, [designItem("design-0"), designItem("design-19")]),
    );
    const calls = mocks.call.mock.calls.length;
    expect(() =>
      batch(result.current, [designItem("design-20"), designItem("design-21")]),
    ).toThrow("homeContext.tooMany");
    expect(result.current.contextItems).toHaveLength(20);
    expect(mocks.call).toHaveBeenCalledTimes(calls);
  });
  it.each([201, 2048])(
    "reads a %i-character website URL without sending it as an id, including retry and submit",
    async (length) => {
      const value = website.padEnd(length, "a");
      const { result } = renderHook(() => useHomePromptContext(defaults));
      expect(
        picker(result.current, "website-reference").link!.validate!(value),
      ).toBeUndefined();
      await act(async () => addWebsite(result.current, value));
      await act(async () =>
        result.current.retry(result.current.contextItems[0].key),
      );
      await act(async () =>
        result.current.prepareSubmission(
          snapshotComposerContextItems(result.current.contextItems),
        ),
      );
      expect(mocks.call.mock.calls).toHaveLength(3);
      for (const [, params] of mocks.call.mock.calls)
        expect(params).toEqual({
          source: "website",
          operation: "read",
          url: value,
          page: 1,
        });
    },
  );
  it("rejects oversized URLs locally and accepts surrounding whitespace", () => {
    const { result } = renderHook(() => useHomePromptContext(defaults));
    const validate = picker(result.current, "website-reference").link?.validate;
    if (!validate) throw new Error("Missing website validation");
    expect(validate(website.padEnd(2049, "a"))).toBe(
      "homeContext.invalidWebsiteUrl",
    );
    expect(validate("  " + website + "  ")).toBeUndefined();
    expect(mocks.call).not.toHaveBeenCalled();
  });
  it("shows genuine provider failure, blocks sending, then retries and removes", async () => {
    const pending = deferred();
    mocks.call.mockReturnValueOnce(pending.promise);
    const { result } = renderHook(() => useHomePromptContext(defaults));
    act(() => {
      void batch(result.current, [designItem("design-one")]);
    });
    expect(() =>
      snapshotComposerContextItems(result.current.contextItems),
    ).toThrow();
    await act(async () =>
      pending.reject(new Error("Action failed: Design access required")),
    );
    expect(result.current.contextItems[0]).toMatchObject({
      status: "error",
      statusMessage: "Design access required",
    });
    expect(() =>
      snapshotComposerContextItems(result.current.contextItems),
    ).toThrow();
    await act(async () =>
      result.current.retry(result.current.contextItems[0].key),
    );
    const frozen = snapshotComposerContextItems(result.current.contextItems);
    act(() => result.current.remove(result.current.contextItems[0].key));
    expect(result.current.contextItems).toEqual([]);
    expect(frozen[0].context).toBe("Bounded visual context");
  });
  it("does not resurrect a removed or re-added reference from an old response", async () => {
    const old = deferred(),
      next = deferred();
    mocks.call
      .mockReturnValueOnce(old.promise)
      .mockReturnValueOnce(next.promise);
    const { result } = renderHook(() => useHomePromptContext(defaults));
    act(() => addWebsite(result.current));
    act(() => result.current.remove(result.current.contextItems[0].key));
    act(() => addWebsite(result.current));
    await act(async () =>
      old.resolve({ id: "ref", title: "Old", context: "Old" }),
    );
    expect(result.current.contextItems[0].status).toBe("pending");
    await act(async () =>
      next.resolve({ id: "ref", title: "New", context: "New" }),
    );
    expect(result.current.contextItems[0].context).toBe("New");
  });
  it("clears identity-specific context and prevents pending reads repopulating", async () => {
    const old = deferred();
    mocks.call.mockReturnValueOnce(old.promise);
    const { result, rerender } = renderHook(() =>
      useHomePromptContext(defaults),
    );
    act(() => addWebsite(result.current));
    mocks.session = {
      email: "other@example.com",
      orgId: "other",
      authUserId: undefined,
    };
    rerender();
    await act(async () =>
      old.resolve({ id: "ref", title: "Private", context: "Old account" }),
    );
    expect(result.current.contextItems).toEqual([]);
    expect(mocks.select).toHaveBeenCalledWith(null);
  });
  it("revalidates access, freezes fresh text, and makes revoked access visibly blocking", async () => {
    const { result } = renderHook(() => useHomePromptContext(defaults));
    await act(async () => addWebsite(result.current));
    const original = snapshotComposerContextItems(result.current.contextItems);
    mocks.call.mockResolvedValueOnce({
      id: "ref",
      title: "Reference",
      context: "Fresh",
    });
    const fresh = await result.current.prepareSubmission(original);
    expect(fresh?.[0].context).toBe("Fresh");
    expect(Object.isFrozen(fresh)).toBe(true);
    expect(original[0].context).toBe("Bounded visual context");
    mocks.call.mockRejectedValueOnce(
      new Error("Action failed: Access revoked"),
    );
    await act(async () => {
      await expect(result.current.prepareSubmission(fresh)).rejects.toThrow(
        "Access revoked",
      );
    });
    expect(result.current.contextItems[0]).toMatchObject({
      context: "",
      status: "error",
      statusMessage: "Access revoked",
    });
  });
  it("captures selected system ids before awaiting and binds context to the current id", async () => {
    const { result, rerender } = renderHook(
      (props: Props) => useHomePromptContext(props),
      {
        initialProps: {
          ...defaults,
          systemId: "a",
          systems: [{ id: "a", title: "A", ready: true }],
        },
      },
    );
    await waitFor(() =>
      expect(result.current.contextItems[0].status).toBe("ready"),
    );
    const pending = deferred();
    mocks.call.mockReturnValueOnce(pending.promise);
    const submitted = result.current.prepareSubmission(
      snapshotComposerContextItems(result.current.contextItems),
    );
    rerender({ ...defaults, systemId: null });
    await act(async () => pending.resolve({ agentContext: "Validated A" }));
    expect((await submitted)?.[0].context).toBe("Validated A");
    expect(result.current.contextItems).toEqual([]);
  });
  it("blocks in-flight submit across org changes and permits metadata-only templates", async () => {
    const { result, rerender } = renderHook(() =>
      useHomePromptContext({
        ...defaults,
        templates: [{ id: "tpl", title: "Template", isBuiltIn: true }],
        templateId: "tpl",
      }),
    );
    expect(
      (
        await result.current.prepareSubmission(
          snapshotComposerContextItems(result.current.contextItems),
        )
      )?.[0].context,
    ).toBe("");
    expect(mocks.call).not.toHaveBeenCalled();
    await act(async () => addWebsite(result.current));
    const pending = deferred();
    mocks.call.mockReturnValueOnce(pending.promise);
    const submitted = result.current.prepareSubmission(
      snapshotComposerContextItems(result.current.contextItems),
    );
    const rejection = expect(submitted).rejects.toThrow(
      "homeContext.loadFailed",
    );
    mocks.session = {
      email: "other@example.com",
      orgId: "other",
      authUserId: undefined,
    };
    rerender();
    await act(async () =>
      pending.resolve({ id: "ref", title: "Old", context: "Old" }),
    );
    await rejection;
  });
  it("forwards search, paging, abort and live refresh without changing identity scope", async () => {
    const { result, rerender } = renderHook(() =>
      useHomePromptContext(defaults),
    );
    mocks.call.mockResolvedValueOnce({ designs: [], hasMore: true });
    const input = request({ search: "campaign", page: 2, cursor: "next" });
    await expect(load(result.current)(input)).resolves.toEqual({
      items: [],
      hasMore: true,
    });
    expect(mocks.call).toHaveBeenLastCalledWith(
      "list-designs",
      { includePreview: "true", pageSize: 12, search: "campaign", page: 2 },
      { method: "GET", signal: input.signal },
    );
    const scope = picker(result.current).scopeKey;
    mocks.refresh = 3;
    rerender();
    expect(picker(result.current)).toMatchObject({
      scopeKey: scope,
      refreshKey: 3,
    });
  });
  it.each([{ items: [] }, { context: "not a list" }])(
    "rejects malformed catalogs %j",
    async (data) => {
      const { result } = renderHook(() => useHomePromptContext(defaults));
      mocks.call.mockResolvedValueOnce(data);
      await expect(load(result.current)(request())).rejects.toThrow(
        "homeContext.loadFailed",
      );
    },
  );
});
