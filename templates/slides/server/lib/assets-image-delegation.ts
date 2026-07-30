import { invokeAgent, resolveA2ACallerAuth } from "@agent-native/core/a2a";

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

export type AssetsImageDelegation =
  | { status: "delegated"; reply: string; target: string }
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

/**
 * Delegate image generation to the Assets app over A2A.
 *
 * Returns `unavailable` (never a fabricated image) when Assets cannot be
 * reached, so callers can decide whether to use the local fallback provider
 * and report which path actually produced the image.
 */
export async function delegateImageGenerationToAssets(
  request: AssetsImageRequest,
): Promise<AssetsImageDelegation> {
  const urlOverride = resolveAssetsUrlOverride();
  const target = urlOverride || ASSETS_AGENT_TARGET;

  try {
    const auth = await resolveA2ACallerAuth();
    const keyOverride = resolveAssetsKeyOverride();
    const { responseText, target: resolved } = await invokeAgent({
      target,
      prompt: buildDelegationMessage(request),
      selfAppId: SELF_APP_ID,
      apiKey: keyOverride || auth.apiKey,
      userEmail: auth.userEmail,
      orgDomain: auth.orgDomain,
      orgSecret: auth.orgSecret,
      timeoutMs: DELEGATION_TIMEOUT_MS,
    });
    return { status: "delegated", reply: responseText, target: resolved.url };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.warn(
      `[slides/image-generation] Assets delegation to "${target}" failed: ${reason}`,
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
  const keyed = reply.match(
    /(?:previewUrl|downloadUrl)"?\s*[:=]\s*"?(https:\/\/[^\s"'<>)\]]+)/i,
  );
  if (keyed?.[1]) return keyed[1];

  const markdown = reply.match(/!\[[^\]]*\]\((https:\/\/[^\s)]+)\)/);
  if (markdown?.[1]) return markdown[1];

  return null;
}
