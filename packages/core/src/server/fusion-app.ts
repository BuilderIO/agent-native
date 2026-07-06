/**
 * fusion-app — server helpers for driving the Builder Fusion app-building
 * backend (ai-services) from agent-native apps.
 *
 * Fusion projects/branches are full running apps: a cloud container runs the
 * dev server (preview URL) and an in-container coding agent applies edits.
 * These helpers cover the lifecycle an app template needs:
 *
 * - `ensureFusionContainer`     — boot/attach the branch container, resolve the
 *                                 iframe-able dev-server preview URL.
 * - `sendFusionBranchMessage`   — send a prompt to the branch's coding agent
 *                                 (fire-and-forget by default so callers stay
 *                                 within hosted action budgets).
 * - `pushFusionBranch`          — push the branch's code to its git remote.
 * - `reserveFusionHostingSlug`  — reserve a `<slug>.builder.cloud` hosting slug.
 * - `deployFusionProject`       — trigger a hosted deploy of the project.
 * - `getFusionDeploys`          — list deploys (poll deploy status).
 *
 * All calls authenticate the same way as `runBuilderAgent`: the Builder
 * private key as a bearer token plus the space/public key as the `apiKey`
 * query param, resolved through the shared credential provider.
 *
 * Endpoints match ai-services `packages/service/main.ts`; streaming endpoints
 * respond with newline-delimited JSON over chunked HTTP.
 */

import { getBuilderApiHost, getBuilderAppHost } from "./builder-browser.js";

export interface FusionBranchRef {
  projectId: string;
  branchName: string;
}

export interface EnsureFusionContainerResult {
  /**
   * `ready` — container is up; `url` is the dev-server preview URL.
   * `provisioning` — still booting when the time budget ran out; callers
   * should poll again.
   * `error` — the backend reported a failure.
   */
  status: "ready" | "provisioning" | "error";
  url?: string;
  /** Last human-readable progress/error message seen on the stream. */
  message?: string;
}

export interface SendFusionMessageResult {
  sent: boolean;
  /** Final agent text when the call waited for completion. */
  response?: string;
  error?: string;
}

async function resolveFusionAuth(): Promise<{
  privateKey: string;
  publicKey: string;
  userId: string | null;
}> {
  const { resolveBuilderCredentials } =
    await import("./credential-provider.js");
  const creds = await resolveBuilderCredentials();
  if (!creds.privateKey || !creds.publicKey) {
    throw new Error("Builder keys are not configured");
  }
  return {
    privateKey: creds.privateKey,
    publicKey: creds.publicKey,
    userId: creds.userId,
  };
}

function fusionUrl(
  path: string,
  auth: { publicKey: string; userId: string | null },
  params?: Record<string, string>,
): URL {
  const url = new URL(path, getBuilderApiHost());
  url.searchParams.set("apiKey", auth.publicKey);
  if (auth.userId) url.searchParams.set("userId", auth.userId);
  for (const [key, value] of Object.entries(params ?? {})) {
    url.searchParams.set(key, value);
  }
  return url;
}

/** The Builder visual-editor URL for a fusion branch. */
export function getFusionBranchEditorUrl(ref: FusionBranchRef): string {
  const host = getBuilderAppHost().replace(/\/+$/, "");
  return `${host}/app/projects/${encodeURIComponent(ref.projectId)}/${encodeURIComponent(ref.branchName)}`;
}

/** Public URL for a reserved fusion hosting slug. */
export function getFusionHostingUrl(slug: string): string {
  return `https://${slug}.builder.cloud`;
}

/**
 * Read an NDJSON response stream, invoking `onLine` per parsed JSON object.
 * Unparseable lines are skipped. Resolves when the stream ends or `onLine`
 * returns `true` (early stop).
 */
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
    // Release the connection; safe to call after the stream is exhausted.
    reader.cancel().catch(() => {});
  }
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

const DEFAULT_ENSURE_CONTAINER_TIMEOUT_MS = 25_000;

/**
 * Ensure the branch container is running and resolve its preview URL.
 *
 * Streams provisioning progress from `/projects/ensure-container`; resolves
 * `ready` + `url` from the terminal chunk. When the container is still booting
 * after `timeoutMs`, aborts the request and returns `provisioning` so callers
 * can poll again without blowing their run budget.
 */
export async function ensureFusionContainer(
  args: FusionBranchRef & { timeoutMs?: number },
): Promise<EnsureFusionContainerResult> {
  const auth = await resolveFusionAuth();
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
          Authorization: `Bearer ${auth.privateKey}`,
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

/**
 * Send a prompt to the fusion branch's in-container coding agent via
 * `/projects/branch/message`.
 *
 * Defaults to `fireAndForget: true`: the backend dispatches the message and
 * ends the stream without waiting for the agent turn, so this returns in
 * seconds. Pass `fireAndForget: false` (with a generous `timeoutMs`) to wait
 * for the turn and capture the agent's final text.
 */
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
  const auth = await resolveFusionAuth();
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
        Authorization: `Bearer ${auth.privateKey}`,
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
      // Timed out reading the stream. With fire-and-forget the dispatch has
      // already happened server-side once we saw any progress chunk.
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
  init: { method: "GET" | "POST" | "DELETE"; body?: Record<string, unknown> },
  params?: Record<string, string>,
): Promise<Record<string, unknown>> {
  const auth = await resolveFusionAuth();
  const response = await fetch(fusionUrl(path, auth, params), {
    method: init.method,
    headers: {
      Authorization: `Bearer ${auth.privateKey}`,
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

/**
 * Push the fusion branch's code to its git remote. Starts/attaches the
 * container if needed, then syncs with `canPush`.
 */
export async function pushFusionBranch(
  ref: FusionBranchRef,
): Promise<Record<string, unknown>> {
  return fusionJsonRequest("/projects/branch/push-to-remote", {
    method: "POST",
    body: { projectId: ref.projectId, branchName: ref.branchName },
  });
}

/** Reserve a hosting slug (`<slug>.builder.cloud`) for the project. */
export async function reserveFusionHostingSlug(args: {
  projectId: string;
  slug: string;
}): Promise<{ slug: string }> {
  const result = await fusionJsonRequest("/projects/hosting/reserve-slug", {
    method: "POST",
    body: { projectId: args.projectId, slug: args.slug },
  });
  const slug = asString(result.slug);
  if (!slug) throw new Error("Slug reservation returned no slug");
  return { slug };
}

/**
 * Trigger a hosted deploy for the project. Requires a reserved hosting slug.
 * Returns immediately; poll `getFusionDeploys` for progress
 * (`queued → building → uploading → deploying → live | failed | canceled`).
 */
export async function deployFusionProject(args: {
  projectId: string;
  checkoutBranch?: string;
}): Promise<{ deployId: string; status: string }> {
  const result = await fusionJsonRequest("/projects/deploy", {
    method: "POST",
    body: {
      projectId: args.projectId,
      ...(args.checkoutBranch ? { checkoutBranch: args.checkoutBranch } : {}),
    },
  });
  const deployId = asString(result.deployId);
  if (!deployId) throw new Error("Deploy did not return a deployId");
  return { deployId, status: asString(result.status) ?? "queued" };
}

/** List the project's deploys, optionally filtered to one deploy id. */
export async function getFusionDeploys(args: {
  projectId: string;
  deployId?: string;
}): Promise<Array<Record<string, unknown>>> {
  const result = await fusionJsonRequest(
    "/projects/deploys",
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
