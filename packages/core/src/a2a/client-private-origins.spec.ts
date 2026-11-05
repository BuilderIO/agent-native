import { afterEach, describe, expect, it, vi } from "vitest";

import { A2AClient } from "./client.js";

const ALLOWED = "http://127.0.0.1:19100";
const OTHER = "http://127.0.0.1:19200";

function message() {
  return {
    role: "user" as const,
    parts: [{ type: "text" as const, text: "hi" }],
  };
}

describe("A2AClient allowedPrivateOrigins", () => {
  afterEach(() => vi.restoreAllMocks());

  it("reaches a configured private origin and still blocks any other", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (_url, init) => {
        const body = JSON.parse(String(init?.body));
        return new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: body.id,
            result: {
              id: "task-ok",
              status: {
                state: "completed",
                message: {
                  role: "agent",
                  parts: [{ type: "text", text: "ok" }],
                },
              },
            },
          }),
          { status: 200 },
        );
      });
    const options = { allowedPrivateOrigins: [ALLOWED] };

    const task = await new A2AClient(`${ALLOWED}/a2a`, undefined, options).send(
      message(),
    );
    expect(task.status.state).toBe("completed");

    await expect(
      new A2AClient(`${OTHER}/a2a`, undefined, options).send(message()),
    ).rejects.toThrow(/SSRF blocked/i);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
