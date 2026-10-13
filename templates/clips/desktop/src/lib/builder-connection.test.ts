import { describe, expect, it, vi } from "vitest";

import {
  connectBuilderForVoiceCleanup,
  isBuilderProvisioningAvailable,
} from "./builder-connection";

describe("isBuilderProvisioningAvailable", () => {
  it("requires the one-click capability and both signed tokens", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          agentNativeProvisioningEnabled: true,
          agentNativeProvisioningToken: "provision-token",
          connectUrl:
            "https://app.example/_agent-native/builder/connect?_an_connect=signed-connect",
        }),
        { status: 200 },
      ),
    );

    await expect(
      isBuilderProvisioningAvailable("https://app.example", fetchImpl),
    ).resolves.toBe(true);
  });

  it("fails closed when status cannot support one-click setup", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({ connectUrl: "https://app.example/connect" }),
        {
          status: 200,
        },
      ),
    );

    await expect(
      isBuilderProvisioningAvailable("https://app.example", fetchImpl),
    ).resolves.toBe(false);
  });
});

describe("connectBuilderForVoiceCleanup", () => {
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
      connectBuilderForVoiceCleanup(
        "https://app.example",
        {
          fetchImpl,
          openExternal,
        },
        { provisionAccount: true },
      ),
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

  it("opens sign-in only when the existing-account option is chosen", async () => {
    const connectUrl =
      "https://app.example/_agent-native/builder/connect?_an_connect=signed-connect";
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ connectUrl }), { status: 200 }),
      );
    const openExternal = vi.fn(async () => {});

    await expect(
      connectBuilderForVoiceCleanup(
        "https://app.example",
        {
          fetchImpl,
          openExternal,
        },
        { provisionAccount: false },
      ),
    ).resolves.toBe("browser");

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(openExternal).toHaveBeenCalledWith(new URL(connectUrl).href);
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
      connectBuilderForVoiceCleanup(
        "https://app.example",
        {
          fetchImpl,
          openExternal,
        },
        { provisionAccount: true },
      ),
    ).rejects.toThrow("One-click Builder.io setup isn't available");

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(openExternal).not.toHaveBeenCalled();
  });

  it("reports an existing account without opening a Builder window", async () => {
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
      connectBuilderForVoiceCleanup(
        "https://app.example",
        { fetchImpl, openExternal },
        { provisionAccount: true },
      ),
    ).resolves.toBe("account-exists");

    expect(openExternal).not.toHaveBeenCalled();
  });
});
