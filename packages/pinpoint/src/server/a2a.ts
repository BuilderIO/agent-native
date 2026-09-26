
import type { Application } from "express";

import { FileStore } from "../storage/file-store.js";
import { PinSchema } from "../storage/schemas.js";

interface A2ASkill {
  id: string;
  name: string;
  description: string;
}

interface A2AConfig {
  name: string;
  description: string;
  skills: A2ASkill[];
  handler: (message: any, context: any) => Promise<any>;
}

export function registerPinpointA2A(
  app: Application,
  options: { dataDir?: string } = {},
): void {
  const store = new FileStore(options.dataDir || "data/pins");

  const config: A2AConfig = {
    name: "pinpoint",
    description: "Visual feedback and annotation tool for web applications",
    skills: [
      {
        id: "get-annotations",
        name: "Get Pins",
        description: "Retrieve visual feedback annotations",
      },
      {
        id: "resolve-annotation",
        name: "Resolve Pin",
        description: "Mark an annotation as resolved",
      },
      {
        id: "create-annotation",
        name: "Create Pin",
        description: "Create a new annotation programmatically",
      },
    ],
    handler: async (message, _context) => {
      const { method, params } = message;

      switch (method) {
        case "get-annotations": {
          const pins = await store.list(params);
          return { result: pins };
        }
        case "resolve-annotation": {
          await store.update(params.id, {
            status: {
              state: "resolved",
              changedAt: new Date().toISOString(),
              changedBy: "agent",
            },
          });
          return { result: { ok: true } };
        }
        case "create-annotation": {
          const validated = PinSchema.safeParse(params?.pin);
          if (!validated.success) {
            return { error: { code: -32602, message: "Invalid pin data" } };
          }
          await store.save(validated.data as any);
          return { result: { ok: true } };
        }
        default:
          return { error: { code: -32601, message: "Method not found" } };
      }
    },
  };

  try {
    const { enableA2A } = require("@agent-native/core/a2a");
    enableA2A(app, config);
  } catch {
    app.get("/.well-known/agent-card.json", (_req, res) => {
      res.json({
        name: config.name,
        description: config.description,
        skills: config.skills,
        url: "/a2a/pinpoint",
      });
    });

    app.post("/a2a/pinpoint", async (req, res) => {
      try {
        const result = await config.handler(req.body, {});
        res.json(result);
      } catch (err) {
        res.status(500).json({ error: "A2A handler error" });
      }
    });
  }
}
