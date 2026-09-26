import { createHash, randomUUID } from "node:crypto";

import {
  A2AClient,
  buildAgentInvocationPrompt,
  resolveA2ACallerAuth,
  resolveAgentInvocationTarget,
  signA2AToken,
  type A2ACallerAuth,
  type Task,
} from "@agent-native/core/a2a";

import { normalizeReferenceUrls } from "../../shared/api.js";

const ASSETS_AGENT_TARGET = "assets";
const SELF_APP_ID = "slides";
const DELEGATION_TIMEOUT_MS = 240_000;

export interface AssetsImageRequest {
  prompt: string;
  count?: number;
  aspectRatio?: string;
  deckId?: string;
  slideId?: string;
  slideContent?: string;
  referenceImageUrls?: string[];
  submissionId?: string;
}

export type AssetsImageDelegation =
  | { status: "delegated"; reply: string; target: string }
  | { status: "pending"; taskId: string; target: string; lastState: string }
  | { status: "rejected"; reason: string; state: string; target: string }
  | { status: "unavailable"; reason: string };

export function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/&#x[0-9a-f]+;/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function resolveAssetsUrlOverride(): string {
  return (
    process.env.IMAGES_A2A_URL ||
    process.env.AGENT_NATIVE_IMAGES_URL ||
    ""
  ).trim();
}

function resolveAssetsKeyOverride(): string {
  return (
    process.env.IMAGES_A2A_KEY ||
    process.env.AGENT_NATIVE_IMAGES_KEY ||
    ""
  ).trim();
}

function buildDelegationMessage(request: AssetsImageRequest): string {
  const hints: string[] = [];
  if (request.deckId) hints.push(`deckId: ${request.deckId}`);
  if (request.slideId) hints.push(`slideId: ${request.slideId}`);
  if (request.slideContent) {
    hints.push(
      `slideContent: ${stripHtml(request.slideContent).slice(0, 280)}`,
    );
  }

  const references = normalizeReferenceUrls(request.referenceImageUrls);

  return (
    `Generate ${request.count ?? 1} brand-consistent image candidate(s) ` +
    `for an agent-native slides deck.\n\n` +
    `Prompt: ${request.prompt}\n` +
    `Aspect ratio: ${request.aspectRatio ?? "16:9"}\n` +
    (hints.length ? `Slide context: ${hints.join(", ")}\n` : "") +
    (references.length
      ? `Condition the generation on these referenceImageUrls: ` +
        `${references.join(", ")}\n`
      : "") +
    `\nPick the best matching library via match-library if no libraryId is ` +
    `obvious, then generate with generate-image-batch. Return id (the asset ` +
    `ID), runId, ` +
    `previewUrl, and downloadUrl verbatim so the slides agent can drop them ` +
    `into the slide HTML. Set source: "a2a" and callerAppId: "slides" so the ` +
    `Assets audit log groups these generations.`
  );
}

function agentAudience(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return url;
  }
}

/**
 * Mirrors the tokens `callAgent` mints internally: audience-bound and carrying
 * the caller identity, global secret first then org secret. `resolveA2ACallerAuth`
 * signs without an audience, so its tokens are kept only as later attempts. The
 * static override goes last because it authenticates the transport but carries
 * no user identity, and preferring it would cost Assets its access scoping.
 */
async function buildCallerTokens(
  targetUrl: string,
  auth: A2ACallerAuth,
): Promise<string[]> {
  const audience = agentAudience(targetUrl);
  const tokens: string[] = [];
  const add = (token: string | undefined) => {
    if (token && !tokens.includes(token)) tokens.push(token);
  };

  if (auth.userEmail && (auth.orgSecret || process.env.A2A_SECRET)) {
    for (const preferGlobalSecret of [true, false]) {
      if (preferGlobalSecret && !process.env.A2A_SECRET?.trim()) continue;
      if (!preferGlobalSecret && !auth.orgSecret) continue;
      try {
        add(
          await signA2AToken(auth.userEmail, auth.orgDomain, auth.orgSecret, {
            preferGlobalSecret,
            audience,
          }),
        );
      } catch {
        // Try the next signing strategy.
      }
    }
  }

  add(auth.apiKey);
  for (const fallback of auth.apiKeyFallbacks ?? []) add(fallback);
  add(resolveAssetsKeyOverride());
  return tokens;
}

function delegationIdempotencyKey(
  request: AssetsImageRequest,
  userEmail: string | undefined,
): string {
  const payload = JSON.stringify({
    ...request,
    userEmail,
    submissionId: request.submissionId ?? randomUUID(),
  });
  const digest = createHash("sha256").update(payload).digest("hex");
  return "slides-" + digest.slice(0, 32);
}

function taskText(task: Task): string {
  const parts = task.status.message?.parts ?? [];
  return parts
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join("\n");
}

