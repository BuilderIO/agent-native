import { describe, expect, it } from "vitest";

import {
  controlCommand,
  readRelayPollCommand,
  relayCapabilities,
  relayOperationClass,
} from "./remote-relay";

describe("direct browser relay contract", () => {
  it("advertises control only while the relay owns the single upstream", () => {
    expect(relayCapabilities(true, "0.1.0").browser).toMatchObject({
      observe: true,
      control: true,
    });
    expect(relayCapabilities(false, "0.1.0").browser).toMatchObject({
      observe: true,
      control: false,
    });
  });

  it("keeps read, observe, and safety stop approval-free", () => {
    expect(relayOperationClass("browser.read")).toBe("browser.observe");
    expect(relayOperationClass("browser.observe")).toBe("browser.observe");
    expect(relayOperationClass("browser.stop")).toBe("browser.observe");
    expect(relayOperationClass("browser.attach")).toBe("browser.control");
    expect(relayOperationClass("browser.click")).toBe("browser.control");
    expect(relayOperationClass("browser.open-tab")).toBe("browser.control");
  });

  it("maps only the reviewed browser-control surface and disables screenshots", () => {
    expect(controlCommand("browser.observe", {}, {})).toEqual({
      type: "observe",
      includeScreenshot: false,
    });
    expect(
      controlCommand(
        "browser.click",
        { button: "left" },
        { observationId: "observation-example", backendNodeId: 42 },
      ),
    ).toEqual({
      type: "click",
      target: { observationId: "observation-example", backendNodeId: 42 },
      button: "left",
    });
    expect(
      controlCommand(
        "browser.open-tab",
        { url: "https://example.com/next" },
        {},
      ),
    ).toEqual({ type: "open-tab", url: "https://example.com/next" });
    expect(() => controlCommand("browser.evaluate", {}, {})).toThrow(
      "Unsupported remote browser action",
    );
  });

  it("reads only the claimed command envelope from a poll response", () => {
    const command = { id: "command-example", kind: "computer-operation" };
    expect(readRelayPollCommand({ command })).toEqual(command);
    expect(readRelayPollCommand({ command: null })).toBeNull();
  });
});
