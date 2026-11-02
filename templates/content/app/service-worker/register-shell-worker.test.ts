import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  installContentShellWorker,
  removeContentShellWorker,
  shouldRegisterShellWorker,
} from "./register-shell-worker";
import { MemoryCacheStorage } from "./shell-test-helpers";

const ROUTES = {
  "routes/_app": { id: "routes/_app", parentId: "root" },
  "routes/_app.page.$id": {
    id: "routes/_app.page.$id",
    parentId: "routes/_app",
    path: "page/:id",
  },
  "routes/p.$id": { id: "routes/p.$id", parentId: "root", path: "p/:id" },
  root: { id: "root", path: "" },
};

const BUILD_VERSION = "abcd1234";

function registration(scriptURL: string) {
  const postMessage = vi.fn();
  return {
    active: { scriptURL, postMessage } as unknown as ServiceWorker,
    postMessage,
    waiting: null,
    installing: null,
    unregister: vi.fn(async () => true),
    update: vi.fn(async () => undefined),
  };
}

interface FakeWindowOptions {
  url?: string;
  secure?: boolean;
  userAgent?: string;
  framed?: boolean;
  controller?: boolean;
  /** Whether the controlling worker's registration still exists. */
  registered?: boolean;
  registrations?: ReturnType<typeof registration>[];
}

function fakeWindow(options: FakeWindowOptions = {}) {
  const url = new URL(
    options.url ?? "https://content.agent-native.com/page/abc",
  );
  const active = registration(`${url.origin}/sw.js`);
  const caches = new MemoryCacheStorage();
  const listen = vi.fn();
  const controller = options.controller
    ? { scriptURL: `${url.origin}/sw.js`, postMessage: vi.fn() }
    : null;
  const container = {
    controller,
    register: vi.fn(async () => active),
    getRegistration: vi.fn(async () =>
      options.registered === false ? undefined : active,
    ),
    ready: Promise.resolve(active),
    getRegistrations: vi.fn(async () => options.registrations ?? []),
  };
  const win = {
    location: {
      href: url.href,
      hostname: url.hostname,
      pathname: url.pathname,
    },
    isSecureContext: options.secure ?? true,
    navigator: {
      serviceWorker: container,
      userAgent: options.userAgent ?? "Mozilla/5.0 Chrome/140",
    },
    document: {
      readyState: "complete",
      visibilityState: "visible",
      addEventListener: listen,
    },
    addEventListener: vi.fn(),
    caches: caches.asCacheStorage(),
    __reactRouterManifest: { version: BUILD_VERSION, routes: ROUTES },
  } as Record<string, unknown>;
  win.top = options.framed ? {} : win;
  return {
    win: win as unknown as Window,
    container,
    controller,
    active,
    caches,
    listen,
  };
}

/** The page's visibilitychange listener. */
function visibilityListener(listen: ReturnType<typeof vi.fn>) {
  const call = listen.mock.calls.find(([type]) => type === "visibilitychange");
  const listener: unknown = call?.[1];
  if (typeof listener !== "function") throw new Error("no listener");
  return listener as () => void;
}

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("where the worker runs", () => {
  it("runs on an app page of the standalone site", () => {
    expect(shouldRegisterShellWorker(fakeWindow().win)).toBe(true);
  });

  it.each([
    ["a public page", { url: "https://content.agent-native.com/p/abc" }],
    ["plain HTTP", { secure: false }],
    ["a local server", { url: "https://localhost:8080/page/abc" }],
    ["the desktop app", { userAgent: "Mozilla/5.0 AgentNativeDesktop/1.2" }],
    ["a frame", { framed: true }],
  ])("stays off on %s", (_label, options) => {
    expect(shouldRegisterShellWorker(fakeWindow(options).win)).toBe(false);
  });
});

describe("registering", () => {
  it("registers at the root, bypassing the HTTP cache for update checks", async () => {
    const { win, container, active } = fakeWindow();
    installContentShellWorker(win, { production: true });
    await vi.waitFor(() =>
      expect(active.postMessage).toHaveBeenCalledWith({
        type: "content-shell:adopt",
        url: "https://content.agent-native.com/page/abc",
        version: BUILD_VERSION,
      }),
    );
    expect(container.register).toHaveBeenCalledWith("/sw.js", {
      scope: "/",
      updateViaCache: "none",
    });
  });

  it("doesn't register or ask for adoption when the worker already served the page", async () => {
    const { win, container, active, listen } = fakeWindow({
      controller: true,
    });
    installContentShellWorker(win, { production: true });
    await vi.waitFor(() =>
      expect(listen).toHaveBeenCalledWith(
        "visibilitychange",
        expect.any(Function),
      ),
    );
    expect(container.getRegistration).toHaveBeenCalledWith(
      "https://content.agent-native.com/page/abc",
    );
    expect(container.register).not.toHaveBeenCalled();
    expect(active.postMessage).not.toHaveBeenCalled();
  });

  it("tells the worker that served it which build it runs, and again when shown after a while", async () => {
    const { win, controller, active, listen } = fakeWindow({
      controller: true,
    });
    installContentShellWorker(win, { production: true });
    const running = { type: "content-shell:running", version: BUILD_VERSION };
    await vi.waitFor(() =>
      expect(controller?.postMessage).toHaveBeenCalledWith(running),
    );

    const shown = visibilityListener(listen);
    shown();
    expect(controller?.postMessage).toHaveBeenCalledTimes(1);
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 31 * 60_000);
    shown();
    expect(controller?.postMessage).toHaveBeenCalledTimes(2);
    expect(active.update).toHaveBeenCalledTimes(1);
  });

  it("doesn't bring back a worker that removed itself while serving the page", async () => {
    const { win, container, listen } = fakeWindow({
      controller: true,
      registered: false,
    });
    installContentShellWorker(win, { production: true });
    await vi.waitFor(() =>
      expect(container.getRegistration).toHaveBeenCalled(),
    );
    await Promise.resolve();
    expect(container.register).not.toHaveBeenCalled();
    expect(listen).not.toHaveBeenCalled();
  });

  it("does nothing in development", () => {
    const { win, container } = fakeWindow();
    installContentShellWorker(win, { production: false });
    expect(container.register).not.toHaveBeenCalled();
  });

  it("keeps the app running when the browser refuses the worker", async () => {
    const { win, container } = fakeWindow();
    container.register.mockRejectedValueOnce(
      new DOMException("denied", "SecurityError"),
    );
    installContentShellWorker(win, { production: true });
    await vi.waitFor(() => expect(console.warn).toHaveBeenCalled());
  });
});

describe("the off switch", () => {
  it("unregisters only the shell worker and drops only its caches", async () => {
    const shell = registration("https://content.agent-native.com/sw.js");
    const other = registration(
      "https://content.agent-native.com/other-worker.js",
    );
    const { win, container, caches } = fakeWindow({
      registrations: [shell, other],
    });
    await caches.open("content-shell-v1-assets");
    await caches.open("unrelated-cache");

    installContentShellWorker(win, { production: true, mode: "off" });
    await vi.waitFor(() => expect(shell.unregister).toHaveBeenCalled());
    await removeContentShellWorker(win);

    expect(other.unregister).not.toHaveBeenCalled();
    expect(container.register).not.toHaveBeenCalled();
    expect(await caches.keys()).toEqual(["unrelated-cache"]);
  });
});
