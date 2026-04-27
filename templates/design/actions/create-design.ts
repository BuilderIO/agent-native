import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { nanoid } from "nanoid";
import { getDb, schema } from "../server/db/index.js";
import {
  getRequestUserEmail,
  getRequestOrgId,
} from "@agent-native/core/server/request-context";

export default defineAction({
  description:
    "Create a new design project. Returns the new design's ID, title, and project type.",
  schema: z.object({
    id: z.string().optional().describe("Optional ID (generated if omitted)"),
    title: z.string().describe("Design project title"),
    description: z
      .string()
      .optional()
      .describe("Short description of the design project"),
    projectType: z
      .enum(["prototype", "deck", "other"])
      .optional()
      .default("prototype")
      .describe("Type of design project"),
    designSystemId: z
      .string()
      .optional()
      .describe("Design system ID to link to this design"),
  }),
  run: async ({
    id: providedId,
    title,
    description,
    projectType,
    designSystemId,
  }) => {
    const db = getDb();
    const id = providedId ?? nanoid();
    const now = new Date().toISOString();
    const ownerEmail = getRequestUserEmail() ?? "local@localhost";
    const orgId = getRequestOrgId();

    await db.insert(schema.designs).values({
      id,
      title,
      description: description ?? null,
      projectType: projectType ?? "prototype",
      designSystemId: designSystemId ?? null,
      data: "{}",
      ownerEmail,
      orgId,
      createdAt: now,
      updatedAt: now,
    });

    return { id, title, projectType };
  },
});
