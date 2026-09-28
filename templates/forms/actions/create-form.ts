import { defineAction, embedApp, fail } from "@agent-native/core";
import { buildDeepLink, getAppProductionUrl } from "@agent-native/core/server";
import {
  getRequestUserEmail,
  getRequestOrgId,
} from "@agent-native/core/server/request-context";
import { track } from "@agent-native/core/tracking";
import { customAlphabet } from "nanoid";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { assertIntegrationUrlsAllowed } from "../server/lib/integrations.js";
import {
  assertValidFields,
  normalizeFieldIds,
} from "../server/lib/validate-fields.js";
import { formFieldSchema } from "../shared/field-schema.js";
import {
  assertValidFormCompletionSettings,
  FORM_SETTINGS_KEYS,
  type FormField,
  type FormSettings,
} from "../shared/types.js";
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
    "Create a draft or published form. Use this for every request that describes a form to build, including when another form is already open in <current-screen> or was created earlier in this conversation: each form the user describes is its own form. Set settings.completionMode to message, redirect, message_then_refresh, or refresh; use settings.completionRefreshSeconds for the message_then_refresh delay. Set settings.anonymous=true to suppress submitter IP, identity, and source metadata, or settings.emailOnNewResponses=true to email the form owner when responses arrive. Published results include a canonical publicUrl; copy it verbatim (it includes /f/<slug>) instead of deriving a URL from slug. Drafts return an editor URL.",
  schema: z.object({
    title: z.string().optional().describe("Form title"),
    description: z.string().optional().describe("Form description"),
    fields: z
      .array(formFieldSchema)
      .optional()
      .describe(
        "Array of complete field objects (a JSON string of the same array is also accepted). Each field property's meaning depends on its `type` — see the field schema's own per-property descriptions. Never use shorthand strings such as 'text: Enter a name'.",
      ),
    settings: z
      .record(z.string(), z.any())
      .optional()
      .describe(
        `Form settings object (a JSON string of the same object is also accepted). Valid settings: ${FORM_SETTINGS_KEYS.join(", ")}. Set completionMode to message, redirect, message_then_refresh, or refresh. Use completionRefreshSeconds with message_then_refresh. Set anonymous=true for strict no-IP, no-identity, no-source-metadata responses.`,
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
  run: async (args, ctx) => {
    const id = nanoid(10);
    const now = new Date().toISOString();
    const title = args.title || "Untitled Form";
    const slug = args.slug || slugify(title) + "-" + id.slice(0, 6);

    const fields = normalizeFieldIds(
      (args.fields ?? []) as unknown as FormField[],
    ) as FormField[];
    assertValidFields(fields);

    const defaultSettings: FormSettings = {
      submitText: "Submit",
      successMessage: "Thank you! Your response has been recorded.",
      showProgressBar: false,
      emailOnNewResponses: false,
    };

    const incomingSettings = (args.settings ?? {}) as unknown as FormSettings;
    assertValidFormCompletionSettings(incomingSettings);
    const settings = { ...defaultSettings, ...incomingSettings };
    assertIntegrationUrlsAllowed(settings);

    const ownerEmail = getRequestUserEmail();
    if (!ownerEmail)
      fail("no authenticated user", {
        errorCode: "not_authenticated",
        statusCode: 401,
      });
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

    const editorUrl = formDeepLink(id);
    const publicUrl =
      status === "published"
        ? `${getAppProductionUrl()}/f/${encodeURIComponent(slug)}`
        : undefined;

    track(
      "form_created",
      {
        app_name: "forms",
        template_name: "forms",
        output_id: id,
        output_type: "form",
        field_count: fields.length,
      },
      ctx,
    );
    if (status === "published") {
      track(
        "form_published",
        {
          app_name: "forms",
          template_name: "forms",
          output_id: id,
          output_type: "form",
          public_url: publicUrl,
        },
        ctx,
      );
    }

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
