import { describe, expect, it, vi } from "vitest";

import { generateRunTitle } from "./run-title";

function deferredTitleFetch() {
  let finish: (response: Response) => void = () => {};
  const response = new Promise<Response>((resolve) => {
    finish = resolve;
  });
  const fetchImpl = vi.fn(
    async (_url: string | URL | Request, _init?: RequestInit) => response,
  );
  return {
    fetchImpl,
    finish: () =>
      finish(
        new Response(
          JSON.stringify({ content: [{ type: "text", text: '"Fix login"' }] }),
          { status: 200 },
        ),
      ),
  };
}

describe("run title generation", () => {
  it.each(["codex-cli", "claude-cli", "builder", "openai", undefined])(
    "makes no network call and reads no key for engine %s",
    async (engine) => {
      const { fetchImpl, finish } = deferredTitleFetch();
      finish();
      const resolveApiKey = vi.fn(() => "sk-test-placeholder");

      const title = await generateRunTitle({
        engine,
        prompt: "A private acquisition notes",
        resolveApiKey,
        fetchImpl,
      });

      expect(title).toBeNull();
      expect(fetchImpl).not.toHaveBeenCalled();
      expect(resolveApiKey).not.toHaveBeenCalled();
    },
  );

  it("sends the prompt to Anthropic when the run's engine is Anthropic", async () => {
    const { fetchImpl, finish } = deferredTitleFetch();

    const pending = generateRunTitle({
      engine: "anthropic",
      prompt: "A private acquisition notes",
      resolveApiKey: () => "sk-test-placeholder",
      fetchImpl,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const call = fetchImpl.mock.calls[0];
    expect(call?.[0]).toBe("https://api.anthropic.com/v1/messages");
    expect(String(call?.[1]?.body)).toContain("A private acquisition notes");

    finish();
    await expect(pending).resolves.toBe("Fix login");
  });

  it("makes no call for an Anthropic run without a key", async () => {
    const { fetchImpl } = deferredTitleFetch();

    await expect(
      generateRunTitle({
        engine: "anthropic",
        prompt: "A private acquisition notes",
        resolveApiKey: () => undefined,
        fetchImpl,
      }),
    ).resolves.toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
