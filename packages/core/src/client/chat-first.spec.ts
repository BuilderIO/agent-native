import { describe, expect, it, vi } from "vitest";

import {
  CHAT_FIRST_SURFACE_TABS_STORAGE_KEY,
  CHAT_FIRST_DEFAULT_APP_IDS,
  orderChatFirstAppIds,
  readChatFirstAppLayout,
  writeChatFirstAppLayout,
  CHAT_FIRST_MODE_STORAGE_KEY,
  getChatFirstSessionWatchStore,
  getChatFirstSurfaceTabsStore,
  getChatFirstSurfacePanelStore,
  clampChatFirstSurfaceWidth,
  normalizeChatFirstSessionReference,
  readChatFirstMode,
  readChatFirstModeState,
  resolveChatFirstAppTarget,
  resolveChatFirstBrowserTarget,
  resolveChatFirstSessionId,
  chatFirstSurfaceTabId,
  readChatFirstSurfaceWidth,
  writeChatFirstSurfaceWidth,
  writeChatFirstMode,
} from "./chat-first.js";

function createStorage(): Storage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
    removeItem: (key) => {
      values.delete(key);
    },
    clear: () => values.clear(),
    key: (index) => [...values.keys()][index] ?? null,
    get length() {
      return values.size;
    },
  };
}

describe("chat-first preference", () => {
  it("uses the shared first-run app order before the rest of the catalog", () => {
    expect(CHAT_FIRST_DEFAULT_APP_IDS).toEqual([
      "content",
      "design",
      "mail",
      "calendar",
      "clips",
    ]);
    expect(
      orderChatFirstAppIds(
        ["brain", "mail", "calendar", "design", "clips", "content"],
        { pinnedIds: [], orderedIds: [] },
      ),
    ).toEqual(["content", "design", "mail", "calendar", "clips", "brain"]);
  });

  it("defaults to enabled and persists an explicit opt-out", () => {
    const storage = createStorage();

    expect(storage.getItem(CHAT_FIRST_MODE_STORAGE_KEY)).toBeNull();
    expect(readChatFirstMode(storage)).toBe(true);
    expect(readChatFirstModeState(storage)).toEqual({
      enabled: true,
      availability: "available",
    });

    writeChatFirstMode(false, storage);

    expect(readChatFirstMode(storage)).toBe(false);

    writeChatFirstMode(true, storage);

    expect(readChatFirstMode(storage)).toBe(true);
  });

  it("reports storage failures instead of claiming the preference persisted", () => {
    const storage = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };

    expect(readChatFirstMode(storage)).toBe(true);
    expect(readChatFirstModeState(storage)).toEqual({
      enabled: true,
      availability: "unavailable",
    });
    expect(writeChatFirstMode(true, storage)).toEqual({
      ok: false,
      reason: "write-failed",
    });
  });

  it("persists a bounded app shelf layout and keeps pinned apps first", () => {
    const storage = createStorage();
    expect(
      writeChatFirstAppLayout(
        {
          pinnedIds: ["calendar", "calendar"],
          orderedIds: ["mail", "calendar"],
        },
        storage,
      ),
    ).toEqual({ ok: true });
    const layout = readChatFirstAppLayout(storage);

    expect(layout).toEqual({
      pinnedIds: ["calendar"],
      orderedIds: ["mail", "calendar"],
    });
    expect(
      orderChatFirstAppIds(["mail", "calendar", "design"], layout),
    ).toEqual(["calendar", "mail", "design"]);
    expect(
      orderChatFirstAppIds(["mail", "calendar", "design"], {
        pinnedIds: ["calendar"],
        orderedIds: ["design", "mail", "calendar"],
      }),
    ).toEqual(["calendar", "design", "mail"]);
  });
});

describe("chat-first app target resolution", () => {
  const apps = [
    {
      id: "mail",
      name: "Mail",
      url: "https://mail.example.com",
      path: "/mail",
    },
    {
      id: "calendar",
      name: "Calendar",
      url: "https://workspace.example.com/calendar",
      path: "/calendar",
    },
  ];

  it("turns a registered absolute target into an app-relative path", () => {
    expect(
      resolveChatFirstAppTarget(
        {
          app: "mail",
          url: "https://mail.example.com/inbox?filter=unread",
        },
        apps,
      ),
    ).toEqual({
      status: "ready",
      target: {
        appId: "mail",
        path: "/inbox?filter=unread",
      },
    });
  });

  it("rejects a URL that does not belong to the named app", () => {
    expect(
      resolveChatFirstAppTarget(
        { app: "mail", url: "https://evil.example.com/login" },
        apps,
      ),
    ).toEqual({ status: "unresolved", reason: "invalid-url" });
  });

  it("rejects an app-named target that is not registered", () => {
    expect(
      resolveChatFirstAppTarget({ app: "unknown", path: "/inbox" }, apps),
    ).toEqual({ status: "unresolved", reason: "unknown-app" });
  });

  it("builds a deep-link path for view-only targets", () => {
    expect(
      resolveChatFirstAppTarget({ app: "calendar", view: "month" }, apps),
    ).toEqual({
      status: "ready",
      target: {
        appId: "calendar",
        path: "/_agent-native/open?app=calendar&view=month",
        view: "month",
      },
    });
  });

  it("keeps non-agent-native browser targets in a visible browser surface", () => {
    expect(
      resolveChatFirstBrowserTarget({
        url: "https://example.com/docs?q=chat-first",
        title: "Docs",
      }),
    ).toEqual({
      status: "ready",
      target: {
        url: "https://example.com/docs?q=chat-first",
        title: "Docs",
      },
    });
    expect(
      resolveChatFirstBrowserTarget({
        url: "javascript:alert(1)",
      }),
    ).toEqual({ status: "unresolved", reason: "invalid-url" });
  });

  it("keeps Builder Visual Editor links out of the browser iframe", () => {
    const builderBranchUrl =
      "https://builder.io/app/projects/project-123/branch/qa-branch";

    expect(resolveChatFirstBrowserTarget({ url: builderBranchUrl })).toEqual({
      status: "ready",
      target: {
        url: builderBranchUrl,
        openExternally: true,
      },
    });
    expect(
      resolveChatFirstBrowserTarget({
        url: "https://preview.builder.cloud/app",
      }),
    ).toEqual({
      status: "ready",
      target: {
        url: "https://preview.builder.cloud/app",
      },
    });
  });
});

