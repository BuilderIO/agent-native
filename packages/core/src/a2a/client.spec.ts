import { afterEach, describe, expect, it, vi } from "vitest";
import { A2AClient, A2ATaskTimeoutError } from "./client.js";

describe("A2AClient", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("throws structured timeout errors with the remote task id", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        const body = JSON.parse(String(init.body));
        if (body.method === "message/send") {
          return new Response(
            JSON.stringify({
              jsonrpc: "2.0",
              id: body.id,
              result: {
                id: "task-qa",
                status: { state: "working" },
                history: [],
                artifacts: [],
              },
            }),
            { status: 200 },
          );
        }
        return new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: body.id,
            result: {
              id: "task-qa",
              status: { state: "working" },
              history: [],
              artifacts: [],
            },
          }),
          { status: 200 },
        );
      }),
    );

    const client = new A2AClient("https://agent.test");
    await expect(
      client.sendAndWait(
        { role: "user", parts: [{ type: "text", text: "hello" }] },
        { timeoutMs: 1, pollIntervalMs: 1 },
      ),
    ).rejects.toMatchObject({
      name: "A2ATaskTimeoutError",
      taskId: "task-qa",
      lastState: "working",
      timeoutMs: 1,
    });

    await expect(
      client.sendAndWait(
        { role: "user", parts: [{ type: "text", text: "hello" }] },
        { timeoutMs: 1, pollIntervalMs: 1 },
      ),
    ).rejects.toBeInstanceOf(A2ATaskTimeoutError);
  });
});
