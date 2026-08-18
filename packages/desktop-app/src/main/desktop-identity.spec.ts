import { describe, expect, it, vi } from "vitest";

import {
  DESKTOP_IDENTITY_COMPLETE_PATH,
  DesktopIdentityBroker,
  desktopWorkspaceLogoutPath,
  fetchDesktopIdentityAvailability,
  isDesktopIdentityAppConfigEligible,
  isDesktopIdentityOriginEligible,
  isDesktopIdentityAuthorizeNavigation,
  isDesktopIdentityCompletion,
  isDesktopIdentityConfiguredAppEligible,
  isDesktopWorkspaceLogoutRequest,
  shouldStartDesktopIdentitySignIn,
  type DesktopIdentityApp,
} from "./desktop-identity";

function cookieStore(
  initial: Electron.Cookie[] = [],
  options: { omitUrlFiltered?: boolean } = {},
) {
  const cookies = [...initial];
  const matchesUrl = (cookie: Electron.Cookie, url?: string) => {
    if (!url) return true;
    const hostname = new URL(url).hostname;
    const domain = (cookie.domain ?? "").replace(/^\./, "");
    return hostname === domain || hostname.endsWith(`.${domain}`);
  };
  return {
    get: vi.fn(async (filter?: Electron.CookiesGetFilter) => {
      if (filter?.url && options.omitUrlFiltered) return [];
      return cookies.filter((cookie) => matchesUrl(cookie, filter?.url));
    }),
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
    remove: vi.fn(async (url: string, name: string) => {
      const index = cookies.findIndex(
        (cookie) => cookie.name === name && matchesUrl(cookie, url),
      );
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
    workspaceSso: true,
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

function sessionResponse(email = "steve@example.com"): Response {
  return new Response(JSON.stringify({ email }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
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

  it("requires explicit opt-in and production HTTPS for custom app SSO", () => {
    const custom = {
      id: "custom-workspace-app",
      enabled: true,
      mode: "prod",
      isBuiltIn: false,
    };

    expect(isDesktopIdentityAppConfigEligible(custom)).toBe(false);
    expect(
      isDesktopIdentityAppConfigEligible({ ...custom, workspaceSso: true }),
    ).toBe(true);
    expect(
      isDesktopIdentityAppConfigEligible({
        ...custom,
        workspaceSso: true,
        mode: "dev",
      }),
    ).toBe(false);
    expect(
      isDesktopIdentityAppConfigEligible({
        ...custom,
        workspaceSso: true,
        enabled: false,
      }),
    ).toBe(false);
    expect(
      isDesktopIdentityAppConfigEligible(custom, { canonical: true }),
    ).toBe(true);
    expect(isDesktopIdentityOriginEligible("https://custom.example")).toBe(
      true,
    );
    expect(isDesktopIdentityOriginEligible("http://custom.example")).toBe(
      false,
    );
    expect(isDesktopIdentityOriginEligible("https://custom.example/path")).toBe(
      false,
    );
  });

  it("only starts the automatic ceremony for a signed-out authority", () => {
    const authority = authorityFixture();

    expect(
      shouldStartDesktopIdentitySignIn("sign-in-required", authority),
    ).toBe(true);
    expect(shouldStartDesktopIdentitySignIn("signed-in", authority)).toBe(
      false,
    );
    expect(shouldStartDesktopIdentitySignIn("failed", authority)).toBe(false);
    expect(shouldStartDesktopIdentitySignIn("sign-in-required", null)).toBe(
      false,
    );
  });
});

describe("DesktopIdentityBroker", () => {
  it("authenticates from the parent surface and fans the session out", async () => {
    const authority = authorityFixture();
    const authorityCookies = cookieStore();
    authority.session = {
      cookies: authorityCookies,
      fetch: vi.fn(async () => sessionResponse()),
    } as unknown as Electron.Session;
    const identityCookies = cookieStore();
    const identityFetch = vi.fn(async (url: string) => {
      if (url.endsWith("/_agent-native/auth/login")) {
        await identityCookies.set({
          url: authority.origin,
          name: "an_session_dispatch",
          value: "new-session",
        });
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ email: "steve@example.com" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    const createWindow = vi.fn(() => {
      let didNavigate:
        | ((event: unknown, url: string, statusCode: number) => void)
        | undefined;
      const webContents = {
        on: vi.fn((event: string, handler: typeof didNavigate) => {
          if (event === "did-navigate") didNavigate = handler;
        }),
        setWindowOpenHandler: vi.fn(),
      };
      return {
        webContents,
        loadURL: vi.fn(async (url: string) => {
          const returnPath = new URL(url).searchParams.get("return");
          queueMicrotask(() =>
            didNavigate?.(
              {},
              new URL(returnPath!, new URL(url).origin).toString(),
              200,
            ),
          );
        }),
        isDestroyed: vi.fn(() => false),
        close: vi.fn(),
        on: vi.fn(),
      } as never;
    });
    const broker = new DesktopIdentityBroker({
      identitySession: {
        cookies: identityCookies,
        fetch: identityFetch,
        clearStorageData: vi.fn(async () => {}),
      } as unknown as Electron.Session,
      isAvailable: vi.fn(async () => true),
      resolveApp: (id) => (id === authority.id ? authority : null),
      listApps: () => [authority],
      createWindow,
      reloadApp: vi.fn(),
      clearLocalBroker: vi.fn(),
    });

    await expect(
      broker.authenticateWithPassword({
        mode: "sign-in",
        email: "steve@example.com",
        password: "not-logged-or-stored",
      }),
    ).resolves.toEqual({ ok: true, email: "steve@example.com" });

    expect(identityFetch).toHaveBeenCalledWith(
      `${authority.origin}/_agent-native/auth/login`,
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        body: JSON.stringify({
          email: "steve@example.com",
          password: "not-logged-or-stored",
        }),
      }),
    );
    expect(authorityCookies.set).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "an_session_dispatch",
        value: "new-session",
      }),
    );
    expect(broker.getStatus()).toBe("signed-in");
    expect(createWindow).toHaveBeenCalledOnce();
  });

  it("adopts a normal Dispatch login into the isolated identity session", async () => {
    const authority = authorityFixture();
    const authorityCookies = cookieStore(
      [
        sessionCookie(
          "an_session_dispatch",
          authority.origin,
          "dispatch-session",
        ),
      ],
      { omitUrlFiltered: true },
    );
    authority.session = {
      cookies: authorityCookies,
      fetch: vi.fn(async () => sessionResponse()),
    } as unknown as Electron.Session;
    const identityCookies = cookieStore([], { omitUrlFiltered: true });
    const identityFetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ email: "steve@example.com" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    const createWindow = vi.fn();
    const broker = new DesktopIdentityBroker({
      identitySession: {
        cookies: identityCookies,
        fetch: identityFetch,
        clearStorageData: vi.fn(async () => {}),
      } as unknown as Electron.Session,
      isAvailable: vi.fn(async () => true),
      resolveApp: (id) => (id === authority.id ? authority : null),
      listApps: () => [authority],
      createWindow: createWindow as never,
      reloadApp: vi.fn(),
      clearLocalBroker: vi.fn(),
    });

    await expect(broker.adoptAppSession(authority.id)).resolves.toBe(true);

    expect(identityFetch).toHaveBeenCalledWith(
      `${authority.origin}/_agent-native/auth/session`,
      expect.objectContaining({ credentials: "include" }),
    );
    expect(identityCookies.set).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "an_session_dispatch",
        value: "dispatch-session",
      }),
    );
    expect(identityCookies.set).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "an_session",
        value: "dispatch-session",
      }),
    );
    expect(createWindow).not.toHaveBeenCalled();
    expect(broker.getStatus()).toBe("signed-in");
  });

  it("rejects adopting a different account over the active identity session", async () => {
    const source = appFixture();
    source.session = {
      cookies: cookieStore([
        sessionCookie("an_session_mail", source.origin, "bob-session"),
      ]),
      fetch: vi.fn(async () => sessionResponse("bob@example.com")),
    } as unknown as Electron.Session;
    const authority = authorityFixture();
    const identityCookies = cookieStore([
      sessionCookie("an_session_dispatch", authority.origin, "alice-session"),
    ]);
    const identityFetch = vi.fn(async () =>
      sessionResponse("alice@example.com"),
    );
    const broker = new DesktopIdentityBroker({
      identitySession: {
        cookies: identityCookies,
        fetch: identityFetch,
        clearStorageData: vi.fn(async () => {}),
      } as unknown as Electron.Session,
      resolveApp: (id) =>
        id === source.id ? source : id === authority.id ? authority : null,
      listApps: () => [source, authority],
      createWindow: vi.fn() as never,
      reloadApp: vi.fn(),
      clearLocalBroker: vi.fn(),
    });

    await expect(broker.adoptAppSession(source.id)).resolves.toBe(false);
    expect(await identityCookies.get({ url: authority.origin })).toEqual([
      expect.objectContaining({
        name: "an_session_dispatch",
        value: "alice-session",
      }),
    ]);
    expect(broker.getStatus()).toBe("idle");
  });

  it("does not promote a child app session into an empty Dispatch authority", async () => {
    const source = appFixture();
    source.session = {
      cookies: cookieStore([
        sessionCookie("an_session_mail", source.origin, "shared-session"),
      ]),
      fetch: vi.fn(async () => sessionResponse()),
    } as unknown as Electron.Session;
    const authority = authorityFixture();
    authority.session = {
      cookies: cookieStore([
        sessionCookie(
          "an_session_dispatch",
          authority.origin,
          "shared-session",
        ),
      ]),
      fetch: vi.fn(async () => sessionResponse()),
    } as unknown as Electron.Session;
    const identityCookies = cookieStore();
    const identityFetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ email: "steve@example.com" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    const broker = new DesktopIdentityBroker({
      identitySession: {
        cookies: identityCookies,
        fetch: identityFetch,
        clearStorageData: vi.fn(async () => {}),
      } as unknown as Electron.Session,
      isAvailable: vi.fn(async () => true),
      resolveApp: (id) =>
        id === source.id ? source : id === authority.id ? authority : null,
      listApps: () => [source, authority],
      createWindow: vi.fn() as never,
      reloadApp: vi.fn(),
      clearLocalBroker: vi.fn(),
    });

    await expect(broker.adoptAppSession(source.id)).resolves.toBe(false);

    expect(identityFetch).not.toHaveBeenCalled();
    expect(identityCookies.set).not.toHaveBeenCalled();
    expect(broker.getStatus()).toBe("idle");
  });

  it("fans a verified parent login out to built-in and opted-in workspace apps", async () => {
    const source = authorityFixture();
    source.session = {
      cookies: cookieStore([
        sessionCookie("an_session_dispatch", source.origin, "shared-session"),
      ]),
      fetch: vi.fn(async () => sessionResponse()),
    } as unknown as Electron.Session;
    const authority = source;
    const calendar = {
      ...appFixture(),
      id: "calendar",
      origin: "https://calendar.agent-native.com",
      cookieNames: ["an_session_calendar", "an_session"],
      cookieNamesToClear: ["an_session_calendar", "an_session"],
    };
    calendar.session = {
      cookies: cookieStore([
        sessionCookie(
          "an_session_calendar",
          calendar.origin,
          "previous-session",
        ),
      ]),
      fetch: vi.fn(async () => sessionResponse()),
    } as unknown as Electron.Session;
    const custom = {
      ...appFixture(),
      id: "custom-workspace-app",
      origin: "https://custom.example",
      cookieNames: ["an_session_custom_workspace_app", "an_session"],
      cookieNamesToClear: ["an_session_custom_workspace_app", "an_session"],
    };
    const untrusted = {
      ...appFixture(),
      id: "untrusted-workspace-app",
      origin: "https://untrusted.example",
      workspaceSso: false,
    };
    const identityCookies = cookieStore();
    const identityFetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ email: "steve@example.com" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    const windows: Array<{
      webContents: {
        on: ReturnType<typeof vi.fn>;
        setWindowOpenHandler: ReturnType<typeof vi.fn>;
      };
      loadURL: ReturnType<typeof vi.fn>;
      isDestroyed: ReturnType<typeof vi.fn>;
      close: ReturnType<typeof vi.fn>;
      on: ReturnType<typeof vi.fn>;
    }> = [];
    const createWindow = vi.fn(() => {
      let didNavigate:
        | ((event: unknown, url: string, statusCode: number) => void)
        | null = null;
      const webContents = {
        on: vi.fn((event: string, handler: typeof didNavigate) => {
          if (event === "did-navigate") didNavigate = handler;
        }),
        setWindowOpenHandler: vi.fn(),
      };
      const identityWindow = {
        webContents,
        loadURL: vi.fn(async (url: string) => {
          const target = apps.find(
            (app) => new URL(url).hostname === new URL(app.origin).hostname,
          );
          if (target) {
            await identityCookies.set({
              url: target.origin,
              name: target.cookieNames[0],
              value: "shared-session",
              path: "/",
              httpOnly: true,
              secure: true,
              sameSite: "lax",
            });
          }
          queueMicrotask(() => didNavigate?.({}, url, 200));
        }),
        isDestroyed: vi.fn(() => false),
        close: vi.fn(),
        on: vi.fn(),
      };
      windows.push(identityWindow);
      return identityWindow as never;
    });
    const apps = [source, calendar, custom, untrusted];
    const broker = new DesktopIdentityBroker({
      identitySession: {
        cookies: identityCookies,
        fetch: identityFetch,
        clearStorageData: vi.fn(async () => {}),
      } as unknown as Electron.Session,
      isAvailable: vi.fn(async () => true),
      resolveLoginRedirect: vi.fn(async (loginUrl: string) => {
        const returnPath = new URL(loginUrl).searchParams.get("return")!;
        return new URL(returnPath, new URL(loginUrl).origin).toString();
      }),
      resolveApp: (id) => apps.find((app) => app.id === id) ?? null,
      listApps: () => apps,
      createWindow,
      reloadApp: vi.fn(),
      clearLocalBroker: vi.fn(),
    });

    await expect(broker.adoptAppSession(source.id)).resolves.toBe(true);

    expect(createWindow).toHaveBeenCalledTimes(2);
    expect(windows).toHaveLength(2);
    expect(identityCookies.set).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "an_session_dispatch",
        value: "shared-session",
      }),
    );
    expect(calendar.session.cookies.set).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "an_session_calendar",
        value: "shared-session",
      }),
    );
    expect(custom.session.cookies.set).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "an_session_custom_workspace_app",
        value: "shared-session",
      }),
    );
    expect(untrusted.session.cookies.set).not.toHaveBeenCalled();
    expect(broker.getStatus()).toBe("signed-in");
  });

  it("restores the previous identity session when authority synchronization fails", async () => {
    const source = appFixture();
    source.session = {
      cookies: cookieStore([
        sessionCookie("an_session_mail", source.origin, "new-session"),
      ]),
      fetch: vi.fn(async () => sessionResponse()),
    } as unknown as Electron.Session;
    const authority = authorityFixture();
    const identityCookies = cookieStore([
      sessionCookie(
        "an_session_dispatch",
        authority.origin,
        "previous-session",
      ),
    ]);
    const identityFetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ email: "steve@example.com" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    const reloadApp = vi.fn();
    const broker = new DesktopIdentityBroker({
      identitySession: {
        cookies: identityCookies,
        fetch: identityFetch,
        clearStorageData: vi.fn(async () => {}),
      } as unknown as Electron.Session,
      resolveLoginRedirect: vi.fn(async () => null),
      resolveApp: (id) =>
        id === source.id ? source : id === authority.id ? authority : null,
      listApps: () => [source, authority],
      createWindow: vi.fn() as never,
      reloadApp,
      clearLocalBroker: vi.fn(),
    });

    await expect(broker.adoptAppSession(source.id)).resolves.toBe(false);

    expect(await identityCookies.get()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "an_session_dispatch",
          value: "previous-session",
        }),
      ]),
    );
    expect(reloadApp).toHaveBeenCalledWith(authority);
    expect(broker.getStatus()).toBe("idle");
  });

  it("fails closed and restores an existing identity session for an invalid app cookie", async () => {
    const source = appFixture();
    source.session = {
      cookies: cookieStore([
        sessionCookie("an_session_mail", source.origin, "invalid-session"),
      ]),
      fetch: vi.fn(async () => new Response(null, { status: 200 })),
    } as unknown as Electron.Session;
    const authority = authorityFixture();
    const identityCookies = cookieStore([
      sessionCookie(
        "an_session_dispatch",
        authority.origin,
        "existing-session",
      ),
    ]);
    const identityFetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: "Not authenticated" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    const broker = new DesktopIdentityBroker({
      identitySession: {
        cookies: identityCookies,
        fetch: identityFetch,
        clearStorageData: vi.fn(async () => {}),
      } as unknown as Electron.Session,
      isAvailable: vi.fn(async () => true),
      resolveApp: (id) =>
        id === source.id ? source : id === authority.id ? authority : null,
      listApps: () => [source, authority],
      createWindow: vi.fn() as never,
      reloadApp: vi.fn(),
      clearLocalBroker: vi.fn(),
    });

    await expect(broker.adoptAppSession(source.id)).resolves.toBe(false);

    const restored = await identityCookies.get();
    expect(restored).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "an_session_dispatch",
          value: "existing-session",
        }),
      ]),
    );
    expect(broker.getStatus()).toBe("idle");
  });

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

  it("starts explicit workspace sign-in when anonymous availability is false", async () => {
    const app = appFixture();
    const authority = authorityFixture();
    let closedHandler: (() => void) | undefined;
    const identityWindow = {
      webContents: {
        on: vi.fn(),
        setWindowOpenHandler: vi.fn(),
      },
      loadURL: vi.fn(async () => {}),
      isDestroyed: vi.fn(() => false),
      close: vi.fn(() => closedHandler?.()),
      on: vi.fn((event: string, handler: () => void) => {
        if (event === "closed") closedHandler = handler;
      }),
    };
    const broker = new DesktopIdentityBroker({
      identitySession: {
        cookies: cookieStore(),
        clearStorageData: vi.fn(async () => {}),
      } as unknown as Electron.Session,
      isAvailable: vi.fn(async () => false),
      resolveApp: (id) =>
        id === app.id ? app : id === authority.id ? authority : null,
      createWindow: vi.fn(() => identityWindow) as never,
      reloadApp: vi.fn(),
      clearLocalBroker: vi.fn(),
    });

    const signIn = broker.signIn(app.id);
    await vi.waitFor(() => expect(identityWindow.loadURL).toHaveBeenCalled());
    closedHandler?.();
    await expect(signIn).resolves.toBe(false);
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

  it("shows the parent sign-in surface when rollout availability is off", async () => {
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
    expect(broker.getStatus()).toBe("sign-in-required");
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
        fetch: vi.fn(async () => sessionResponse()),
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

  it("passes the isolated authority cookie to the authenticated availability probe", async () => {
    const authority = authorityFixture();
    const identityCookies = cookieStore([
      sessionCookie("an_session_dispatch", authority.origin, "parent-session"),
    ]);
    let cookieHeader: string | null = null;
    const identitySession = {
      cookies: identityCookies,
      fetch: vi.fn(async (_url: string, init?: RequestInit) => {
        cookieHeader = new Headers(init?.headers).get("Cookie");
        return new Response(JSON.stringify({ available: true }), {
          status: 200,
        });
      }),
    } as unknown as Electron.Session;

    await expect(
      fetchDesktopIdentityAvailability(authority, identitySession),
    ).resolves.toBe(true);
    expect(cookieHeader).toBe("an_session_dispatch=parent-session");
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

  it("lets the OAuth handler claim Google navigation before the allowlist", async () => {
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
    const handleOAuthNavigation = vi.fn(() => true);
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
      handleOAuthNavigation,
      reloadApp: vi.fn(),
      clearLocalBroker: vi.fn(),
    });

    await broker.refreshStatus(authority);
    const ceremony = broker.signIn(app.id);
    await vi.waitFor(() => expect(identityWindow.loadURL).toHaveBeenCalled());
    const navigationHandler = webContents.on.mock.calls.find(
      ([event]) => event === "will-navigate",
    )?.[1];
    const preventDefault = vi.fn();
    const googleUrl =
      "https://accounts.google.com/o/oauth2/v2/auth?flow_id=desktop-flow";

    navigationHandler({ preventDefault }, googleUrl);

    expect(handleOAuthNavigation).toHaveBeenCalledWith(googleUrl, webContents);
    expect(preventDefault).toHaveBeenCalledOnce();
    const closedHandler = identityWindow.on.mock.calls.find(
      ([event]) => event === "closed",
    )?.[1];
    closedHandler();
    await expect(ceremony).resolves.toBe(false);
  });

  it("polls the system-browser OAuth exchange before completing the parent session", async () => {
    const authority = authorityFixture();
    const identityCookies = cookieStore();
    const identityFetch = vi
      .fn<() => Promise<Response>>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ pending: true }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            token: "desktop-session",
            email: "steve@example.com",
          }),
          { status: 200 },
        ),
      );
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
    const broker = new DesktopIdentityBroker({
      identitySession: {
        cookies: identityCookies,
        fetch: identityFetch,
        clearStorageData: vi.fn(async () => {}),
      } as unknown as Electron.Session,
      isAvailable: vi.fn(async () => true),
      resolveApp: (id) => (id === authority.id ? authority : null),
      listApps: () => [authority],
      createWindow: () => identityWindow as never,
      handleOAuthNavigation: vi.fn(() => true),
      reloadApp: vi.fn(),
      clearLocalBroker: vi.fn(),
    });

    const signIn = broker.signIn(authority.id);
    await vi.waitFor(() => expect(identityWindow.loadURL).toHaveBeenCalled());
    const navigationHandler = webContents.on.mock.calls.find(
      ([event]) => event === "will-navigate",
    )?.[1] as (event: { preventDefault: () => void }, url: string) => void;
    const state = `${Buffer.from(JSON.stringify({ f: "desktop-flow" })).toString("base64url")}.signature`;
    navigationHandler(
      { preventDefault: vi.fn() },
      `https://accounts.google.com/o/oauth2/v2/auth?state=${state}&verifier=magic-link-verifier`,
    );

    await vi.waitFor(() => expect(identityFetch).toHaveBeenCalledTimes(1));
    closedListener?.();

    await expect(signIn).resolves.toBe(true);
    expect(identityFetch).toHaveBeenCalledWith(
      expect.stringContaining(
        "/_agent-native/auth/desktop-exchange?flow_id=desktop-flow&verifier=magic-link-verifier",
      ),
      expect.objectContaining({ credentials: "include" }),
    );
    expect(identityFetch).toHaveBeenCalledTimes(2);
    expect(identityCookies.set).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "an_session_dispatch",
        value: "desktop-session",
      }),
    );
  });

  it("uses the system browser and one-time embed sessions for modern fan-out", async () => {
    const authority = authorityFixture();
    const mail = appFixture();
    const identityCookies = cookieStore();
    const authorityCookies = cookieStore();
    const mailCookies = cookieStore();
    const openedUrls: string[] = [];
    const identityFetch = vi.fn(
      async (input: string, init?: RequestInit): Promise<Response> => {
        const url = new URL(input);
        if (url.pathname === "/_agent-native/auth/desktop-exchange") {
          return new Response(
            JSON.stringify({
              token: "desktop-session",
              email: "owner@example.com",
            }),
            { status: 200 },
          );
        }
        if (url.pathname === "/_agent-native/auth/session") {
          return sessionResponse("owner@example.com");
        }
        if (
          url.pathname ===
          "/_agent-native/actions/create-workspace-app-embed-session"
        ) {
          expect(init?.headers).toEqual(
            expect.objectContaining({
              Cookie: expect.stringContaining(
                "an_session_dispatch=desktop-session",
              ),
              "X-Agent-Native-CSRF": "1",
            }),
          );
          expect(JSON.parse(String(init?.body))).toEqual({
            app: "mail",
            path: "/",
            chrome: "minimal",
          });
          return new Response(
            JSON.stringify({
              startUrl:
                "https://mail.agent-native.com/_agent-native/embed/start?ticket=mail-ticket",
            }),
            { status: 200 },
          );
        }
        return new Response(null, { status: 404 });
      },
    );
    authority.session = {
      cookies: authorityCookies,
      fetch: vi.fn(async (input: string) =>
        new URL(input).pathname === "/_agent-native/auth/session"
          ? sessionResponse("owner@example.com")
          : new Response(null, { status: 404 }),
      ),
    } as unknown as Electron.Session;
    mail.session = {
      cookies: mailCookies,
      fetch: vi.fn(async (input: string) => {
        const url = new URL(input);
        if (url.pathname === "/_agent-native/embed/start") {
          await mailCookies.set({
            url: mail.origin,
            name: "an_session_mail",
            value: "mail-session",
          });
          return new Response("<html></html>", { status: 200 });
        }
        return url.pathname === "/_agent-native/auth/session"
          ? sessionResponse("owner@example.com")
          : new Response(null, { status: 404 });
      }),
    } as unknown as Electron.Session;
    const createWindow = vi.fn();
    const reloadApp = vi.fn();
    const broker = new DesktopIdentityBroker({
      identitySession: {
        cookies: identityCookies,
        fetch: identityFetch,
        clearStorageData: vi.fn(async () => {}),
      } as unknown as Electron.Session,
      isAvailable: vi.fn(async () => true),
      resolveApp: (id) =>
        id === authority.id ? authority : id === mail.id ? mail : null,
      listApps: () => [authority, mail],
      createWindow,
      openExternal: vi.fn(async (url: string) => {
        openedUrls.push(url);
      }),
      reloadApp,
      clearLocalBroker: vi.fn(),
    });

    await expect(broker.signIn(mail.id)).resolves.toBe(true);

    expect(createWindow).not.toHaveBeenCalled();
    expect(openedUrls).toHaveLength(1);
    expect(new URL(openedUrls[0]!).pathname).toBe(
      "/_agent-native/google/auth-url",
    );
    expect(authorityCookies.set).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "an_session_dispatch",
        value: "desktop-session",
      }),
    );
    expect(mailCookies.set).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "an_session_mail",
        value: "mail-session",
      }),
    );
    expect(reloadApp).toHaveBeenCalledWith(authority);
    expect(reloadApp).toHaveBeenCalledWith(mail);
    expect(broker.getStatus()).toBe("signed-in");

    const embedSessionRequests = identityFetch.mock.calls.filter(
      ([input]) =>
        new URL(String(input)).pathname ===
        "/_agent-native/actions/create-workspace-app-embed-session",
    );
    const reloadCount = reloadApp.mock.calls.length;
    await expect(broker.ensureAppSession(mail.id)).resolves.toBe(true);
    expect(
      identityFetch.mock.calls.filter(
        ([input]) =>
          new URL(String(input)).pathname ===
          "/_agent-native/actions/create-workspace-app-embed-session",
      ),
    ).toHaveLength(embedSessionRequests.length);
    expect(reloadApp).toHaveBeenCalledTimes(reloadCount);
  });

  it("does not remint a verified modern child on repeated status notifications", async () => {
    const authority = authorityFixture();
    const mail = appFixture();
    const identityCookies = cookieStore([
      sessionCookie("an_session_dispatch", authority.origin, "desktop-session"),
    ]);
    const mailCookies = cookieStore();
    let appSessionVerificationCount = 0;
    const identityFetch = vi.fn(async (input: string) => {
      const url = new URL(input);
      if (url.pathname === "/_agent-native/auth/session") {
        return sessionResponse("owner@example.com");
      }
      if (
        url.pathname ===
        "/_agent-native/actions/create-workspace-app-embed-session"
      ) {
        return new Response(
          JSON.stringify({
            startUrl:
              "https://mail.agent-native.com/_agent-native/embed/start?ticket=mail-ticket",
          }),
          { status: 200 },
        );
      }
      return new Response(null, { status: 404 });
    });
    mail.session = {
      cookies: mailCookies,
      fetch: vi.fn(async (input: string) => {
        const url = new URL(input);
        if (url.pathname === "/_agent-native/embed/start") {
          await mailCookies.set({
            url: mail.origin,
            name: "an_session_mail",
            value: "mail-session",
          });
          return new Response("<html></html>", { status: 200 });
        }
        if (url.pathname === "/_agent-native/auth/session") {
          appSessionVerificationCount += 1;
          return appSessionVerificationCount === 1
            ? sessionResponse("owner@example.com")
            : new Response(null, { status: 503 });
        }
        return new Response(null, { status: 404 });
      }),
    } as unknown as Electron.Session;
    const reloadApp = vi.fn();
    const broker = new DesktopIdentityBroker({
      identitySession: {
        cookies: identityCookies,
        fetch: identityFetch,
        clearStorageData: vi.fn(async () => {}),
      } as unknown as Electron.Session,
      resolveApp: (id) =>
        id === authority.id ? authority : id === mail.id ? mail : null,
      listApps: () => [authority, mail],
      openExternal: vi.fn(async () => {}),
      reloadApp,
      clearLocalBroker: vi.fn(),
      createWindow: vi.fn() as never,
    });
    broker.setStatusForSetting("signed-in");

    await expect(broker.ensureAppSession(mail.id)).resolves.toBe(true);
    const embedSessionRequestCount = identityFetch.mock.calls.filter(
      ([input]) =>
        new URL(String(input)).pathname ===
        "/_agent-native/actions/create-workspace-app-embed-session",
    ).length;

    await expect(broker.ensureAppSession(mail.id)).resolves.toBe(true);

    expect(
      identityFetch.mock.calls.filter(
        ([input]) =>
          new URL(String(input)).pathname ===
          "/_agent-native/actions/create-workspace-app-embed-session",
      ),
    ).toHaveLength(embedSessionRequestCount);
    expect(reloadApp).toHaveBeenCalledTimes(1);
  });

  it("dedupes a completed workspace embed session", async () => {
    const authority = authorityFixture();
    const mail = appFixture();
    mail.cookieNames = [
      ...mail.cookieNames,
      "an_session_workspace",
      "an_embed_session",
    ];
    mail.cookieNamesToClear = [
      ...mail.cookieNamesToClear,
      "an_session_workspace",
      "an_embed_session",
    ];
    const identityCookies = cookieStore([
      sessionCookie("an_session_dispatch", authority.origin, "desktop-session"),
    ]);
    const mailCookies = cookieStore();
    const identityFetch = vi.fn(async (input: string) => {
      const url = new URL(input);
      if (url.pathname === "/_agent-native/auth/session") {
        return sessionResponse("owner@example.com");
      }
      if (
        url.pathname ===
        "/_agent-native/actions/create-workspace-app-embed-session"
      ) {
        return new Response(
          JSON.stringify({
            startUrl:
              "https://mail.agent-native.com/_agent-native/embed/start?ticket=mail-ticket",
          }),
          { status: 200 },
        );
      }
      return new Response(null, { status: 404 });
    });
    mail.session = {
      cookies: mailCookies,
      fetch: vi.fn(async (input: string) =>
        (() => {
          const url = new URL(input);
          if (url.pathname === "/_agent-native/auth/session") {
            return sessionResponse("owner@example.com");
          }
          if (url.pathname === "/_agent-native/embed/start") {
            void mailCookies.set({
              url: mail.origin,
              name: "an_embed_session",
              value: "workspace-embed-session",
            });
            return new Response("<html></html>", { status: 200 });
          }
          return new Response(null, { status: 404 });
        })(),
      ),
    } as unknown as Electron.Session;
    const reloadApp = vi.fn();
    const broker = new DesktopIdentityBroker({
      identitySession: {
        cookies: identityCookies,
        fetch: identityFetch,
        clearStorageData: vi.fn(async () => {}),
      } as unknown as Electron.Session,
      resolveApp: (id) =>
        id === authority.id ? authority : id === mail.id ? mail : null,
      listApps: () => [authority, mail],
      openExternal: vi.fn(async () => {}),
      reloadApp,
      clearLocalBroker: vi.fn(),
      createWindow: vi.fn() as never,
    });
    broker.setStatusForSetting("signed-in");

    await expect(broker.ensureAppSession(mail.id)).resolves.toBe(true);
    await expect(broker.ensureAppSession(mail.id)).resolves.toBe(true);

    expect(
      identityFetch.mock.calls.filter(
        ([input]) =>
          new URL(String(input)).pathname ===
          "/_agent-native/actions/create-workspace-app-embed-session",
      ),
    ).toHaveLength(1);
    expect(reloadApp).toHaveBeenCalledTimes(1);
  });

  it("reloads a matching child session adopted before its WebView mounts", async () => {
    const authority = authorityFixture();
    const mail = appFixture();
    mail.cookieNames = [...mail.cookieNames, "an_embed_session"];
    mail.cookieNamesToClear = [...mail.cookieNamesToClear, "an_embed_session"];
    const identityCookies = cookieStore([
      sessionCookie("an_session_dispatch", authority.origin, "desktop-session"),
    ]);
    const mailCookies = cookieStore([
      sessionCookie("an_embed_session", mail.origin, "workspace-embed-session"),
    ]);
    const identityFetch = vi.fn(async (input: string) => {
      const url = new URL(input);
      if (url.pathname === "/_agent-native/auth/session") {
        return sessionResponse("owner@example.com");
      }
      return new Response(null, { status: 404 });
    });
    mail.session = {
      cookies: mailCookies,
      fetch: vi.fn(async (input: string) =>
        new URL(input).pathname === "/_agent-native/auth/session"
          ? sessionResponse("owner@example.com")
          : new Response(null, { status: 404 }),
      ),
    } as unknown as Electron.Session;
    const reloadApp = vi.fn();
    const broker = new DesktopIdentityBroker({
      identitySession: {
        cookies: identityCookies,
        fetch: identityFetch,
        clearStorageData: vi.fn(async () => {}),
      } as unknown as Electron.Session,
      resolveApp: (id) =>
        id === authority.id ? authority : id === mail.id ? mail : null,
      listApps: () => [authority, mail],
      openExternal: vi.fn(async () => {}),
      reloadApp,
      clearLocalBroker: vi.fn(),
      createWindow: vi.fn() as never,
    });
    broker.setStatusForSetting("signed-in");

    await expect(broker.ensureAppSession(mail.id)).resolves.toBe(true);
    await expect(broker.ensureAppSession(mail.id)).resolves.toBe(true);

    expect(
      identityFetch.mock.calls.filter(
        ([input]) =>
          new URL(String(input)).pathname ===
          "/_agent-native/actions/create-workspace-app-embed-session",
      ),
    ).toHaveLength(0);
    expect(reloadApp).toHaveBeenCalledTimes(1);
  });

  it("remints a completed modern child if its session cookie disappears", async () => {
    const authority = authorityFixture();
    const mail = appFixture();
    const identityCookies = cookieStore([
      sessionCookie("an_session_dispatch", authority.origin, "desktop-session"),
    ]);
    const mailCookies = cookieStore();
    const identityFetch = vi.fn(async (input: string) => {
      const url = new URL(input);
      if (url.pathname === "/_agent-native/auth/session") {
        return sessionResponse("owner@example.com");
      }
      if (
        url.pathname ===
        "/_agent-native/actions/create-workspace-app-embed-session"
      ) {
        return new Response(
          JSON.stringify({
            startUrl:
              "https://mail.agent-native.com/_agent-native/embed/start?ticket=mail-ticket",
          }),
          { status: 200 },
        );
      }
      return new Response(null, { status: 404 });
    });
    mail.session = {
      cookies: mailCookies,
      fetch: vi.fn(async (input: string) => {
        const url = new URL(input);
        if (url.pathname === "/_agent-native/embed/start") {
          await mailCookies.set({
            url: mail.origin,
            name: "an_session_mail",
            value: "mail-session",
          });
          return new Response("<html></html>", { status: 200 });
        }
        return url.pathname === "/_agent-native/auth/session"
          ? sessionResponse("owner@example.com")
          : new Response(null, { status: 404 });
      }),
    } as unknown as Electron.Session;
    const reloadApp = vi.fn();
    const broker = new DesktopIdentityBroker({
      identitySession: {
        cookies: identityCookies,
        fetch: identityFetch,
        clearStorageData: vi.fn(async () => {}),
      } as unknown as Electron.Session,
      resolveApp: (id) =>
        id === authority.id ? authority : id === mail.id ? mail : null,
      listApps: () => [authority, mail],
      openExternal: vi.fn(async () => {}),
      reloadApp,
      clearLocalBroker: vi.fn(),
      createWindow: vi.fn() as never,
    });
    broker.setStatusForSetting("signed-in");

    await expect(broker.ensureAppSession(mail.id)).resolves.toBe(true);
    await mailCookies.remove(mail.origin, "an_session_mail");
    await expect(broker.ensureAppSession(mail.id)).resolves.toBe(true);

    expect(
      identityFetch.mock.calls.filter(
        ([input]) =>
          new URL(String(input)).pathname ===
          "/_agent-native/actions/create-workspace-app-embed-session",
      ),
    ).toHaveLength(2);
    expect(reloadApp).toHaveBeenCalledTimes(2);
  });

  it("surfaces a stored desktop exchange error before session adoption", async () => {
    const authority = authorityFixture();
    const identityFetch = vi.fn<() => Promise<Response>>().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: "The sign-in link could not be verified.",
          code: "callback_error",
        }),
        { status: 400 },
      ),
    );
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
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const broker = new DesktopIdentityBroker({
      identitySession: {
        cookies: cookieStore(),
        fetch: identityFetch,
        clearStorageData: vi.fn(async () => {}),
      } as unknown as Electron.Session,
      isAvailable: vi.fn(async () => true),
      resolveApp: (id) => (id === authority.id ? authority : null),
      listApps: () => [authority],
      createWindow: () => identityWindow as never,
      handleOAuthNavigation: vi.fn(() => true),
      reloadApp: vi.fn(),
      clearLocalBroker: vi.fn(),
    });

    const signIn = broker.signIn(authority.id);
    await vi.waitFor(() => expect(identityWindow.loadURL).toHaveBeenCalled());
    const navigationHandler = webContents.on.mock.calls.find(
      ([event]) => event === "will-navigate",
    )?.[1] as (event: { preventDefault: () => void }, url: string) => void;
    const state = `${Buffer.from(JSON.stringify({ f: "desktop-flow" })).toString("base64url")}.signature`;
    navigationHandler(
      { preventDefault: vi.fn() },
      `https://dispatch.agent-native.com/_agent-native/auth/magic-link/desktop-callback?flow_id=desktop-flow&verifier=magic-link-verifier&state=${state}`,
    );

    await expect(signIn).resolves.toBe(false);
    expect(warn).toHaveBeenCalledWith(
      "[desktop-identity] desktop OAuth exchange failed",
      expect.objectContaining({
        reason: expect.stringContaining("callback_error"),
      }),
    );
    expect(identityFetch).toHaveBeenCalledWith(
      expect.stringContaining(
        "/_agent-native/auth/desktop-exchange?flow_id=desktop-flow&verifier=magic-link-verifier",
      ),
      expect.objectContaining({ credentials: "include" }),
    );
  });

  it("coalesces duplicate requests and copies only the target cookie", async () => {
    const app = appFixture();
    const identityCookies = cookieStore([
      sessionCookie(
        "an_session",
        "https://calendar.agent-native.com",
        "wrong-generic-session",
      ),
      sessionCookie(
        "an_session_mail",
        "https://calendar.agent-native.com",
        "wrong-mail-session",
      ),
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

  it("fans one explicit sign-in out to eligible apps and syncs a later app lazily", async () => {
    const authority = authorityFixture();
    const mail = appFixture();
    const calendar = {
      ...appFixture(),
      id: "calendar",
      origin: "https://calendar.agent-native.com",
      cookieNames: ["an_session_calendar", "an_session"],
      cookieNamesToClear: [
        "an_session_calendar",
        "an_session",
        "an_calendar.session_token",
        "__Secure-an_calendar.session_token",
      ],
    };
    const custom = {
      ...appFixture(),
      id: "custom-workspace-app",
      origin: "https://custom-workspace.example",
      cookieNames: ["an_session_custom_workspace_app", "an_session"],
      cookieNamesToClear: [
        "an_session_custom_workspace_app",
        "an_session",
        "an_custom_workspace_app.session_token",
        "__Secure-an_custom_workspace_app.session_token",
      ],
    };
    const identityCookies = cookieStore([
      sessionCookie("an_session_dispatch", authority.origin, "dispatch"),
      sessionCookie("an_session_mail", mail.origin, "mail"),
      sessionCookie("an_session_calendar", calendar.origin, "calendar"),
      sessionCookie("an_session_custom_workspace_app", custom.origin, "custom"),
    ]);
    const apps = new Map(
      [authority, mail, calendar].map((app) => [app.id, app]),
    );
    const windows: Array<{
      loadedUrl: string;
      webContents: {
        on: ReturnType<typeof vi.fn>;
        setWindowOpenHandler: ReturnType<typeof vi.fn>;
      };
      options: Electron.BrowserWindowConstructorOptions;
    }> = [];
    const createWindow = vi.fn(
      (options: Electron.BrowserWindowConstructorOptions) => {
        const record = {
          loadedUrl: "",
          webContents: {
            on: vi.fn(),
            setWindowOpenHandler: vi.fn(),
          },
          options,
        };
        const identityWindow = {
          webContents: record.webContents,
          loadURL: vi.fn(async (url: string) => {
            record.loadedUrl = url;
          }),
          isDestroyed: vi.fn(() => false),
          close: vi.fn(),
          on: vi.fn(),
        };
        windows.push(record);
        return identityWindow as never;
      },
    );
    const resolveLoginRedirect = vi.fn(async (loginUrl: string) => {
      const target = new URL(loginUrl);
      const returnPath = target.searchParams.get("return")!;
      return new URL(returnPath, target.origin).toString();
    });
    const isAvailable = vi.fn(async () => true);
    const reloadApp = vi.fn((target: DesktopIdentityApp) => {
      if (target.id === "calendar") throw new Error("webview destroyed");
    });
    const broker = new DesktopIdentityBroker({
      identitySession: {
        cookies: identityCookies,
        clearStorageData: vi.fn(async () => {}),
      } as unknown as Electron.Session,
      isAvailable,
      resolveLoginRedirect,
      resolveApp: (id) => apps.get(id) ?? null,
      listApps: () => [...apps.values()],
      createWindow,
      reloadApp,
      clearLocalBroker: vi.fn(),
    });

    const completeWindow = (index: number) => {
      const record = windows[index]!;
      const loaded = new URL(record.loadedUrl);
      const returnPath = loaded.searchParams.get("return");
      const completion = returnPath
        ? new URL(returnPath, loaded.origin).toString()
        : loaded.toString();
      const navigationHandler = record.webContents.on.mock.calls.find(
        ([event]) => event === "did-navigate",
      )?.[1] as (event: unknown, url: string, statusCode: number) => void;
      navigationHandler({}, completion, 200);
    };

    const signIn = broker.signIn(mail.id);
    await vi.waitFor(() => expect(windows).toHaveLength(1));
    expect(windows[0]!.options.show).toBe(true);
    completeWindow(0);
    await vi.waitFor(() => expect(windows).toHaveLength(2));
    expect(windows[1]!.options.show).toBe(false);
    completeWindow(1);
    await vi.waitFor(() => expect(windows).toHaveLength(3));
    expect(windows[2]!.options.show).toBe(false);
    completeWindow(2);

    await expect(signIn).resolves.toBe(true);
    expect(broker.getStatus()).toBe("signed-in");
    expect(isAvailable).toHaveBeenCalledTimes(2);
    expect(authority.session.cookies.set).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "an_session_dispatch",
        value: "dispatch",
      }),
    );
    expect(mail.session.cookies.set).toHaveBeenCalledWith(
      expect.objectContaining({ name: "an_session_mail", value: "mail" }),
    );
    expect(calendar.session.cookies.set).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "an_session_calendar",
        value: "calendar",
      }),
    );

    apps.set(custom.id, custom);
    const customSync = broker.ensureAppSession(custom.id);
    await vi.waitFor(() => expect(windows).toHaveLength(4));
    expect(windows[3]!.options.show).toBe(false);
    completeWindow(3);
    await expect(customSync).resolves.toBe(true);
    expect(isAvailable).toHaveBeenCalledTimes(3);
    expect(custom.session.cookies.set).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "an_session_custom_workspace_app",
        value: "custom",
      }),
    );
    expect(reloadApp).toHaveBeenCalledTimes(4);
  });

  it("does not report workspace sign-in complete when an eligible app fails", async () => {
    const authority = authorityFixture();
    const mail = appFixture();
    const identityCookies = cookieStore([
      sessionCookie("an_session_dispatch", authority.origin, "dispatch"),
    ]);
    let windowRecord: {
      loadedUrl: string;
      webContents: {
        on: ReturnType<typeof vi.fn>;
        setWindowOpenHandler: ReturnType<typeof vi.fn>;
      };
    } | null = null;
    const createWindow = vi.fn(
      (_options: Electron.BrowserWindowConstructorOptions) => {
        const record = {
          loadedUrl: "",
          webContents: {
            on: vi.fn(),
            setWindowOpenHandler: vi.fn(),
          },
        };
        windowRecord = record;
        return {
          webContents: record.webContents,
          loadURL: vi.fn(async (url: string) => {
            record.loadedUrl = url;
          }),
          isDestroyed: vi.fn(() => false),
          close: vi.fn(),
          on: vi.fn(),
        } as never;
      },
    );
    const resolveLoginRedirect = vi.fn(async (loginUrl: string) => {
      const target = new URL(loginUrl);
      if (target.origin === mail.origin) return null;
      return new URL(
        target.searchParams.get("return")!,
        target.origin,
      ).toString();
    });
    const broker = new DesktopIdentityBroker({
      identitySession: {
        cookies: identityCookies,
        clearStorageData: vi.fn(async () => {}),
      } as unknown as Electron.Session,
      resolveLoginRedirect,
      resolveApp: (id) =>
        id === authority.id ? authority : id === mail.id ? mail : null,
      listApps: () => [authority, mail],
      createWindow,
      reloadApp: vi.fn(),
      clearLocalBroker: vi.fn(),
    });

    const signIn = broker.signIn(mail.id);
    await vi.waitFor(() => expect(windowRecord).not.toBeNull());
    const loaded = new URL(windowRecord!.loadedUrl);
    const returnPath = loaded.searchParams.get("return");
    const completion = returnPath ? new URL(returnPath, loaded.origin) : loaded;
    const navigationHandler = windowRecord!.webContents.on.mock.calls.find(
      ([event]) => event === "did-navigate",
    )?.[1] as (event: unknown, url: string, statusCode: number) => void;
    navigationHandler({}, completion.toString(), 200);

    await expect(signIn).resolves.toBe(false);
    expect(broker.getStatus()).toBe("failed");
  });

  it("does not fan out when the authenticated parent is outside the rollout", async () => {
    const authority = authorityFixture();
    const mail = appFixture();
    const identityCookies = cookieStore([
      sessionCookie("an_session_dispatch", authority.origin, "dispatch"),
    ]);
    let windowRecord: {
      loadedUrl: string;
      webContents: {
        on: ReturnType<typeof vi.fn>;
        setWindowOpenHandler: ReturnType<typeof vi.fn>;
      };
    } | null = null;
    const createWindow = vi.fn(
      (_options: Electron.BrowserWindowConstructorOptions) => {
        const record = {
          loadedUrl: "",
          webContents: {
            on: vi.fn(),
            setWindowOpenHandler: vi.fn(),
          },
        };
        windowRecord = record;
        return {
          webContents: record.webContents,
          loadURL: vi.fn(async (url: string) => {
            record.loadedUrl = url;
          }),
          isDestroyed: vi.fn(() => false),
          close: vi.fn(),
          on: vi.fn(),
        } as never;
      },
    );
    const resolveLoginRedirect = vi.fn(async (loginUrl: string) => {
      const target = new URL(loginUrl);
      return new URL(
        target.searchParams.get("return")!,
        target.origin,
      ).toString();
    });
    const isAvailable = vi
      .fn<() => Promise<boolean>>()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false);
    const broker = new DesktopIdentityBroker({
      identitySession: {
        cookies: identityCookies,
        clearStorageData: vi.fn(async () => {}),
      } as unknown as Electron.Session,
      isAvailable,
      resolveLoginRedirect,
      resolveApp: (id) =>
        id === authority.id ? authority : id === mail.id ? mail : null,
      listApps: () => [authority, mail],
      createWindow,
      reloadApp: vi.fn(),
      clearLocalBroker: vi.fn(),
    });

    const signIn = broker.signIn(mail.id);
    await vi.waitFor(() => expect(windowRecord).not.toBeNull());
    const loaded = new URL(windowRecord!.loadedUrl);
    const returnPath = loaded.searchParams.get("return");
    const completion = returnPath
      ? new URL(returnPath, loaded.origin).toString()
      : loaded.toString();
    const navigationHandler = windowRecord!.webContents.on.mock.calls.find(
      ([event]) => event === "did-navigate",
    )?.[1] as (event: unknown, url: string, statusCode: number) => void;
    navigationHandler({}, completion, 200);

    await expect(signIn).resolves.toBe(false);
    expect(isAvailable).toHaveBeenCalledTimes(2);
    expect(mail.session.cookies.set).not.toHaveBeenCalled();
    expect(broker.getStatus()).toBe("failed");
  });

  it("keeps the requested app signed in when another app is unavailable", async () => {
    const authority = authorityFixture();
    const mail = appFixture();
    const calendar = {
      ...appFixture(),
      id: "calendar",
      origin: "https://calendar.agent-native.com",
      cookieNames: ["an_session_calendar", "an_session"],
    };
    const apps = new Map(
      [authority, mail, calendar].map((app) => [app.id, app]),
    );
    const identityCookies = cookieStore([
      sessionCookie("an_session_dispatch", authority.origin, "dispatch"),
      sessionCookie("an_session_mail", mail.origin, "mail"),
    ]);
    const windows: Array<{
      loadedUrl: string;
      webContents: {
        on: ReturnType<typeof vi.fn>;
        setWindowOpenHandler: ReturnType<typeof vi.fn>;
      };
    }> = [];
    const createWindow = vi.fn(
      (_options: Electron.BrowserWindowConstructorOptions) => {
        const record = {
          loadedUrl: "",
          webContents: {
            on: vi.fn(),
            setWindowOpenHandler: vi.fn(),
          },
        };
        windows.push(record);
        return {
          webContents: record.webContents,
          loadURL: vi.fn(async (url: string) => {
            record.loadedUrl = url;
          }),
          isDestroyed: vi.fn(() => false),
          close: vi.fn(),
          on: vi.fn(),
        } as never;
      },
    );
    const resolveLoginRedirect = vi.fn(async (loginUrl: string) => {
      const target = new URL(loginUrl);
      if (target.origin === calendar.origin) return null;
      return new URL(
        target.searchParams.get("return")!,
        target.origin,
      ).toString();
    });
    const broker = new DesktopIdentityBroker({
      identitySession: {
        cookies: identityCookies,
        clearStorageData: vi.fn(async () => {}),
      } as unknown as Electron.Session,
      resolveLoginRedirect,
      resolveApp: (id) => apps.get(id) ?? null,
      listApps: () => [...apps.values()],
      createWindow,
      reloadApp: vi.fn(),
      clearLocalBroker: vi.fn(),
    });

    const completeWindow = async (index: number) => {
      const record = windows[index]!;
      const loaded = new URL(record.loadedUrl);
      const returnPath = loaded.searchParams.get("return");
      const completion = returnPath
        ? new URL(returnPath, loaded.origin).toString()
        : loaded.toString();
      const navigationHandler = record.webContents.on.mock.calls.find(
        ([event]) => event === "did-navigate",
      )?.[1] as (event: unknown, url: string, statusCode: number) => void;
      navigationHandler({}, completion, 200);
      await Promise.resolve();
    };

    const signIn = broker.signIn(mail.id);
    await vi.waitFor(() => expect(windows).toHaveLength(1));
    await completeWindow(0);
    await vi.waitFor(() => expect(windows).toHaveLength(2));
    await completeWindow(1);

    await expect(signIn).resolves.toBe(true);
    expect(broker.getStatus()).toBe("signed-in");
    expect(mail.session.cookies.set).toHaveBeenCalledWith(
      expect.objectContaining({ name: "an_session_mail", value: "mail" }),
    );
    expect(resolveLoginRedirect).toHaveBeenCalledWith(
      expect.stringContaining("calendar.agent-native.com"),
      expect.anything(),
    );
  });

  it("reuses a lazy app session only when its account matches the authority", async () => {
    const authority = authorityFixture();
    const mail = appFixture();
    mail.session = {
      cookies: cookieStore([
        sessionCookie("an_session_mail", mail.origin, "mail-session"),
      ]),
      fetch: vi.fn(async () => sessionResponse("steve@example.com")),
    } as unknown as Electron.Session;
    const identityCookies = cookieStore([
      sessionCookie(
        "an_session_dispatch",
        authority.origin,
        "dispatch-session",
      ),
    ]);
    const createWindow = vi.fn();
    const broker = new DesktopIdentityBroker({
      identitySession: {
        cookies: identityCookies,
        fetch: vi.fn(async () => sessionResponse("steve@example.com")),
        clearStorageData: vi.fn(async () => {}),
      } as unknown as Electron.Session,
      resolveApp: (id) =>
        id === authority.id ? authority : id === mail.id ? mail : null,
      listApps: () => [authority, mail],
      createWindow: createWindow as never,
      reloadApp: vi.fn(),
      clearLocalBroker: vi.fn(),
    });
    broker.setStatusForSetting("signed-in");

    await expect(broker.ensureAppSession(mail.id)).resolves.toBe(true);
    expect(createWindow).not.toHaveBeenCalled();
    expect(mail.session.fetch).toHaveBeenCalledWith(
      `${mail.origin}/_agent-native/auth/session`,
      expect.objectContaining({ credentials: "include" }),
    );
  });

  it("keeps a failed lazy app synchronization scoped to the child", async () => {
    const authority = authorityFixture();
    const custom = {
      ...appFixture(),
      id: "custom-workspace-app",
      origin: "https://custom-workspace.example.com",
    };
    const apps = new Map<string, DesktopIdentityApp>([
      [authority.id, authority],
      [custom.id, custom],
    ]);
    let includeCustom = false;
    const identityCookies = cookieStore([
      sessionCookie("an_session_dispatch", authority.origin, "dispatch"),
    ]);
    let windowRecord: {
      loadedUrl: string;
      webContents: {
        on: ReturnType<typeof vi.fn>;
        setWindowOpenHandler: ReturnType<typeof vi.fn>;
      };
    } | null = null;
    const createWindow = vi.fn(
      (_options: Electron.BrowserWindowConstructorOptions) => {
        const record = {
          loadedUrl: "",
          webContents: {
            on: vi.fn(),
            setWindowOpenHandler: vi.fn(),
          },
        };
        windowRecord = record;
        return {
          webContents: record.webContents,
          loadURL: vi.fn(async (url: string) => {
            record.loadedUrl = url;
          }),
          isDestroyed: vi.fn(() => false),
          close: vi.fn(),
          on: vi.fn(),
        } as never;
      },
    );
    const resolveLoginRedirect = vi.fn(async (loginUrl: string) => {
      const target = new URL(loginUrl);
      if (target.origin !== custom.origin) {
        const returnPath = target.searchParams.get("return")!;
        return new URL(returnPath, target.origin).toString();
      }
      return "https://evil.example/identity/callback";
    });
    const broker = new DesktopIdentityBroker({
      identitySession: {
        cookies: identityCookies,
        clearStorageData: vi.fn(async () => {}),
      } as unknown as Electron.Session,
      resolveLoginRedirect,
      resolveApp: (id) => apps.get(id) ?? null,
      listApps: () => (includeCustom ? [authority, custom] : [authority]),
      createWindow,
      reloadApp: vi.fn(),
      clearLocalBroker: vi.fn(),
    });

    const signIn = broker.signIn(authority.id);
    await vi.waitFor(() => expect(windowRecord).not.toBeNull());
    const loaded = new URL(windowRecord!.loadedUrl);
    const returnPath = loaded.searchParams.get("return");
    const completion = returnPath
      ? new URL(returnPath, loaded.origin).toString()
      : loaded.toString();
    const navigationHandler = windowRecord!.webContents.on.mock.calls.find(
      ([event]) => event === "did-navigate",
    )?.[1] as (event: unknown, url: string, statusCode: number) => void;
    navigationHandler({}, completion, 200);
    await expect(signIn).resolves.toBe(true);

    includeCustom = true;
    await expect(broker.ensureAppSession(custom.id)).resolves.toBe(false);
    expect(broker.getStatus()).toBe("signed-in");
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
      { appId: "mail", reason: "Missing app session cookie" },
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

  it("opens Dispatch's ordinary sign-in entry without consuming its authority session", async () => {
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

    expect(new URL(loginUrl).pathname).toBe("/login");
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
