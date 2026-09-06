// @vitest-environment happy-dom

import { beforeEach, describe, expect, it } from "vitest";

import { clearChatHomeThreadId, getChatHomeThreadId } from "./chat-home-thread";

describe("chat home handoff thread", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  it("reuses a pending id while the home route is being handed off", () => {
    const first = getChatHomeThreadId();

    expect(first).toMatch(/^chat-/);
    expect(getChatHomeThreadId()).toBe(first);
  });

  it("allows the durable route to release the id for the next new chat", () => {
    const first = getChatHomeThreadId();

    clearChatHomeThreadId();

    expect(getChatHomeThreadId()).not.toBe(first);
  });
});
