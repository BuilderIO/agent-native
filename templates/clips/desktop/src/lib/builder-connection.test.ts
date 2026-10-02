import { describe, expect, it, vi } from "vitest";

import { useBuilderForVoiceCleanup } from "./builder-connection";

describe("useBuilderForVoiceCleanup", () => {
  it("activates directly with the signed token and skips browser OAuth", async () => {
    const connectUrl =
      "https://app.example/_agent-native/builder/connect?_an_connect=signed-connect";
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            agentNativeProvisioningEnabled: true,
            agentNativeProvisioningToken: "provision-token",
            connectUrl,
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true, scope: "personal" }), {
          status: 200,
        }),
      );
    const openExternal = vi.fn(async () => {});

    await expect(
      useBuilderForVoiceCleanup("https://app.example", {
        fetchImpl,
        openExternal,
      }),
    ).resolves.toBe("activated");

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[1]?.[0]).toContain("/builder/provision?");
    expect(fetchImpl.mock.calls[1]?.[1]?.body).toBe(
      JSON.stringify({
        provisioningToken: "provision-token",
        connectToken: "signed-connect",
      }),
    );
    expect(openExternal).not.toHaveBeenCalled();
  });

  it("opens sign-in only when activation reports an existing account", async () => {
    const connectUrl =
      "https://app.example/_agent-native/builder/connect?_an_connect=signed-connect";
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            agentNativeProvisioningEnabled: true,
            agentNativeProvisioningToken: "provision-token",
            connectUrl,
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: false, code: "account_exists" }), {
          status: 409,
        }),
      );
    const openExternal = vi.fn(async () => {});

    await expect(
      useBuilderForVoiceCleanup("https://app.example", {
        fetchImpl,
        openExternal,
      }),
    ).resolves.toBe("browser");

    expect(openExternal).toHaveBeenCalledWith(connectUrl);
  });

  it("does not open OAuth when one-click setup is unavailable", async () => {
    const connectUrl =
      "https://app.example/_agent-native/builder/connect?_an_connect=signed-connect";
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ connectUrl }), { status: 200 }),
      );
    const openExternal = vi.fn(async () => {});

    await expect(
      useBuilderForVoiceCleanup("https://app.example", {
        fetchImpl,
        openExternal,
      }),
    ).rejects.toThrow("One-click Builder.io setup isn't available");

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(openExternal).not.toHaveBeenCalled();
  });
});
