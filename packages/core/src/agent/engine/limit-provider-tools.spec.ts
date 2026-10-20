import { describe, expect, it } from "vitest";

import {
  limitProviderTools,
  MAX_PROVIDER_TOOLS,
} from "./limit-provider-tools.js";
import type { EngineTool } from "./types.js";

function makeTool(name: string): EngineTool {
  return {
    name,
    description: name,
    inputSchema: { type: "object", properties: {} },
  };
}

describe("limitProviderTools", () => {
  it("caps provider tool arrays at 128 while preserving tool-search", () => {
    const tools = Array.from({ length: MAX_PROVIDER_TOOLS + 1 }, (_, index) =>
      makeTool(index === MAX_PROVIDER_TOOLS ? "tool-search" : `tool-${index}`),
    );

    const limited = limitProviderTools(tools);

    expect(limited).toHaveLength(MAX_PROVIDER_TOOLS);
    expect(limited.map((tool) => tool.name)).toContain("tool-search");
    expect(limited.map((tool) => tool.name)).not.toContain("tool-127");
  });
});