describe("chat-first surface panel preference", () => {
  it("starts closed and supports an explicit toggle", () => {
    const store = getChatFirstSurfacePanelStore(
      `panel-test-${Math.random().toString(36).slice(2)}`,
    );
    expect(store.getSnapshot().open).toBe(false);
    store.setOpen(true);
    expect(store.getSnapshot().open).toBe(true);
    store.toggle();
    expect(store.getSnapshot().open).toBe(false);
  });
});

describe("chat-first session watch contract", () => {
  it("resolves stable ids from run and thread-shaped payloads", () => {
    expect(resolveChatFirstSessionId({ runId: " run-42 " })).toBe("run-42");
    expect(resolveChatFirstSessionId({ threadId: "thread-7" })).toBe(
      "thread-7",
    );
    expect(resolveChatFirstSessionId({ id: "" })).toBeNull();
    expect(
      normalizeChatFirstSessionReference({
        id: "thread-7",
        title: "  Review  ",
        kind: "agent-chat",
        sourceSessionId: "source-1",
      }),
    ).toEqual({
      sessionId: "thread-7",
      title: "Review",
      kind: "agent-chat",
      sourceSessionId: "source-1",
    });
  });

  it("keeps watch state and subscriptions shared by both renderers", () => {
    const store = getChatFirstSessionWatchStore();
    store.close();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);

    store.open({ sessionId: "session-1", title: "Build" });
    expect(store.getSnapshot()).toEqual({
      target: { sessionId: "session-1", title: "Build" },
    });
    expect(listener).toHaveBeenCalledTimes(1);

    store.close();
    expect(store.getSnapshot()).toEqual({ target: null });
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
  });

  it("provides tab lifecycle operations for shared side surfaces", () => {
    const store = getChatFirstSurfaceTabsStore();
    store.closeAll();
    store.open({
      id: chatFirstSurfaceTabId("browser", "docs"),
      kind: "browser",
      title: "Docs",
      url: "https://example.com/docs",
    });
    store.open({
      id: chatFirstSurfaceTabId("app", "mail"),
      kind: "app",
      title: "Mail",
      appId: "mail",
    });
    store.open({
      id: chatFirstSurfaceTabId("files", "workspace"),
      kind: "files",
      title: "Files",
    });

    expect(store.getSnapshot().activeTabId).toBe("files:workspace");
    store.closeToRight("browser:docs");
    expect(store.getSnapshot().tabs.map((tab) => tab.id)).toEqual([
      "browser:docs",
    ]);
    store.open({
      id: "app:mail",
      kind: "app",
      title: "Mail",
      appId: "mail",
    });
    store.open({ id: "diff", kind: "diff", title: "Diff" });
    store.closeOthers("app:mail");
    expect(store.getSnapshot().tabs.map((tab) => tab.id)).toEqual(["app:mail"]);
    store.closeAll();
  });

  it("restores a valid app placement and rejects malformed persisted values", () => {
    const scope = "placement-test";
    const storage = createStorage();
    vi.stubGlobal("window", { localStorage: storage });
    storage.setItem(
      CHAT_FIRST_SURFACE_TABS_STORAGE_KEY,
      JSON.stringify({
        [scope]: {
          tabs: [
            {
              id: "app:analytics:/",
              kind: "app",
              title: "Analytics",
              appId: "analytics",
              placement: "main",
            },
            {
              id: "app:legacy:/",
              kind: "app",
              title: "Legacy",
              appId: "legacy",
            },
            {
              id: "app:invalid:/",
              kind: "app",
              title: "Invalid",
              appId: "invalid",
              placement: "floating",
            },
          ],
          activeTabId: "app:analytics:/",
        },
      }),
    );

    const store = getChatFirstSurfaceTabsStore(scope);
    expect(store.getSnapshot().tabs).toEqual([
      {
        id: "app:analytics:/",
        kind: "app",
        title: "Analytics",
        appId: "analytics",
        placement: "main",
      },
      {
        id: "app:legacy:/",
        kind: "app",
        title: "Legacy",
        appId: "legacy",
        placement: "main",
      },
    ]);
    expect(
      JSON.parse(storage.getItem(CHAT_FIRST_SURFACE_TABS_STORAGE_KEY)!)[scope]
        .tabs[1].placement,
    ).toBe("main");
    store.closeAll();
    storage.removeItem(CHAT_FIRST_SURFACE_TABS_STORAGE_KEY);
    vi.unstubAllGlobals();
  });

  it("clamps and persists side-surface width without accepting invalid values", () => {
    const storage = createStorage();
    expect(clampChatFirstSurfaceWidth(100, 1200)).toBe(320);
    expect(clampChatFirstSurfaceWidth(2000, 1200)).toBe(840);
    expect(writeChatFirstSurfaceWidth(620, "thread-1", storage)).toEqual({
      ok: true,
    });
    expect(readChatFirstSurfaceWidth("thread-1", storage)).toBe(620);
    expect(readChatFirstSurfaceWidth("missing", storage)).toBe(
      clampChatFirstSurfaceWidth(380),
    );
  });
});
