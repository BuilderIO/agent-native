import { afterEach, describe, expect, it, vi } from "vitest";

import {
  areBuiltinMcpCapabilitiesSupported,
  BUILTIN_MCP_CAPABILITIES,
  getBuiltinMcpCapability,
  isBuiltinMcpCapabilityAvailable,
  listSupportedBuiltinMcpCapabilities,
  normalizeBuiltinMcpCapabilityIds,
  toBuiltinMcpServerConfig,
} from "./builtin-capabilities.js";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("built-in MCP capabilities", () => {
  it("pins the browser and computer-use server commands", () => {
    expect(
      toBuiltinMcpServerConfig(
        getBuiltinMcpCapability("browser-chrome-devtools")!,
      ),
    ).toEqual({
      type: "stdio",
      command: "npx",
      args: [
        "-y",
        "chrome-devtools-mcp@0.26.0",
        "--autoConnect",
        "--no-usage-statistics",
      ],
      description:
        "Attach to a live Chrome browser through Chrome DevTools MCP.",
    });
    expect(
      toBuiltinMcpServerConfig(getBuiltinMcpCapability("browser-playwright")!),
    ).toMatchObject({
      command: "npx",
      args: ["-y", "@playwright/mcp@0.0.75"],
    });
    expect(
      toBuiltinMcpServerConfig(getBuiltinMcpCapability("computer-use")!),
    ).toMatchObject({
      command: "npx",
      args: ["-y", "computer-use-mcp@1.8.0"],
    });
  });

  it("keeps the browser group exclusive with the last requested browser winning", () => {
    expect(
      normalizeBuiltinMcpCapabilityIds([
        "browser-chrome-devtools",
        "computer-use",
        "browser-playwright",
      ]),
    ).toEqual(["computer-use", "browser-playwright"]);
  });

  it("treats computer-use as macOS-only", () => {
    const computerUse = getBuiltinMcpCapability("computer-use")!;
    expect(isBuiltinMcpCapabilityAvailable(computerUse, "darwin")).toBe(true);
    expect(isBuiltinMcpCapabilityAvailable(computerUse, "linux")).toBe(false);
  });

  it("defines exactly the supported built-in ids", () => {
    expect(BUILTIN_MCP_CAPABILITIES.map((capability) => capability.id)).toEqual(
      ["browser-chrome-devtools", "browser-playwright", "computer-use"],
    );
  });

  it("does not support local stdio built-ins in production runtimes", () => {
    vi.stubEnv("NODE_ENV", "production");

    expect(areBuiltinMcpCapabilitiesSupported()).toBe(false);
    expect(listSupportedBuiltinMcpCapabilities()).toEqual([]);
  });

  it("does not support local stdio built-ins on hosted serverless runtimes", () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("VERCEL", "1");

    expect(areBuiltinMcpCapabilitiesSupported()).toBe(false);
    expect(listSupportedBuiltinMcpCapabilities()).toEqual([]);
  });
});
