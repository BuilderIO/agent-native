
import { z } from "zod";

import { withBuilderUtmTrackingParams } from "../shared/builder-link-tracking.js";
import {
  builderReferralInfoSchema,
  type BuilderReferralInfo,
} from "../shared/builder-referrals.js";
import {
  resolveBuilderRequestAuthorization,
  type BuilderRequestAuthorization,
} from "./builder-api-auth.js";
import { getBuilderApiHost, getBuilderAppHost } from "./builder-browser.js";
import type { BuilderOAuthPermissionScope } from "./builder-oauth.js";

export interface FusionBranchRef {
  projectId: string;
  branchName: string;
}

export interface EnsureFusionContainerResult {
  status: "ready" | "provisioning" | "error";
  url?: string;
  message?: string;
}

export interface SendFusionMessageResult {
  sent: boolean;
  response?: string;
  error?: string;
}

async function resolveFusionAuth(
  requiredScope: BuilderOAuthPermissionScope,
): Promise<BuilderRequestAuthorization> {
  const authorization = await resolveBuilderRequestAuthorization({
    requiredScope,
  });
  if (!authorization) {
    throw new Error(
      "Builder.io is not connected. Connect Builder.io in Settings.",
    );
  }
  if (authorization.source === "legacy" && !authorization.legacyPublicKey) {
    throw new Error(
      "Builder legacy credentials require BUILDER_PUBLIC_KEY for this request.",
    );
  }
  return authorization;
}

function fusionUrl(
  path: string,
  authorization: BuilderRequestAuthorization,
  params?: Record<string, string>,
): URL {
  const url = new URL(path, getBuilderApiHost());
  if (authorization.legacyPublicKey) {
    url.searchParams.set("apiKey", authorization.legacyPublicKey);
    if (authorization.userId) {
      url.searchParams.set("userId", authorization.userId);
    }
  }
  for (const [key, value] of Object.entries(params ?? {})) {
    url.searchParams.set(key, value);
  }
  return url;
}

const builderCreditUsageSchema = z.object({
  plan: z.enum(["free", "paid"]),
  balance: z.number().finite().nonnegative(),
  quota: z.object({
    period: z.enum(["daily", "monthly"]),
    limit: z.number().finite().positive(),
    used: z.number().finite().nonnegative(),
    remaining: z.number().finite().nonnegative(),
  }),
});

export type BuilderCreditUsage = z.infer<typeof builderCreditUsageSchema>;

export async function getBuilderCreditUsage(): Promise<BuilderCreditUsage | null> {
  const authorization = await resolveBuilderRequestAuthorization({
    requiredScope: "builder:ai:invoke",
  });
  if (!authorization) return null;

  const response = await fetch(
    fusionUrl("/agent-native/credits/v1/usage", authorization),
    {
      headers: { Authorization: authorization.authorization },
      signal: AbortSignal.timeout(5000),
    },
  );
  if (!response.ok) {
    throw new Error(`Builder credit usage failed (${response.status}).`);
  }
  return builderCreditUsageSchema.parse(await response.json());
}

export async function getBuilderReferralInfo(): Promise<BuilderReferralInfo | null> {
  const authorization = await resolveBuilderRequestAuthorization({
    requiredScope: "builder:ai:invoke",
  });
  if (!authorization) return null;

  const response = await fetch(
    fusionUrl("/agent-native/credits/v1/referrals", authorization),
    {
      headers: { Authorization: authorization.authorization },
      signal: AbortSignal.timeout(5000),
    },
  );
  if (!response.ok) {
    throw new Error(`Builder referral info failed (${response.status}).`);
  }
  return builderReferralInfoSchema.parse(await response.json());
}

export function getFusionBranchEditorUrl(ref: FusionBranchRef): string {
  const host = getBuilderAppHost().replace(/\/+$/, "");
  return withBuilderUtmTrackingParams(
    `${host}/app/projects/${encodeURIComponent(ref.projectId)}/${encodeURIComponent(ref.branchName)}`,
    { campaign: "product", content: "fusion_editor" },
  );
}

export function getFusionHostingUrl(slug: string): string {
  return `https://${slug}.builder.cloud`;
}

