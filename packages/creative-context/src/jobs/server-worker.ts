import { isLocalDatabase } from "@agent-native/core/db";
import {
  awaitBootstrap,
  extractInternalBearerToken,
  fireInternalDispatch,
  FRAMEWORK_ROUTE_PREFIX,
  getH3App,
  readBody,
  verifyInternalToken,
  type NitroPluginDef,
} from "@agent-native/core/server";

import {
  enqueueCreativeContextDailyMaintenance,
  processCreativeContextBackgroundJob,
  processDueCreativeContextBackgroundJobs,
  registerCreativeContextBackgroundDispatcher,
} from "./background-worker.js";
import {
  processDueCreativeContextImportJobs,
  processCreativeContextImportJob,
  registerCreativeContextImportContinuationDispatcher,
  type CreativeContextImportDispatch,
} from "./worker.js";

export const CREATIVE_CONTEXT_IMPORT_PROCESSOR_ROUTE = `${FRAMEWORK_ROUTE_PREFIX}/creative-context/process-import`;
export const CREATIVE_CONTEXT_BACKGROUND_PROCESSOR_ROUTE = `${FRAMEWORK_ROUTE_PREFIX}/creative-context/process-background`;

const mountedApps = new WeakSet<object>();
const delayedDispatches = new Map<string, ReturnType<typeof setTimeout>>();
const sweepTimers = new Map<string, ReturnType<typeof setInterval>>();
const maintenanceTimers = new Map<string, ReturnType<typeof setInterval>>();
const DEFAULT_SWEEP_INTERVAL_MS = 60_000;
const DEFAULT_MAINTENANCE_INTERVAL_MS = 24 * 60 * 60_000;

export function createCreativeContextWorkerPlugin(input: {
  appId: string;
  registerDispatcher?: boolean;
}): NitroPluginDef {
  const appId = input.appId.trim();
  if (!appId) throw new Error("appId is required.");
  return async (nitroApp: object) => {
    if (mountedApps.has(nitroApp)) return;
    mountedApps.add(nitroApp);
    await awaitBootstrap(nitroApp);
    if (input.registerDispatcher !== false) {
      registerCreativeContextImportContinuationDispatcher((dispatch) =>
        scheduleHostedDispatch({ ...dispatch, appId }),
      );
    }
    registerCreativeContextBackgroundDispatcher((dispatch) =>
      scheduleHostedBackgroundDispatch({ ...dispatch, appId }),
    );
    startCreativeContextImportSweep({ appId });
    startCreativeContextDailyMaintenance({ appId });
    const h3App = getH3App(nitroApp);
    h3App.use(CREATIVE_CONTEXT_IMPORT_PROCESSOR_ROUTE, async (event: any) => {
      if (event?.req?.method !== "POST") {
        return json({ error: "Method not allowed" }, 405);
      }
      const body = asDispatch(await readBody(event), appId);
      if (!body) return json({ error: "Invalid import dispatch" }, 400);
      const token = extractInternalBearerToken(
        event.req.headers?.get?.("authorization") ??
          event.node?.req?.headers?.authorization,
      );
      if (!process.env.A2A_SECRET && !unsignedDispatchAllowed()) {
        return json(
          {
            error:
              "A2A_SECRET is required for hosted creative-context background processing.",
          },
          503,
        );
      }
      if (
        process.env.A2A_SECRET &&
        (!token || !verifyInternalToken(body.jobId, token))
      ) {
        return json({ error: "Invalid internal dispatch token" }, 401);
      }
      if (resumeTime(body) > Date.now()) {
        await scheduleHostedDispatch(body);
        return json({ accepted: true, deferredUntil: body.resumeAt }, 202);
      }
      const work = processCreativeContextImportJob(body);
      const waitUntil = resolveWaitUntil(event);
      if (waitUntil) {
        waitUntil(work);
        return json({ accepted: true }, 202);
      }
      try {
        const result = await work;
        return json({
          accepted: true,
          yielded: result.yielded,
          reason: result.reason,
          status: result.job.status,
        });
      } catch (error) {
        console.error(
          "[creative-context] hosted import processor failed:",
          error instanceof Error ? error.message : error,
        );
        return json({ error: "Creative context import failed" }, 500);
      }
    });
    h3App.use(
      CREATIVE_CONTEXT_BACKGROUND_PROCESSOR_ROUTE,
      async (event: any) => {
        if (event?.req?.method !== "POST") {
          return json({ error: "Method not allowed" }, 405);
        }
        const body = asDispatch(await readBody(event), appId);
        if (!body) return json({ error: "Invalid background dispatch" }, 400);
        const token = extractInternalBearerToken(
          event.req.headers?.get?.("authorization") ??
            event.node?.req?.headers?.authorization,
        );
        if (!process.env.A2A_SECRET && !unsignedDispatchAllowed()) {
          return json(
            {
              error:
                "A2A_SECRET is required for hosted creative-context background processing.",
            },
            503,
          );
        }
        if (
          process.env.A2A_SECRET &&
          (!token || !verifyInternalToken(body.jobId, token))
        ) {
          return json({ error: "Invalid internal dispatch token" }, 401);
        }
        if (resumeTime(body) > Date.now()) {
          await scheduleHostedBackgroundDispatch(body);
          return json({ accepted: true, deferredUntil: body.resumeAt }, 202);
        }
        const work = processCreativeContextBackgroundJob(body);
        const waitUntil = resolveWaitUntil(event);
        if (waitUntil) {
          waitUntil(work);
          return json({ accepted: true }, 202);
        }
        try {
          const job = await work;
          return json({ accepted: true, status: job.status });
        } catch (error) {
          console.error(
            "[creative-context] hosted background processor failed:",
            error instanceof Error ? error.message : error,
          );
          return json({ error: "Creative context background job failed" }, 500);
        }
      },
    );
  };
}

