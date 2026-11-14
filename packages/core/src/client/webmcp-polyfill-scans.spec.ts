// @vitest-environment happy-dom
import { cleanupWebMCPPolyfill } from "@mcp-b/webmcp-polyfill";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { initializeAgentNativeWebMcp } from "./webmcp.js";

function countFullScans() {
  const calls = { full: 0 };
  const original = document.querySelectorAll.bind(document);
  const spy = vi.spyOn(document, "querySelectorAll").mockImplementation(((
    selectors: string,
  ) => {
    if (selectors === "*") calls.full += 1;
    return original(selectors);
  }) as typeof document.querySelectorAll);
  return { calls, restore: () => spy.mockRestore() };
}

// happy-dom's document is not an instance of its global Document, so the
// polyfill's Document.prototype getter misses it; its navigator alias works.
async function polyfillToolNames(): Promise<string[]> {
  const modelContext = (
    navigator as unknown as {
      modelContext: { getTools(): Promise<{ name: string }[]> };
    }
  ).modelContext;
  return (await modelContext.getTools()).map((tool) => tool.name);
}

describe("WebMCP polyfill declarative form scans", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("isSecureContext", true);
  });

  afterEach(() => {
    cleanupWebMCPPolyfill();
    document.body.innerHTML = "";
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("coalesces a burst of DOM mutations into one document scan", async () => {
    initializeAgentNativeWebMcp();
    const scans = countFullScans();
    const transcript = document.createElement("div");
    document.body.append(transcript);
    for (let index = 0; index < 60; index += 1) {
      const paragraph = document.createElement("p");
      paragraph.textContent = `Streamed line ${index}`;
      transcript.append(paragraph);
      await Promise.resolve();
    }
    expect(scans.calls.full).toBe(0);
    await vi.advanceTimersByTimeAsync(1_500);
    expect(scans.calls.full).toBe(1);
    scans.restore();
  });

  it("still registers a declarative form tool", async () => {
    vi.useRealTimers();
    initializeAgentNativeWebMcp();
    const form = document.createElement("form");
    form.setAttribute("toolname", "find-order");
    form.setAttribute("tooldescription", "Find an order by number");
    const input = document.createElement("input");
    input.name = "order";
    form.append(input);
    document.body.append(form);
    await vi.waitFor(
      async () => expect(await polyfillToolNames()).toContain("find-order"),
      { timeout: 3_000, interval: 100 },
    );
  });
});
