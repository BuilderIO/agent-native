import {
  defineAction,
  fail,
  type ActionRunContext,
} from "@agent-native/core/action";
import {
  getRequestUserEmail,
  readDeployCredentialEnv,
} from "@agent-native/core/server";
import { assertAccess } from "@agent-native/core/sharing";
import { and, eq, isNull, lt, or } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { isFormFileValue } from "../server/lib/file-upload-policy.js";
import type { FormField } from "../shared/types.js";

export const COMMUNITY_APP_FORM_SLUG = "community-app-submission";
export const COMMUNITY_APP_BUILDER_MODEL = "community-apps";
const BUILDER_WRITE_TIMEOUT_MS = 30_000;
const PROMOTION_CLAIM_LEASE_MS = 5 * 60_000;

type CommunityAppPayload = {
  name: string;
  slug: string;
  description: string;
  screenshots: string[];
  demoUrl: string;
  repositoryUrl?: string;
  status: "new";
};

type BuilderWriteResult =
  | { ok: true; entryId: string | null }
  | {
      ok: false;
      error: string;
      ambiguity?: "timeout" | "transport" | "provider";
      status: number;
    };

function safeHttpUrl(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const normalized = /^[a-z][a-z\d+.-]*:/i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
  if (!URL.canParse(normalized)) return null;
  const url = new URL(normalized);
  return (url.protocol === "http:" || url.protocol === "https:") &&
    !url.username &&
    !url.password
    ? url.href
    : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 56);
}

function hasActivePromotionClaim(promotedAt: string | null): boolean {
  if (!promotedAt) return false;
  const timestamp = Date.parse(promotedAt);
  return (
    Number.isFinite(timestamp) &&
    timestamp >= Date.now() - PROMOTION_CLAIM_LEASE_MS
  );
}

function fieldValue(
  data: Record<string, unknown>,
  fields: FormField[],
  ids: string[],
): unknown {
  for (const id of ids) {
    if (data[id] !== undefined) return data[id];
  }
  const normalizedIds = new Set(
    ids.map((id) => id.toLowerCase().replace(/[^a-z0-9]/g, "")),
  );
  const field = fields.find((candidate) => {
    const values = [candidate.id, candidate.label].map((value) =>
      value.toLowerCase().replace(/[^a-z0-9]/g, ""),
    );
    return values.some((value) => normalizedIds.has(value));
  });
  return field ? data[field.id] : undefined;
}

function parseJson(value: string, label: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    // coercion-ok: malformed persisted JSON is rejected by fail immediately below.
  }
  fail(`This submission has invalid saved ${label} data.`, {
    errorCode: "invalid_submission_data",
  });
}

function readSubmission(
  response: typeof schema.responses.$inferSelect,
  form: typeof schema.forms.$inferSelect,
): CommunityAppPayload {
  const parsedData = parseJson(response.data, "response");
  const parsedFields = parseJson(form.fields, "form fields");
  if (!isRecord(parsedData) || !Array.isArray(parsedFields)) {
    fail("This submission has invalid saved form data.", {
      errorCode: "invalid_submission_data",
    });
  }
  const data = parsedData;
  const formFields = parsedFields as FormField[];
  const name = stringValue(fieldValue(data, formFields, ["name", "app_name"]));
  const description = stringValue(
    fieldValue(data, formFields, ["description", "app_description"]),
  );
  const appUrl = safeHttpUrl(
    stringValue(fieldValue(data, formFields, ["app_url", "url", "demo_url"])),
  );
  const repositoryValue = stringValue(
    fieldValue(data, formFields, [
      "repository_url",
      "github_url",
      "repository",
    ]),
  );
  const repositoryUrl = repositoryValue ? safeHttpUrl(repositoryValue) : null;
  const rawScreenshots = fieldValue(data, formFields, [
    "screenshots",
    "screenshot",
  ]);
  const screenshotValues = Array.isArray(rawScreenshots)
    ? rawScreenshots
    : rawScreenshots
      ? [rawScreenshots]
      : [];
  const screenshots = screenshotValues.map((value) => {
    if (!isFormFileValue(value) || !value.id || !value.provider) return null;
    return safeHttpUrl(value.url);
  });

  if (!name) {
    fail("Add an app name before publishing this submission.", {
      errorCode: "invalid_submission",
    });
  }
  if (!description) {
    fail("Add a description before publishing this submission.", {
      errorCode: "invalid_submission",
    });
  }
  if (!appUrl) {
    fail("Add a valid app link before publishing this submission.", {
      errorCode: "invalid_submission",
    });
  }
  if (repositoryValue && !repositoryUrl) {
    fail("The repository link is not valid.", {
      errorCode: "invalid_submission",
    });
  }
  if (repositoryUrl) {
    const repository = new URL(repositoryUrl);
    const pathSegments = repository.pathname.split("/").filter(Boolean);
    if (
      !["github.com", "www.github.com"].includes(
        repository.hostname.toLowerCase(),
      ) ||
      pathSegments.length < 2
    ) {
      fail("The repository link must be a GitHub repository.", {
        errorCode: "invalid_submission",
      });
    }
  }
  if (screenshotValues.length > 5 || screenshots.some((url) => !url)) {
    fail("Each screenshot must be an uploaded image from the submission.", {
      errorCode: "invalid_submission",
    });
  }

  return {
    name,
    slug: `${slugify(name) || "community-app"}-${response.id.slice(0, 6).toLowerCase()}`,
    description,
    screenshots: screenshots as string[],
    demoUrl: appUrl,
    ...(repositoryUrl ? { repositoryUrl } : {}),
    status: "new",
  };
}