async function readNdjsonStream(
  response: Response,
  onLine: (chunk: Record<string, unknown>) => boolean | undefined,
): Promise<void> {
  const body = response.body;
  if (!body) return;
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffered = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (value) buffered += decoder.decode(value, { stream: true });
      const lines = buffered.split("\n");
      buffered = done ? "" : (lines.pop() ?? "");
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        let parsed: unknown;
        try {
          parsed = JSON.parse(trimmed);
        } catch {
          continue;
        }
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          if (onLine(parsed as Record<string, unknown>)) return;
        }
      }
      if (done) return;
    }
  } finally {
    reader.cancel().catch(() => {});
  }
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

const DEFAULT_ENSURE_CONTAINER_TIMEOUT_MS = 25_000;

export async function ensureFusionContainer(
  args: FusionBranchRef & { timeoutMs?: number },
): Promise<EnsureFusionContainerResult> {
  const auth = await resolveFusionAuth("builder:projects:write");
  const controller = new AbortController();
  const timeoutMs = args.timeoutMs ?? DEFAULT_ENSURE_CONTAINER_TIMEOUT_MS;
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let readyUrl: string | undefined;
  let lastMessage: string | undefined;
  let errorMessage: string | undefined;

  try {
    const response = await fetch(
      fusionUrl("/projects/ensure-container", auth),
      {
        method: "POST",
        headers: {
          Authorization: auth.authorization,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          projectId: args.projectId,
          branchName: args.branchName,
        }),
        signal: controller.signal,
      },
    );
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      return {
        status: "error",
        message:
          text.slice(0, 500) || `ensure-container failed (${response.status})`,
      };
    }
    await readNdjsonStream(response, (chunk) => {
      const message = asString(chunk.message) ?? asString(chunk.error);
      if (message) lastMessage = message;
      const url = asString(chunk.url);
      if (url) readyUrl = url;
      const state = asString(chunk.state) ?? asString(chunk.type);
      if (state === "error" || state === "init-error") {
        errorMessage = message ?? "Container provisioning failed";
        return true;
      }
      if (state === "ready" && readyUrl) return true;
      return undefined;
    });
  } catch (error) {
    if (controller.signal.aborted) {
      return {
        status: readyUrl ? "ready" : "provisioning",
        url: readyUrl,
        message: lastMessage ?? "Container is still starting",
      };
    }
    return {
      status: "error",
      message: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timer);
  }

  if (errorMessage) return { status: "error", message: errorMessage };
  if (readyUrl) return { status: "ready", url: readyUrl, message: lastMessage };
  return { status: "provisioning", message: lastMessage };
}

const DEFAULT_SEND_MESSAGE_TIMEOUT_MS = 30_000;

