import { defineAction, embedApp } from "@agent-native/core";
import { buildDeepLink } from "@agent-native/core/server";
import {
  getRequestUserEmail,
  getRequestOrgId,
} from "@agent-native/core/server/request-context";
import { customAlphabet } from "nanoid";
import { z } from "zod";
import { getDb, schema } from "../server/db/index.js";
import { assertIntegrationUrlsAllowed } from "../server/lib/integrations.js";
import { assertValidFields } from "../server/lib/validate-fields.js";
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

function formDeepLink(formId: string): string {
  return buildDeepLink({
    app: "forms",
    view: "form",
    to: `/forms/${encodeURIComponent(formId)}`,
    params: { formId },
  });
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
  mcpApp: {
    resource: embedApp({
      title: "Edit form",
      description:
        "Open the generated form in the real Forms editor so the user can edit fields, settings, publishing, and integrations.",
      iframeTitle: "Agent-Native Forms",
      openLabel: "Open in Forms",
      frameDomains: ["https:", "http://localhost:*", "http://127.0.0.1:*"],
      height: 900,
    }),
  },
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
    assertValidFields(fields);

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

    const ownerEmail = getRequestUserEmail();
    if (!ownerEmail) throw new Error("no authenticated user");
    const orgId = getRequestOrgId();
    const status = args.status || "draft";
    const description = args.description || null;
    const visibility = "private" as const;

    const db = getDb();
    await db.insert(schema.forms).values({
      id,
      title,
      description,
      slug,
      fields: JSON.stringify(fields),
      settings: JSON.stringify(settings),
      status,
      createdAt: now,
      updatedAt: now,
      ownerEmail,
      orgId,
      visibility,
    });

    // Return the values we just inserted rather than re-selecting. A
    // post-insert SELECT can come back empty under connection-pool routing
    // (Neon and similar pooled-Postgres setups occasionally route the read
    // to a replica that hasn't replicated the write yet), which then throws
    // a 500 even though the form was created successfully.
    return {
      id,
      title,
      description: description ?? undefined,
      slug,
      fields,
      settings,
      status,
      visibility,
      ownerEmail,
      responseCount: 0,
      createdAt: now,
      updatedAt: now,
    };
  },
  link: ({ result }) => {
    const id = (result as { id?: string } | null)?.id;
    if (!id) return null;
    return {
      url: formDeepLink(id),
      label: "Open form in Forms",
      view: "form",
    };
  },
});
