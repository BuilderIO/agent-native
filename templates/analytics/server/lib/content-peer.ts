import {
  invokeAgentAction,
  resolveA2ACallerAuth,
} from "@agent-native/core/a2a";
import { getAppConfig } from "@agent-native/core/server";
import { getBuiltinAgents } from "@agent-native/core/server/agent-discovery";
import { resolveLaneEndpoint } from "@agent-native/core/shared/environment-lanes";
import { z } from "zod";

const CITATIONS_TIMEOUT_MS = 15_000;

function hostnameOf(url: string | undefined): string | undefined {
  if (!url || !URL.canParse(url)) return undefined;
  return new URL(url).hostname;
}

function builtinContentUrl(): string | null {
  const content = getBuiltinAgents("analytics").find(
    (app) => app.id === "content",
  );
  if (!content?.url || !URL.canParse(content.url)) return null;
  return content.url.replace(/\/+$/, "");
}

export function resolveContentAppUrl(): string | null {
  const builtinUrl = builtinContentUrl();
  if (!builtinUrl) return null;
  return resolveLaneEndpoint(
    builtinUrl,
    hostnameOf(getAppConfig().app.url),
  ).replace(/\/+$/, "");
}

function contentTarget(): string {
  const builtinUrl = builtinContentUrl();
  const appUrl = resolveContentAppUrl();
  return appUrl && appUrl !== builtinUrl ? appUrl : "content";
}

const citationsSchema = z.object({
  pages: z
    .array(
      z.object({
        id: z.string().min(1).max(256),
        title: z.string().max(2_000),
        url: z.string().min(1).max(4_000),
        updatedAt: z.string().max(100),
      }),
    )
    .max(100),
  more: z.boolean(),
});

export interface CitingPage {
  id: string;
  title: string;
  url: string;
  updatedAt: string;
}

export type ContentCitationsResult =
  | { ok: true; pages: CitingPage[]; more: boolean }
  | {
      ok: false;
      code:
        | "content_signed_out"
        | "content_unreachable"
        | "content_refused"
        | "content_invalid_response";
    };

function pageLink(url: string, contentUrl: string | null): string | null {
  const base = contentUrl ?? undefined;
  if (!URL.canParse(url, base)) return null;
  const link = new URL(url, base);
  return link.protocol === "https:" || link.protocol === "http:"
    ? link.toString()
    : null;
}

export async function requestContentCitations(
  dashboardId: string,
): Promise<ContentCitationsResult> {
  const auth = await resolveA2ACallerAuth();
  if (!auth.userEmail) return { ok: false, code: "content_signed_out" };
  const action = "list-analytics-chart-citations";
  let response;
  try {
    response = await invokeAgentAction({
      target: contentTarget(),
      selfAppId: "analytics",
      action,
      input: { dashboardId },
      userEmail: auth.userEmail,
      ...(auth.orgDomain !== undefined ? { orgDomain: auth.orgDomain } : {}),
      ...(auth.orgSecret !== undefined ? { orgSecret: auth.orgSecret } : {}),
      requestTimeoutMs: CITATIONS_TIMEOUT_MS,
    });
  } catch (error) {
    console.warn("[analytics-content] Content request failed", {
      action,
      error: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, code: "content_unreachable" };
  }
  if (response.result.status !== "completed") {
    console.warn("[analytics-content] Content refused the request", {
      action,
      status: response.result.status,
    });
    return { ok: false, code: "content_refused" };
  }
  const invalid = { ok: false, code: "content_invalid_response" } as const;
  let output: unknown;
  try {
    output = JSON.parse(response.result.output);
  } catch {
    console.warn(
      "[analytics-content] Content answered with text that isn't JSON",
      {
        action,
        chars: response.result.output.length,
      },
    );
    return invalid;
  }
  const parsed = citationsSchema.safeParse(output);
  if (!parsed.success) {
    console.warn(
      "[analytics-content] Content answered in a shape Analytics can't read",
      {
        action,
        issues: parsed.error.issues
          .slice(0, 5)
          .map((issue) => `${issue.path.join(".")}: ${issue.message}`),
      },
    );
    return invalid;
  }
  const contentUrl = resolveContentAppUrl();
  const pages: CitingPage[] = [];
  for (const page of parsed.data.pages) {
    const url = pageLink(page.url, contentUrl);
    if (!url) {
      console.warn(
        "[analytics-content] Content sent a page link that doesn't open",
        {
          action,
          chars: page.url.length,
        },
      );
      return invalid;
    }
    pages.push({ ...page, url });
  }
  return { ok: true, pages, more: parsed.data.more };
}
