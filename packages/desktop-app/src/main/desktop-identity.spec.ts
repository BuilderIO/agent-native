import { describe, expect, it, vi } from "vitest";

import {
  DESKTOP_IDENTITY_COMPLETE_PATH,
  DesktopIdentityBroker,
  desktopWorkspaceLogoutPath,
  fetchDesktopIdentityAvailability,
  isDesktopIdentityAuthorizeNavigation,
  isDesktopIdentityCompletion,
  isDesktopIdentityConfiguredAppEligible,
  isDesktopWorkspaceLogoutRequest,
  type DesktopIdentityApp,
} from "./desktop-identity";

function cookieStore(initial: Electron.Cookie[] = []) {
  const cookies = [...initial];
  return {
    get: vi.fn(async () => [...cookies]),
    set: vi.fn(async (cookie: Electron.CookiesSetDetails) => {
      cookies.push({
        name: cookie.name!,
        value: cookie.value!,
        domain: new URL(cookie.url).hostname,
        hostOnly: true,
        path: cookie.path ?? "/",
        secure: cookie.secure ?? true,
        httpOnly: cookie.httpOnly ?? true,
        session: !cookie.expirationDate,
        sameSite: cookie.sameSite ?? "lax",
        ...(cookie.expirationDate
          ? { expirationDate: cookie.expirationDate }
          : {}),
      });
    }),
    remove: vi.fn(async (_url: string, name: string) => {
      const index = cookies.findIndex((cookie) => cookie.name === name);
      if (index >= 0) cookies.splice(index, 1);
    }),
  };
}

function appFixture(): DesktopIdentityApp {
  return {
    id: "mail",
    origin: "https://mail.agent-native.com",
    cookieNames: ["an_session_mail", "an_session"],
    cookieNamesToClear: [
      "an_session_mail",
      "an_session",
      "an_mail.session_token",
      "__Secure-an_mail.session_token",
    ],
    session: {
      cookies: cookieStore(),
      fetch: vi.fn(async () => new Response(null, { status: 200 })),
    } as unknown as Electron.Session,
  };
}

function authorityFixture(): DesktopIdentityApp {
  return {
    ...appFixture(),
    id: "dispatch",
    origin: "https://dispatch.agent-native.com",
    cookieNames: ["an_session_dispatch", "an_session"],
    cookieNamesToClear: [
      "an_session_dispatch",
      "an_session",
      "an_dispatch.session_token",
      "__Secure-an_dispatch.session_token",
    ],
    identityAuthority: true,
  };
}

