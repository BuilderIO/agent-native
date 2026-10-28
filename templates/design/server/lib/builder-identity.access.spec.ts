import { afterEach, describe, expect, it, vi } from "vitest";

process.env.BUILDER_IDENTITY = "1";

const {
  BuilderSignInRequiredError,
  builderOwnerEmail,
  canAccessBuilderProject,
  rememberDelegatedCredential,
} = await import("./builder-identity.js");

/** An unsigned token: only its `exp` is read when remembering it. */
function tokenFor(email: string): string {
  const part = (value: object) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  const exp = Math.floor(Date.now() / 1000) + 3600;
  return `${part({ alg: "none" })}.${part({ sub: email, exp })}.`;
}

/** Signs a Builder user in and returns the owner key Design sees for them. */
function signIn(email: string): string {
  const uid = `uid-${email}`;
  rememberDelegatedCredential(
    { uid, email, spaceId: "space-1" },
    tokenFor(email),
  );
  return builderOwnerEmail(uid);
}

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

afterEach(() => {
  fetchMock.mockReset();
});

describe("Builder project access", () => {
  it("treats a Builder outage as unavailable (503), never as a cached denial", async () => {
    const owner = signIn("outage@example.com");
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
    const owner = signIn("denied@example.com");
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
    const owner = signIn("visitor@example.com");
    fetchMock.mockResolvedValueOnce(
      Response.json({ id: "proj-public", ownerId: "space-other" }),
    );
    await expect(canAccessBuilderProject(owner, "proj-public")).resolves.toBe(
      true,
    );
  });

  it("asks for a fresh sign-in when this server holds no credential", async () => {
    await expect(
      canAccessBuilderProject(builderOwnerEmail("never-exchanged"), "proj-any"),
    ).rejects.toBeInstanceOf(BuilderSignInRequiredError);
    // Typed, so every Design action that reaches the access check answers
    // 401 with the sign-in hint instead of a generic 500.
    await expect(
      canAccessBuilderProject(builderOwnerEmail("never-exchanged"), "proj-any"),
    ).rejects.toMatchObject({
      statusCode: 401,
      errorCode: "builder_sign_in_required",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("Builder owner key", () => {
  it("is derived from the uid, so a shared email never shares an account", () => {
    expect(builderOwnerEmail("uid-a")).not.toBe(builderOwnerEmail("uid-b"));
    expect(builderOwnerEmail("uid-a")).toBe(builderOwnerEmail("uid-a"));
  });

  it("is lowercase and undeliverable, whatever the uid looks like", () => {
    const key = builderOwnerEmail("AbC123xYz-Mixed_Case");
    expect(key).toBe(key.toLowerCase());
    expect(key).toMatch(/^b-[0-9a-f]{32}@builder-identity\.invalid$/);
  });

  it("does not depend on the Builder email, which can change", () => {
    const before = signIn("old-address@example.com");
    rememberDelegatedCredential(
      {
        uid: "uid-old-address@example.com",
        email: "new-address@example.com",
        spaceId: "space-1",
      },
      tokenFor("new-address@example.com"),
    );
    expect(builderOwnerEmail("uid-old-address@example.com")).toBe(before);
  });
});