export function startCreativeContextDailyMaintenance(input: {
  appId: string;
  intervalMs?: number;
}): () => void {
  const appId = input.appId.trim();
  if (!appId) throw new Error("appId is required.");
  if (!maintenanceTimers.has(appId)) {
    const run = () => {
      void enqueueCreativeContextDailyMaintenance({ appId }).catch((error) => {
        console.error(
          "[creative-context] daily maintenance enqueue failed:",
          error instanceof Error ? error.message : error,
        );
      });
    };
    run();
    const timer = setInterval(
      run,
      Math.max(60_000, input.intervalMs ?? DEFAULT_MAINTENANCE_INTERVAL_MS),
    );
    timer.unref?.();
    maintenanceTimers.set(appId, timer);
  }
  return () => {
    const timer = maintenanceTimers.get(appId);
    if (timer) clearInterval(timer);
    maintenanceTimers.delete(appId);
  };
}

function unsignedDispatchAllowed(): boolean {
  return process.env.NODE_ENV !== "production" && isLocalDatabase();
}

export function startCreativeContextImportSweep(input: {
  appId: string;
  intervalMs?: number;
}): () => void {
  const appId = input.appId.trim();
  if (!appId) throw new Error("appId is required.");
  const existing = sweepTimers.get(appId);
  if (!existing) {
    const run = () => {
      void Promise.all([
        processDueCreativeContextImportJobs({ appId }),
        processDueCreativeContextBackgroundJobs({ appId }),
      ]).catch((error) => {
        console.error(
          "[creative-context] due job sweep failed:",
          error instanceof Error ? error.message : error,
        );
      });
    };
    run();
    const timer = setInterval(
      run,
      Math.max(1_000, input.intervalMs ?? DEFAULT_SWEEP_INTERVAL_MS),
    );
    timer.unref?.();
    sweepTimers.set(appId, timer);
  }
  return () => {
    const timer = sweepTimers.get(appId);
    if (timer) clearInterval(timer);
    sweepTimers.delete(appId);
  };
}

async function scheduleHostedDispatch(
  dispatch: CreativeContextImportDispatch,
): Promise<void> {
  const delay = Math.max(0, resumeTime(dispatch) - Date.now());
  if (delay > 0) {
    const existing = delayedDispatches.get(dispatch.jobId);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(
      () => {
        delayedDispatches.delete(dispatch.jobId);
        void fireHostedDispatch(dispatch).catch((error) => {
          console.error(
            `[creative-context] delayed import dispatch ${dispatch.jobId} failed:`,
            error instanceof Error ? error.message : error,
          );
        });
      },
      Math.min(delay, 2_147_000_000),
    );
    timer.unref?.();
    delayedDispatches.set(dispatch.jobId, timer);
    return;
  }
  await fireHostedDispatch(dispatch);
}

async function fireHostedDispatch(
  dispatch: CreativeContextImportDispatch,
): Promise<void> {
  await fireInternalDispatch({
    path: CREATIVE_CONTEXT_IMPORT_PROCESSOR_ROUTE,
    taskId: dispatch.jobId,
    body: { ...dispatch },
  });
}

async function scheduleHostedBackgroundDispatch(
  dispatch: CreativeContextImportDispatch,
): Promise<void> {
  const delay = Math.max(0, resumeTime(dispatch) - Date.now());
  if (delay > 0) {
    const key = `background:${dispatch.jobId}`;
    const existing = delayedDispatches.get(key);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(
      () => {
        delayedDispatches.delete(key);
        void fireInternalDispatch({
          path: CREATIVE_CONTEXT_BACKGROUND_PROCESSOR_ROUTE,
          taskId: dispatch.jobId,
          body: { ...dispatch },
        }).catch((error) => {
          console.error(
            `[creative-context] delayed background dispatch ${dispatch.jobId} failed:`,
            error instanceof Error ? error.message : error,
          );
        });
      },
      Math.min(delay, 2_147_000_000),
    );
    timer.unref?.();
    delayedDispatches.set(key, timer);
    return;
  }
  await fireInternalDispatch({
    path: CREATIVE_CONTEXT_BACKGROUND_PROCESSOR_ROUTE,
    taskId: dispatch.jobId,
    body: { ...dispatch },
  });
}

function asDispatch(
  value: unknown,
  appId: string,
): CreativeContextImportDispatch | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const jobId = text(record.jobId) ?? text(record.taskId);
  const ownerEmail = text(record.ownerEmail);
  if (!jobId || !ownerEmail) return null;
  return {
    jobId,
    ownerEmail,
    orgId: text(record.orgId) ?? null,
    appId,
    resumeAt: text(record.resumeAt) ?? null,
  };
}

function resolveWaitUntil(
  event: any,
): ((promise: Promise<unknown>) => void) | null {
  const candidate =
    event?.context?.cloudflare?.context?.waitUntil ??
    event?.context?.waitUntil ??
    event?.waitUntil;
  return typeof candidate === "function"
    ? (promise) => candidate.call(event.context ?? event, promise)
    : null;
}

function resumeTime(input: CreativeContextImportDispatch): number {
  if (!input.resumeAt) return 0;
  const timestamp = Date.parse(input.resumeAt);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}
