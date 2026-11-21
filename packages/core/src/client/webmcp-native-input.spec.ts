import { expect, it, vi } from "vitest";

import { createAgentNativeWebMcpClient } from "./webmcp.js";

it("passes object input to native WebMCP", async () => {
  const tool = { name: "get-order", description: "Read an order" };
  const executeTool = vi.fn(async () => "ok");
  const client = createAgentNativeWebMcpClient({
    document: {
      modelContext: {
        registerTool: vi.fn(),
        getTools: vi.fn(async () => [tool]),
        executeTool,
      },
    } as unknown as Document,
  });

  await client.executeTool({ name: "get-order" }, { id: "order-1" });
  expect(executeTool).toHaveBeenCalledWith(tool, { id: "order-1" }, {});
});
