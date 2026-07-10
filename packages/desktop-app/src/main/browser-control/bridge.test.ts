import { afterEach, describe, expect, it } from "vitest";

import { BrowserControlLoopbackBridge } from "./bridge";
import type {
  BrowserHostBridgeRegistration,
  BrowserNativeRequest,
} from "./protocol";

const bridges: BrowserControlLoopbackBridge[] = [];

afterEach(async () => {
  await Promise.all(bridges.splice(0).map((bridge) => bridge.close()));
});

function auth(registration: BrowserHostBridgeRegistration): HeadersInit {
  return { authorization: `Bearer ${registration.bearerToken}` };
}

async function poll(
  registration: BrowserHostBridgeRegistration,
): Promise<BrowserNativeRequest> {
  const response = await fetch(`${registration.baseUrl}/v1/commands`, {
    headers: auth(registration),
  });
  expect(response.status).toBe(200);
  return (await response.json()) as BrowserNativeRequest;
}

async function respond(
  registration: BrowserHostBridgeRegistration,
  body: unknown,
): Promise<Response> {
  return fetch(`${registration.baseUrl}/v1/messages`, {
    method: "POST",
    headers: { ...auth(registration), "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("BrowserControlLoopbackBridge", () => {
  it("requires the per-process native-host bearer token", async () => {
    const bridge = new BrowserControlLoopbackBridge();
    bridges.push(bridge);
    const registration = await bridge.start();

    expect(await fetch(`${registration.baseUrl}/v1/commands`)).toMatchObject({
      status: 401,
    });
    expect(
      await fetch(`${registration.baseUrl}/v1/commands`, {
        headers: { authorization: "Bearer wrong-example-token" },
      }),
    ).toMatchObject({ status: 401 });
  });

  it("binds commands to server-issued task credentials", async () => {
    const tokens = ["host-example", "task-one-example", "task-two-example"];
    const bridge = new BrowserControlLoopbackBridge({
      token: () => tokens.shift()!,
      requestId: (() => {
        let id = 0;
        return () => `request-${++id}`;
      })(),
    });
    bridges.push(bridge);
    const host = await bridge.start();
    const taskOne = bridge.registerTask("task-one");
    const taskTwo = bridge.registerTask("task-two");

    expect(() =>
      bridge.execute(
        { ...taskOne, taskToken: taskTwo.taskToken },
        {
          type: "observe",
        },
      ),
    ).toThrow(/credentials/);

    const oneResult = bridge.execute(taskOne, { type: "observe" });
    const twoResult = bridge.execute(taskTwo, {
      type: "navigate",
      url: "https://example.com",
    });
    const one = await poll(host);
    const two = await poll(host);
    expect([one.taskId, two.taskId]).toEqual(["task-one", "task-two"]);

    expect(
      await respond(host, { id: two.id, ok: true, result: "two" }),
    ).toMatchObject({ status: 204 });
    expect(
      await respond(host, { id: one.id, ok: true, result: "one" }),
    ).toMatchObject({ status: 204 });
    await expect(oneResult).resolves.toBe("one");
    await expect(twoResult).resolves.toBe("two");
  });

  it("cancels a task's work and prioritizes its emergency stop", async () => {
    const bridge = new BrowserControlLoopbackBridge({
      commandTimeoutMs: 5_000,
    });
    bridges.push(bridge);
    const host = await bridge.start();
    const task = bridge.registerTask("task-one");
    const otherTask = bridge.registerTask("task-two");

    const cancelled = bridge.execute(task, { type: "observe" });
    const other = bridge.execute(otherTask, { type: "observe" });
    const stop = bridge.stopTask(task);

    await expect(cancelled).rejects.toThrow(/stopped/);
    const first = await poll(host);
    expect(first).toMatchObject({
      taskId: "task-one",
      command: { type: "stop" },
    });
    expect(await respond(host, { id: first.id, ok: true })).toMatchObject({
      status: 204,
    });
    await expect(stop).resolves.toBeUndefined();

    const second = await poll(host);
    expect(second.taskId).toBe("task-two");
    expect(await respond(host, { id: second.id, ok: true })).toMatchObject({
      status: 204,
    });
    await expect(other).resolves.toBeUndefined();
  });

  it("rejects unknown native results rather than crossing task boundaries", async () => {
    const bridge = new BrowserControlLoopbackBridge();
    bridges.push(bridge);
    const host = await bridge.start();

    expect(
      await respond(host, {
        id: "unknown-request",
        ok: true,
        result: "ignored",
      }),
    ).toMatchObject({ status: 404 });
  });
});
