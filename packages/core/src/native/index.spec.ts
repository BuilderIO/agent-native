import { afterEach, expect, it, vi } from "vitest";

import { native } from "./index.js";

afterEach(() => vi.unstubAllGlobals());

it("reports unavailable instead of inventing web results or subscriptions", async () => {
  vi.stubGlobal("window", undefined);
  expect(await native.call("capture.screen@1", "start", {})).toEqual({
    status: "unavailable",
    reason: "Desktop shell unavailable",
  });
  expect(await native.on("capture.screen@1", "state", () => {})).toEqual({
    status: "unavailable",
    reason: "Desktop shell unavailable",
  });
});
it("forwards calls and subscriptions to the shell", async () => {
  const call = vi.fn(async () => ({ status: "ok", value: 5 }));
  const on = vi.fn(async () => ({ status: "ok", unsubscribe: () => {} }));
  vi.stubGlobal("window", { agentNative: { native: { call, on } } });
  expect(
    await native.call("capture.screen@1", "start", { source: "screen" }),
  ).toEqual({ status: "ok", value: 5 });
  const callback = vi.fn();
  await native.on("capture.screen@1", "state", callback);
  expect(call).toHaveBeenCalledWith("capture.screen@1", "start", {
    source: "screen",
  });
  expect(on).toHaveBeenCalledWith("capture.screen@1", "state", callback);
});

it("preserves shell capability denial as unavailable", async () => {
  const denial = {
    status: "unavailable",
    reason: "Permission denied",
  } as const;
  vi.stubGlobal("window", {
    agentNative: { native: { call: async () => denial } },
  });
  await expect(native.call("capture.screen@1", "start", {})).resolves.toEqual(
    denial,
  );
});
