import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { agentChat } from "./agent-chat.js";

describe("agentChat.submit", () => {
  it("logs BUILDER_PARENT_MESSAGE in Node.js", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    agentChat.submit("hello", "ctx");
    expect(spy).toHaveBeenCalledOnce();
    const output = spy.mock.calls[0][0] as string;
    expect(output).toMatch(/^BUILDER_PARENT_MESSAGE:/);
    const parsed = JSON.parse(output.replace("BUILDER_PARENT_MESSAGE:", ""));
    expect(parsed.message.type).toBe("agentNative.submitChat");
    expect(parsed.message.data.message).toBe("hello");
    expect(parsed.message.data.context).toBe("ctx");
    expect(parsed.message.data.submit).toBe(true);
    spy.mockRestore();
  });
});

describe("agentChat.prefill", () => {
  it("sets submit to false", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    agentChat.prefill("draft");
    const output = spy.mock.calls[0][0] as string;
    const parsed = JSON.parse(output.replace("BUILDER_PARENT_MESSAGE:", ""));
    expect(parsed.message.data.submit).toBe(false);
    spy.mockRestore();
  });
});

describe("agentChat.call", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    delete process.env.FRAME_PORT;
  });

  it("sends POST to frame and returns response", async () => {
    const mockResponse = {
      response: "Done!",
      filesChanged: ["events.json"],
    };

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockResponse),
    });

    const result = await agentChat.call("what events?", { framePort: 4444 });
    expect(result).toEqual(mockResponse);

    const fetchCall = (globalThis.fetch as any).mock.calls[0];
    expect(fetchCall[0]).toBe("http://localhost:4444/api/chat");
    expect(fetchCall[1].method).toBe("POST");
    const body = JSON.parse(fetchCall[1].body);
    expect(body.message).toBe("what events?");
  });

  it("passes context to the request body", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ response: "ok", filesChanged: [] }),
    });

    await agentChat.call("msg", { context: "extra", framePort: 5555 });
    const body = JSON.parse((globalThis.fetch as any).mock.calls[0][1].body);
    expect(body.context).toBe("extra");
  });

  it("uses FRAME_PORT env var", async () => {
    process.env.FRAME_PORT = "9999";
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ response: "ok", filesChanged: [] }),
    });

    await agentChat.call("msg");
    const url = (globalThis.fetch as any).mock.calls[0][0];
    expect(url).toBe("http://localhost:9999/api/chat");
  });

  it("defaults to port 3333", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ response: "ok", filesChanged: [] }),
    });

    await agentChat.call("msg");
    const url = (globalThis.fetch as any).mock.calls[0][0];
    expect(url).toBe("http://localhost:3333/api/chat");
  });

  it("throws on non-ok response", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: () => Promise.resolve('{"error":"boom"}'),
    });

    await expect(agentChat.call("msg", { framePort: 3333 })).rejects.toThrow(
      "Frame chat failed (500)",
    );
  });

  it("includes warnings when present", async () => {
    const mockResponse = {
      response: "Done!",
      filesChanged: [],
      warnings: ["Reverted unauthorized change to: src/index.ts"],
    };

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockResponse),
    });

    const result = await agentChat.call("msg", { framePort: 3333 });
    expect(result.warnings).toEqual([
      "Reverted unauthorized change to: src/index.ts",
    ]);
  });
});
