import { afterEach, describe, expect, it, vi } from "vitest";

import { getVoiceProviderStatus } from "./voice-provider-status.js";

function stubStatusResponse(body: unknown, init?: ResponseInit) {
  const fetchMock = vi
    .fn()
    .mockResolvedValue(new Response(JSON.stringify(body), init));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("getVoiceProviderStatus", () => {
  it("reads the voice provider status route with same-origin credentials", async () => {
    const fetchMock = stubStatusResponse({ builder: true, openai: false });

    await getVoiceProviderStatus();

    expect(fetchMock).toHaveBeenCalledWith(
      "/_agent-native/voice-providers/status",
      { credentials: "same-origin" },
    );
  });

  it("passes through the providers whose credentials could not be read", async () => {
    stubStatusResponse({
      builder: false,
      openai: false,
      credentialLookupFailed: ["openai"],
    });

    await expect(getVoiceProviderStatus()).resolves.toEqual({
      builder: false,
      openai: false,
      credentialLookupFailed: ["openai"],
    });
  });

  it("reports no failed lookups when the field is missing or not an array", async () => {
    stubStatusResponse({ builder: true, openai: true });
    await expect(getVoiceProviderStatus()).resolves.toEqual({
      builder: true,
      openai: true,
      credentialLookupFailed: [],
    });

    stubStatusResponse({
      builder: true,
      openai: false,
      credentialLookupFailed: "openai",
    });
    await expect(getVoiceProviderStatus()).resolves.toEqual({
      builder: true,
      openai: false,
      credentialLookupFailed: [],
    });
  });

  it("treats only a literal true as a configured provider", async () => {
    stubStatusResponse({ builder: "yes", openai: 1 });

    await expect(getVoiceProviderStatus()).resolves.toEqual({
      builder: false,
      openai: false,
      credentialLookupFailed: [],
    });
  });

  it("throws with the status code when the route fails", async () => {
    stubStatusResponse({ error: "nope" }, { status: 503 });

    await expect(getVoiceProviderStatus()).rejects.toThrow(
      "Voice provider status unavailable (503)",
    );
  });
});