export async function sendFusionBranchMessage(
  args: FusionBranchRef & {
    prompt: string;
    fireAndForget?: boolean;
    timeoutMs?: number;
    userEmail?: string;
  },
): Promise<SendFusionMessageResult> {
  const prompt = args.prompt?.trim();
  if (!prompt) throw new Error("prompt is required");
  const auth = await resolveFusionAuth("builder:projects:write");
  const fireAndForget = args.fireAndForget ?? true;
  const controller = new AbortController();
  const timeoutMs = args.timeoutMs ?? DEFAULT_SEND_MESSAGE_TIMEOUT_MS;
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let dispatched = false;
  let finalText: string | undefined;
  let errorMessage: string | undefined;

  try {
    const response = await fetch(fusionUrl("/projects/branch/message", auth), {
      method: "POST",
      headers: {
        Authorization: auth.authorization,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        projectId: args.projectId,
        branchName: args.branchName,
        fireAndForget,
        userMessage: {
          userPrompt: prompt,
          ...(auth.userId || args.userEmail
            ? {
                user: {
                  source: "agent-native",
                  role: "user",
                  ...(auth.userId ? { userId: auth.userId } : {}),
                  ...(args.userEmail ? { userEmail: args.userEmail } : {}),
                },
              }
            : {}),
        },
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      return {
        sent: false,
        error:
          text.slice(0, 500) || `branch message failed (${response.status})`,
      };
    }
    await readNdjsonStream(response, (chunk) => {
      const type = asString(chunk.type);
      if (type === "sending-message") dispatched = true;
      if (type === "error") {
        errorMessage =
          asString(chunk.error) ?? asString(chunk.message) ?? "Message failed";
        return true;
      }
      if (type === "ai") {
        dispatched = true;
        const event = chunk.event;
        if (event && typeof event === "object") {
          const ev = event as Record<string, unknown>;
          if (asString(ev.type) === "done" && Array.isArray(ev.actions)) {
            for (const action of ev.actions) {
              if (
                action &&
                typeof action === "object" &&
                (action as Record<string, unknown>).type === "text"
              ) {
                const content = asString(
                  (action as Record<string, unknown>).content,
                );
                if (content) finalText = content;
              }
            }
          }
        }
      }
      return undefined;
    });
  } catch (error) {
    if (controller.signal.aborted) {
      if (dispatched) return { sent: true };
      return {
        sent: false,
        error: "Timed out sending message to the app agent",
      };
    }
    return {
      sent: false,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timer);
  }

  if (errorMessage) return { sent: dispatched, error: errorMessage };
  return { sent: true, response: finalText };
}

async function fusionJsonRequest(
  path: string,
  requiredScope: BuilderOAuthPermissionScope,
  init: { method: "GET" | "POST" | "DELETE"; body?: Record<string, unknown> },
  params?: Record<string, string>,
): Promise<Record<string, unknown>> {
  const auth = await resolveFusionAuth(requiredScope);
  const response = await fetch(fusionUrl(path, auth, params), {
    method: init.method,
    headers: {
      Authorization: auth.authorization,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
    },
    ...(init.body ? { body: JSON.stringify(init.body) } : {}),
  });
  const text = await response.text().catch(() => "");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = undefined;
  }
  if (!response.ok) {
    const errorDetail =
      parsed && typeof parsed === "object"
        ? asString((parsed as Record<string, unknown>).error)
        : undefined;
    throw new Error(
      errorDetail ??
        `${path} failed (${response.status}): ${text.slice(0, 300)}`,
    );
  }
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    return parsed as Record<string, unknown>;
  }
  return {};
}

export async function pushFusionBranch(
  ref: FusionBranchRef,
): Promise<Record<string, unknown>> {
  return fusionJsonRequest(
    "/projects/branch/push-to-remote",
    "builder:projects:write",
    {
      method: "POST",
      body: { projectId: ref.projectId, branchName: ref.branchName },
    },
  );
}

export async function reserveFusionHostingSlug(args: {
  projectId: string;
  slug: string;
}): Promise<{ slug: string }> {
  const result = await fusionJsonRequest(
    "/projects/hosting/reserve-slug",
    "builder:projects:write",
    {
      method: "POST",
      body: { projectId: args.projectId, slug: args.slug },
    },
  );
  const slug = asString(result.slug);
  if (!slug) throw new Error("Slug reservation returned no slug");
  return { slug };
}

export async function deployFusionProject(args: {
  projectId: string;
  checkoutBranch?: string;
}): Promise<{ deployId: string; status: string }> {
  const result = await fusionJsonRequest(
    "/projects/deploy",
    "builder:projects:write",
    {
      method: "POST",
      body: {
        projectId: args.projectId,
        ...(args.checkoutBranch ? { checkoutBranch: args.checkoutBranch } : {}),
      },
    },
  );
  const deployId = asString(result.deployId);
  if (!deployId) throw new Error("Deploy did not return a deployId");
  return { deployId, status: asString(result.status) ?? "queued" };
}

export async function getFusionDeploys(args: {
  projectId: string;
  deployId?: string;
}): Promise<Array<Record<string, unknown>>> {
  const result = await fusionJsonRequest(
    "/projects/deploys",
    "builder:projects:read",
    { method: "GET" },
    {
      projectId: args.projectId,
      ...(args.deployId ? { deployId: args.deployId } : {}),
    },
  );
  const deploys = (result.deploys ?? result.data ?? result) as unknown;
  if (Array.isArray(deploys)) {
    return deploys.filter(
      (entry): entry is Record<string, unknown> =>
        !!entry && typeof entry === "object",
    );
  }
  return [];
}
