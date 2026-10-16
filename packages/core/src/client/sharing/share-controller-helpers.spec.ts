// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";

import { notifyShareChanged } from "./share-controller-helpers.js";

describe("notifyShareChanged", () => {
  afterEach(() => vi.restoreAllMocks());

  it("tells chat history lists to refetch after a chat share changes", () => {
    const listener = vi.fn();
    window.addEventListener("agent-chat:threads-updated", listener);

    notifyShareChanged("chat_thread");

    expect(listener).toHaveBeenCalledOnce();
    window.removeEventListener("agent-chat:threads-updated", listener);
  });

  it("leaves chat history alone for other resource types", () => {
    const listener = vi.fn();
    window.addEventListener("agent-chat:threads-updated", listener);

    notifyShareChanged("document");

    expect(listener).not.toHaveBeenCalled();
    window.removeEventListener("agent-chat:threads-updated", listener);
  });
});
