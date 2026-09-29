import type { AssistantChatComposerContext } from "@agent-native/toolkit/app/chat/chat";
import { snapshotComposerContextItems } from "@agent-native/toolkit/composer/context-items";
// @vitest-environment happy-dom
import {
  act,
  cleanup,
  render,
  renderHook,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const { callAction, query, identity, navigate, capabilities } = vi.hoisted(
  () => ({
    callAction: vi.fn(),
    query: { refresh: 0, enabled: true },
    identity: {
      email: "one@example.test",
      orgId: "one",
      authUserId: undefined as string | undefined,
    },
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
  }),
);
vi.mock(
  "@agent-native/toolkit/app/chat/composer/index",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("@agent-native/toolkit/app/chat/composer/index")
    >()),
    useAgentKitCapabilities: () => capabilities,
  }),
);
vi.mock("@/hooks/use-design-system-workflows", () => ({
  useDesignSystemWorkflows: () => query.enabled,
}));
vi.mock("@/hooks/use-design-systems", () => ({
  useDesignSystems: () => ({
    designSystems: [],
    isLoading: false,
    refetch: vi.fn(),
  }),
}));
const translate = (key: string) => key;
vi.mock("@agent-native/core/client/i18n", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/client/i18n")>()),
  useT: () => translate,
  useFormatters: () => ({ formatDate: (value: string) => value }),
}));
vi.mock("@/components/deck/SlideRenderer", () => ({ default: () => null }));
vi.mock("react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-router")>()),
  useNavigate: () => navigate,
}));
vi.mock("@agent-native/core/client/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/client/hooks")>()),
  callAction,
  actionErrorMessage: (error: Error) =>
    error?.message.replace(/^Action failed: /, ""),
  useSession: () => ({ session: identity }),
  useChangeVersions: () => query.refresh,
}));
vi.mock("@agent-native/toolkit/composer", async () => ({
  ...(await vi.importActual("@agent-native/toolkit/composer/context-items")),
}));
import { useSlidesComposerContext } from "./SlidesComposerContext";
import { SlidesComposerContextProvider } from "./SlidesComposerContextProvider";

beforeEach(() => {
  vi.clearAllMocks();
  const storage = new Map<string, string>();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      clear: () => storage.clear(),
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
      key: (index: number) => [...storage.keys()][index] ?? null,
      get length() {
        return storage.size;
      },
    },
  });
  window.localStorage.clear();
  identity.email = "one@example.test";
  identity.orgId = "one";
  identity.authUserId = undefined;
  capabilities.data = {
    sources: { figma: { available: true } },
    integrations: [],
  };
  navigate.mockReset();
  query.refresh = 0;
  query.enabled = true;
  callAction.mockImplementation(async (_action, args) => ({
    id: args.id ?? "website-hash",
    title: "Reference",
    context: "Visual language",
  }));
});
afterEach(cleanup);
const defaults = {
  defaultDesignSystemId: null,
  systems: [],
  onCreateDesignSystem: vi.fn(),
};
const deck = { id: "deck", title: "Deck" };
function picker(
  controller: ReturnType<typeof useSlidesComposerContext>,
  id: string,
) {
  const item = controller.props.contextMenuItems[0].children!.find(
    (item) => item.id === id,
  )!;
  if (!("picker" in item) || !item.picker)
    throw new Error("Missing shared picker");
  return item.picker;
}
const request = (extra = {}) => ({
  search: "",
  page: 1,
  signal: new AbortController().signal,
  ...extra,
});

function attachFrames(
  controller: ReturnType<typeof useSlidesComposerContext>,
  items: { id: string; title: string; url?: string }[],
  url = "https://www.figma.com/design/example-one/Example",
) {
  const presentation = picker(controller, "figma").presentation;
  if (
    !presentation ||
    presentation === "submenu" ||
    presentation.mode !== "multiple"
  )
    throw new Error("Missing dialog");
  return presentation.onAttach(items, request({ url }));
}

