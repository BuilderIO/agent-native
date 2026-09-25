import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  registerRequiredSecret: vi.fn(),
}));

vi.mock("@agent-native/core/secrets", () => ({
  registerRequiredSecret: mocks.registerRequiredSecret,
}));

await import("./register-secrets");

interface CapturedSecret {
  key: string;
  scope: string;
  required?: boolean;
  description?: string;
  docsUrl?: string;
  validator?: (
    value: string,
  ) => Promise<boolean | { ok: boolean; error?: string }>;
}

function figmaSecret(): CapturedSecret {
  const registered = mocks.registerRequiredSecret.mock.calls
    .map(([secret]) => secret as CapturedSecret)
    .find((secret) => secret.key === "FIGMA_ACCESS_TOKEN");
  if (!registered) throw new Error("Figma secret was not registered");
  return registered;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Figma secret registration", () => {
  it("is optional, user-scoped, and documents current granular scopes", () => {
    const secret = figmaSecret();

    expect(secret.scope).toBe("user");
    expect(secret.required).toBe(false);
    expect(secret.docsUrl).toBe(
      "https://developers.figma.com/docs/rest-api/personal-access-tokens/",
    );
    expect(secret.description).toContain("current_user:read");
    expect(secret.description).toContain("file_content:read");
    expect(secret.description).toContain("library_content:read");
    expect(secret.description).toContain("team_library_content:read");
  });

  it("validates against Figma without returning the submitted token", async () => {
    const exampleToken = "<FIGMA_ACCESS_TOKEN>";
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await figmaSecret().validator?.(exampleToken);

    expect(result).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.figma.com/v1/me",
      expect.objectContaining({
        headers: expect.objectContaining({
          "X-Figma-Token": exampleToken,
        }),
      }),
    );
    expect(JSON.stringify(result)).not.toContain(exampleToken);
  });

  it("returns actionable permission guidance without reflecting the token", async () => {
    const exampleToken = "<FIGMA_ACCESS_TOKEN>";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status: 403 })),
    );

    const result = await figmaSecret().validator?.(exampleToken);

    expect(result).toMatchObject({ ok: false });
    expect(JSON.stringify(result)).toContain("current_user:read");
    expect(JSON.stringify(result)).not.toContain(exampleToken);
  });

  it("does not reflect transport exception details", async () => {
    const exampleToken = "<FIGMA_ACCESS_TOKEN>";
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockRejectedValue(
          new Error(`request failed with X-Figma-Token ${exampleToken}`),
        ),
    );

    const result = await figmaSecret().validator?.(exampleToken);

    expect(result).toEqual({
      ok: false,
      error: "Could not reach Figma. Check your network and try again.",
    });
    expect(JSON.stringify(result)).not.toContain(exampleToken);
  });
});