function authorizeUrl(
  authority: DesktopIdentityApp,
  target: DesktopIdentityApp,
): string {
  const result = new URL("/_agent-native/identity/authorize", authority.origin);
  result.searchParams.set("app", target.id);
  result.searchParams.set(
    "redirect_uri",
    new URL("/_agent-native/identity/callback", target.origin).toString(),
  );
  result.searchParams.set("state", "state_123");
  return result.toString();
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function sessionCookie(
  name: string,
  origin: string,
  value = "example-session-value",
): Electron.Cookie {
  return {
    name,
    value,
    domain: new URL(origin).hostname,
    hostOnly: true,
    path: "/",
    secure: true,
    httpOnly: true,
    session: true,
    sameSite: "lax",
  };
}

describe("Desktop identity navigation boundaries", () => {
  const app = appFixture();

  it("accepts completion only for the exact origin, path, and nonce", () => {
    const nonce = "nonce_12345678901234567890123456789012";
    expect(
      isDesktopIdentityCompletion(
        `https://mail.agent-native.com${DESKTOP_IDENTITY_COMPLETE_PATH}?nonce=${nonce}`,
        app,
        nonce,
      ),
    ).toBe(true);
    expect(
      isDesktopIdentityCompletion(
        `https://calendar.agent-native.com${DESKTOP_IDENTITY_COMPLETE_PATH}?nonce=${nonce}`,
        app,
        nonce,
      ),
    ).toBe(false);
    expect(
      isDesktopIdentityCompletion(
        `https://mail.agent-native.com${DESKTOP_IDENTITY_COMPLETE_PATH}?nonce=stale`,
        app,
        nonce,
      ),
    ).toBe(false);
  });

  it("accepts authorize redirects only for the exact authority and callback", () => {
    const app = appFixture();
    const authority = authorityFixture();
    expect(
      isDesktopIdentityAuthorizeNavigation(
        authorizeUrl(authority, app),
        authority,
        app,
      ),
    ).toBe(true);
    expect(
      isDesktopIdentityAuthorizeNavigation(
        authorizeUrl(authority, { ...app, id: "calendar" }),
        authority,
        app,
      ),
    ).toBe(false);
    const hostile = new URL(authorizeUrl(authority, app));
    hostile.searchParams.set(
      "redirect_uri",
      "https://evil.example/_agent-native/identity/callback",
    );
    expect(
      isDesktopIdentityAuthorizeNavigation(hostile.toString(), authority, app),
    ).toBe(false);
  });

  it("recognizes workspace logout only on the canonical app origin", () => {
    expect(
      isDesktopWorkspaceLogoutRequest(
        "https://mail.agent-native.com/_agent-native/auth/logout",
        app,
      ),
    ).toBe(true);
    expect(
      isDesktopWorkspaceLogoutRequest(
        "https://evil.example/_agent-native/auth/logout",
        app,
      ),
    ).toBe(false);
    expect(
      desktopWorkspaceLogoutPath(
        "https://mail.agent-native.com/_agent-native/auth/logout-all",
        app,
      ),
    ).toBe("/_agent-native/auth/logout-all");
  });

  it("includes disabled or dev canonical apps only in cleanup inventory", () => {
    for (const id of ["mail", "dispatch"]) {
      const configured = { id, enabled: false, mode: "prod" };
      expect(isDesktopIdentityConfiguredAppEligible(configured)).toBe(false);
      expect(
        isDesktopIdentityConfiguredAppEligible(configured, {
          forCleanup: true,
        }),
      ).toBe(true);
    }
    expect(
      isDesktopIdentityConfiguredAppEligible(
        { enabled: false, mode: "dev" },
        { forCleanup: true },
      ),
    ).toBe(true);
  });
});

describe("DesktopIdentityBroker", () => {
  it("refuses explicit workspace sign-in when the Dispatch authority is unavailable", async () => {
    const app = appFixture();
    const createWindow = vi.fn();
    const broker = new DesktopIdentityBroker({
      identitySession: {
        cookies: cookieStore(),
        clearStorageData: vi.fn(async () => {}),
      } as unknown as Electron.Session,
      isAvailable: vi.fn(async () => true),
      resolveApp: (id) => (id === app.id ? app : null),
      createWindow: createWindow as never,
      reloadApp: vi.fn(),
      clearLocalBroker: vi.fn(),
    });

    await expect(broker.signIn(app.id)).resolves.toBe(false);
    expect(createWindow).not.toHaveBeenCalled();
  });

  it("refuses explicit workspace sign-in before rollout availability is known", async () => {
    const app = appFixture();
    const authority = authorityFixture();
    const broker = new DesktopIdentityBroker({
      identitySession: {
        cookies: cookieStore(),
        clearStorageData: vi.fn(async () => {}),
      } as unknown as Electron.Session,
      isAvailable: vi.fn(async () => true),
      resolveApp: (id) =>
        id === app.id ? app : id === authority.id ? authority : null,
      createWindow: vi.fn() as never,
      reloadApp: vi.fn(),
      clearLocalBroker: vi.fn(),
    });

    await expect(broker.signIn(app.id)).resolves.toBe(false);
  });

  it("fails explicit sign-in if Dispatch disappears before the ceremony", async () => {
    const app = appFixture();
    const authority = authorityFixture();
    const reloadApp = vi.fn();
    let authorityReads = 0;
    const broker = new DesktopIdentityBroker({
      identitySession: {
        cookies: cookieStore(),
        clearStorageData: vi.fn(async () => {}),
      } as unknown as Electron.Session,
      isAvailable: vi.fn(async () => true),
      resolveApp: (id) => {
        if (id === app.id) return app;
        if (id !== authority.id) return null;
        authorityReads += 1;
        return authorityReads === 1 ? authority : null;
      },
      createWindow: vi.fn() as never,
      reloadApp,
      clearLocalBroker: vi.fn(),
    });

    await broker.refreshStatus(authority);

    await expect(broker.signIn(app.id)).resolves.toBe(false);
    await vi.waitFor(() => expect(reloadApp).toHaveBeenCalledWith(app));
    expect(broker.getStatus()).toBe("idle");
  });

  it("leaves ordinary per-app sign-in alone when rollout availability is off", async () => {
    const app = appFixture();
    const authority = authorityFixture();
    const createWindow = vi.fn();
    const resolveLoginRedirect = vi.fn();
    const reloadApp = vi.fn();
    const broker = new DesktopIdentityBroker({
      identitySession: {
        cookies: cookieStore(),
        clearStorageData: vi.fn(async () => {}),
      } as unknown as Electron.Session,
      isAvailable: vi.fn(async () => false),
      resolveLoginRedirect,
      resolveApp: (id) =>
        id === app.id ? app : id === authority.id ? authority : null,
      createWindow: createWindow as never,
      reloadApp,
      clearLocalBroker: vi.fn(),
    });

    await broker.refreshStatus(authority);
    expect(createWindow).not.toHaveBeenCalled();
    expect(resolveLoginRedirect).not.toHaveBeenCalled();
    expect(reloadApp).not.toHaveBeenCalled();
    expect(broker.getStatus()).toBe("idle");
    await expect(broker.signIn(app.id)).resolves.toBe(false);
  });

  it("leaves ordinary per-app sign-out alone after rollout availability turns off", async () => {
    const app = appFixture();
    const authority = authorityFixture();
    const isAvailable = vi
      .fn<() => Promise<boolean>>()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    const appFetch = vi.fn(async () => new Response(null, { status: 200 }));
    app.session = {
      cookies: cookieStore([
        sessionCookie("an_session_mail", app.origin, "mail-session"),
      ]),
      fetch: appFetch,
    } as unknown as Electron.Session;
    const clearStorageData = vi.fn(async () => {});
    const broker = new DesktopIdentityBroker({
      identitySession: {
        cookies: cookieStore([
          sessionCookie("an_session_dispatch", authority.origin),
        ]),
        clearStorageData,
      } as unknown as Electron.Session,
      isAvailable,
      resolveApp: (id) =>
        id === app.id ? app : id === authority.id ? authority : null,
      createWindow: vi.fn() as never,
      reloadApp: vi.fn(),
      clearLocalBroker: vi.fn(),
    });

    await broker.refreshStatus(authority);
    expect(broker.getStatus()).toBe("signed-in");

    await expect(
      broker.prepareExternalSignOut([app, authority], {
        logoutPath: "/_agent-native/auth/logout",
        alreadyRevokedAppId: app.id,
      }),
    ).resolves.toBe(false);

    expect(broker.getStatus()).toBe("idle");
    expect(clearStorageData).not.toHaveBeenCalled();
    expect(appFetch).not.toHaveBeenCalled();
  });

  it("bounds a stalled rollout availability request", async () => {
    vi.useFakeTimers();
    const authority = authorityFixture();
    let observedSignal: AbortSignal | undefined;
    const identitySession = {
      fetch: vi.fn(
        (_url: string, options: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            observedSignal = options.signal as AbortSignal;
            observedSignal.addEventListener("abort", () =>
              reject(new Error("aborted")),
            );
          }),
      ),
    } as unknown as Electron.Session;

    const availability = fetchDesktopIdentityAvailability(
      authority,
      identitySession,
      100,
    );
    await vi.advanceTimersByTimeAsync(100);

    await expect(availability).resolves.toBe(false);
    expect(observedSignal?.aborted).toBe(true);
    vi.useRealTimers();
  });

  it("does not replace an active app-led ceremony with a stale cookie status", async () => {
    const app = appFixture();
    const authority = authorityFixture();
    const statusCookies = deferred<Electron.Cookie[]>();
    const preflight = deferred<string | null>();
    const broker = new DesktopIdentityBroker({
      identitySession: {
        cookies: {
          ...cookieStore(),
          get: vi.fn(() => statusCookies.promise),
        },
        clearStorageData: vi.fn(async () => {}),
      } as unknown as Electron.Session,
      resolveLoginRedirect: vi.fn(() => preflight.promise),
      resolveApp: (id) =>
        id === app.id ? app : id === authority.id ? authority : null,
      createWindow: vi.fn() as never,
      reloadApp: vi.fn(),
      clearLocalBroker: vi.fn(),
    });

    const refresh = broker.refreshStatus(authority);
    const ceremony = broker.signIn(app.id);
    await vi.waitFor(() => expect(broker.getStatus()).toBe("signing-in"));
    statusCookies.resolve([
      sessionCookie("an_session_dispatch", authority.origin),
    ]);
    await refresh;
    expect(broker.getStatus()).toBe("signing-in");

    preflight.resolve(null);
    await expect(ceremony).resolves.toBe(false);
  });

  it("does not inspect or replace status during workspace sign-out", async () => {
    const authority = authorityFixture();
    const identityCookies = cookieStore([
      sessionCookie("an_session_dispatch", authority.origin),
    ]);
    const centralCleanup = deferred<void>();
    const clearStorageData = vi.fn(() => centralCleanup.promise);
    const broker = new DesktopIdentityBroker({
      identitySession: {
        cookies: identityCookies,
        clearStorageData,
        fetch: vi.fn(async () => new Response(null, { status: 200 })),
      } as unknown as Electron.Session,
      resolveApp: (id) => (id === authority.id ? authority : null),
      createWindow: vi.fn() as never,
      reloadApp: vi.fn(),
      clearLocalBroker: vi.fn(),
    });

    const signOut = broker.signOut([authority]);
    await vi.waitFor(() => expect(clearStorageData).toHaveBeenCalledOnce());
    const cookieReadsBeforeRefresh = identityCookies.get.mock.calls.length;
    await broker.refreshStatus(authority);

    expect(identityCookies.get).toHaveBeenCalledTimes(cookieReadsBeforeRefresh);
    centralCleanup.resolve();
    await signOut;
    expect(broker.getStatus()).toBe("sign-in-required");
  });

  it("loads the validated identity authority redirect", async () => {
    const app = appFixture();
    const authority = authorityFixture();
    const resolvedUrl = authorizeUrl(authority, app);
    const resolveLoginRedirect = vi.fn(
      async (_loginUrl: string) => resolvedUrl,
    );
    let closedListener: (() => void) | undefined;
    const identityWindow = {
      webContents: {
        on: vi.fn(),
        setWindowOpenHandler: vi.fn(),
      },
      loadURL: vi.fn(async () => {}),
      isDestroyed: vi.fn(() => false),
      close: vi.fn(),
      on: vi.fn((event: string, listener: () => void) => {
        if (event === "closed") closedListener = listener;
      }),
    };
    const broker = new DesktopIdentityBroker({
      identitySession: {
        cookies: cookieStore(),
        clearStorageData: vi.fn(async () => {}),
      } as unknown as Electron.Session,
      resolveLoginRedirect,
      resolveApp: (id) =>
        id === app.id ? app : id === authority.id ? authority : null,
      createWindow: () => identityWindow as never,
      reloadApp: vi.fn(),
      clearLocalBroker: vi.fn(),
    });

    const ceremony = broker.signIn(app.id);
    await vi.waitFor(() =>
      expect(identityWindow.loadURL).toHaveBeenCalledWith(resolvedUrl),
    );
    expect(resolveLoginRedirect).toHaveBeenCalledWith(
      expect.stringContaining("/_agent-native/identity/login"),
      expect.objectContaining({ cookies: expect.anything() }),
    );
    closedListener?.();
    await expect(ceremony).resolves.toBe(false);
  });

  it("restores ordinary sign-in when targeted authorization denies the user", async () => {
    const app = appFixture();
    const authority = authorityFixture();
    const reloadApp = vi.fn();
    const webContents = {
      on: vi.fn(),
      setWindowOpenHandler: vi.fn(),
    };
    const identityWindow = {
      webContents,
      loadURL: vi.fn(async () => {}),
      isDestroyed: vi.fn(() => false),
      close: vi.fn(),
      on: vi.fn(),
    };
    const broker = new DesktopIdentityBroker({
      identitySession: {
        cookies: cookieStore(),
        clearStorageData: vi.fn(async () => {}),
      } as unknown as Electron.Session,
      isAvailable: vi.fn(async () => true),
      resolveLoginRedirect: vi.fn(async () => authorizeUrl(authority, app)),
      resolveApp: (id) =>
        id === app.id ? app : id === authority.id ? authority : null,
      createWindow: () => identityWindow as never,
      reloadApp,
      clearLocalBroker: vi.fn(),
    });

    await broker.refreshStatus(authority);
    const ceremony = broker.signIn(app.id);
    await vi.waitFor(() => expect(identityWindow.loadURL).toHaveBeenCalled());
    const didNavigate = webContents.on.mock.calls.find(
      ([event]) => event === "did-navigate",
    )?.[1];
    didNavigate({}, authorizeUrl(authority, app), 404);

    await expect(ceremony).resolves.toBe(false);
    expect(reloadApp).toHaveBeenCalledWith(app);
    expect(identityWindow.close).toHaveBeenCalledOnce();
    expect(broker.getStatus()).toBe("idle");
  });

  it("sanitizes identity preflight failures before logging", async () => {
    const app = appFixture();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const reloadApp = vi.fn();
    const broker = new DesktopIdentityBroker({
      identitySession: {
        cookies: cookieStore(),
        clearStorageData: vi.fn(async () => {}),
      } as unknown as Electron.Session,
      resolveLoginRedirect: vi.fn(async () => {
        throw new Error("redirect failed?state=secret&token=secret");
      }),
      resolveApp: (id) => (id === app.id ? app : null),
      createWindow: vi.fn() as never,
      reloadApp,
      clearLocalBroker: vi.fn(),
    });

    await expect(broker.signIn(app.id)).resolves.toBe(false);
    expect(warn).toHaveBeenCalledWith(
      "[desktop-identity] identity preflight failed",
    );
    expect(JSON.stringify(warn.mock.calls)).not.toContain("state=secret");
    expect(JSON.stringify(warn.mock.calls)).not.toContain("token=secret");
    expect(reloadApp).toHaveBeenCalledWith(app);
    warn.mockRestore();
  });

  it("rejects a redirect outside the identity authority", async () => {
    const app = appFixture();
    const authority = authorityFixture();
    const createWindow = vi.fn();
    const reloadApp = vi.fn();
    const broker = new DesktopIdentityBroker({
      identitySession: {
        cookies: cookieStore(),
        clearStorageData: vi.fn(async () => {}),
      } as unknown as Electron.Session,
      resolveLoginRedirect: vi.fn(
        async () => "https://evil.example/_agent-native/identity/authorize",
      ),
      resolveApp: (id) =>
        id === app.id ? app : id === authority.id ? authority : null,
      createWindow,
      reloadApp,
      clearLocalBroker: vi.fn(),
    });

    await expect(broker.signIn(app.id)).resolves.toBe(false);
    expect(createWindow).not.toHaveBeenCalled();
    expect(reloadApp).toHaveBeenCalledWith(app);
    expect(broker.getStatus()).toBe("failed");
  });

  it("closes the identity window on unhandled cross-origin navigation", async () => {
    const app = appFixture();
    const authority = authorityFixture();
    const webContents = {
      on: vi.fn(),
      setWindowOpenHandler: vi.fn(),
    };
    const identityWindow = {
      webContents,
      loadURL: vi.fn(async () => {}),
      isDestroyed: vi.fn(() => false),
      close: vi.fn(),
      on: vi.fn(),
    };
    const broker = new DesktopIdentityBroker({
      identitySession: {
        cookies: cookieStore(),
        clearStorageData: vi.fn(async () => {}),
      } as unknown as Electron.Session,
      isAvailable: vi.fn(async () => true),
      resolveLoginRedirect: vi.fn(async () => authorizeUrl(authority, app)),
      resolveApp: (id) =>
        id === app.id ? app : id === authority.id ? authority : null,
      createWindow: () => identityWindow as never,
      handleOAuthNavigation: vi.fn(() => false),
      reloadApp: vi.fn(),
      clearLocalBroker: vi.fn(),
    });

    await broker.refreshStatus(authority);
    const ceremony = broker.signIn(app.id);
    await vi.waitFor(() => expect(identityWindow.loadURL).toHaveBeenCalled());
    const navigationHandler = webContents.on.mock.calls.find(
      ([event]) => event === "will-navigate",
    )?.[1];
    const allowedPreventDefault = vi.fn();
    navigationHandler(
      { preventDefault: allowedPreventDefault },
      authority.origin,
    );
    navigationHandler(
      { preventDefault: allowedPreventDefault },
      `${app.origin}/_agent-native/identity/callback`,
    );
    expect(allowedPreventDefault).not.toHaveBeenCalled();

    const preventDefault = vi.fn();
    navigationHandler(
      { preventDefault },
      "https://evil.example/looks-like-sign-in",
    );

    await expect(ceremony).resolves.toBe(false);
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(identityWindow.close).toHaveBeenCalledOnce();
    expect(broker.getStatus()).toBe("failed");
  });

  it("coalesces duplicate requests and copies only the target cookie", async () => {
    const app = appFixture();
    const identityCookies = cookieStore([
      {
        name: "an_session_mail",
        value: "example-session-value",
        domain: "mail.agent-native.com",
        hostOnly: true,
        path: "/",
        secure: true,
        httpOnly: true,
        session: false,
        sameSite: "lax",
        expirationDate: Date.now() / 1000 + 3600,
      },
      {
        name: "unrelated_cookie",
        value: "do-not-copy",
        domain: "mail.agent-native.com",
        hostOnly: true,
        path: "/",
        secure: true,
        httpOnly: true,
        session: true,
        sameSite: "lax",
      },
    ]);
    identityCookies.get.mockImplementationOnce(async () => []);
    const webContents = {
      on: vi.fn(),
      setWindowOpenHandler: vi.fn(),
    };
    let loadedUrl = "";
    let closedListener: (() => void) | undefined;
    const identityWindow = {
      webContents,
      loadURL: vi.fn(async (url: string) => {
        loadedUrl = url;
      }),
      isDestroyed: vi.fn(() => false),
      close: vi.fn(),
      on: vi.fn((event: string, listener: () => void) => {
        if (event === "closed") closedListener = listener;
      }),
    };
    const reloadApp = vi.fn();
    const broker = new DesktopIdentityBroker({
      identitySession: {
        cookies: identityCookies,
        clearStorageData: vi.fn(),
      } as unknown as Electron.Session,
      resolveApp: (id) => (id === app.id ? app : null),
      createWindow: () => identityWindow as never,
      reloadApp,
      clearLocalBroker: vi.fn(),
      timeoutMs: 10_000,
    });

    const first = broker.signIn("mail");
    const second = broker.signIn("mail");
    expect(second).toBe(first);
    await vi.waitFor(() => expect(loadedUrl).not.toBe(""));

    const nonce = new URL(loadedUrl).searchParams.get("return")!;
    const completion = new URL(nonce, app.origin).toString();
    const redirectHandler = webContents.on.mock.calls.find(
      ([event]) => event === "will-redirect",
    )?.[1];
    const navigationHandler = webContents.on.mock.calls.find(
      ([event]) => event === "did-navigate",
    )?.[1];
    const preventDefault = vi.fn();
    redirectHandler({ preventDefault }, completion);
    expect(identityCookies.get).not.toHaveBeenCalled();
    expect(preventDefault).not.toHaveBeenCalled();
    navigationHandler({}, completion, 200, "OK");

    await expect(first).resolves.toBe(true);
    expect(identityCookies.get).toHaveBeenCalledTimes(2);
    expect(app.session.cookies.set).toHaveBeenCalledTimes(1);
    expect(app.session.cookies.set).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "an_session_mail",
        value: "example-session-value",
      }),
    );
    expect(reloadApp).toHaveBeenCalledWith(app);
    expect(identityCookies.remove).toHaveBeenCalledWith(
      app.origin,
      "an_session_mail",
    );
    expect(closedListener).toBeDefined();
  });

  it("requires an authenticated committed completion before copying", async () => {
    const app = appFixture();
    const identityCookies = cookieStore([
      sessionCookie("an_session_mail", app.origin),
    ]);
    const webContents = {
      on: vi.fn(),
      setWindowOpenHandler: vi.fn(),
    };
    let loadedUrl = "";
    const identityWindow = {
      webContents,
      loadURL: vi.fn(async (url: string) => {
        loadedUrl = url;
      }),
      isDestroyed: vi.fn(() => false),
      close: vi.fn(),
      on: vi.fn(),
    };
    const reloadApp = vi.fn();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const broker = new DesktopIdentityBroker({
      identitySession: {
        cookies: identityCookies,
        clearStorageData: vi.fn(async () => {}),
      } as unknown as Electron.Session,
      resolveApp: (id) => (id === app.id ? app : null),
      createWindow: () => identityWindow as never,
      reloadApp,
      clearLocalBroker: vi.fn(),
    });

    const ceremony = broker.signIn(app.id);
    await vi.waitFor(() => expect(loadedUrl).not.toBe(""));
    const returnPath = new URL(loadedUrl).searchParams.get("return")!;
    const completion = new URL(returnPath, app.origin).toString();
    const navigationHandler = webContents.on.mock.calls.find(
      ([event]) => event === "did-navigate",
    )?.[1];
    navigationHandler({}, completion, 401, "Unauthorized");

    await expect(ceremony).resolves.toBe(false);
    expect(identityCookies.get).not.toHaveBeenCalled();
    expect(app.session.cookies.set).not.toHaveBeenCalled();
    expect(reloadApp).toHaveBeenCalledWith(app);
    expect(broker.getStatus()).toBe("failed");
    expect(warn).toHaveBeenCalledWith(
      "[desktop-identity] authenticated completion failed",
      { appId: "mail", statusCode: 401 },
    );
    expect(JSON.stringify(warn.mock.calls)).not.toContain("session-value");
    warn.mockRestore();
  });

  it("ignores a committed completion with the wrong nonce", async () => {
    const app = appFixture();
    const identityCookies = cookieStore([
      sessionCookie("an_session_mail", app.origin),
    ]);
    const webContents = {
      on: vi.fn(),
      setWindowOpenHandler: vi.fn(),
    };
    let loadedUrl = "";
    let closedListener: (() => void) | undefined;
    const identityWindow = {
      webContents,
      loadURL: vi.fn(async (url: string) => {
        loadedUrl = url;
      }),
      isDestroyed: vi.fn(() => false),
      close: vi.fn(),
      on: vi.fn((event: string, listener: () => void) => {
        if (event === "closed") closedListener = listener;
      }),
    };
    const broker = new DesktopIdentityBroker({
      identitySession: {
        cookies: identityCookies,
        clearStorageData: vi.fn(async () => {}),
      } as unknown as Electron.Session,
      resolveApp: (id) => (id === app.id ? app : null),
      createWindow: () => identityWindow as never,
      reloadApp: vi.fn(),
      clearLocalBroker: vi.fn(),
    });

    const ceremony = broker.signIn(app.id);
    await vi.waitFor(() => expect(loadedUrl).not.toBe(""));
    const wrongCompletion = new URL(
      `${DESKTOP_IDENTITY_COMPLETE_PATH}?nonce=wrong`,
      app.origin,
    ).toString();
    const navigationHandler = webContents.on.mock.calls.find(
      ([event]) => event === "did-navigate",
    )?.[1];
    navigationHandler({}, wrongCompletion, 200, "OK");
    expect(identityCookies.get).not.toHaveBeenCalled();
    closedListener?.();

    await expect(ceremony).resolves.toBe(false);
    expect(app.session.cookies.set).not.toHaveBeenCalled();
  });

  it("recovers from a missing target cookie without logging session details", async () => {
    const app = appFixture();
    const webContents = {
      on: vi.fn(),
      setWindowOpenHandler: vi.fn(),
    };
    let loadedUrl = "";
    const identityWindow = {
      webContents,
      loadURL: vi.fn(async (url: string) => {
        loadedUrl = url;
      }),
      isDestroyed: vi.fn(() => false),
      close: vi.fn(),
      on: vi.fn(),
    };
    const reloadApp = vi.fn();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const broker = new DesktopIdentityBroker({
      identitySession: {
        cookies: cookieStore(),
        clearStorageData: vi.fn(async () => {}),
      } as unknown as Electron.Session,
      resolveApp: (id) => (id === app.id ? app : null),
      createWindow: () => identityWindow as never,
      reloadApp,
      clearLocalBroker: vi.fn(),
      sessionCookieWaitMs: 50,
    });

    const ceremony = broker.signIn(app.id);
    await vi.waitFor(() => expect(loadedUrl).not.toBe(""));
    const returnPath = new URL(loadedUrl).searchParams.get("return")!;
    const completion = new URL(returnPath, app.origin).toString();
    const navigationHandler = webContents.on.mock.calls.find(
      ([event]) => event === "did-navigate",
    )?.[1];
    navigationHandler({}, completion, 200, "OK");

    await expect(ceremony).resolves.toBe(false);
    expect(reloadApp).toHaveBeenCalledWith(app);
    expect(broker.getStatus()).toBe("failed");
    expect(warn).toHaveBeenCalledWith(
      "[desktop-identity] target session transfer failed",
      { appId: "mail" },
    );
    expect(JSON.stringify(warn.mock.calls)).not.toContain("session-value");
    warn.mockRestore();
  });

  it("does not copy a cookie that appears after the identity window closes", async () => {
    const app = appFixture();
    const identityCookies = cookieStore();
    const webContents = {
      on: vi.fn(),
      setWindowOpenHandler: vi.fn(),
    };
    let loadedUrl = "";
    let closedListener: (() => void) | undefined;
    const identityWindow = {
      webContents,
      loadURL: vi.fn(async (url: string) => {
        loadedUrl = url;
      }),
      isDestroyed: vi.fn(() => false),
      close: vi.fn(),
      on: vi.fn((event: string, listener: () => void) => {
        if (event === "closed") closedListener = listener;
      }),
    };
    const reloadApp = vi.fn();
    const broker = new DesktopIdentityBroker({
      identitySession: {
        cookies: identityCookies,
        clearStorageData: vi.fn(async () => {}),
      } as unknown as Electron.Session,
      resolveApp: (id) => (id === app.id ? app : null),
      createWindow: () => identityWindow as never,
      reloadApp,
      clearLocalBroker: vi.fn(),
      sessionCookieWaitMs: 500,
    });

    const ceremony = broker.signIn(app.id);
    await vi.waitFor(() => expect(loadedUrl).not.toBe(""));
    const returnPath = new URL(loadedUrl).searchParams.get("return")!;
    const completion = new URL(returnPath, app.origin).toString();
    const navigationHandler = webContents.on.mock.calls.find(
      ([event]) => event === "did-navigate",
    )?.[1];
    navigationHandler({}, completion, 200, "OK");
    await vi.waitFor(() => expect(identityCookies.get).toHaveBeenCalled());

    closedListener?.();
    await identityCookies.set({
      url: app.origin,
      name: "an_session_mail",
      value: "late-session",
      path: "/",
      secure: true,
      httpOnly: true,
      sameSite: "lax",
    });

    await expect(ceremony).resolves.toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(app.session.cookies.set).not.toHaveBeenCalled();
    expect(reloadApp).not.toHaveBeenCalled();
    expect(broker.getStatus()).toBe("sign-in-required");
  });

  it("does not copy a cookie after the identity ceremony times out", async () => {
    const app = appFixture();
    const identityCookies = cookieStore();
    const webContents = {
      on: vi.fn(),
      setWindowOpenHandler: vi.fn(),
    };
    let loadedUrl = "";
    const identityWindow = {
      webContents,
      loadURL: vi.fn(async (url: string) => {
        loadedUrl = url;
      }),
      isDestroyed: vi.fn(() => false),
      close: vi.fn(),
      on: vi.fn(),
    };
    const reloadApp = vi.fn();
    const broker = new DesktopIdentityBroker({
      identitySession: {
        cookies: identityCookies,
        clearStorageData: vi.fn(async () => {}),
      } as unknown as Electron.Session,
      resolveApp: (id) => (id === app.id ? app : null),
      createWindow: () => identityWindow as never,
      reloadApp,
      clearLocalBroker: vi.fn(),
      timeoutMs: 50,
      sessionCookieWaitMs: 500,
    });

    const ceremony = broker.signIn(app.id);
    await vi.waitFor(() => expect(loadedUrl).not.toBe(""));
    const returnPath = new URL(loadedUrl).searchParams.get("return")!;
    const completion = new URL(returnPath, app.origin).toString();
    const navigationHandler = webContents.on.mock.calls.find(
      ([event]) => event === "did-navigate",
    )?.[1];
    navigationHandler({}, completion, 200, "OK");

    await expect(ceremony).resolves.toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(app.session.cookies.set).not.toHaveBeenCalled();
    expect(reloadApp).not.toHaveBeenCalled();
    expect(broker.getStatus()).toBe("sign-in-required");
  });

  it("bounds a cookie-store read that never resolves", async () => {
    const app = appFixture();
    const identityCookies = cookieStore();
    identityCookies.get.mockImplementation(
      () => new Promise<Electron.Cookie[]>(() => {}),
    );
    const webContents = {
      on: vi.fn(),
      setWindowOpenHandler: vi.fn(),
    };
    let loadedUrl = "";
    const identityWindow = {
      webContents,
      loadURL: vi.fn(async (url: string) => {
        loadedUrl = url;
      }),
      isDestroyed: vi.fn(() => false),
      close: vi.fn(),
      on: vi.fn(),
    };
    const reloadApp = vi.fn();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const broker = new DesktopIdentityBroker({
      identitySession: {
        cookies: identityCookies,
        clearStorageData: vi.fn(async () => {}),
      } as unknown as Electron.Session,
      resolveApp: (id) => (id === app.id ? app : null),
      createWindow: () => identityWindow as never,
      reloadApp,
      clearLocalBroker: vi.fn(),
      sessionCookieWaitMs: 25,
    });

    const ceremony = broker.signIn(app.id);
    await vi.waitFor(() => expect(loadedUrl).not.toBe(""));
    const returnPath = new URL(loadedUrl).searchParams.get("return")!;
    const completion = new URL(returnPath, app.origin).toString();
    const navigationHandler = webContents.on.mock.calls.find(
      ([event]) => event === "did-navigate",
    )?.[1];
    navigationHandler({}, completion, 200, "OK");

    await expect(ceremony).resolves.toBe(false);
    expect(reloadApp).toHaveBeenCalledWith(app);
    expect(broker.getStatus()).toBe("failed");
    warn.mockRestore();
  });

  it("accepts Dispatch's nonce-bound front-door shortcut without consuming its authority session", async () => {
    const dispatch = authorityFixture();
    const identityCookies = cookieStore([
      sessionCookie("an_session_dispatch", dispatch.origin, "dispatch-session"),
      sessionCookie("unrelated_cookie", dispatch.origin, "do-not-copy"),
    ]);
    const resolveLoginRedirect = vi.fn(async (loginUrl: string) => {
      const returnPath = new URL(loginUrl).searchParams.get("return")!;
      return new URL(returnPath, dispatch.origin).toString();
    });
    const webContents = {
      on: vi.fn(),
      setWindowOpenHandler: vi.fn(),
    };
    let loadedUrl = "";
    const identityWindow = {
      webContents,
      loadURL: vi.fn(async (url: string) => {
        loadedUrl = url;
      }),
      isDestroyed: vi.fn(() => false),
      close: vi.fn(),
      on: vi.fn(),
    };
    const createWindow = vi.fn(() => identityWindow as never);
    const reloadApp = vi.fn();
    const broker = new DesktopIdentityBroker({
      identitySession: {
        cookies: identityCookies,
        clearStorageData: vi.fn(async () => {}),
      } as unknown as Electron.Session,
      resolveLoginRedirect,
      resolveApp: (id) => (id === dispatch.id ? dispatch : null),
      createWindow,
      reloadApp,
      clearLocalBroker: vi.fn(),
    });

    const ceremony = broker.signIn(dispatch.id);
    await vi.waitFor(() => expect(loadedUrl).not.toBe(""));
    const loginUrl = String(resolveLoginRedirect.mock.calls[0]?.[0]);
    const returnPath = new URL(loginUrl).searchParams.get("return")!;
    const completion = new URL(returnPath, dispatch.origin).toString();
    const navigationHandler = webContents.on.mock.calls.find(
      ([event]) => event === "did-navigate",
    )?.[1];
    expect(identityCookies.get).not.toHaveBeenCalled();
    navigationHandler({}, completion, 200, "OK");

    await expect(ceremony).resolves.toBe(true);

    expect(new URL(loginUrl).pathname).toBe("/_agent-native/identity/login");
    expect(new URL(completion).pathname).toBe(DESKTOP_IDENTITY_COMPLETE_PATH);
    expect(createWindow).toHaveBeenCalledOnce();
    expect(identityWindow.loadURL).toHaveBeenCalledWith(completion);
    expect(dispatch.session.cookies.set).toHaveBeenCalledTimes(1);
    expect(dispatch.session.cookies.set).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "an_session_dispatch",
        value: "dispatch-session",
      }),
    );
    expect(dispatch.session.cookies.set).not.toHaveBeenCalledWith(
      expect.objectContaining({ name: "unrelated_cookie" }),
    );
    expect(identityCookies.remove).not.toHaveBeenCalled();
    expect(reloadApp).toHaveBeenCalledWith(dispatch);
    expect(broker.getStatus()).toBe("signed-in");
  });

  it("revokes and clears canonical app sessions plus the central identity session", async () => {
    const app = appFixture();
    app.identityAuthority = true;
    const identitySession = {
      cookies: cookieStore(),
      clearStorageData: vi.fn(async () => {}),
      fetch: vi.fn(async () => new Response(null, { status: 200 })),
    } as unknown as Electron.Session;
    const clearLocalBroker = vi.fn();
    const reloadApp = vi.fn();
    const broker = new DesktopIdentityBroker({
      identitySession,
      resolveApp: () => app,
      createWindow: vi.fn() as never,
      reloadApp,
      clearLocalBroker,
    });

    await broker.signOut([app]);

    expect(app.session.fetch).toHaveBeenCalledWith(
      expect.stringMatching(
        /^https:\/\/mail\.agent-native\.com\/_agent-native\/auth\/logout\?_an_desktop_logout=/,
      ),
      { method: "POST", redirect: "manual", credentials: "include" },
    );
    expect(identitySession.fetch).toHaveBeenCalledWith(
      expect.stringMatching(
        /^https:\/\/mail\.agent-native\.com\/_agent-native\/auth\/logout\?_an_desktop_logout=/,
      ),
      { method: "POST", redirect: "manual", credentials: "include" },
    );
    expect(identitySession.clearStorageData).toHaveBeenCalledWith({
      storages: ["cookies"],
    });
    expect(app.session.cookies.remove).toHaveBeenCalledTimes(4);
    expect(clearLocalBroker).toHaveBeenCalledOnce();
    expect(reloadApp).toHaveBeenCalledWith(app);
    expect(broker.getStatus()).toBe("sign-in-required");
  });

  it("attempts every local cleanup and reports failure when central cleanup fails", async () => {
    const app = appFixture();
    const identitySession = {
      cookies: cookieStore(),
      clearStorageData: vi.fn(async () => {
        throw new Error("central cleanup failed");
      }),
      fetch: vi.fn(async () => new Response(null, { status: 200 })),
    } as unknown as Electron.Session;
    const clearLocalBroker = vi.fn();
    const reloadApp = vi.fn();
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const broker = new DesktopIdentityBroker({
      identitySession,
      resolveApp: () => app,
      createWindow: vi.fn() as never,
      reloadApp,
      clearLocalBroker,
    });

    await broker.signOut([app]);

    expect(app.session.cookies.remove).toHaveBeenCalledTimes(4);
    expect(clearLocalBroker).toHaveBeenCalledOnce();
    expect(reloadApp).toHaveBeenCalledWith(app);
    expect(broker.getStatus()).toBe("failed");
    expect(consoleError).toHaveBeenCalledOnce();
    consoleError.mockRestore();
  });

  it("preserves logout-all while avoiding a duplicate request to the triggering app", async () => {
    const app = appFixture();
    app.identityAuthority = true;
    const identitySession = {
      cookies: cookieStore(),
      clearStorageData: vi.fn(async () => {}),
      fetch: vi.fn(async () => new Response(null, { status: 200 })),
    } as unknown as Electron.Session;
    const broker = new DesktopIdentityBroker({
      identitySession,
      resolveApp: () => app,
      createWindow: vi.fn() as never,
      reloadApp: vi.fn(),
      clearLocalBroker: vi.fn(),
    });

    await broker.signOut([app], {
      logoutPath: "/_agent-native/auth/logout-all",
      alreadyRevokedAppId: app.id,
    });

    expect(app.session.fetch).not.toHaveBeenCalled();
    expect(identitySession.fetch).toHaveBeenCalledWith(
      expect.stringMatching(
        /^https:\/\/mail\.agent-native\.com\/_agent-native\/auth\/logout-all\?_an_desktop_logout=/,
      ),
      { method: "POST", redirect: "manual", credentials: "include" },
    );
    expect(broker.getStatus()).toBe("sign-in-required");
  });

  it("upgrades an in-progress logout when logout-all arrives", async () => {
    const mail = appFixture();
    mail.identityAuthority = true;
    const calendar = appFixture();
    calendar.id = "calendar";
    calendar.origin = "https://calendar.agent-native.com";
    const plainLogout = deferred<Response>();
    const sessionFetch = () =>
      vi.fn((url: string) =>
        new URL(url).pathname === "/_agent-native/auth/logout"
          ? plainLogout.promise
          : Promise.resolve(new Response(null, { status: 200 })),
      );
    mail.session.fetch = sessionFetch();
    calendar.session.fetch = sessionFetch();
    const identityFetch = sessionFetch();
    const broker = new DesktopIdentityBroker({
      identitySession: {
        cookies: cookieStore(),
        clearStorageData: vi.fn(async () => {}),
        fetch: identityFetch,
      } as unknown as Electron.Session,
      resolveApp: (id) => [mail, calendar].find((app) => app.id === id) ?? null,
      createWindow: vi.fn() as never,
      reloadApp: vi.fn(),
      clearLocalBroker: vi.fn(),
    });

    const first = broker.signOut([mail, calendar], {
      alreadyRevokedAppId: mail.id,
    });
    await vi.waitFor(() => expect(calendar.session.fetch).toHaveBeenCalled());
    const second = broker.signOut([mail, calendar], {
      logoutPath: "/_agent-native/auth/logout-all",
      alreadyRevokedAppId: calendar.id,
    });
    expect(second).toBe(first);
    plainLogout.resolve(new Response(null, { status: 200 }));

    await first;

    expect(mail.session.fetch).toHaveBeenCalledWith(
      expect.stringMatching(
        /^https:\/\/mail\.agent-native\.com\/_agent-native\/auth\/logout-all\?_an_desktop_logout=/,
      ),
      { method: "POST", redirect: "manual", credentials: "include" },
    );
    expect(
      vi
        .mocked(calendar.session.fetch)
        .mock.calls.some(
          ([url]) =>
            new URL(String(url)).pathname === "/_agent-native/auth/logout-all",
        ),
    ).toBe(false);
    expect(identityFetch).toHaveBeenCalledWith(
      expect.stringMatching(
        /^https:\/\/mail\.agent-native\.com\/_agent-native\/auth\/logout-all\?_an_desktop_logout=/,
      ),
      { method: "POST", redirect: "manual", credentials: "include" },
    );
  });

  it("uses request-start credentials when logout-all arrives during cleanup", async () => {
    const mail = appFixture();
    mail.identityAuthority = true;
    const calendar = appFixture();
    calendar.id = "calendar";
    calendar.origin = "https://calendar.agent-native.com";
    const mailFetch = vi.fn(
      async (_url: string, _init?: RequestInit) =>
        new Response(null, { status: 200 }),
    );
    const calendarFetch = vi.fn(
      async (_url: string, _init?: RequestInit) =>
        new Response(null, { status: 200 }),
    );
    mail.session = {
      cookies: cookieStore([
        sessionCookie("an_session_mail", mail.origin, "mail-session"),
      ]),
      fetch: mailFetch,
    } as unknown as Electron.Session;
    calendar.session = {
      cookies: cookieStore([
        sessionCookie("an_session", calendar.origin, "calendar-session"),
      ]),
      fetch: calendarFetch,
    } as unknown as Electron.Session;
    const centralCleanup = deferred<void>();
    const identityFetch = vi.fn(
      async (_url: string, _init?: RequestInit) =>
        new Response(null, { status: 200 }),
    );
    const clearStorageData = vi.fn(() => centralCleanup.promise);
    const broker = new DesktopIdentityBroker({
      identitySession: {
        cookies: cookieStore([
          sessionCookie("an_session", mail.origin, "dispatch-session"),
        ]),
        clearStorageData,
        fetch: identityFetch,
      } as unknown as Electron.Session,
      resolveApp: (id) => [mail, calendar].find((app) => app.id === id) ?? null,
      createWindow: vi.fn() as never,
      reloadApp: vi.fn(),
      clearLocalBroker: vi.fn(),
    });
    const apps = [mail, calendar];
    const plainOptions = {
      logoutPath: "/_agent-native/auth/logout" as const,
      alreadyRevokedAppId: mail.id,
    };
    await broker.prepareExternalSignOut(apps, plainOptions);
    const signOut = broker.completeExternalSignOut(apps, plainOptions, true);
    await vi.waitFor(() => expect(clearStorageData).toHaveBeenCalled());

    const allOptions = {
      logoutPath: "/_agent-native/auth/logout-all" as const,
      alreadyRevokedAppId: calendar.id,
    };
    await broker.prepareExternalSignOut(apps, allOptions);
    void broker.completeExternalSignOut(apps, allOptions, true);
    centralCleanup.resolve();
    await signOut;

    expect(
      mailFetch.mock.calls.some(
        ([url, init]) =>
          new URL(String(url)).pathname === "/_agent-native/auth/logout-all" &&
          new Headers(init?.headers).get("Cookie") ===
            "an_session_mail=mail-session",
      ),
    ).toBe(true);
    expect(
      identityFetch.mock.calls.some(
        ([url, init]) =>
          new URL(String(url)).pathname === "/_agent-native/auth/logout-all" &&
          new Headers(init?.headers).get("Cookie") ===
            "an_session=dispatch-session",
      ),
    ).toBe(true);
  });

  it("opens a ceremony only after explicit sign-in", async () => {
    const app = appFixture();
    let closedListener: (() => void) | undefined;
    const identityWindow = {
      webContents: {
        on: vi.fn(),
        setWindowOpenHandler: vi.fn(),
      },
      loadURL: vi.fn(async () => {}),
      isDestroyed: vi.fn(() => false),
      close: vi.fn(),
      on: vi.fn((event: string, listener: () => void) => {
        if (event === "closed") closedListener = listener;
      }),
    };
    const broker = new DesktopIdentityBroker({
      identitySession: {
        cookies: cookieStore(),
        clearStorageData: vi.fn(async () => {}),
      } as unknown as Electron.Session,
      resolveApp: (id) => (id === app.id ? app : null),
      createWindow: () => identityWindow as never,
      reloadApp: vi.fn(),
      clearLocalBroker: vi.fn(),
    });
    expect(identityWindow.loadURL).not.toHaveBeenCalled();

    const explicitSignIn = broker.signIn(app.id);
    await vi.waitFor(() => expect(closedListener).toBeDefined());
    expect(identityWindow.loadURL).toHaveBeenCalledTimes(1);
    closedListener?.();
    await expect(explicitSignIn).resolves.toBe(false);
  });

  it("invalidates a queued ceremony before it can open a window", async () => {
    const app = appFixture();
    const redirectResponse = deferred<string | null>();
    const resolveLoginRedirect = vi.fn(() => redirectResponse.promise);
    const createWindow = vi.fn();
    const reloadApp = vi.fn();
    const broker = new DesktopIdentityBroker({
      identitySession: {
        cookies: cookieStore(),
        clearStorageData: vi.fn(async () => {}),
      } as unknown as Electron.Session,
      resolveLoginRedirect,
      resolveApp: (id) => (id === app.id ? app : null),
      createWindow,
      reloadApp,
      clearLocalBroker: vi.fn(),
    });

    const ceremony = broker.signIn(app.id);
    await vi.waitFor(() => expect(resolveLoginRedirect).toHaveBeenCalled());
    await broker.signOut([app]);
    redirectResponse.resolve("https://dispatch.agent-native.com/sign-in");

    await expect(ceremony).resolves.toBe(false);
    expect(createWindow).not.toHaveBeenCalled();
    expect(reloadApp).toHaveBeenCalledTimes(1);
  });

  it("removes a cookie written by a ceremony cancelled during sign-out", async () => {
    const app = appFixture();
    const identityCookies = cookieStore([
      {
        name: "an_session_mail",
        value: "example-session-value",
        domain: "mail.agent-native.com",
        hostOnly: true,
        path: "/",
        secure: true,
        httpOnly: true,
        session: true,
        sameSite: "lax",
      },
    ]);
    const cookieWrite = deferred<void>();
    const targetCookies = cookieStore();
    targetCookies.set.mockImplementation(async () => cookieWrite.promise);
    app.session = {
      cookies: targetCookies,
      fetch: vi.fn(async () => new Response(null, { status: 200 })),
    } as unknown as Electron.Session;
    const webContents = {
      on: vi.fn(),
      setWindowOpenHandler: vi.fn(),
    };
    let loadedUrl = "";
    const closedListeners: Array<() => void> = [];
    const identityWindow = {
      webContents,
      loadURL: vi.fn(async (url: string) => {
        loadedUrl = url;
      }),
      isDestroyed: vi.fn(() => false),
      close: vi.fn(),
      on: vi.fn((event: string, listener: () => void) => {
        if (event === "closed") closedListeners.push(listener);
      }),
    };
    const createWindow = vi.fn(() => identityWindow as never);
    const reloadApp = vi.fn();
    const broker = new DesktopIdentityBroker({
      identitySession: {
        cookies: identityCookies,
        clearStorageData: vi.fn(async () => {}),
      } as unknown as Electron.Session,
      resolveApp: (id) => (id === app.id ? app : null),
      createWindow,
      reloadApp,
      clearLocalBroker: vi.fn(),
    });

    const ceremony = broker.signIn(app.id);
    await vi.waitFor(() => expect(loadedUrl).not.toBe(""));
    const returnPath = new URL(loadedUrl).searchParams.get("return")!;
    const completion = new URL(returnPath, app.origin).toString();
    const navigationHandler = webContents.on.mock.calls.find(
      ([event]) => event === "did-navigate",
    )?.[1];
    navigationHandler({}, completion, 200, "OK");
    await vi.waitFor(() => expect(targetCookies.set).toHaveBeenCalledOnce());

    let signOutResolved = false;
    const signOutOperation = broker.signOut([app]);
    const signOut = signOutOperation.then(() => {
      signOutResolved = true;
    });
    const nextSignIn = broker.signIn(app.id);
    expect(broker.signOut([app])).toBe(signOutOperation);
    await Promise.resolve();
    expect(signOutResolved).toBe(false);
    expect(createWindow).toHaveBeenCalledOnce();
    cookieWrite.resolve();

    await signOut;
    expect(signOutResolved).toBe(true);
    await expect(ceremony).resolves.toBe(false);
    await expect(nextSignIn).resolves.toBe(false);
    expect(targetCookies.remove).toHaveBeenCalledWith(
      app.origin,
      "an_session_mail",
    );
    expect(closedListeners).toHaveLength(1);
    expect(createWindow).toHaveBeenCalledOnce();
    expect(reloadApp).toHaveBeenCalledTimes(1);
  });

  it("drains cancelled cookie cleanup before starting an immediate reauthentication", async () => {
    const app = appFixture();
    const identityCookies = cookieStore([
      {
        name: "an_session_mail",
        value: "example-session-value",
        domain: "mail.agent-native.com",
        hostOnly: true,
        path: "/",
        secure: true,
        httpOnly: true,
        session: true,
        sameSite: "lax",
      },
    ]);
    const firstCookieWrite = deferred<void>();
    const targetCookies = cookieStore();
    targetCookies.set
      .mockImplementationOnce(async () => firstCookieWrite.promise)
      .mockImplementation(async () => {});
    app.session = {
      cookies: targetCookies,
      fetch: vi.fn(async () => new Response(null, { status: 200 })),
    } as unknown as Electron.Session;
    const windows: Array<{
      loadedUrl: string;
      webContents: {
        on: ReturnType<typeof vi.fn>;
        setWindowOpenHandler: ReturnType<typeof vi.fn>;
      };
      closed: () => void;
    }> = [];
    const createWindow = vi.fn(() => {
      const webContents = {
        on: vi.fn(),
        setWindowOpenHandler: vi.fn(),
      };
      let loadedUrl = "";
      let closed = () => {};
      const identityWindow = {
        webContents,
        loadURL: vi.fn(async (url: string) => {
          loadedUrl = url;
          windows[windows.length - 1]!.loadedUrl = url;
        }),
        isDestroyed: vi.fn(() => false),
        close: vi.fn(),
        on: vi.fn((event: string, listener: () => void) => {
          if (event === "closed") closed = listener;
          windows[windows.length - 1]!.closed = listener;
        }),
      };
      windows.push({
        loadedUrl,
        webContents,
        closed: () => closed(),
      });
      return identityWindow as never;
    });
    const broker = new DesktopIdentityBroker({
      identitySession: {
        cookies: identityCookies,
        clearStorageData: vi.fn(async () => {}),
      } as unknown as Electron.Session,
      resolveApp: (id) => (id === app.id ? app : null),
      createWindow,
      reloadApp: vi.fn(),
      clearLocalBroker: vi.fn(),
    });

    const firstCeremony = broker.signIn(app.id);
    await vi.waitFor(() => {
      expect(windows).toHaveLength(1);
      expect(windows[0]!.loadedUrl).not.toBe("");
    });
    const firstReturnPath = new URL(windows[0]!.loadedUrl).searchParams.get(
      "return",
    )!;
    const firstCompletion = new URL(firstReturnPath, app.origin).toString();
    const firstNavigation = windows[0]!.webContents.on.mock.calls.find(
      ([event]) => event === "did-navigate",
    )?.[1];
    firstNavigation({}, firstCompletion, 200, "OK");
    await vi.waitFor(() => expect(targetCookies.set).toHaveBeenCalledOnce());

    windows[0]!.closed();
    await expect(firstCeremony).resolves.toBe(false);
    const secondCeremony = broker.signIn(app.id);
    await Promise.resolve();
    expect(createWindow).toHaveBeenCalledOnce();

    firstCookieWrite.resolve();
    await vi.waitFor(() => expect(createWindow).toHaveBeenCalledTimes(2));
    expect(targetCookies.remove).toHaveBeenCalledWith(
      app.origin,
      "an_session_mail",
    );
    const secondReturnPath = new URL(windows[1]!.loadedUrl).searchParams.get(
      "return",
    )!;
    const secondCompletion = new URL(secondReturnPath, app.origin).toString();
    const secondNavigation = windows[1]!.webContents.on.mock.calls.find(
      ([event]) => event === "did-navigate",
    )?.[1];
    secondNavigation({}, secondCompletion, 200, "OK");

    await expect(secondCeremony).resolves.toBe(true);
    expect(targetCookies.set).toHaveBeenCalledTimes(2);
  });
});
