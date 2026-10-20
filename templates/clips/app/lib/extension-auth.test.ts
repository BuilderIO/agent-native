import { describe, expect, it, vi } from "vitest";

import {
  buildClipsExtensionBaseUrl,
  fetchClipsExtensionSession,
} from "./extension-auth";

describe("buildClipsExtensionBaseUrl", () => {
  it("keeps a root-mounted app at its origin", () => {
    expect(buildClipsExtensionBaseUrl("https://clips.example.com", "/")).toBe(
      "https://clips.example.com",
    );
  });

  it("keeps the configured mount path for self-hosted apps", () => {
    expect(
      buildClipsExtensionBaseUrl("https://clips.example.com", "/clips/"),
    ).toBe("https://clips.example.com/clips");
  });

  it("does not carry query or hash state into the extension setting", () => {
    expect(
      buildClipsExtensionBaseUrl(
        "https://clips.example.com",
        "/clips/?clipsExtensionAuth=1#signed-in",
      ),
    ).toBe("https://clips.example.com/clips");
  });
});

describe("fetchClipsExtensionSession", () => {
  const keepGoing = () => true;
  const noDelay = async () => {};

  it("retries a temporarily unavailable session endpoint", async () => {
    const fetchSession = vi
      .fn<() => Promise<Response>>()
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(
        Response.json({ email: "person@example.test", token: "session" }),
      );

    await expect(
      fetchClipsExtensionSession(fetchSession, keepGoing, noDelay),
    ).resolves.toEqual({ email: "person@example.test", token: "session" });
    expect(fetchSession).toHaveBeenCalledTimes(2);
  });

  it("retries a transient network failure", async () => {
    const fetchSession = vi
      .fn<() => Promise<Response>>()
      .mockRejectedValueOnce(new TypeError("network unavailable"))
      .mockResolvedValueOnce(
        Response.json({ email: "person@example.test", token: "session" }),
      );

    await expect(
      fetchClipsExtensionSession(fetchSession, keepGoing, noDelay),
    ).resolves.toEqual({ email: "person@example.test", token: "session" });
    expect(fetchSession).toHaveBeenCalledTimes(2);
  });

  it("stops after three consecutive unavailable responses", async () => {
    const fetchSession = vi
      .fn<() => Promise<Response>>()
      .mockResolvedValue(new Response(null, { status: 503 }));

    await expect(
      fetchClipsExtensionSession(fetchSession, keepGoing, noDelay),
    ).rejects.toThrow("HTTP 503");
    expect(fetchSession).toHaveBeenCalledTimes(3);
  });

  it("does not retry an unauthenticated response", async () => {
    const fetchSession = vi
      .fn<() => Promise<Response>>()
      .mockResolvedValue(
        Response.json({ error: "Not authenticated" }, { status: 200 }),
      );

    await expect(
      fetchClipsExtensionSession(fetchSession, keepGoing, noDelay),
    ).resolves.toBeNull();
    expect(fetchSession).toHaveBeenCalledTimes(1);
  });

  it("stops retrying after the bridge is cancelled", async () => {
    let active = true;
    const fetchSession = vi
      .fn<() => Promise<Response>>()
      .mockResolvedValue(new Response(null, { status: 503 }));
    const pause = async () => {
      active = false;
    };

    await expect(
      fetchClipsExtensionSession(fetchSession, () => active, pause),
    ).resolves.toBeNull();
    expect(fetchSession).toHaveBeenCalledTimes(1);
  });

  it("does not retry an unreadable successful response", async () => {
    const fetchSession = vi
      .fn<() => Promise<Response>>()
      .mockResolvedValueOnce(new Response("not json"));

    await expect(
      fetchClipsExtensionSession(fetchSession, keepGoing, noDelay),
    ).rejects.toThrow(SyntaxError);
    expect(fetchSession).toHaveBeenCalledTimes(1);
  });

  it("rejects a successful response without session credentials", async () => {
    const fetchSession = vi
      .fn<() => Promise<Response>>()
      .mockResolvedValueOnce(Response.json({ email: "person@example.test" }));

    await expect(
      fetchClipsExtensionSession(fetchSession, keepGoing, noDelay),
    ).rejects.toThrow("invalid session");
    expect(fetchSession).toHaveBeenCalledTimes(1);
  });
});
