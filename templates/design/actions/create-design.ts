import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { nanoid } from "nanoid";
import { getDb, schema } from "../server/db/index.js";
import {
  getRequestUserEmail,
  getRequestOrgId,
} from "@agent-native/core/server/request-context";
import { assertAccess } from "@agent-native/core/sharing";

export default defineAction({
  description:
    "Create a new empty design project shell. This is not a renderable artifact by itself; call generate-design with at least one HTML/JSX file before reporting a design URL as ready.",
  schema: z.object({
    id: z.string().optional().describe("Optional ID (generated if omitted)"),
    title: z.string().describe("Design project title"),
    description: z
      .string()
      .optional()
      .describe("Short description of the design project"),
    projectType: z
      .enum(["prototype", "other"])
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
    const ownerEmail = getRequestUserEmail();
    if (!ownerEmail) throw new Error("no authenticated user");
    const orgId = getRequestOrgId();

    if (designSystemId) {
      await assertAccess("design-system", designSystemId, "viewer");
    }

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

    return {
      id,
      title,
      projectType,
      renderable: false,
      nextRequiredAction: "generate-design",
    };
  },
});
