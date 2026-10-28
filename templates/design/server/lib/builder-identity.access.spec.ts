import { afterEach, describe, expect, it, vi } from "vitest";

process.env.BUILDER_IDENTITY = "1";

// The app secrets store, shared by every "instance" in these tests.
const store = vi.hoisted(() => ({
  rows: new Map<string, string>(),
  failReads: false,
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
    `sid-${uid}`,
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
      "sid-new-address",
    );
    expect(builderOwnerEmail(PROJECT, "uid-old-address@example.com")).toBe(
      before,
    );
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
});

describe("Builder owner key across Firebase projects", () => {
  it("separates users who share a uid in different projects", () => {
    expect(builderOwnerEmail("builder-3b0a2", "same-uid")).not.toBe(
      builderOwnerEmail("builder-io-qa", "same-uid"),
    );
  });

  it("keeps their stored credentials apart", async () => {
    const credential = (project: string) =>
      rememberDelegatedCredential(
        {
          uid: "same-uid",
          projectId: project,
          email: "a@example.com",
          spaceId: project,
        },
        tokenFor(project),
        `sid-${project}`,
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

  it("gives a cookie without a project no session", async () => {
    const part = (value: object) =>
      Buffer.from(JSON.stringify(value)).toString("base64url");
    const event = {
      req: {
        headers: new Headers({
          cookie: `${BUILDER_IDENTITY_COOKIE}=${part({ uid: "u", email: "e@x.test" })}.sig`,
        }),
      },
    } as never;
    await expect(getBuilderIdentitySession(event)).resolves.toBeNull();
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
    vi.resetModules();
    const other = await import("./builder-identity.js");
    expect(other.isBuilderOwnerEmail(owner)).toBe(true);
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

describe("Builder sign-out", () => {
  const eventWith = (cookie: string) => {
    const headers = new Headers();
    return {
      req: { headers: new Headers({ cookie }) },
      res: { headers },
      node: undefined,
      context: {},
    } as never;
  };

  it("forgets the stored credential and expires the identity cookie", async () => {
    const uid = "signing-out";
    await rememberDelegatedCredential(
      { uid, projectId: PROJECT, email: "out@example.com", spaceId: "space-1" },
      tokenFor("out@example.com"),
      "sid-out",
    );
    const owner = builderOwnerEmail(PROJECT, uid);
    const cookie = encodeIdentityCookie({
      uid,
      projectId: PROJECT,
      sid: "sid-out",
      email: "out@example.com",
    });
    await clearBuilderIdentitySession(
      eventWith(`${BUILDER_IDENTITY_COOKIE}=${cookie}`),
    );
    vi.resetModules();
    const other = await import("./builder-identity.js");
    await expect(
      other.canAccessBuilderProject(owner, "proj-after-logout"),
    ).rejects.toMatchObject({ errorCode: "builder_sign_in_required" });
  });

  it("is harmless without an identity cookie", async () => {
    await expect(
      clearBuilderIdentitySession(eventWith("other=1")),
    ).resolves.toBeUndefined();
  });
});

describe("Builder sessions are revocable", () => {
  const eventWith = (cookie: string) =>
    ({
      req: { headers: new Headers({ cookie }) },
      res: { headers: new Headers() },
      context: {},
    }) as never;
  const cookieFor = (uid: string, sid: string) =>
    `${BUILDER_IDENTITY_COOKIE}=${encodeIdentityCookie({
      uid,
      projectId: PROJECT,
      email: `${uid}@example.com`,
      sid,
    })}`;
  const remember = (uid: string, sid: string) =>
    rememberDelegatedCredential(
      {
        uid,
        projectId: PROJECT,
        email: `${uid}@example.com`,
        spaceId: "space-1",
      },
      tokenFor(uid),
      sid,
    );

  it("keys the session's user id by project as well as uid", async () => {
    await remember("who", "sid-who");
    await expect(
      getBuilderIdentitySession(eventWith(cookieFor("who", "sid-who"))),
    ).resolves.toMatchObject({ userId: `builder:${PROJECT}:who` });
  });

  it("accepts a cookie only while its sign-in is on the live list", async () => {
    await remember("known", "sid-known");
    await expect(
      getBuilderIdentitySession(eventWith(cookieFor("known", "sid-known"))),
    ).resolves.not.toBeNull();
    // Validly signed, but a sign-in the server never recorded.
    await expect(
      getBuilderIdentitySession(eventWith(cookieFor("known", "sid-other"))),
    ).resolves.toBeNull();
    // Nothing stored for this user at all.
    await expect(
      getBuilderIdentitySession(eventWith(cookieFor("nobody", "sid-nobody"))),
    ).resolves.toBeNull();
  });

  it("revokes every copy of the cookie everywhere when the user signs out", async () => {
    await remember("leaving", "sid-leaving");
    const copy = cookieFor("leaving", "sid-leaving");
    await clearBuilderIdentitySession(eventWith(copy));

    // Another instance, with no memory of this one.
    vi.resetModules();
    const other = await import("./builder-identity.js");
    await expect(
      other.getBuilderIdentitySession(eventWith(copy)),
    ).resolves.toBeNull();
  });

  it("keeps a user's other devices signed in when one more signs in", async () => {
    await remember("two-devices", "sid-laptop");
    await remember("two-devices", "sid-phone");
    for (const sid of ["sid-laptop", "sid-phone"]) {
      await expect(
        getBuilderIdentitySession(eventWith(cookieFor("two-devices", sid))),
      ).resolves.not.toBeNull();
    }
  });

  it("keeps only the newest ten sign-ins", async () => {
    for (let i = 0; i < 11; i++) await remember("many", `sid-${i}`);
    await expect(
      getBuilderIdentitySession(eventWith(cookieFor("many", "sid-0"))),
    ).resolves.toBeNull();
    await expect(
      getBuilderIdentitySession(eventWith(cookieFor("many", "sid-10"))),
    ).resolves.not.toBeNull();
  });

  it("does not hold a credential in process memory past sign-out", async () => {
    const owner = await signIn("nocache@example.com");
    await expect(registered.provider!(owner)).resolves.toMatchObject({
      spaceId: "space-1",
    });
    await clearBuilderIdentitySession(
      eventWith(
        cookieFor("uid-nocache@example.com", "sid-uid-nocache@example.com"),
      ),
    );
    // Same instance, immediately: no stale copy of the token.
    await expect(registered.provider!(owner)).resolves.toBe("none");
  });

  it("reports an unreadable stored credential instead of treating it as absent", async () => {
    const owner = builderOwnerEmail(PROJECT, "corrupt");
    store.rows.set(`user:${owner}:BUILDER_DELEGATED_CREDENTIAL`, "{not json");
    await expect(registered.provider!(owner)).rejects.toThrow(
      "could not be read",
    );
    await expect(
      getBuilderIdentitySession(eventWith(cookieFor("corrupt", "sid-corrupt"))),
    ).rejects.toThrow("could not be read");
    await expect(
      canAccessBuilderProject(owner, "proj-corrupt"),
    ).rejects.toMatchObject({ errorCode: "builder_unavailable" });
  });

  it("replaces an unreadable row when the user signs in again", async () => {
    const owner = builderOwnerEmail(PROJECT, "corrupt-again");
    store.rows.set(`user:${owner}:BUILDER_DELEGATED_CREDENTIAL`, "{not json");
    await remember("corrupt-again", "sid-fresh");
    await expect(
      getBuilderIdentitySession(
        eventWith(cookieFor("corrupt-again", "sid-fresh")),
      ),
    ).resolves.not.toBeNull();
  });
});
