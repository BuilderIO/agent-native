import {
  AGENT_BACKGROUND_PROCESSOR_FIELD,
  AGENT_BACKGROUND_PROCESSOR_ROUTE,
  AGENT_BACKGROUND_PROCESSOR_ROUTE_FIELD,
  dispatchPathTargetsNetlifyBackgroundFunction,
  resolveDurableBackgroundDispatchPath,
  signScopedAgentAccessToken,
} from "@agent-native/core/server";

export type PostFinalizeJobKind = "seekable" | "transcript";

export const POST_FINALIZE_JOB_TOKEN_KIND = "clips-post-finalize-job";

const DISPATCH_SETTLE_MS = 250;

function normalizeBasePath(value: string | undefined): string {
  const normalized = (value ?? "").trim().replace(/^\/+|\/+$/g, "");
  return normalized ? `/${normalized}` : "";
}

function resolveWorkerUrl(pathname: string): string {
  const configuredOrigin =
    process.env.APP_URL ||
    process.env.URL ||
    process.env.DEPLOY_URL ||
    process.env.BETTER_AUTH_URL;
  const origin =
    configuredOrigin ||
    `http://localhost:${process.env.NITRO_PORT || process.env.PORT || "3000"}`;
  const url = new URL(origin);
  url.pathname = pathname;
  url.search = "";
  url.hash = "";
  return url.toString();
}

export function postFinalizeJobResourceId(
  recordingId: string,
  kind: PostFinalizeJobKind,
): string {
  return `${recordingId}:${kind}`;
}

export async function dispatchPostFinalizeJob(args: {
  recordingId: string;
  kind: PostFinalizeJobKind;
  delayMs?: number;
  retryAttempt?: number;
  regenerate?: boolean;
}): Promise<void> {
  const token = signScopedAgentAccessToken({
    resourceKind: POST_FINALIZE_JOB_TOKEN_KIND,
    resourceId: postFinalizeJobResourceId(args.recordingId, args.kind),
    ttlSeconds: 10 * 60,
  });
  const basePath = normalizeBasePath(
    process.env.VITE_APP_BASE_PATH || process.env.APP_BASE_PATH,
  );
  const processorRoute = `${basePath}/api/_agent-native-background/post-finalize-worker`;
  const dispatchPath = resolveDurableBackgroundDispatchPath(processorRoute);
  const workerUrl = resolveWorkerUrl(dispatchPath);
  const usesDurableBackground =
    dispatchPathTargetsNetlifyBackgroundFunction(dispatchPath);
  const body = JSON.stringify({
    ...args,
    token,
    ...(usesDurableBackground
      ? {
          [AGENT_BACKGROUND_PROCESSOR_FIELD]: AGENT_BACKGROUND_PROCESSOR_ROUTE,
          [AGENT_BACKGROUND_PROCESSOR_ROUTE_FIELD]: processorRoute,
        }
      : {}),
  });
  const post = (url: string) =>
    fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
  const dispatch = post(workerUrl).then(async (initialResponse) => {
    const response =
      usesDurableBackground && !initialResponse.ok
        ? await post(resolveWorkerUrl(processorRoute))
        : initialResponse;
    if (response.ok) return;
    const detail = (await response.text().catch(() => "")).trim().slice(0, 300);
    throw new Error(
      `Post-finalize ${args.kind} worker returned HTTP ${response.status}${
        detail ? `: ${detail}` : ""
      }`,
    );
  });

  dispatch.catch((err) => {
    console.error("[post-finalize] worker dispatch failed", {
      recordingId: args.recordingId,
      kind: args.kind,
      workerUrl,
      error: err instanceof Error ? err.message : String(err),
    });
  });

  await Promise.race([
    dispatch,
    new Promise<void>((resolve) => setTimeout(resolve, DISPATCH_SETTLE_MS)),
  ]);
}
