// @vitest-environment happy-dom

import { afterEach, beforeEach, expect, it, vi } from "vitest";

const canonicalCheck = vi.hoisted(() => vi.fn((_html: string) => true));

vi.mock("@shared/code-layer", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  hasCanonicalCodeLayerNodeIds: canonicalCheck,
}));

const screen = `<html><body><div data-agent-native-node-id="a">x</div></body></html>`;

async function freshLoad() {
  vi.resetModules();
  return import("./source-publication");
}

beforeEach(() => {
  localStorage.clear();
  canonicalCheck.mockClear();
  vi.stubGlobal("requestIdleCallback", (callback: () => void) => {
    callback();
    return 0;
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

it("skips the node-id check on a later load for content it already proved canonical", async () => {
  const first = await freshLoad();
  first.prepareCanonicalSourceContent(screen, { fileId: "screen-1" });
  expect(canonicalCheck).toHaveBeenCalledTimes(1);

  const reload = await freshLoad();
  expect(
    reload.prepareCanonicalSourceContent(screen, { fileId: "screen-1" })
      .changed,
  ).toBe(false);
  expect(canonicalCheck).toHaveBeenCalledTimes(1);

  const edited = await freshLoad();
  edited.prepareCanonicalSourceContent(screen.replace("x", "y"), {
    fileId: "screen-1",
  });
  expect(canonicalCheck).toHaveBeenCalledTimes(2);
});

it("checks every screen when the stored verdicts are unreadable", async () => {
  localStorage.setItem("agent-native:design:canonical-node-ids", "{not json");
  const load = await freshLoad();
  load.prepareCanonicalSourceContent(screen, { fileId: "screen-1" });
  expect(canonicalCheck).toHaveBeenCalledTimes(1);
});

it("gives different content of the same length a different key", async () => {
  const { canonicalContentKey } = await import("./canonical-verdicts");
  expect(canonicalContentKey("abcd")).toBe(canonicalContentKey("abcd"));
  expect(canonicalContentKey("abcd")).not.toBe(canonicalContentKey("abce"));
});
