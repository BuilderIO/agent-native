import {
  A2AClient,
  buildAgentInvocationPrompt,
  resolveA2ACallerAuth,
  resolveAgentInvocationTarget,
  signA2AToken,
  type A2ACallerAuth,
  type Task,
} from "@agent-native/core/a2a";

/**
 * Slides never calls an image-generation API itself when the Assets app is
 * reachable: Assets owns brand libraries, presets, provenance, and the
 * generation audit log, so improvements there have to reach decks for free.
 * The direct Gemini/OpenAI providers under `server/handlers/image-providers`
 * are a standalone-deploy fallback only.
 */
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
}

/**
 * `pending` is deliberately distinct from `unavailable`: the Assets run is
 * still going and owns a `taskId`, so generating locally would duplicate work
 * that is about to succeed.
 */
export type AssetsImageDelegation =
  | { status: "delegated"; reply: string; target: string }
  | { status: "pending"; taskId: string; target: string; lastState: string }
  | { status: "rejected"; reason: string; state: string; target: string }
  | { status: "unavailable"; reason: string };

/** Strip HTML tags to extract plain text from slide content. */
export function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/&#x[0-9a-f]+;/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Single resolver for the Assets A2A endpoint override. Deploys that mount
 * both apps resolve Assets through agent discovery instead, so this stays
 * empty in the normal case.
 */
function resolveAssetsUrlOverride(): string {
  return (
    process.env.IMAGES_A2A_URL ||
    process.env.AGENT_NATIVE_IMAGES_URL ||
    ""
  ).trim();
}

/** Single resolver for the standalone-deploy Assets A2A key override. */
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

  return (
    `Generate ${request.count ?? 1} brand-consistent image candidate(s) ` +
    `for an agent-native slides deck.\n\n` +
    `Prompt: ${request.prompt}\n` +
    `Aspect ratio: ${request.aspectRatio ?? "16:9"}\n` +
    (hints.length ? `Slide context: ${hints.join(", ")}\n` : "") +
    `\nPick the best matching library via match-library if no libraryId is ` +
    `obvious, then generate with generate-image-batch. Return assetId, runId, ` +
    `previewUrl, and downloadUrl verbatim so the slides agent can drop them ` +
    `into the slide HTML. Set source: "a2a" and callerAppId: "slides" so the ` +
    `Assets audit log groups these generations.`
  );
}

/** Receivers derive their expected audience from their origin, not their path. */
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

function taskText(task: Task): string {
  const parts = task.status.message?.parts ?? [];
  return parts
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join("\n");
}

/**
 * Delegate image generation to the Assets app over A2A.
 *
 * Uses `A2AClient` rather than `callAgent`/`invokeAgent` on purpose: those
 * flatten the task to its status text, so a `failed` run is indistinguishable
 * from a completed one and a caller-side timeout looks like a finished
 * generation. Callers here must be able to tell those apart.
 */
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
        timeoutMs: DELEGATION_TIMEOUT_MS,
      },
    );

    if (task.status.state === "completed") {
      return { status: "delegated", reply: taskText(task), target: targetUrl };
    }
    // failed / canceled / input-required all mean no usable image came back.
    // Say which, rather than passing the status text off as a generation.
    return {
      status: "rejected",
      reason: taskText(task) || `Assets run ended as "${task.status.state}"`,
      state: task.status.state,
      target: targetUrl,
    };
  } catch (err) {
    // A caller-side timeout does NOT cancel the Assets run: it keeps
    // generating and may still succeed, so report it as pending instead of
    // starting a duplicate local generation.
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
    console.warn(
      `[slides/image-generation] Assets delegation to "${targetUrl}" failed: ${reason}`,
    );
    return { status: "unavailable", reason };
  }
}

/**
 * Pull the first hosted image URL out of an Assets reply. Assets is instructed
 * to return `previewUrl`/`downloadUrl` verbatim; when neither is present the
 * caller must surface the raw reply rather than guess at a URL.
 */
export function extractAssetUrl(reply: string): string | null {
  // Assets phrases these keys as JSON, `key: value`, or prose, so take the
  // first URL that follows the key rather than requiring one delimiter.
  const keyIndex = reply.search(/previewUrl|downloadUrl/i);
  if (keyIndex >= 0) {
    const afterKey = reply.slice(keyIndex).match(/https:\/\/[^\s"'<>)\]]+/);
    const url = normalizeUrl(afterKey?.[0]);
    if (url) return url;
  }
  const markdown = reply.match(/!\[[^\]]*\]\((https:\/\/[^\s)]+)\)/);
  return normalizeUrl(markdown?.[1]);
}

/**
 * Chat renders `![]()` as an image but `[]()` as a bare link, and an agent
 * that only links the result leaves the user with nothing to look at. Handing
 * back the finished markdown is more reliable than asking the model to
 * remember the syntax.
 */
export function imagePreviewMarkdown(prompt: string, url: string): string {
  const alt = prompt.replace(/[[\]]/g, "").slice(0, 80).trim();
  return `![${alt || "Generated image"}](${url})`;
}

/**
 * Replies are agent prose, so a URL often ends a sentence: keep the trailing
 * punctuation out of the `<img src>`.
 */
function normalizeUrl(candidate: string | undefined): string | null {
  if (!candidate) return null;
  const trimmed = candidate.replace(/[.,;:!?]+$/, "");
  try {
    return new URL(trimmed).toString();
  } catch {
    return null;
  }
}
