// @vitest-environment happy-dom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const { callAction, query, identity } = vi.hoisted(() => ({
  callAction: vi.fn(),
  query: { refresh: 0, enabled: true },
  identity: { email: "one@example.test", orgId: "one" },
}));
vi.mock("@/hooks/use-design-system-workflows", () => ({
  useDesignSystemWorkflows: () => query.enabled,
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
      "website",
    ]);
    expect(entries[0].children?.map((entry) => entry.label)).toEqual([
      "home.context.menu.system",
      "home.context.menu.figma",
      "home.context.websiteReference",
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
      ["website", "websiteUrl"],
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

  it("shows only Figma/website by default and never reads an automatic or saved draft system", async () => {
    query.enabled = false;
    const key = "slides-home-context:one@example.test:one";
    const saved = JSON.stringify({ designSystemId: "saved", references: [] });
    localStorage.setItem(key, saved);
    const { result } = renderHook(() =>
      useSlidesComposerContext({
        ...defaults,
        defaultDesignSystemId: "default",
      }),
    );
    expect(
      result.current.props.contextMenuItems[0].children?.map((item) => item.id),
    ).toEqual(["figma", "website"]);
    expect(result.current.props.contextItems).toEqual([]);
    expect(callAction).not.toHaveBeenCalled();
    expect(localStorage.getItem(key)).toBe(saved);
    const snapshot = await result.current.beforeSend();
    expect(snapshot.selection.designSystemId).toBeNull();
    expect(snapshot.text).toContain("Do not restore a workspace default");
  });
  it("keeps storage errors blocking even when system workflows are off", () => {
    query.enabled = false;
    localStorage.setItem("slides-home-context:one@example.test:one", "{broken");
    const { result } = renderHook(() => useSlidesComposerContext(defaults));
    expect(result.current.props.contextItems[0]).toMatchObject({
      key: "context-state",
      status: "error",
    });
  });
  it("preserves a saved system through flag-off retry and source changes, then restores it when enabled", async () => {
    query.enabled = false;
    const key = "slides-home-context:one@example.test:one";
    localStorage.setItem(
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
    expect(JSON.parse(localStorage.getItem(key)!).designSystemId).toBe("brand");
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
    const saved = localStorage.getItem(
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
      localStorage.getItem("slides-home-context:one@example.test:one"),
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
