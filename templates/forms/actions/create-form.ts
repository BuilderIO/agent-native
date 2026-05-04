import { defineAction } from "@agent-native/core";
import {
  getRequestUserEmail,
  getRequestOrgId,
} from "@agent-native/core/server/request-context";
import { customAlphabet } from "nanoid";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "../server/db/index.js";
import { assertIntegrationUrlsAllowed } from "../server/lib/integrations.js";
import type { FormField, FormSettings } from "../shared/types.js";

const nanoid = customAlphabet(
  "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ",
);

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}

export default defineAction({
  description: "Create a new form.",
  schema: z.object({
    title: z.string().optional().describe("Form title"),
    description: z.string().optional().describe("Form description"),
    // Accept either a JSON string (agent CLI / older callers) or an actual
    // array/object — the UI POSTs JSON bodies via useActionMutation, which
    // serializes the inputs directly.
    fields: z
      .union([z.string(), z.array(z.any())])
      .optional()
      .describe("Array of form fields (or JSON string of the same)"),
    settings: z
      .union([z.string(), z.record(z.string(), z.any())])
      .optional()
      .describe("Form settings object (or JSON string of the same)"),
    slug: z.string().optional().describe("Custom URL slug"),
    status: z
      .enum(["draft", "published", "closed"])
      .optional()
      .describe("Form status"),
  }),
  run: async (args) => {
    const id = nanoid(10);
    const now = new Date().toISOString();
    const title = args.title || "Untitled Form";
    const slug = args.slug || slugify(title) + "-" + id.slice(0, 6);

    let fields: FormField[] = [];
    if (args.fields) {
      if (typeof args.fields === "string") {
        try {
          fields = JSON.parse(args.fields);
        } catch {
          throw new Error("--fields must be valid JSON");
        }
      } else {
        fields = args.fields as unknown as FormField[];
      }
    }

    const defaultSettings: FormSettings = {
      submitText: "Submit",
      successMessage: "Thank you! Your response has been recorded.",
      showProgressBar: false,
    };

    let settings = defaultSettings;
    if (args.settings) {
      if (typeof args.settings === "string") {
        try {
          settings = JSON.parse(args.settings);
        } catch {
          throw new Error("--settings must be valid JSON");
        }
      } else {
        settings = args.settings as unknown as FormSettings;
      }
    }
    // Reject blocked integration URLs at save time. fireIntegrations also
    // re-checks at runtime as defense-in-depth.
    assertIntegrationUrlsAllowed(settings);

    const db = getDb();
    await db.insert(schema.forms).values({
      id,
      title,
      description: args.description || null,
      slug,
      fields: JSON.stringify(fields),
      settings: JSON.stringify(settings),
      status: args.status || "draft",
      createdAt: now,
      updatedAt: now,
      ownerEmail: (() => {
        const e = getRequestUserEmail();
        if (!e) throw new Error("no authenticated user");
        return e;
      })(),
      orgId: getRequestOrgId(),
    });

    const [row] = await db
      .select()
      .from(schema.forms)
      .where(eq(schema.forms.id, id))
      .limit(1);

    return {
      id: row!.id,
      title: row!.title,
      description: row!.description ?? undefined,
      slug: row!.slug,
      fields: JSON.parse(row!.fields) as FormField[],
      settings: JSON.parse(row!.settings) as FormSettings,
      status: row!.status,
      visibility: row!.visibility,
      ownerEmail: row!.ownerEmail,
      responseCount: 0,
      createdAt: row!.createdAt,
      updatedAt: row!.updatedAt,
    };
  },
});