export async function delegateImageGenerationToAssets(
  request: AssetsImageRequest,
): Promise<AssetsImageDelegation> {
  const requestedTarget = resolveAssetsUrlOverride() || ASSETS_AGENT_TARGET;

  let targetUrl: string;
  try {
    const resolved = await resolveAgentInvocationTarget(requestedTarget, {
      selfAppId: SELF_APP_ID,
    });
    targetUrl = resolved.url;
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.warn(
      `[slides/image-generation] Could not resolve Assets ("${requestedTarget}"): ${reason}`,
    );
    return { status: "unavailable", reason };
  }

  try {
    const auth = await resolveA2ACallerAuth();
    const tokens = await buildCallerTokens(targetUrl, auth);
    const client = new A2AClient(targetUrl, tokens[0], {
      fallbackApiKeys: tokens.slice(1),
    });

    const task = await client.sendAndWait(
      {
        role: "user",
        parts: [
          {
            type: "text",
            text: buildAgentInvocationPrompt(
              buildDelegationMessage(request),
              targetUrl,
            ),
          },
        ],
      },
      {
        metadata: {
          ...(auth.userEmail ? { userEmail: auth.userEmail } : {}),
          ...(auth.orgDomain ? { orgDomain: auth.orgDomain } : {}),
        },
        idempotencyKey: delegationIdempotencyKey(request, auth.userEmail),
        timeoutMs: DELEGATION_TIMEOUT_MS,
      },
    );

    if (task.status.state === "completed") {
      return { status: "delegated", reply: taskText(task), target: targetUrl };
    }
    return {
      status: "rejected",
      reason: taskText(task) || `Assets run ended as "${task.status.state}"`,
      state: task.status.state,
      target: targetUrl,
    };
  } catch (err) {
    if (err && typeof err === "object" && "taskId" in err) {
      const timeout = err as { taskId: string; lastState?: string };
      return {
        status: "pending",
        taskId: timeout.taskId,
        target: targetUrl,
        lastState: timeout.lastState ?? "working",
      };
    }
    const reason = err instanceof Error ? err.message : String(err);
    if (isAuthRejection(reason)) {
      return {
        status: "rejected",
        reason,
        state: "unauthorized",
        target: targetUrl,
      };
    }
    console.warn(
      `[slides/image-generation] Assets delegation to "${targetUrl}" failed: ${reason}`,
    );
    return { status: "unavailable", reason };
  }
}

function isAuthRejection(message: string): boolean {
  return (
    /\((?:401|403)\)/.test(message) ||
    /verified, audience-bound user identity/i.test(message) ||
    /Invalid or expired A2A token|Invalid API key|Authentication required|Forbidden/i.test(
      message,
    )
  );
}

export interface AssetReplyImage {
  previewUrl?: string;
  downloadUrl?: string;
}

export interface AssetUrlOptions {
  prefer?: "preview" | "download";
  baseUrl?: string;
}

const ASSET_TOKEN_RE =
  /(previewUrl|downloadUrl)|(https:\/\/[^\s"'<>)\]]+|\/api\/assets\/[^\s"'<>)\]]+)/gi;

export function extractAssetImages(
  reply: string,
  baseUrl?: string,
): AssetReplyImage[] {
  const images: AssetReplyImage[] = [];
  let current: AssetReplyImage | undefined;
  let pendingKey: keyof AssetReplyImage | undefined;

  for (const match of reply.matchAll(ASSET_TOKEN_RE)) {
    if (match[1]) {
      pendingKey =
        match[1].toLowerCase() === "previewurl" ? "previewUrl" : "downloadUrl";
      continue;
    }
    const url = normalizeUrl(match[2], baseUrl);
    const key = pendingKey ?? "previewUrl";
    pendingKey = undefined;
    if (!url) continue;
    if (!current || current[key]) {
      current = {};
      images.push(current);
    }
    current[key] = url;
  }
  return images;
}

export function extractAssetUrls(
  reply: string,
  options: AssetUrlOptions = {},
): string[] {
  const urls: string[] = [];
  for (const image of extractAssetImages(reply, options.baseUrl)) {
    const url =
      options.prefer === "download"
        ? (image.downloadUrl ?? image.previewUrl)
        : (image.previewUrl ?? image.downloadUrl);
    if (url && !urls.includes(url)) urls.push(url);
  }
  return urls;
}

export function extractAssetUrl(
  reply: string,
  options: AssetUrlOptions = {},
): string | null {
  return extractAssetUrls(reply, options)[0] ?? null;
}

export function imagePreviewMarkdown(prompt: string, url: string): string {
  const alt = prompt.replace(/[[\]]/g, "").slice(0, 80).trim();
  return `![${alt || "Generated image"}](${url})`;
}

function normalizeUrl(
  candidate: string | undefined,
  baseUrl?: string,
): string | null {
  if (!candidate) return null;
  const trimmed = candidate.replace(/[.,;:!?]+$/, "");
  try {
    return new URL(trimmed, baseUrl || undefined).toString();
  } catch {
    return null;
  }
}
