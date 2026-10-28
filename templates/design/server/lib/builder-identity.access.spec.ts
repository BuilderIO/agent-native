import { afterEach, describe, expect, it, vi } from "vitest";

process.env.BUILDER_IDENTITY = "1";

// The app secrets store, shared by every "instance" in these tests.
const store = vi.hoisted(() => ({
  rows: new Map<string, string>(),
  failReads: false,
  failDeletes: false,
}));
const registered = vi.hoisted(() => ({
  provider: null as null | ((email: string) => unknown),
}));
vi.mock("@agent-native/core/server", () => ({
  registerDelegatedBuilderCredentials: vi.fn(
    (provider: (email: string) => unknown) => {
      registered.provider = provider;
    },
  ),
}));
vi.mock("@agent-native/core/secrets", () => ({
  writeAppSecret: vi.fn(
    async (ref: {
      scope: string;
      scopeId: string;
      key: string;
      value: string;
    }) => {
      store.rows.set(`${ref.scope}:${ref.scopeId}:${ref.key}`, ref.value);
      return "id";
    },
  ),
  deleteAppSecret: vi.fn(
    async (ref: { scope: string; scopeId: string; key: string }) => {
      if (store.failDeletes) throw new Error("secrets store down");
      return store.rows.delete(`${ref.scope}:${ref.scopeId}:${ref.key}`);
    },
  ),
  readAppSecret: vi.fn(
    async (ref: { scope: string; scopeId: string; key: string }) => {
      if (store.failReads) throw new Error("secrets store down");
      const value = store.rows.get(`${ref.scope}:${ref.scopeId}:${ref.key}`);
      return value === undefined ? null : { value };
    },
  ),
}));

const {
  BuilderSignInRequiredError,
  builderOwnerEmail,
  canAccessBuilderProject,
  clearBuilderIdentitySession,
  encodeIdentityCookie,
  getBuilderIdentitySession,
  isBuilderOwnerEmail,
  rememberDelegatedCredential,
  BUILDER_IDENTITY_COOKIE,
} = await import("./builder-identity.js");

const PROJECT = "builder-3b0a2";

/** An unsigned token: only its `exp` is read when remembering it. */
function tokenFor(email: string, ttlSeconds = 3600): string {
  const part = (value: object) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  return `${part({ alg: "none" })}.${part({ sub: email, exp })}.`;
}

/** Signs a Builder user in and returns the owner key Design sees for them. */
async function signIn(email: string, ttlSeconds = 3600): Promise<string> {
  const uid = `uid-${email}`;
  await rememberDelegatedCredential(
    { uid, projectId: PROJECT, email, spaceId: "space-1" },
    tokenFor(email, ttlSeconds),
  );
  return builderOwnerEmail(PROJECT, uid);
}

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

afterEach(() => {
  fetchMock.mockReset();
});