describe("Slides context readiness and identity", () => {
  it("restores reference metadata across same-thread surface remounts and re-reads content", async () => {
    let model!: AssistantChatComposerContext;
    const provider = (threadId: string, tabId: string) => (
      <SlidesComposerContextProvider threadId={threadId} tabId={tabId} isActive>
        {(value) => {
          model = value;
          return null;
        }}
      </SlidesComposerContextProvider>
    );
    const view = render(provider("thread", "sidebar-tab"));
    const action = model.menuItems[0].children!.find(
      (item) => item.id === "website",
    )!;
    if (!("picker" in action) || !action.picker?.onSelect)
      throw new Error("Missing website picker");
    const url = "https://example.com/reference";
    await act(async () =>
      action.picker!.onSelect!({ id: url, title: "Website" }, request()),
    );
    await waitFor(() => expect(model.contextItems[0]?.status).toBe("ready"));
    view.rerender(<></>);
    callAction.mockResolvedValueOnce({
      id: "website-hash",
      title: "Website",
      context: "Fresh after handoff",
    });
    view.rerender(provider("thread", "page-tab"));
    await waitFor(() =>
      expect(model.contextItems[0]?.context).toBe("Fresh after handoff"),
    );
    const stored = [...Array(window.localStorage.length)]
      .map((_, index) =>
        window.localStorage.getItem(window.localStorage.key(index)!),
      )
      .join("");
    expect(stored).toContain(url);
    expect(stored).not.toContain("Visual language");
    expect(stored).not.toContain("Fresh after handoff");
    view.rerender(provider("other-thread", "other-tab"));
    expect(model.contextItems).toEqual([]);
    identity.authUserId = "different-auth-user";
    view.rerender(provider("thread", "page-tab"));
    expect(model.contextItems).toEqual([]);
    identity.authUserId = undefined;
    identity.orgId = "different-org";
    view.rerender(provider("thread", "page-tab"));
    expect(model.contextItems).toEqual([]);
    identity.orgId = "one";
    view.rerender(provider("thread", "page-tab"));
    await waitFor(() => expect(model.contextItems[0]?.status).toBe("ready"));
    let prepared!: typeof model.contextItems;
    await act(async () => {
      prepared = await model.prepareSubmission(model.contextItems);
    });
    act(() => model.submissionAccepted(prepared));
    view.rerender(<></>);
    view.rerender(provider("thread", "sidebar-tab"));
    expect(model.contextItems).toEqual([]);
  });
  it("mounts a distinct controller per chat and resets for a different authentication identity", async () => {
    const models = new Map<string, AssistantChatComposerContext>();
    const providers = () =>
      ["one", "two"].map((threadId) => (
        <SlidesComposerContextProvider
          key={threadId}
          threadId={threadId}
          tabId={threadId}
          isActive={threadId === "one"}
        >
          {(model) => {
            models.set(threadId, model);
            return null;
          }}
        </SlidesComposerContextProvider>
      ));
    const view = render(<>{providers()}</>);
    const action = models
      .get("one")!
      .menuItems[0].children!.find((item) => item.id === "website")!;
    if (!("picker" in action) || !action.picker?.onSelect)
      throw new Error("Missing website picker");
    await act(async () =>
      action.picker!.onSelect!(
        { id: "https://example.com/one", title: "One" },
        request(),
      ),
    );
    await waitFor(() =>
      expect(models.get("one")!.contextItems[0]?.status).toBe("ready"),
    );
    expect(models.get("two")!.contextItems).toEqual([]);
    expect(models.get("two")!.menuItems).toEqual([]);
    identity.authUserId = "another-auth-identity";
    view.rerender(<>{providers()}</>);
    expect(models.get("one")!.contextItems).toEqual([]);
    expect(models.get("two")!.contextItems).toEqual([]);
  });
  it("does not share chat selections with another thread or persisted Home context", async () => {
    const saved = JSON.stringify({
      designSystemId: null,
      references: [{ source: "slides", id: "home", title: "Home" }],
    });
    window.localStorage.setItem(
      "slides-home-context:one@example.test:one",
      saved,
    );
    const first = renderHook(() =>
      useSlidesComposerContext({
        ...defaults,
        scopeKey: "one",
        persistSelection: false,
      }),
    );
    const second = renderHook(() =>
      useSlidesComposerContext({
        ...defaults,
        scopeKey: "two",
        persistSelection: false,
      }),
    );
    expect(first.result.current.props.contextItems).toEqual([]);
    const website = picker(first.result.current, "website");
    await act(async () =>
      website.onSelect!(
        { id: "https://example.com/one", title: "One" },
        request(),
      ),
    );
    await waitFor(() =>
      expect(first.result.current.props.contextItems[0]?.status).toBe("ready"),
    );
    expect(second.result.current.props.contextItems).toEqual([]);
    expect(
      window.localStorage.getItem("slides-home-context:one@example.test:one"),
    ).toBe(saved);
  });

  it("revalidates exactly the captured subset and clears it without dropping later additions", async () => {
    const { result } = renderHook(() =>
      useSlidesComposerContext({ ...defaults, persistSelection: false }),
    );
    const url = "https://example.com/one";
    await act(async () =>
      picker(result.current, "website").onSelect!(
        { id: url, title: "One" },
        request(),
      ),
    );
    await waitFor(() =>
      expect(result.current.props.contextItems[0]?.status).toBe("ready"),
    );
    const captured = snapshotComposerContextItems(
      result.current.props.contextItems,
    );
    await act(async () =>
      picker(result.current, "website").onSelect!(
        { id: "https://example.com/two", title: "Two" },
        request(),
      ),
    );
    await waitFor(() =>
      expect(
        result.current.props.contextItems.every(
          (item) => item.status === "ready",
        ),
      ).toBe(true),
    );
    callAction.mockClear();
    callAction.mockResolvedValueOnce({
      id: "website-hash",
      title: "Refreshed",
      context: "New source content",
    });
    let prepared!: Awaited<ReturnType<typeof result.current.beforeSend>>;
    await act(async () => {
      prepared = await result.current.beforeSend(captured);
    });
    expect(prepared.items).toHaveLength(1);
    expect(prepared.items[0].context).toBe("New source content");
    expect(callAction).toHaveBeenCalledTimes(1);
    expect(callAction.mock.calls[0][1].url).toBe(url);
    act(() => result.current.submissionAccepted(prepared.items));
    await waitFor(() =>
      expect(result.current.props.contextItems).toHaveLength(1),
    );
    expect(result.current.props.contextItems[0].key).toContain(
      "https://example.com/two",
    );
  });

  it("keeps a same-key replacement when an earlier version finishes submission", async () => {
    const { result } = renderHook(() =>
      useSlidesComposerContext({ ...defaults, persistSelection: false }),
    );
    const reference = { id: "https://example.com/one", title: "One" };
    await act(async () =>
      picker(result.current, "website").onSelect!(reference, request()),
    );
    await waitFor(() =>
      expect(result.current.props.contextItems[0]?.status).toBe("ready"),
    );
    const captured = snapshotComposerContextItems(
      result.current.props.contextItems,
    );
    let resolve!: (value: unknown) => void;
    callAction.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const pending = result.current.beforeSend(captured);
    await act(async () =>
      picker(result.current, "website").onSelect!(
        { ...reference, title: "Replacement" },
        request(),
      ),
    );
    resolve({
      id: "website-hash",
      title: "Original",
      context: "Old source revalidated",
    });
    let prepared!: Awaited<ReturnType<typeof result.current.beforeSend>>;
    await act(async () => {
      prepared = await pending;
    });
    act(() => result.current.submissionAccepted(prepared.items));
    await waitFor(() =>
      expect(result.current.props.contextItems).toHaveLength(1),
    );
  });

  it("uses captured versions even when preparation starts after a same-key replacement", async () => {
    const { result } = renderHook(() =>
      useSlidesComposerContext({ ...defaults, persistSelection: false }),
    );
    const reference = { id: "https://example.com/one", title: "One" };
    await act(async () =>
      picker(result.current, "website").onSelect!(reference, request()),
    );
    await waitFor(() =>
      expect(result.current.props.contextItems[0]?.status).toBe("ready"),
    );
    const captured = snapshotComposerContextItems(
      result.current.props.contextItems,
    );
    const capturedController = result.current;
    await act(async () =>
      picker(result.current, "website").onSelect!(reference, request()),
    );
    let prepared!: Awaited<ReturnType<typeof result.current.beforeSend>>;
    await act(async () => {
      prepared = await capturedController.beforeSend(captured);
    });
    act(() => result.current.submissionAccepted(prepared.items));
    expect(result.current.props.contextItems).toHaveLength(1);
  });
  it("rejects a stale picker after its chat becomes inactive", () => {
    const { result, rerender } = renderHook(
      ({ active }) =>
        useSlidesComposerContext({
          ...defaults,
          active,
          persistSelection: false,
        }),
      { initialProps: { active: true } },
    );
    const website = picker(result.current, "website");
    rerender({ active: false });
    expect(result.current.props.contextMenuItems).toEqual([]);
    expect(() =>
      website.onSelect!(
        { id: "https://example.com", title: "Stale" },
        request(),
      ),
    ).toThrow("home.context.loadFailed");
    expect(result.current.props.contextItems).toEqual([]);
  });
  it("blocks submission and retains an error selection when an attached integration is revoked", async () => {
    const integration = {
      id: "provider-api:figma",
      label: "Figma",
      kind: "provider-api" as const,
    };
    capabilities.data.integrations = [integration];
    const { result, rerender } = renderHook(() =>
      useSlidesComposerContext({ ...defaults, persistSelection: false }),
    );
    await act(async () =>
      picker(result.current, "integrations").onSelect!(
        { id: integration.id, title: integration.label },
        request(),
      ),
    );
    await waitFor(() =>
      expect(result.current.props.contextItems[0]?.status).toBe("ready"),
    );
    const captured = snapshotComposerContextItems(
      result.current.props.contextItems,
    );
    capabilities.data.integrations = [];
    rerender();
    callAction.mockRejectedValueOnce(
      Object.assign(new Error("Integration is no longer available"), {
        status: 403,
      }),
    );
    const send = vi.fn();
    await act(async () => {
      await expect(
        result.current.beforeSend(captured).then(send),
      ).rejects.toThrow("home.context.notReady");
    });
    expect(send).not.toHaveBeenCalled();
    expect(result.current.props.contextItems).toEqual([
      expect.objectContaining({
        key: captured[0].key,
        status: "error",
        context: "",
        statusMessage: "Integration is no longer available",
      }),
    ]);
  });
  it("removes context picker actions while the Home route is inactive", () => {
    const { result } = renderHook(() =>
      useSlidesComposerContext({ ...defaults, active: false }),
    );

    expect(result.current.props.contextMenuItems).toEqual([]);
    expect(callAction).not.toHaveBeenCalled();
  });

  it("ignores reference reads that finish after the Home route deactivates", async () => {
    let resolve!: (value: unknown) => void;
    callAction.mockReturnValue(new Promise((done) => (resolve = done)));
    const { result, rerender } = renderHook(
      ({ active }) =>
        useSlidesComposerContext({
          ...defaults,
          active,
          defaultReferenceDeck: deck,
        }),
      { initialProps: { active: true } },
    );

    await waitFor(() => expect(callAction).toHaveBeenCalledOnce());
    rerender({ active: false });
    await act(async () =>
      resolve({
        id: "deck",
        title: "Deck",
        context: "Loaded after deactivation",
      }),
    );

    expect(result.current.props.contextItems[0]).toMatchObject({
      status: "pending",
      context: "",
    });
  });

  it("blocks pending reads and retryable concrete failures before generation", async () => {
    let reject!: (error: Error) => void;
    callAction.mockReturnValue(
      new Promise((_resolve, fail) => {
        reject = fail;
      }),
    );
    const { result } = renderHook(() =>
      useSlidesComposerContext({ ...defaults, defaultReferenceDeck: deck }),
    );
    await waitFor(() =>
      expect(result.current.props.contextItems[0]?.status).toBe("pending"),
    );
    await expect(result.current.beforeSend()).rejects.toThrow(
      "home.context.notReady",
    );
    await act(async () =>
      reject(new Error("Action failed: Deck access denied")),
    );
    expect(result.current.props.contextItems[0]).toMatchObject({
      status: "error",
      statusMessage: "Deck access denied",
    });
    await expect(result.current.beforeSend()).rejects.toThrow(
      "home.context.notReady",
    );
    callAction.mockResolvedValue({
      id: "deck",
      title: "Deck",
      context: "Recovered context",
    });
    act(() => result.current.props.onRetryContextItem());
    await waitFor(() =>
      expect(result.current.props.contextItems[0]?.status).toBe("ready"),
    );
    let snapshot!: Awaited<ReturnType<typeof result.current.beforeSend>>;
    await act(async () => {
      snapshot = await result.current.beforeSend();
    });
    expect(snapshot.items[0].context).toBe("Recovered context");
    expect(Object.isFrozen(snapshot.items)).toBe(true);
  });
  it("does not resurrect removed context when a read finishes later", async () => {
    let resolve!: (result: unknown) => void;
    callAction.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const { result } = renderHook(() =>
      useSlidesComposerContext({ ...defaults, defaultReferenceDeck: deck }),
    );
    await waitFor(() =>
      expect(result.current.props.contextItems[0]?.status).toBe("pending"),
    );
    act(() => result.current.props.onRemoveContextItem("slides:deck:"));
    await act(async () =>
      resolve({ id: "deck", title: "Deck", context: "Late data" }),
    );
    expect(result.current.props.contextItems).toEqual([]);
    expect(
      window.localStorage.getItem("slides-home-context:one@example.test:one"),
    ).toContain('"references":[]');
  });
  it("resets selection for another identity and rejects an in-flight send", async () => {
    const { result, rerender } = renderHook(() =>
      useSlidesComposerContext({
        ...defaults,
        defaultReferenceDeck:
          identity.email === "one@example.test" ? deck : undefined,
      }),
    );
    await waitFor(() =>
      expect(result.current.props.contextItems[0]?.status).toBe("ready"),
    );
    let resolve!: (result: unknown) => void;
    callAction.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const pending = result.current.beforeSend();
    const rejected = expect(pending).rejects.toThrow("home.context.loadFailed");
    identity.email = "two@example.test";
    identity.orgId = "two";
    rerender();
    await act(async () =>
      resolve({ id: "deck", title: "Deck", context: "Old identity context" }),
    );
    await rejected;
    expect(result.current.props.contextItems).toEqual([]);
  });
  it("registers the deck reference with shared-only source views", async () => {
    const { result } = renderHook(() => useSlidesComposerContext(defaults));
    const entries = result.current.props.contextMenuItems;
    expect(entries.map((entry) => entry.id)).toEqual(["design-context"]);
    expect(entries[0].children?.map((entry) => entry.id)).toEqual([
      "deck",
      "system",
      "figma",
      "website",
      "integrations",
    ]);
    expect(entries[0].children?.map((entry) => entry.label)).toEqual([
      "home.context.menu.deck",
      "home.context.menu.system",
      "home.context.menu.figma",
      "home.context.websiteReference",
      "agentChat.composer.menu.integrations",
    ]);
    expect(
      entries[0].children
        ?.filter((entry) => "picker" in entry)
        .every((entry) => "picker" in entry && !("render" in entry)),
    ).toBe(true);
    expect(
      "searchPlaceholder" in entries[0] && entries[0].searchPlaceholder,
    ).toBe("home.context.menu.searchDesign");
    for (const [id, key] of [
      ["deck", "searchPresentations"],
      ["system", "searchSystems"],
      ["figma", "searchFrames"],
      ["website", "websiteUrl"],
    ]) {
      expect(picker(result.current, id).searchPlaceholder).toBe(
        `home.context.${key}`,
      );
    }
  });
  it("lists, attaches, revalidates and removes a deck through the source action", async () => {
    const id = "deck";
    const source = "slides";
    query.enabled = false;
    const { result } = renderHook(() => useSlidesComposerContext(defaults));
    expect(result.current.props.contextMenuItems[0].children).toContainEqual(
      expect.objectContaining({ id, intent: "add-context" }),
    );
    const input = request({ search: "campaign", page: 2, cursor: "next" });
    const references = [{ id: "reference-one", title: "Campaign" }];
    callAction.mockResolvedValueOnce({
      decks: references.map((item) => ({
        ...item,
        updatedAt: "2026-09-28T00:00:00Z",
        previewSlide: { id: "slide-one", content: "<h1>Campaign</h1>" },
      })),
    });
    const sourcePicker = picker(result.current, id);
    const listed = await sourcePicker.load!(input);
    expect(callAction).toHaveBeenLastCalledWith(
      "list-decks",
      {
        includePreview: "true",
        limit: 12,
        search: "campaign",
        cursor: "next",
      },
      { method: "GET", signal: input.signal },
    );
    expect(result.current.props.contextItems).toEqual([]);
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
    expect(callAction).toHaveBeenLastCalledWith(
      "read-composer-source",
      { source, operation: "read", id: "reference-one" },
      { method: "GET" },
    );
    expect(picker(result.current, id).selectedIds).toEqual(["reference-one"]);
    await waitFor(() =>
      expect(result.current.props.contextItems[0]).toMatchObject({
        status: "ready",
        context: "Visual language",
      }),
    );
    callAction.mockResolvedValueOnce({
      id: "reference-one",
      title: "Campaign",
      context: "Fresh reference",
    });
    await act(async () => {
      const submitted = await result.current.beforeSend();
      expect(submitted.selection.references).toEqual([
        { ...references[0], source },
      ]);
      expect(submitted.items[0].context).toBe("Fresh reference");
    });
    expect(callAction).toHaveBeenLastCalledWith(
      "read-composer-source",
      { source, operation: "read", id: "reference-one" },
      { method: "GET" },
    );
    await act(async () =>
      result.current.props.onRemoveContextItem(
        result.current.props.contextItems[0].key,
      ),
    );
    expect(result.current.props.contextItems).toEqual([]);
    expect(picker(result.current, id).selectedIds).toEqual([]);
  });
  it("gates Figma and exposes ready integrations through the shared source action", async () => {
    capabilities.data = {
      sources: { figma: { available: false } },
      integrations: [
        {
          id: "google_drive",
          label: "Google Drive",
          kind: "provider-api",
        },
      ],
    };
    const { result } = renderHook(() => useSlidesComposerContext(defaults));
    const entries = result.current.props.contextMenuItems[0].children!;
    expect(entries.some((entry) => entry.id === "figma")).toBe(false);
    const integrations = entries.find((entry) => entry.id === "integrations");
    expect(integrations).toMatchObject({ intent: "invoke-integration" });
    const integrationPicker = picker(result.current, "integrations");
    expect(integrationPicker.items).toEqual([
      { id: "google_drive", title: "Google Drive" },
    ]);
    act(() => {
      void integrationPicker.onSelect!(
        { id: "google_drive", title: "Google Drive" },
        request(),
      );
    });
    await waitFor(() =>
      expect(callAction).toHaveBeenCalledWith(
        "read-composer-source",
        {
          source: "integration",
          operation: "read",
          id: "google_drive",
        },
        { method: "GET" },
      ),
    );
    expect(navigate).not.toHaveBeenCalled();
  });
  it("forwards paging and cancellation and refreshes without resetting identity scope", async () => {
    const { result, rerender } = renderHook(() =>
      useSlidesComposerContext(defaults),
    );
    const input = request({ search: "campaign", page: 2, cursor: "next" });
    callAction.mockResolvedValueOnce({
      items: [],
      hasMore: true,
      nextCursor: "third",
    });
    await expect(
      picker(result.current, "figma").load!(input),
    ).resolves.toMatchObject({ hasMore: true, nextCursor: "third" });
    expect(callAction).toHaveBeenLastCalledWith(
      "read-composer-source",
      {
        source: "figma",
        figmaUrl: undefined,
        operation: "list",
        search: "campaign",
        page: 2,
        cursor: "next",
      },
      { method: "GET", signal: input.signal },
    );
    const scope = picker(result.current, "figma").scopeKey;
    query.refresh = 3;
    rerender();
    expect(picker(result.current, "figma")).toMatchObject({
      scopeKey: scope,
      refreshKey: 3,
    });
  });
  it.each([{ items: [] }, { context: "wrong shape" }])(
    "rejects malformed/unpageable catalogs: %j",
    async (data) => {
      const { result } = renderHook(() => useSlidesComposerContext(defaults));
      callAction.mockResolvedValueOnce(data);
      await expect(
        picker(result.current, "figma").load!(request()),
      ).rejects.toThrow("home.context.loadFailed");
    },
  );
  it("surfaces real action errors and can retry without an app-owned picker view", async () => {
    const { result } = renderHook(() => useSlidesComposerContext(defaults));
    callAction.mockRejectedValueOnce(
      new Error("Action failed: Design app connection required"),
    );
    await expect(
      picker(result.current, "figma").load!(request()),
    ).rejects.toThrow("Design app connection required");
    callAction.mockResolvedValueOnce({ items: [], hasMore: false });
    await expect(
      picker(result.current, "figma").load!(request()),
    ).resolves.toEqual({ items: [], hasMore: false });
  });
  it("offers the actual creator for empty systems without a lone None choice", async () => {
    const { result } = renderHook(() => useSlidesComposerContext(defaults));
    const system = picker(result.current, "system");
    expect(system).toMatchObject({
      items: [],
      emptyMessage: "home.context.noSystems",
    });
    expect(system.clearSelection).toBeUndefined();
    expect(system.footerAction?.label).toBe("home.context.createSystem");
    await act(async () => system.footerAction!.onSelect!());
    expect(defaults.onCreateDesignSystem).toHaveBeenCalledOnce();
  });
  it("passes selected systems, loading, errors and retry without removing the creator", async () => {
    callAction.mockResolvedValue({
      title: "Brand",
      agentContext: "Brand tokens",
    });
    const retry = vi.fn();
    const { result } = renderHook(() =>
      useSlidesComposerContext({
        ...defaults,
        defaultDesignSystemId: "brand",
        systems: [{ id: "brand", title: "Brand" }],
        systemsLoading: true,
        systemsError: new Error("Action failed: Offline"),
        retrySystems: retry,
      }),
    );
    await waitFor(() =>
      expect(picker(result.current, "system").selectedIds).toEqual(["brand"]),
    );
    const system = picker(result.current, "system");
    expect(system).toMatchObject({ loading: true, error: "Offline" });
    expect(system.footerAction).toBeDefined();
    system.onRetry?.();
    expect(retry).toHaveBeenCalledOnce();
    await act(async () => system.clearSelection!.onSelect());
    expect(picker(result.current, "system").clearSelection).toBeUndefined();
  });
  it("scopes Figma selected checks to the file and decodes the node for reads", async () => {
    const { result } = renderHook(() => useSlidesComposerContext(defaults));
    const url = "https://www.figma.com/design/example-one/Example";
    expect(picker(result.current, "figma").link).toMatchObject({
      placeholder: "home.context.figmaUrl",
      submitLabel: "home.context.browse",
    });
    callAction.mockResolvedValueOnce({
      items: [{ id: "1:2", title: "Frame" }],
      hasMore: false,
    });
    const listed = await picker(result.current, "figma").load!(
      request({ url }),
    );
    await act(async () => attachFrames(result.current, [...listed.items], url));
    expect(callAction).toHaveBeenLastCalledWith(
      "read-composer-source",
      {
        source: "figma",
        operation: "read",
        id: "1:2",
        nodeId: "1:2",
        figmaUrl: url,
      },
      { method: "GET" },
    );
    expect(picker(result.current, "figma").selectedIds).toContain(
      listed.items[0].id,
    );
    callAction.mockResolvedValueOnce({
      items: [{ id: "1:2", title: "Frame" }],
      hasMore: false,
    });
    const other = await picker(result.current, "figma").load!(
      request({ url: "https://www.figma.com/design/example-two/Example" }),
    );
    expect(picker(result.current, "figma").selectedIds).not.toContain(
      other.items[0].id,
    );
  });

  it("keeps references available with design systems disabled and never reads an automatic or saved draft system", async () => {
    query.enabled = false;
    const key = "slides-home-context:one@example.test:one";
    const saved = JSON.stringify({ designSystemId: "saved", references: [] });
    window.localStorage.setItem(key, saved);
    const { result } = renderHook(() =>
      useSlidesComposerContext({
        ...defaults,
        defaultDesignSystemId: "default",
      }),
    );
    expect(
      result.current.props.contextMenuItems[0].children?.map((item) => item.id),
    ).toEqual(["deck", "figma", "website", "integrations"]);
    expect(result.current.props.contextItems).toEqual([]);
    expect(callAction).not.toHaveBeenCalled();
    expect(window.localStorage.getItem(key)).toBe(saved);
    const snapshot = await result.current.beforeSend();
    expect(snapshot.selection.designSystemId).toBeNull();
    expect(snapshot.text).toContain("Do not restore a workspace default");
  });
  it("keeps storage errors blocking even when system workflows are off", () => {
    query.enabled = false;
    window.localStorage.setItem(
      "slides-home-context:one@example.test:one",
      "{broken",
    );
    const { result } = renderHook(() => useSlidesComposerContext(defaults));
    expect(result.current.props.contextItems[0]).toMatchObject({
      key: "context-state",
      status: "error",
    });
  });
  it("preserves a saved system through flag-off retry and source changes, then restores it when enabled", async () => {
    query.enabled = false;
    const key = "slides-home-context:one@example.test:one";
    window.localStorage.setItem(
      key,
      JSON.stringify({
        designSystemId: "brand",
        references: [
          {
            source: "website",
            id: "https://example.com",
            title: "Site",
            url: "https://example.com",
          },
        ],
      }),
    );
    callAction.mockRejectedValueOnce(new Error("Offline"));
    const { result, rerender } = renderHook(() =>
      useSlidesComposerContext(defaults),
    );
    await waitFor(() =>
      expect(result.current.props.contextItems[0].status).toBe("error"),
    );
    act(() => result.current.props.onRetryContextItem());
    await waitFor(() =>
      expect(result.current.props.contextItems[0].status).toBe("ready"),
    );
    act(() =>
      result.current.props.onRemoveContextItem(
        result.current.props.contextItems[0].key,
      ),
    );
    expect(JSON.parse(window.localStorage.getItem(key)!).designSystemId).toBe(
      "brand",
    );
    callAction.mockResolvedValue({
      title: "Brand",
      agentContext: "Saved tokens",
    });
    query.enabled = true;
    rerender();
    await waitFor(() =>
      expect(result.current.props.contextItems[0]?.context).toBe(
        "Saved tokens",
      ),
    );
    expect(picker(result.current, "system").selectedIds).toEqual(["brand"]);
  });
  it("stages a deduplicated Figma batch once and rejects overflow without partial writes", async () => {
    const { result } = renderHook(() => useSlidesComposerContext(defaults));
    const firstUrl =
      "https://www.figma.com/design/example-one/Frame?node-id=1-2";
    const secondUrl =
      "https://www.figma.com/design/example-two/Frame?node-id=1-2";
    await act(async () =>
      attachFrames(result.current, [
        { id: "one:1%3A2", title: "One", url: firstUrl },
        { id: "two:1%3A2", title: "Two", url: secondUrl },
      ]),
    );
    expect(result.current.props.contextItems).toHaveLength(2);
    expect(callAction).toHaveBeenLastCalledWith(
      "read-composer-source",
      {
        source: "figma",
        operation: "read",
        id: "1:2",
        nodeId: "1:2",
        figmaUrl: secondUrl,
      },
      { method: "GET" },
    );
    const many = Array.from({ length: 18 }, (_, i) => ({
      id: `file:${encodeURIComponent(`2:${i}`)}`,
      title: "Frame",
      url: firstUrl,
    }));
    await act(async () => attachFrames(result.current, many));
    const saved = window.localStorage.getItem(
      "slides-home-context:one@example.test:one",
    );
    const calls = callAction.mock.calls.length;
    expect(() =>
      attachFrames(result.current, [
        { id: "file:extra", title: "Extra", url: firstUrl },
      ]),
    ).toThrow("home.context.tooMany");
    expect(result.current.props.contextItems).toHaveLength(20);
    expect(
      window.localStorage.getItem("slides-home-context:one@example.test:one"),
    ).toBe(saved);
    expect(callAction).toHaveBeenCalledTimes(calls);
    await act(async () => attachFrames(result.current, many));
    expect(result.current.props.contextItems).toHaveLength(20);
  });
  it.each([201, 2048])(
    "persists, retries and revalidates a %i-character website URL without an id parameter",
    async (length) => {
      query.enabled = false;
      const url = "https://example.com/reference?".padEnd(length, "a");
      const { result, unmount } = renderHook(() =>
        useSlidesComposerContext(defaults),
      );
      const website = picker(result.current, "website");
      expect(website.presentation).toEqual({ type: "dialog", mode: "url" });
      expect(website.load).toBeUndefined();
      expect(website.link!.validate!(url)).toBeUndefined();
      await act(async () =>
        website.onSelect!({ id: url, title: url, url }, request({ url })),
      );
      act(() => result.current.props.onRetryContextItem());
      await waitFor(() =>
        expect(result.current.props.contextItems[0]?.status).toBe("ready"),
      );
      unmount();
      const restored = renderHook(() => useSlidesComposerContext(defaults));
      await waitFor(() =>
        expect(restored.result.current.props.contextItems[0]?.status).toBe(
          "ready",
        ),
      );
      await act(async () => restored.result.current.beforeSend());
      expect(callAction.mock.calls.length).toBeGreaterThanOrEqual(4);
      for (const [, args] of callAction.mock.calls)
        expect(args).toEqual({ source: "website", operation: "read", url });
    },
  );
  it("rejects oversized Figma and website URLs locally", () => {
    const { result } = renderHook(() => useSlidesComposerContext(defaults));
    const figma = picker(result.current, "figma");
    expect(figma.onSelect).toBeUndefined();
    const url = "https://www.figma.com/design/example-one/Example";
    expect(
      figma.link!.validate!(" " + url.padEnd(2048, "a") + " "),
    ).toBeUndefined();
    expect(figma.link!.validate!(url.padEnd(2049, "a"))).toBe(
      "home.context.invalidFigmaUrl",
    );
    expect(
      picker(result.current, "website").link!.validate!(
        "https://example.com".padEnd(2049, "a"),
      ),
    ).toBe("home.quickStart.invalidUrl");
    expect(callAction).not.toHaveBeenCalled();
  });
});
