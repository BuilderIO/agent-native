import { describe, expect, it, vi } from "vitest";

vi.mock("./api-path.js", () => ({ agentNativePath: (p: string) => p }));

const { fetchSpeechClip } = await import("./speak.js");

function respond(status: number, body: unknown, type = "application/json") {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(
          typeof body === "string" || body instanceof Uint8Array
            ? body
            : JSON.stringify(body),
          { status, headers: { "Content-Type": type } },
        ),
    ),
  );
}

describe("fetchSpeechClip", () => {
  it("returns the audio blob", async () => {
    respond(200, new Uint8Array([1, 2, 3]), "audio/mpeg");
    const result = await fetchSpeechClip({ text: "Good morning." });
    expect(result.status).toBe("ok");
    expect((result as { blob: Blob }).blob.size).toBe(3);
  });

  it("reports no-provider only when the server says so", async () => {
    respond(400, { error: "No speech provider", reason: "no-provider" });
    const result = await fetchSpeechClip({ text: "Good morning." });
    expect(result).toMatchObject({ status: "failed", reason: "no-provider" });
  });

  it("does not read any other 400 as an unconfigured provider", async () => {
    respond(400, { error: 'Unknown voice "saige"', reason: "unknown-voice" });
    const result = await fetchSpeechClip({ text: "Good morning." });
    // Mapping this to no-provider would silently downgrade every reader to the
    // browser voice and hide the real bug.
    expect(result).toMatchObject({
      status: "failed",
      reason: "provider-error",
    });
  });

  it("treats an empty 200 as a failure, not as silence to play", async () => {
    respond(200, new Uint8Array(), "audio/mpeg");
    const result = await fetchSpeechClip({ text: "Good morning." });
    expect(result).toMatchObject({
      status: "failed",
      reason: "provider-error",
    });
  });

  it("surfaces a transport failure instead of throwing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("offline");
      }),
    );
    const result = await fetchSpeechClip({ text: "Good morning." });
    expect(result).toMatchObject({
      status: "failed",
      reason: "provider-error",
    });
    expect((result as { message: string }).message).toContain("offline");
  });
});