describe("Builder project access", () => {
  it("treats a Builder outage as unavailable (503), never as a cached denial", async () => {
    const owner = await signIn("outage@example.com");
    fetchMock.mockResolvedValueOnce(new Response("down", { status: 503 }));
    await expect(
      canAccessBuilderProject(owner, "proj-outage"),
    ).rejects.toMatchObject({
      statusCode: 503,
      errorCode: "builder_unavailable",
    });

    fetchMock.mockResolvedValueOnce(
      Response.json({ id: "proj-outage", ownerId: "space-1" }),
    );
    await expect(canAccessBuilderProject(owner, "proj-outage")).resolves.toBe(
      true,
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("caches Builder's own refusal as a denial", async () => {
    const owner = await signIn("denied@example.com");
    fetchMock.mockResolvedValue(new Response("no", { status: 403 }));
    await expect(canAccessBuilderProject(owner, "proj-denied")).resolves.toBe(
      false,
    );
    await expect(canAccessBuilderProject(owner, "proj-denied")).resolves.toBe(
      false,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("lets a user open a project from another space, read-only", async () => {
    const owner = await signIn("visitor@example.com");
    fetchMock.mockResolvedValueOnce(
      Response.json({ id: "proj-public", ownerId: "space-other" }),
    );
    await expect(canAccessBuilderProject(owner, "proj-public")).resolves.toBe(
      true,
    );
  });

  it("asks for a fresh sign-in when this server holds no credential", async () => {
    await expect(
      canAccessBuilderProject(
        builderOwnerEmail(PROJECT, "never-exchanged"),
        "proj-any",
      ),
    ).rejects.toBeInstanceOf(BuilderSignInRequiredError);
    // Typed, so every Design action that reaches the access check answers
    // 401 with the sign-in hint instead of a generic 500.
    await expect(
      canAccessBuilderProject(
        builderOwnerEmail(PROJECT, "never-exchanged"),
        "proj-any",
      ),
    ).rejects.toMatchObject({
      statusCode: 401,
      errorCode: "builder_sign_in_required",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("Builder owner key", () => {
  it("is derived from the uid, so a shared email never shares an account", () => {
    expect(builderOwnerEmail(PROJECT, "uid-a")).not.toBe(
      builderOwnerEmail(PROJECT, "uid-b"),
    );
    expect(builderOwnerEmail(PROJECT, "uid-a")).toBe(
      builderOwnerEmail(PROJECT, "uid-a"),
    );
  });

  it("is lowercase and undeliverable, whatever the uid looks like", () => {
    const key = builderOwnerEmail(PROJECT, "AbC123xYz-Mixed_Case");
    expect(isBuilderOwnerEmail(key)).toBe(true);
    expect(key).toBe(key.toLowerCase());
    expect(key).toMatch(/^b-[0-9a-f]{32}@builder-identity\.invalid$/);
  });

  it("does not depend on the Builder email, which can change", async () => {
    const before = await signIn("old-address@example.com");
    await rememberDelegatedCredential(
      {
        uid: "uid-old-address@example.com",
        projectId: PROJECT,
        email: "new-address@example.com",
        spaceId: "space-1",
      },
      tokenFor("new-address@example.com"),
    );
    expect(builderOwnerEmail(PROJECT, "uid-old-address@example.com")).toBe(
      before,
    );
  });

  it("separates users who share a uid in different projects", () => {
    expect(builderOwnerEmail("builder-3b0a2", "same-uid")).not.toBe(
      builderOwnerEmail("builder-io-qa", "same-uid"),
    );
  });

  it("cannot be computed without the server secret, so no account can claim it", async () => {
    const known = builderOwnerEmail(PROJECT, "victim-uid");
    process.env.BUILDER_IDENTITY_COOKIE_SECRET = "a-different-secret";
    try {
      vi.resetModules();
      const other = await import("./builder-identity.js");
      expect(other.builderOwnerEmail(PROJECT, "victim-uid")).not.toBe(known);
    } finally {
      delete process.env.BUILDER_IDENTITY_COOKIE_SECRET;
      vi.resetModules();
    }
  });
});

describe("Builder credential store", () => {
  it("is shared across instances, so an exchange on one serves a request on another", async () => {
    const owner = await signIn("shared@example.com");
    vi.resetModules();
    // A different instance: same store, no in-memory state.
    const other = await import("./builder-identity.js");
    fetchMock.mockResolvedValueOnce(
      Response.json({ id: "proj-shared", ownerId: "space-1" }),
    );
    await expect(
      other.canAccessBuilderProject(owner, "proj-shared"),
    ).resolves.toBe(true);
  });

  it("asks for a new sign-in once the stored credential has expired", async () => {
    const owner = await signIn("expired@example.com", -60);
    vi.resetModules();
    const other = await import("./builder-identity.js");
    await expect(
      other.canAccessBuilderProject(owner, "proj-expired"),
    ).rejects.toMatchObject({ errorCode: "builder_sign_in_required" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("treats a store outage as Builder being unavailable, not as a sign-out", async () => {
    const owner = await signIn("store-down@example.com");
    vi.resetModules();
    const other = await import("./builder-identity.js");
    store.failReads = true;
    try {
      await expect(
        other.canAccessBuilderProject(owner, "proj-store-down"),
      ).rejects.toMatchObject({ errorCode: "builder_unavailable" });
    } finally {
      store.failReads = false;
    }
  });

  it("keeps each project's credential for the same uid apart", async () => {
    const credential = (project: string) =>
      rememberDelegatedCredential(
        {
          uid: "same-uid",
          projectId: project,
          email: "a@example.com",
          spaceId: project,
        },
        tokenFor(project),
      );
    await credential("builder-3b0a2");
    await credential("builder-io-qa");
    const provider = registered.provider!;
    await expect(
      provider(builderOwnerEmail("builder-3b0a2", "same-uid")),
    ).resolves.toMatchObject({ spaceId: "builder-3b0a2" });
    await expect(
      provider(builderOwnerEmail("builder-io-qa", "same-uid")),
    ).resolves.toMatchObject({ spaceId: "builder-io-qa" });
  });

  it("reports an unreadable stored credential instead of treating it as absent", async () => {
    const owner = builderOwnerEmail(PROJECT, "corrupt");
    store.rows.set(`user:${owner}:BUILDER_DELEGATED_CREDENTIAL`, "{not json");
    await expect(registered.provider!(owner)).rejects.toThrow(
      "could not be read",
    );
    await expect(
      canAccessBuilderProject(owner, "proj-corrupt"),
    ).rejects.toMatchObject({ errorCode: "builder_unavailable" });
  });

  it("replaces an unreadable credential when the user signs in again", async () => {
    const owner = builderOwnerEmail(PROJECT, "corrupt-again");
    store.rows.set(`user:${owner}:BUILDER_DELEGATED_CREDENTIAL`, "{not json");
    await rememberDelegatedCredential(
      {
        uid: "corrupt-again",
        projectId: PROJECT,
        email: "c@example.com",
        spaceId: "space-1",
      },
      tokenFor("corrupt-again"),
    );
    await expect(registered.provider!(owner)).resolves.toMatchObject({
      spaceId: "space-1",
    });
  });
});

describe("Builder credential hook", () => {
  it("leaves ordinary users to the normal credential lookup", async () => {
    await expect(
      registered.provider!("someone@example.com"),
    ).resolves.toBeNull();
  });

  it("tells core a Builder user without a credential has none, so nothing else stands in", async () => {
    await expect(
      registered.provider!(builderOwnerEmail(PROJECT, "never-signed-in")),
    ).resolves.toBe("none");
  });

  it("hands over the stored credential", async () => {
    const owner = await signIn("hooked@example.com");
    await expect(registered.provider!(owner)).resolves.toMatchObject({
      spaceId: "space-1",
    });
  });

  it("lets a store outage surface to core instead of reading as no credential", async () => {
    const owner = await signIn("hook-outage@example.com");
    store.failReads = true;
    try {
      await expect(registered.provider!(owner)).rejects.toThrow(
        "secrets store down",
      );
    } finally {
      store.failReads = false;
    }
  });
});

describe("Builder session", () => {
  const eventWith = (cookie: string) =>
    ({
      req: { headers: new Headers({ cookie }) },
      res: { headers: new Headers() },
      context: {},
    }) as never;
  const cookieFor = (uid: string, projectId = PROJECT) =>
    `${BUILDER_IDENTITY_COOKIE}=${encodeIdentityCookie({
      uid,
      projectId,
      email: `${uid}@example.com`,
    })}`;

  it("is the owner key, a project-qualified user id and the Builder email as the display name", async () => {
    await expect(
      getBuilderIdentitySession(eventWith(cookieFor("who"))),
    ).resolves.toEqual({
      email: builderOwnerEmail(PROJECT, "who"),
      userId: `builder:${PROJECT}:who`,
      name: "who@example.com",
      emailVerified: true,
    });
  });

  it("does not depend on the credential store, so an outage signs no one out", async () => {
    store.failReads = true;
    try {
      await expect(
        getBuilderIdentitySession(eventWith(cookieFor("steady"))),
      ).resolves.not.toBeNull();
    } finally {
      store.failReads = false;
    }
  });

  it("gives a cookie without a project, or with a bad signature, no session", async () => {
    const part = (value: object) =>
      Buffer.from(JSON.stringify(value)).toString("base64url");
    const unsigned = `${BUILDER_IDENTITY_COOKIE}=${part({ uid: "u", email: "e@x.test" })}.sig`;
    await expect(
      getBuilderIdentitySession(eventWith(unsigned)),
    ).resolves.toBeNull();
    const tampered = cookieFor("tampered").replace(/.$/, "x");
    await expect(
      getBuilderIdentitySession(eventWith(tampered)),
    ).resolves.toBeNull();
  });

  it("gives a request with no cookie no session", async () => {
    await expect(
      getBuilderIdentitySession(eventWith("other=1")),
    ).resolves.toBeNull();
  });
});

describe("Builder sign-out", () => {
  const eventWith = (cookie: string) => {
    const headers = new Headers();
    return {
      req: { headers: new Headers({ cookie }) },
      res: { headers },
      context: {},
    } as never;
  };
  const cookieFor = (uid: string) =>
    `${BUILDER_IDENTITY_COOKIE}=${encodeIdentityCookie({
      uid,
      projectId: PROJECT,
      email: `${uid}@example.com`,
    })}`;

  it("forgets the stored credential and expires the cookie", async () => {
    const owner = await signIn("signing-out@example.com");
    const event = eventWith(cookieFor("uid-signing-out@example.com")) as {
      res: { headers: Headers };
    };
    await clearBuilderIdentitySession(event as never);

    expect(event.res.headers.get("set-cookie")).toContain(
      `${BUILDER_IDENTITY_COOKIE}=;`,
    );
    vi.resetModules();
    const other = await import("./builder-identity.js");
    await expect(
      other.canAccessBuilderProject(owner, "proj-after-logout"),
    ).rejects.toMatchObject({ errorCode: "builder_sign_in_required" });
  });

  it("forgets the credential before it expires the cookie, so a failed sign-out can be retried", async () => {
    const owner = await signIn("retry@example.com");
    const event = eventWith(cookieFor("uid-retry@example.com")) as {
      res: { headers: Headers };
    };
    store.failDeletes = true;
    try {
      await expect(clearBuilderIdentitySession(event as never)).rejects.toThrow(
        "secrets store down",
      );
    } finally {
      store.failDeletes = false;
    }
    // Nothing was half done: still signed in, cookie intact.
    expect(event.res.headers.get("set-cookie")).toBeNull();
    await expect(registered.provider!(owner)).resolves.toMatchObject({
      spaceId: "space-1",
    });

    await clearBuilderIdentitySession(event as never);
    await expect(registered.provider!(owner)).resolves.toBe("none");
  });

  it("is harmless without an identity cookie", async () => {
    const event = eventWith("other=1") as { res: { headers: Headers } };
    await expect(
      clearBuilderIdentitySession(event as never),
    ).resolves.toBeUndefined();
  });
});
