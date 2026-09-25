// @vitest-environment happy-dom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const { callAction, query, identity } = vi.hoisted(() => ({
  callAction: vi.fn(),
  query: { refresh: 0 },
  identity: { email: "one@example.test", orgId: "one" },
}));
const translate = (key: string) => key;
vi.mock("@agent-native/core/client/i18n", () => ({ useT: () => translate }));
vi.mock("@agent-native/core/client/hooks", () => ({
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

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  identity.email = "one@example.test";
  identity.orgId = "one";
  query.refresh = 0;
  callAction.mockImplementation(async (_action, args) => ({
    id: args.id,
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

describe("Slides context readiness and identity", () => {
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
      localStorage.getItem("slides-home-context:one@example.test:one"),
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
  it("keeps both app sources in the agreed hierarchy with shared-only source views", async () => {
    const { result } = renderHook(() => useSlidesComposerContext(defaults));
    const entries = result.current.props.contextMenuItems;
    expect(entries.map((entry) => entry.id)).toEqual(["design-context"]);
    expect(entries[0].children?.map((entry) => entry.id)).toEqual([
      "system",
      "figma",
      "design",
      "slides",
    ]);
    expect(entries[0].children?.map((entry) => entry.label)).toEqual([
      "home.context.menu.system",
      "home.context.menu.figma",
      "home.context.menu.design",
      "home.context.menu.deck",
    ]);
    expect(
      entries[0].children?.every(
        (entry) => "picker" in entry && !("render" in entry),
      ),
    ).toBe(true);
    expect(
      "searchPlaceholder" in entries[0] && entries[0].searchPlaceholder,
    ).toBe("home.context.menu.searchDesign");
    for (const [id, key] of [
      ["system", "searchSystems"],
      ["figma", "searchFrames"],
      ["design", "searchDesigns"],
      ["slides", "searchPresentations"],
    ]) {
      expect(picker(result.current, id).searchPlaceholder).toBe(
        `home.context.${key}`,
      );
    }
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
      picker(result.current, "slides").load!(input),
    ).resolves.toMatchObject({ hasMore: true, nextCursor: "third" });
    expect(callAction).toHaveBeenLastCalledWith(
      "read-composer-source",
      {
        source: "slides",
        operation: "list",
        search: "campaign",
        page: 2,
        cursor: "next",
      },
      { method: "GET", signal: input.signal },
    );
    const scope = picker(result.current, "slides").scopeKey;
    query.refresh = 3;
    rerender();
    expect(picker(result.current, "slides")).toMatchObject({
      scopeKey: scope,
      refreshKey: 3,
    });
  });
  it.each([
    { items: [] },
    { items: [], hasMore: true },
    { context: "wrong shape" },
  ])("rejects malformed/unpageable catalogs: %j", async (data) => {
    const { result } = renderHook(() => useSlidesComposerContext(defaults));
    callAction.mockResolvedValueOnce(data);
    await expect(
      picker(result.current, "slides").load!(request()),
    ).rejects.toThrow("home.context.loadFailed");
  });
  it("surfaces real action errors and can retry without an app-owned picker view", async () => {
    const { result } = renderHook(() => useSlidesComposerContext(defaults));
    callAction.mockRejectedValueOnce(
      new Error("Action failed: Design app connection required"),
    );
    await expect(
      picker(result.current, "design").load!(request()),
    ).rejects.toThrow("Design app connection required");
    callAction.mockResolvedValueOnce({ items: [], hasMore: false });
    await expect(
      picker(result.current, "design").load!(request()),
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
    await act(async () =>
      picker(result.current, "figma").onSelect(
        listed.items[0],
        request({ url }),
      ),
    );
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
});
