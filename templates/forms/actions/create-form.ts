import { defineAction, embedApp } from "@agent-native/core";
import { buildDeepLink, getAppProductionUrl } from "@agent-native/core/server";
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
import { assertPublishableForm } from "./lib/assert-publishable-form.js";

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
    to: `/forms/${encodeURIComponent(formId)}?tab=edit`,
    params: { formId, tab: "edit" },
  });
}

export default defineAction({
  description:
    "Create a draft or published form. Set settings.anonymous=true to suppress submitter IP, identity, and source metadata. Published forms return a direct public response URL; drafts return an editor URL.",
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
      .describe(
        "Form settings object (or JSON string). Set anonymous=true for strict no-IP, no-identity, no-source-metadata responses.",
      ),
    slug: z.string().optional().describe("Custom URL slug"),
    status: z
      .enum(["draft", "published", "closed"])
      .optional()
      .describe("Form status"),
  }),
  mcpApp: {
    compactCatalog: true,
    resource: embedApp({
      title: "Edit form",
      description:
        "Open the generated form in the real Forms editor so the user can edit fields, settings, publishing, and integrations.",
      iframeTitle: "Agent-Native Forms",
      openLabel: "Open in Forms",
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
          settings = { ...defaultSettings, ...JSON.parse(args.settings) };
        } catch {
          throw new Error("--settings must be valid JSON");
        }
      } else {
        settings = {
          ...defaultSettings,
          ...(args.settings as unknown as FormSettings),
        };
      }
    }
    // Reject blocked integration URLs at save time. fireIntegrations also
    // re-checks at runtime as defense-in-depth.
    assertIntegrationUrlsAllowed(settings);

    const ownerEmail = getRequestUserEmail();
    if (!ownerEmail) throw new Error("no authenticated user");
    const orgId = getRequestOrgId();
    const status = args.status || "draft";
    if (status === "published") {
      assertPublishableForm(fields);
    }
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
    const editorUrl = formDeepLink(id);
    const publicUrl =
      status === "published"
        ? `${getAppProductionUrl()}/f/${encodeURIComponent(slug)}`
        : undefined;

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
      editorUrl,
      publicUrl,
    };
  },
  link: ({ result }) => {
    const created = result as {
      id?: string;
      slug?: string;
      status?: string;
      settings?: FormSettings;
      editorUrl?: string;
      publicUrl?: string;
    } | null;
    const id = created?.id;
    if (!id) return null;
    if (created?.status === "published" && created.slug) {
      if (!created.publicUrl) return null;
      return {
        url: created.publicUrl,
        label:
          created.settings?.anonymous === true
            ? "Open anonymous form"
            : "Open public form",
        view: "public-form",
      };
    }
    return {
      url: created?.editorUrl ?? formDeepLink(id),
      label: "Open form in Forms",
      view: "form",
    };
  },
});
