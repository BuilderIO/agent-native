import {
  AGENT_BACKGROUND_PROCESSOR_FIELD,
  AGENT_BACKGROUND_PROCESSOR_ROUTE,
  AGENT_BACKGROUND_PROCESSOR_ROUTE_FIELD,
  resolveBackgroundDispatchTarget,
  sendBackgroundQueueMessage,
  signScopedAgentAccessToken,
} from "@agent-native/core/server";

export type PostFinalizeJobKind =
  | "media-ready"
  | "seekable"
  | "transcript"
  | "brain-export"
  | "loom-import";

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
  requireAccepted?: boolean;
}): Promise<void> {
  const { requireAccepted = false, ...job } = args;
  const token = signScopedAgentAccessToken({
    resourceKind: POST_FINALIZE_JOB_TOKEN_KIND,
    resourceId: postFinalizeJobResourceId(job.recordingId, job.kind),
    ttlSeconds: 10 * 60,
  });
  const basePath = normalizeBasePath(
    process.env.VITE_APP_BASE_PATH || process.env.APP_BASE_PATH,
  );
  const processorRoute = `${basePath}/api/_agent-native-background/post-finalize-worker`;
  // The durable worker is reachable on any transport that carries its own
  // budget: the emitted Netlify function url, or the Cloudflare queue consumer
  // (which routes back to this same processor route through the background
  // route-processor field). `inline-route` is the portable in-process route.
  const target = resolveBackgroundDispatchTarget({
    fallbackPath: processorRoute,
  });
  const usesDurableBackground = target.kind !== "inline-route";
  const jobBody = {
    ...job,
    token,
    ...(usesDurableBackground
      ? {
          [AGENT_BACKGROUND_PROCESSOR_FIELD]: AGENT_BACKGROUND_PROCESSOR_ROUTE,
          [AGENT_BACKGROUND_PROCESSOR_ROUTE_FIELD]: processorRoute,
        }
      : {}),
  };
  const body = JSON.stringify(jobBody);
  const post = (url: string) =>
    fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
  const assertAccepted = async (response: Response) => {
    if (response.ok) return;
    const detail = (await response.text().catch(() => "")).trim().slice(0, 300);
    throw new Error(
      `Post-finalize ${args.kind} worker returned HTTP ${response.status}${
        detail ? `: ${detail}` : ""
      }`,
    );
  };
  const workerUrl =
    target.kind === "queue"
      ? resolveWorkerUrl(processorRoute)
      : resolveWorkerUrl(target.path);
  const dispatch =
    target.kind === "queue"
      ? sendBackgroundQueueMessage({
          taskId: postFinalizeJobResourceId(job.recordingId, job.kind),
          origin: new URL(workerUrl).origin,
          body: jobBody,
        }).catch(async (queueError: unknown) => {
          // Same shape as the Netlify fast-fail fallback below: a queue that
          // refuses the send is a known state with a working alternative, and
          // the job runs on the portable route instead of being dropped.
          console.error("[post-finalize] queue dispatch failed; falling back", {
            recordingId: args.recordingId,
            kind: args.kind,
            error:
              queueError instanceof Error
                ? queueError.message
                : String(queueError),
          });
          await assertAccepted(await post(workerUrl));
        })
      : post(workerUrl).then(async (initialResponse) => {
          const response =
            usesDurableBackground && !initialResponse.ok
              ? await post(resolveWorkerUrl(processorRoute))
              : initialResponse;
          await assertAccepted(response);
        });

  dispatch.catch((err: unknown) => {
    console.error("[post-finalize] worker dispatch failed", {
      recordingId: args.recordingId,
      kind: args.kind,
      workerUrl,
      error: err instanceof Error ? err.message : String(err),
    });
  });

  if (requireAccepted) {
    await dispatch;
    return;
  }

  await Promise.race([
    dispatch,
    new Promise<void>((resolve) => setTimeout(resolve, DISPATCH_SETTLE_MS)),
  ]);
}
