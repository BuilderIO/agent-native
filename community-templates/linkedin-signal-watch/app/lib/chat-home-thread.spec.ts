// @vitest-environment happy-dom

import { beforeEach, describe, expect, it } from "vitest";

import {
  clearChatHomeThreadId,
  consumeChatHomeThreadId,
  getChatHomeThreadId,
} from "./chat-home-thread";

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

  it("consumes only a matching pending home handoff", () => {
    const pending = getChatHomeThreadId();

    expect(consumeChatHomeThreadId(pending)).toBe(true);
    expect(consumeChatHomeThreadId(pending)).toBe(false);
  });

  it("does not attribute a different routed thread to the pending handoff", () => {
    getChatHomeThreadId();

    expect(consumeChatHomeThreadId("chat-other")).toBe(false);
  });
});
