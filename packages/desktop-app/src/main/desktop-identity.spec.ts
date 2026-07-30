import { describe, expect, it, vi } from "vitest";

import {
  DESKTOP_IDENTITY_COMPLETE_PATH,
  DesktopIdentityBroker,
  desktopWorkspaceLogoutPath,
  isDesktopIdentityAuthorizeNavigation,
  isDesktopIdentityAuthorityLanding,
  isDesktopIdentityCompletion,
  isDesktopIdentityConfiguredAppEligible,
  isDesktopSignInNavigation,
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

  it("intercepts only the exact canonical app sign-in path", () => {
    expect(
      isDesktopSignInNavigation(
        "https://mail.agent-native.com/_agent-native/sign-in?return=%2Finbox",
        app,
      ),
    ).toBe(true);
    expect(
      isDesktopSignInNavigation(
        "https://evil.example/_agent-native/sign-in",
        app,
      ),
    ).toBe(false);
    expect(
      isDesktopSignInNavigation(
        "https://mail.agent-native.com/_agent-native/identity/login",
        app,
      ),
    ).toBe(false);
  });

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

  it("accepts an authority landing only on the exact authority origin", () => {
    const authority = authorityFixture();
    expect(
      isDesktopIdentityAuthorityLanding(
        "https://dispatch.agent-native.com/",
        authority,
      ),
    ).toBe(true);
    expect(
      isDesktopIdentityAuthorityLanding("https://evil.example/", authority),
    ).toBe(false);
    expect(
      isDesktopIdentityAuthorityLanding(
        "https://dispatch.agent-native.com/_agent-native/sign-in",
        authority,
      ),
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
  it("signs in to the authority directly and requires its session cookie", async () => {
    const authority = authorityFixture();
    const identityCookies = cookieStore();
    const webContents = {
      on: vi.fn(),
      setWindowOpenHandler: vi.fn(),
    };
    let closedListener: (() => void) | undefined;
    const identityWindow = {
      webContents,
      loadURL: vi.fn(async () => {}),
      isDestroyed: vi.fn(() => false),
      close: vi.fn(),
      on: vi.fn((event: string, listener: () => void) => {
        if (event === "closed") closedListener = listener;
      }),
    };
    const handleOAuthNavigation = vi.fn(() => false);
    const broker = new DesktopIdentityBroker({
      identitySession: {
        cookies: identityCookies,
        clearStorageData: vi.fn(async () => {}),
      } as unknown as Electron.Session,
      resolveApp: (id) => (id === authority.id ? authority : null),
      createWindow: () => identityWindow as never,
      handleOAuthNavigation,
      reloadApp: vi.fn(),
      clearLocalBroker: vi.fn(),
    });

    const first = broker.signInAuthority(authority.id);
    expect(broker.signInAuthority(authority.id)).toBe(first);
    await vi.waitFor(() => expect(identityWindow.loadURL).toHaveBeenCalled());
    expect(identityWindow.loadURL).toHaveBeenCalledWith(
      "https://dispatch.agent-native.com/_agent-native/sign-in?return=%2F",
    );

    const didNavigate = webContents.on.mock.calls.find(
      ([event]) => event === "did-navigate",
    )?.[1];
    didNavigate({}, authority.origin);
    await Promise.resolve();
    expect(broker.getStatus()).toBe("signing-in");

    await identityCookies.set({
      url: authority.origin,
      name: "an_session",
      value: "fake-session-value",
    });
    didNavigate({}, `${authority.origin}/`);

    await expect(first).resolves.toBe(true);
    expect(broker.getStatus()).toBe("signed-in");
    expect(identityWindow.close).toHaveBeenCalledOnce();
    expect(closedListener).toBeDefined();
  });

  it("does not accept a hostile authority landing and still delegates OAuth", async () => {
    const authority = authorityFixture();
    const webContents = {
      on: vi.fn(),
      setWindowOpenHandler: vi.fn(),
    };
    let closedListener: (() => void) | undefined;
    const identityWindow = {
      webContents,
      loadURL: vi.fn(async () => {}),
      isDestroyed: vi.fn(() => false),
      close: vi.fn(),
      on: vi.fn((event: string, listener: () => void) => {
        if (event === "closed") closedListener = listener;
      }),
    };
    const handleOAuthNavigation = vi.fn(() => true);
    const broker = new DesktopIdentityBroker({
      identitySession: {
        cookies: cookieStore(),
        clearStorageData: vi.fn(async () => {}),
      } as unknown as Electron.Session,
      resolveApp: (id) => (id === authority.id ? authority : null),
      createWindow: () => identityWindow as never,
      handleOAuthNavigation,
      reloadApp: vi.fn(),
      clearLocalBroker: vi.fn(),
    });

    const ceremony = broker.signInAuthority(authority.id);
    await vi.waitFor(() => expect(identityWindow.loadURL).toHaveBeenCalled());
    const willNavigate = webContents.on.mock.calls.find(
      ([event]) => event === "will-navigate",
    )?.[1];
    const didNavigate = webContents.on.mock.calls.find(
      ([event]) => event === "did-navigate",
    )?.[1];
    const preventDefault = vi.fn();
    willNavigate(
      { preventDefault },
      "https://accounts.google.com/o/oauth2/auth?client_id=fake-client-id",
    );
    didNavigate({}, "https://evil.example/");

    expect(preventDefault).toHaveBeenCalledOnce();
    expect(handleOAuthNavigation).toHaveBeenCalledWith(
      expect.stringContaining("accounts.google.com"),
      webContents,
    );
    expect(broker.getStatus()).toBe("signing-in");
    closedListener?.();
    await expect(ceremony).resolves.toBe(false);
    expect(broker.getStatus()).toBe("sign-in-required");
  });

  it("allows a fresh authority sign-in after sign-out cancels the active one", async () => {
    const authority = authorityFixture();
    const windows: Array<{ close: () => void }> = [];
    const createWindow = vi.fn(() => {
      let closedListener: (() => void) | undefined;
      const identityWindow = {
        webContents: {
          on: vi.fn(),
          setWindowOpenHandler: vi.fn(),
        },
        loadURL: vi.fn(async () => {}),
        isDestroyed: vi.fn(() => false),
        close: vi.fn(() => closedListener?.()),
        on: vi.fn((event: string, listener: () => void) => {
          if (event === "closed") closedListener = listener;
        }),
      };
      windows.push(identityWindow);
      return identityWindow as never;
    });
    const broker = new DesktopIdentityBroker({
      identitySession: {
        cookies: cookieStore(),
        clearStorageData: vi.fn(async () => {}),
        fetch: vi.fn(async () => new Response(null, { status: 200 })),
      } as unknown as Electron.Session,
      resolveApp: (id) => (id === authority.id ? authority : null),
      createWindow,
      reloadApp: vi.fn(),
      clearLocalBroker: vi.fn(),
    });

    const first = broker.signInAuthority(authority.id);
    await vi.waitFor(() => expect(createWindow).toHaveBeenCalledOnce());
    await broker.signOut([authority]);
    await expect(first).resolves.toBe(false);

    const second = broker.signInAuthority(authority.id);
    expect(second).not.toBe(first);
    await vi.waitFor(() => expect(createWindow).toHaveBeenCalledTimes(2));
    windows[1]?.close();
    await expect(second).resolves.toBe(false);
  });

  it("loads the validated identity authority redirect", async () => {
    const app = appFixture();
    const authority = authorityFixture();
    const resolvedUrl = authorizeUrl(authority, app);
    const resolveLoginRedirect = vi.fn(async () => resolvedUrl);
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

    const ceremony = broker.ensureAppSession(app.id);
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

    await expect(broker.ensureAppSession(app.id)).resolves.toBe(false);
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

    await expect(broker.ensureAppSession(app.id)).resolves.toBe(false);
    expect(createWindow).not.toHaveBeenCalled();
    expect(reloadApp).toHaveBeenCalledWith(app);
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

    const first = broker.ensureAppSession("mail");
    const second = broker.ensureAppSession("mail");
    expect(second).toBe(first);
    await vi.waitFor(() => expect(loadedUrl).not.toBe(""));

    const nonce = new URL(loadedUrl).searchParams.get("return")!;
    const completion = new URL(nonce, app.origin).toString();
    const navigationHandler = webContents.on.mock.calls.find(
      ([event]) => event === "will-navigate",
    )?.[1];
    const preventDefault = vi.fn();
    navigationHandler({ preventDefault }, completion);

    await expect(first).resolves.toBe(true);
    expect(preventDefault).toHaveBeenCalled();
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

  it("keeps automatic sign-in suppressed until an explicit sign-in", async () => {
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
    const signInUrl = `${app.origin}/_agent-native/sign-in`;

    await broker.signOut([app]);
    expect(broker.handleSignedOutNavigation(app.id, signInUrl)).toBe(false);

    const explicitSignIn = broker.signIn(app.id);
    expect(broker.handleSignedOutNavigation(app.id, signInUrl)).toBe(true);
    await vi.waitFor(() => expect(closedListener).toBeDefined());
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

    const ceremony = broker.ensureAppSession(app.id);
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

    const ceremony = broker.ensureAppSession(app.id);
    await vi.waitFor(() => expect(loadedUrl).not.toBe(""));
    const returnPath = new URL(loadedUrl).searchParams.get("return")!;
    const completion = new URL(returnPath, app.origin).toString();
    const navigationHandler = webContents.on.mock.calls.find(
      ([event]) => event === "will-navigate",
    )?.[1];
    navigationHandler({ preventDefault: vi.fn() }, completion);
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
});