function builderEntryId(value: unknown): string | null {
  if (!isRecord(value)) return null;
  for (const key of ["id", "entryId", "uuid"]) {
    const direct = stringValue(value[key]);
    if (direct) return direct;
  }
  for (const key of ["entry", "result", "content", "data"]) {
    const nested = builderEntryId(value[key]);
    if (nested) return nested;
  }
  return null;
}

async function publishToBuilder(
  payload: CommunityAppPayload,
  fetchImpl: typeof fetch = fetch,
): Promise<BuilderWriteResult> {
  const privateKey = readDeployCredentialEnv("BUILDER_CMS_PRIVATE_KEY");
  if (!privateKey) {
    return {
      ok: false,
      status: 0,
      error: "Builder publishing is not configured for Forms.",
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    BUILDER_WRITE_TIMEOUT_MS,
  );
  try {
    const response = await fetchImpl(
      `https://builder.io/api/v1/write/${COMMUNITY_APP_BUILDER_MODEL}?triggerWebhooks=false`,
      {
        method: "POST",
        headers: {
          accept: "application/json",
          authorization: `Bearer ${privateKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          name: payload.name,
          modelId: COMMUNITY_APP_BUILDER_MODEL,
          published: "published",
          data: payload,
        }),
        signal: controller.signal,
      },
    );
    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        error:
          response.status >= 500
            ? "Builder returned an uncertain result. Check the Builder catalog before retrying."
            : "Builder rejected this submission. Check the community app model fields and try again.",
        ...(response.status >= 500 ? { ambiguity: "provider" as const } : {}),
      };
    }
    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      // coercion-ok: a successful status is the write result; the body is optional metadata.
    }
    return { ok: true, entryId: builderEntryId(body) };
  } catch {
    return {
      ok: false,
      status: 0,
      error: controller.signal.aborted
        ? "Builder publication timed out. Check the Builder catalog before retrying."
        : "Builder publication could not be reached. Check the Builder catalog before retrying.",
      ambiguity: controller.signal.aborted ? "timeout" : "transport",
    };
  } finally {
    clearTimeout(timeout);
  }
}

export default defineAction({
  description:
    "Publish a reviewed community app submission to Builder Publish CMS. Use this only for the community-app-submission form after reviewing its uploaded screenshots.",
  schema: z.object({
    responseId: z.string().min(1).describe("Response ID to publish"),
  }),
  run: async ({ responseId }, context?: ActionRunContext) => {
    const db = getDb();
    const [responseRef] = await db
      .select({ formId: schema.responses.formId })
      .from(schema.responses)
      .where(eq(schema.responses.id, responseId))
      .limit(1);
    if (!responseRef) {
      fail("That submission could not be found.", {
        errorCode: "response_not_found",
        statusCode: 404,
      });
    }

    await assertAccess("form", responseRef.formId, "admin");
    const [response] = await db
      .select()
      .from(schema.responses)
      .where(
        and(
          eq(schema.responses.id, responseId),
          eq(schema.responses.formId, responseRef.formId),
        ),
      )
      .limit(1);
    if (!response) {
      fail("That submission could not be found.", {
        errorCode: "response_not_found",
        statusCode: 404,
      });
    }

    const [form] = await db
      .select()
      .from(schema.forms)
      .where(eq(schema.forms.id, responseRef.formId))
      .limit(1);
    if (!form || form.slug !== COMMUNITY_APP_FORM_SLUG) {
      fail("This response is not a community app submission.", {
        errorCode: "wrong_form",
      });
    }

    if (response.promotionStatus === "published") {
      return {
        status: "published" as const,
        slug: response.communitySlug,
        builderContentId: response.builderContentId,
      };
    }
    if (
      response.promotionStatus === "unknown" ||
      (response.promotionStatus === "publishing" &&
        hasActivePromotionClaim(response.promotedAt))
    ) {
      fail(
        "This submission may already be in Builder. Check the catalog before retrying.",
        { errorCode: "promotion_unknown", statusCode: 409 },
      );
    }

    const payload = readSubmission(response, form);
    const now = new Date().toISOString();
    const promotedBy = context?.userEmail ?? getRequestUserEmail() ?? null;
    const claimed = await db
      .update(schema.responses)
      .set({
        promotionStatus: "publishing",
        promotionError: null,
        promotedAt: now,
        promotedBy,
      })
      .where(
        and(
          eq(schema.responses.id, response.id),
          eq(schema.responses.formId, response.formId),
          or(
            isNull(schema.responses.promotionStatus),
            eq(schema.responses.promotionStatus, "failed"),
            and(
              eq(schema.responses.promotionStatus, "publishing"),
              or(
                isNull(schema.responses.promotedAt),
                lt(
                  schema.responses.promotedAt,
                  new Date(Date.now() - PROMOTION_CLAIM_LEASE_MS).toISOString(),
                ),
              ),
            ),
          ),
        ),
      )
      .returning({ id: schema.responses.id });
    if (claimed.length === 0) {
      fail(
        "This submission is already being published or needs a Builder check before retrying.",
        { errorCode: "promotion_unknown", statusCode: 409 },
      );
    }

    const result = await publishToBuilder(payload);
    if (!result.ok) {
      const status = result.ambiguity ? "unknown" : "failed";
      await db
        .update(schema.responses)
        .set({
          promotionStatus: status,
          promotionError: result.error,
          promotedAt: new Date().toISOString(),
          promotedBy,
        })
        .where(eq(schema.responses.id, response.id));
      if (result.ambiguity) {
        fail(result.error, {
          errorCode: "promotion_unknown",
          statusCode: 503,
          details: { providerStatus: result.status },
        });
      }
      fail(result.error, {
        errorCode: "promotion_failed",
        statusCode: result.status >= 400 ? 502 : 503,
      });
    }

    const publishedAt = new Date().toISOString();
    try {
      await db
        .update(schema.responses)
        .set({
          promotionStatus: "published",
          builderContentId: result.entryId,
          communitySlug: payload.slug,
          promotionError: null,
          promotedAt: publishedAt,
          promotedBy,
        })
        .where(eq(schema.responses.id, response.id));
    } catch {
      try {
        await db
          .update(schema.responses)
          .set({
            promotionStatus: "unknown",
            promotionError:
              "Builder accepted this submission, but Forms could not save its publication state. Check Builder before retrying.",
            promotedAt: new Date().toISOString(),
            promotedBy,
          })
          .where(eq(schema.responses.id, response.id));
      } catch {
        // coercion-ok: the original database error is returned below; the UI treats publishing as needs-check.
      }
      fail(
        "Builder accepted this submission, but Forms could not save its publication state. Check Builder before retrying.",
        { errorCode: "promotion_unknown", statusCode: 503 },
      );
    }

    return {
      status: "published" as const,
      slug: payload.slug,
      builderContentId: result.entryId,
    };
  },
});

export { publishToBuilder, safeHttpUrl, slugify };
