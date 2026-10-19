import { afterEach, describe, expect, it, vi } from "vitest";

process.env.BUILDER_IDENTITY = "1";

const {
  BuilderSignInRequiredError,
  BuilderUnavailableError,
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

function signIn(email: string): void {
  rememberDelegatedCredential(
    { uid: `uid-${email}`, email, spaceId: "space-1" },
    tokenFor(email),
  );
}

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

afterEach(() => {
  fetchMock.mockReset();
});

describe("Builder project access", () => {
  it("treats a Builder outage as unavailable, never as a cached denial", async () => {
    signIn("outage@example.com");
    fetchMock.mockResolvedValueOnce(new Response("down", { status: 503 }));
    await expect(
      canAccessBuilderProject("outage@example.com", "proj-outage"),
    ).rejects.toBeInstanceOf(BuilderUnavailableError);

    fetchMock.mockResolvedValueOnce(
      Response.json({ id: "proj-outage", ownerId: "space-1" }),
    );
    await expect(
      canAccessBuilderProject("outage@example.com", "proj-outage"),
    ).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("caches Builder's own refusal as a denial", async () => {
    signIn("denied@example.com");
    fetchMock.mockResolvedValue(new Response("no", { status: 403 }));
    await expect(
      canAccessBuilderProject("denied@example.com", "proj-denied"),
    ).resolves.toBe(false);
    await expect(
      canAccessBuilderProject("denied@example.com", "proj-denied"),
    ).resolves.toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("lets a user open a project from another space, read-only", async () => {
    signIn("visitor@example.com");
    fetchMock.mockResolvedValueOnce(
      Response.json({ id: "proj-public", ownerId: "space-other" }),
    );
    await expect(
      canAccessBuilderProject("visitor@example.com", "proj-public"),
    ).resolves.toBe(true);
  });

  it("asks for a fresh sign-in when this server holds no credential", async () => {
    await expect(
      canAccessBuilderProject("never-exchanged@example.com", "proj-any"),
    ).rejects.toBeInstanceOf(BuilderSignInRequiredError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
