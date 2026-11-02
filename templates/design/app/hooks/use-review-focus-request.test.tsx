// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { useReviewFocusRequest } from "./use-review-focus-request";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe("useReviewFocusRequest", () => {
  let container: HTMLDivElement;
  let root: Root;
  let hook: ReturnType<typeof useReviewFocusRequest>;

  function Probe() {
    hook = useReviewFocusRequest();
    return null;
  }

  beforeEach(async () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => root.render(<Probe />));
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  const target = { anchor: { point: { xPct: 1, yPct: 2 } }, targetId: null };

  function currentRequest() {
    const request = hook[0];
    if (!request) throw new Error("expected an active focus request");
    return request;
  }

  it("holds no request until the user asks for one", () => {
    expect(hook[0]).toBeNull();
  });

  it("issues a request with a fresh nonce each time", async () => {
    await act(async () => hook[1]({ ...target, threadId: "a" }));
    const first = currentRequest();
    expect(first).toMatchObject({ nonce: 1, threadId: "a", targetId: null });

    await act(async () => hook[1]({ ...target, threadId: "a" }));
    expect(currentRequest().nonce).toBe(2);
  });

  it("drops the request once an overlay reports acting on it", async () => {
    await act(async () => hook[1]({ ...target, threadId: "a" }));
    await act(async () => currentRequest().onConsumed?.());
    expect(hook[0]).toBeNull();
  });

  it("does not let a superseded request's report drop the newer one", async () => {
    await act(async () => hook[1]({ ...target, threadId: "a" }));
    const stale = currentRequest();
    await act(async () => hook[1]({ ...target, threadId: "b" }));

    await act(async () => stale.onConsumed?.());

    expect(hook[0]).toMatchObject({ nonce: 2, threadId: "b" });
  });
});
