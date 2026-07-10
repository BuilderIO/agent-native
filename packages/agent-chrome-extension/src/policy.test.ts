import { describe, expect, it } from "vitest";

import {
  assertUrlAllowed,
  normalizeAllowedOrigin,
  parseNativeRequest,
  ProtocolValidationError,
} from "./policy";

const request = (command: unknown): unknown => ({
  id: "req-example",
  taskId: "task-example",
  command,
});

describe("browser command policy", () => {
  it("normalizes exact HTTP(S) origins", () => {
    expect(normalizeAllowedOrigin("https://example.com/")).toBe(
      "https://example.com",
    );
    expect(normalizeAllowedOrigin("http://localhost:3000/")).toBe(
      "http://localhost:3000",
    );
  });

  it.each([
    "file:///tmp/example",
    "chrome://settings/",
    "javascript:alert(1)",
    "https://example.com/path",
    "https://user:password@example.com/",
    "https://example.com/?query=1",
  ])("rejects unsafe or non-origin attachment scope %s", (origin) => {
    expect(() => normalizeAllowedOrigin(origin)).toThrow(
      ProtocolValidationError,
    );
  });

  it("deduplicates allowed origins on attach", () => {
    expect(
      parseNativeRequest(
        request({
          type: "attach",
          tabId: 42,
          allowedOrigins: ["https://example.com", "https://example.com/"],
        }),
      ).command,
    ).toEqual({
      type: "attach",
      tabId: 42,
      allowedOrigins: ["https://example.com"],
    });
  });

  it("accepts the bounded typed command surface", () => {
    const commands = [
      { type: "observe", includeScreenshot: true, maxNodes: 500 },
      {
        type: "click",
        target: { observationId: "observation-1", backendNodeId: 17 },
        button: "left",
      },
      {
        type: "type",
        target: { observationId: "observation-1", backendNodeId: 17 },
        text: "example",
        replace: true,
      },
      { type: "key", key: "Enter", modifiers: ["shift"] },
      { type: "navigate", url: "https://example.com/path" },
      { type: "scroll", deltaX: 0, deltaY: 600, x: 10, y: 20 },
      { type: "detach" },
      { type: "stop" },
    ];
    for (const command of commands)
      expect(parseNativeRequest(request(command)).command).toEqual(command);
  });

  it.each([
    { type: "evaluate", expression: "document.cookie" },
    {
      type: "click",
      target: { observationId: "observation-1", backendNodeId: 0 },
    },
    { type: "click", target: { backendNodeId: 1 } },
    {
      type: "type",
      target: { observationId: "observation-1", backendNodeId: 1 },
      text: "example",
      replace: "yes",
    },
    { type: "key", key: "a" },
    { type: "observe", includeScreenshot: "yes" },
    { type: "observe", maxNodes: 20_000 },
    { type: "scroll", deltaX: Number.NaN, deltaY: 1 },
  ])("rejects an unbounded or unsupported command %#", (command) => {
    expect(() => parseNativeRequest(request(command))).toThrow(
      ProtocolValidationError,
    );
  });

  it("requires navigations to remain inside the task origin set", () => {
    const allowed = new Set(["https://example.com"]);
    expect(assertUrlAllowed("https://example.com/work?q=1", allowed).href).toBe(
      "https://example.com/work?q=1",
    );
    expect(() =>
      assertUrlAllowed("https://other.example/work", allowed),
    ).toThrow(/outside this task/);
    expect(() =>
      assertUrlAllowed("https://user:password@example.com/work", allowed),
    ).toThrow(/credential-free/);
  });

  it("rejects malformed request envelopes", () => {
    expect(() =>
      parseNativeRequest({ taskId: "task-example", command: { type: "stop" } }),
    ).toThrow(ProtocolValidationError);
    expect(() =>
      parseNativeRequest({
        id: "req-example",
        taskId: "",
        command: { type: "stop" },
      }),
    ).toThrow(ProtocolValidationError);
  });
});
