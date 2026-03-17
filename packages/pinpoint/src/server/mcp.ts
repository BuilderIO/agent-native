// @agent-native/pinpoint — MCP server for pin tools
// MIT License

import { FileStore } from "../storage/file-store.js";

/**
 * Create MCP tool handlers for Pinpoint.
 * These can be registered with an MCP server instance.
 *
 * ```ts
 * import { Server } from '@modelcontextprotocol/sdk/server/index.js';
 * import { createPinpointMCPTools } from '@agent-native/pinpoint/server';
 *
 * const server = new Server({ name: 'pinpoint', version: '1.0.0' }, { capabilities: { tools: {} } });
 * const tools = createPinpointMCPTools();
 * // Register tools with server...
 * ```
 */
export function createPinpointMCPTools(options: { dataDir?: string } = {}) {
  const store = new FileStore(options.dataDir || "data/pins");

  return {
    tools: [
      {
        name: "get_annotations",
        description: "Get visual feedback annotations from the page",
        inputSchema: {
          type: "object" as const,
          properties: {
            pageUrl: {
              type: "string",
              description: "Filter by page URL",
            },
            status: {
              type: "string",
              enum: ["open", "acknowledged", "resolved", "dismissed"],
              description: "Filter by status",
            },
          },
        },
      },
      {
        name: "resolve_annotation",
        description: "Mark an annotation as resolved",
        inputSchema: {
          type: "object" as const,
          properties: {
            id: {
              type: "string",
              description: "The annotation ID to resolve",
            },
            message: {
              type: "string",
              description: "Optional resolution message",
            },
          },
          required: ["id"],
        },
      },
      {
        name: "create_annotation",
        description: "Create a new annotation on a page element",
        inputSchema: {
          type: "object" as const,
          properties: {
            pageUrl: {
              type: "string",
              description: "The page URL",
            },
            selector: {
              type: "string",
              description: "CSS selector of the element",
            },
            comment: {
              type: "string",
              description: "The annotation comment",
            },
          },
          required: ["pageUrl", "selector", "comment"],
        },
      },
      {
        name: "delete_annotation",
        description: "Delete an annotation",
        inputSchema: {
          type: "object" as const,
          properties: {
            id: {
              type: "string",
              description: "The annotation ID to delete",
            },
          },
          required: ["id"],
        },
      },
    ],

    async handleTool(
      name: string,
      args: Record<string, any>,
    ): Promise<{ content: Array<{ type: string; text: string }> }> {
      switch (name) {
        case "get_annotations": {
          const pins = await store.list({
            pageUrl: args.pageUrl,
            status: args.status,
          });
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(pins, null, 2),
              },
            ],
          };
        }

        case "resolve_annotation": {
          await store.update(args.id, {
            status: {
              state: "resolved",
              changedAt: new Date().toISOString(),
              changedBy: "agent",
            },
          });
          return {
            content: [{ type: "text", text: `Resolved annotation ${args.id}` }],
          };
        }

        case "create_annotation": {
          const { randomUUID } = await import("crypto");
          const now = new Date().toISOString();
          const pin = {
            id: randomUUID(),
            pageUrl: args.pageUrl,
            createdAt: now,
            updatedAt: now,
            comment: args.comment,
            element: {
              tagName: "unknown",
              classNames: [],
              selector: args.selector,
              boundingRect: { x: 0, y: 0, width: 0, height: 0 },
            },
            status: {
              state: "open" as const,
              changedAt: now,
              changedBy: "agent",
            },
          };
          await store.save(pin as any);
          return {
            content: [
              {
                type: "text",
                text: `Created annotation ${pin.id} on ${args.selector}`,
              },
            ],
          };
        }

        case "delete_annotation": {
          await store.delete(args.id);
          return {
            content: [{ type: "text", text: `Deleted annotation ${args.id}` }],
          };
        }

        default:
          return {
            content: [{ type: "text", text: `Unknown tool: ${name}` }],
          };
      }
    },
  };
}
