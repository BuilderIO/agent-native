import { afterEach, describe, expect, it, vi } from "vitest";

import {
  FIGMA_ACCESS_TOKEN_SECRET_KEY,
  getFigmaConnectionStatus,
  saveFigmaAccessToken,
} from "./figma-connection";

const EXAMPLE_TOKEN = "<FIGMA_ACCESS_TOKEN>";

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: init?.status ?? 200,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Figma connection client", () => {
  it("returns only safe metadata for the registered Figma secret", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse([
        {
          key: "GITHUB_TOKEN",
          label: "GitHub token",
          status: "set",
          last4: "safe",
        },
        {
          key: FIGMA_ACCESS_TOKEN_SECRET_KEY,
          label: "Figma access token",
          description: "Connect Figma files.",
          docsUrl:
            "https://developers.figma.com/docs/rest-api/personal-access-tokens/",
          status: "set",
          last4: "mple",
          updatedAt: 123,
        },
      ]),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(getFigmaConnectionStatus()).resolves.toEqual({
      connected: true,
      status: "set",
      key: FIGMA_ACCESS_TOKEN_SECRET_KEY,
      label: "Figma access token",
      description: "Connect Figma files.",
      docsUrl:
        "https://developers.figma.com/docs/rest-api/personal-access-tokens/",
      last4: "mple",
      updatedAt: 123,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/_agent-native/secrets"),
      expect.objectContaining({ method: "GET", credentials: "same-origin" }),
    );
  });

  it.each(["unset", "invalid"] as const)(
    "reports %s credentials as disconnected",
    async (status) => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(
          jsonResponse([
            {
              key: FIGMA_ACCESS_TOKEN_SECRET_KEY,
              label: "Figma access token",
              status,
            },
          ]),
        ),
      );

      await expect(getFigmaConnectionStatus()).resolves.toMatchObject({
        connected: false,
        status,
      });
    },
  );

  it("saves through the registered-secret route, then returns refreshed status", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ ok: true, status: "set" }))
      .mockResolvedValueOnce(
        jsonResponse([
          {
            key: FIGMA_ACCESS_TOKEN_SECRET_KEY,
            label: "Figma access token",
            status: "set",
            last4: "OKEN",
          },
        ]),
      );
    vi.stubGlobal("fetch", fetchMock);

    const result = await saveFigmaAccessToken(`  ${EXAMPLE_TOKEN}  `);

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining(
        `/_agent-native/secrets/${FIGMA_ACCESS_TOKEN_SECRET_KEY}`,
      ),
      expect.objectContaining({
        method: "POST",
        credentials: "same-origin",
        body: JSON.stringify({ value: EXAMPLE_TOKEN }),
      }),
    );
    expect(result.connected).toBe(true);
    expect(JSON.stringify(result)).not.toContain(EXAMPLE_TOKEN);
  });

  it("redacts a reflected token from a failed save", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse(
            { error: `Provider rejected ${EXAMPLE_TOKEN}` },
            { status: 400 },
          ),
        ),
    );

    await expect(saveFigmaAccessToken(EXAMPLE_TOKEN)).rejects.toThrow(
      "Provider rejected [redacted]",
    );
  });

  it("redacts URL-encoded and JSON-escaped reflections of a failed token", async () => {
    const token = '<FIGMA "ACCESS" \\ TOKEN>';
    const jsonEscaped = JSON.stringify(token).slice(1, -1);
    const reflected = `${encodeURIComponent(token)} ${jsonEscaped}`;
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(jsonResponse({ error: reflected }, { status: 400 })),
    );

    const error = await saveFigmaAccessToken(token).catch(
      (reason: unknown) => reason,
    );
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).not.toContain(token);
    expect((error as Error).message).not.toContain(encodeURIComponent(token));
    expect((error as Error).message).not.toContain(jsonEscaped);
  });

  it("fails clearly when the template forgot to register Figma", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse([])));

    await expect(getFigmaConnectionStatus()).rejects.toThrow(
      "Figma connection is not registered",
    );
  });
});
