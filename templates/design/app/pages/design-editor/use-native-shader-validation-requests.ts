import {
  callAction,
  getBrowserTabId,
  readClientAppState,
} from "@agent-native/core/client/hooks";
import type { NativePresentationFaultGrant } from "@shared/native-presentation-fault-gate";
import {
  isNativePresentationFaultFailureCode,
  nativeShaderValidationStateKey,
  nativeShaderValidationStateSchema,
  type NativeShaderValidationCaseResult,
  type NativeShaderValidationState,
} from "@shared/native-shader-validation";
import { useEffect, useRef } from "react";

import { readPreparedScene } from "./native-scene-export-client";
import {
  validateNativePresentationFaultInEditor,
  validateNativeShaderCaseInEditor,
} from "./native-shader-validation-client";
import {
  parsePreparedNativeValidationFixtures,
  validateNativeCleanFixtures,
} from "./native-shader-validation-fixture-client";

export type NativeShaderValidationHandler = (
  claimed: NativeShaderValidationState,
  signal: AbortSignal,
) => Promise<NativeShaderValidationCaseResult[]>;

export class NativeShaderValidationReportError extends Error {
  constructor(
    readonly validationError: unknown,
    readonly reportError: unknown,
  ) {
    super("GPU validation and its result report both failed.");
    this.name = "NativeShaderValidationReportError";
  }
}

export async function runNativeShaderValidationRequest(args: {
  request: NativeShaderValidationState;
  designId: string;
  tabId: string;
  signal: AbortSignal;
  validate: NativeShaderValidationHandler;
  invoke: (name: string, input: Record<string, unknown>) => Promise<unknown>;
  readState: () => Promise<unknown>;
}): Promise<void> {
  const { request, designId, tabId, signal, validate, invoke, readState } =
    args;
  if (
    request.designId !== designId ||
    request.tabId !== tabId ||
    request.status !== "pending"
  )
    throw new Error(
      "The GPU validation request does not match this editor tab.",
    );
  const claimed = nativeShaderValidationStateSchema.parse(
    await invoke("claim-native-shader-validation", {
      designId,
      requestId: request.requestId,
    }),
  );
  if (
    claimed.status !== "running" ||
    claimed.requestId !== request.requestId ||
    claimed.tabId !== tabId
  )
    throw new Error("The GPU validation claim changed before rendering.");
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  signal.addEventListener("abort", onAbort, { once: true });
  let watcherBusy = false;
  let watcherError: unknown;
  const watcher = window.setInterval(() => {
    if (watcherBusy || controller.signal.aborted) return;
    watcherBusy = true;
    void readState()
      .then((raw) => {
        if (raw === null) throw new Error("GPU validation state disappeared.");
        const state = nativeShaderValidationStateSchema.parse(raw);
        if (
          state.requestId !== claimed.requestId ||
          state.status === "cancel-requested"
        )
          controller.abort();
        else if (state.status !== "running")
          throw new Error("GPU validation state changed while rendering.");
      })
      .catch((error: unknown) => {
        watcherError = error;
        controller.abort();
      })
      .finally(() => {
        watcherBusy = false;
      });
  }, 500);
  const leaseTimer = window.setTimeout(
    () => controller.abort(),
    Math.max(0, claimed.expiresAt - Date.now()),
  );
  try {
    if (controller.signal.aborted || Date.now() >= claimed.expiresAt)
      throw new Error("GPU validation lease expired before rendering.");
    const results = await validate(claimed, controller.signal);
    if (controller.signal.aborted || Date.now() >= claimed.expiresAt)
      throw new Error("GPU validation ended after its lease expired.");
    if (results.length !== claimed.cases.length)
      throw new Error("GPU validation did not return every requested case.");
    await invoke("finish-native-shader-validation", {
      designId,
      requestId: claimed.requestId,
      result: { status: "validation-complete", results },
    });
  } catch (error) {
    const canceled = controller.signal.aborted && !watcherError;
    const result = canceled
      ? { status: "canceled" as const }
      : {
          status: "failed" as const,
          failure: {
            code: (claimed.cases.length === 1 &&
            claimed.cases[0]?.presentationFault &&
            error &&
            typeof error === "object" &&
            "code" in error &&
            typeof error.code === "string" &&
            isNativePresentationFaultFailureCode(error.code)
              ? error.code
              : "render-failed") as NonNullable<
              NativeShaderValidationState["failure"]
            >["code"],
            message: (error instanceof Error
              ? error.message
              : "validation-render-failed"
            ).slice(0, 300),
          },
        };
    try {
      await invoke("finish-native-shader-validation", {
        designId,
        requestId: claimed.requestId,
        result,
      });
    } catch (reportError) {
      throw new NativeShaderValidationReportError(error, reportError);
    }
    throw error;
  } finally {
    signal.removeEventListener("abort", onAbort);
    window.clearInterval(watcher);
    window.clearTimeout(leaseTimer);
  }
}

export function useNativeShaderValidationRequests(args: {
  designId: string | undefined;
  enabled: boolean;
  onError: (error: unknown) => void;
}): void {
  const onError = useRef(args.onError);
  onError.current = args.onError;
  useEffect(() => {
    const designId = args.designId;
    if (!args.enabled || !designId) return;
    const tabId = getBrowserTabId();
    const controller = new AbortController();
    let busy = false;
    let seenId: string | null = null;
    const poll = async () => {
      if (busy || controller.signal.aborted) return;
      busy = true;
      try {
        const raw = await readClientAppState(
          nativeShaderValidationStateKey(designId, tabId),
        );
        if (raw === null) return;
        const state = nativeShaderValidationStateSchema.parse(raw);
        if (state.status !== "pending" || state.requestId === seenId) return;
        seenId = state.requestId;
        await runNativeShaderValidationRequest({
          request: state,
          designId,
          tabId,
          signal: controller.signal,
          validate: async (claimed, signal) => {
            const cleanCases = claimed.cases.filter((item) => item.fixture);
            const cleanResults = cleanCases.length
              ? await validateNativeCleanFixtures({
                  cases: cleanCases,
                  prepared: await parsePreparedNativeValidationFixtures(
                    await callAction("prepare-native-shader-validation", {
                      designId,
                      requestId: claimed.requestId,
                    }),
                    cleanCases,
                    claimed.expectedVersionHash,
                  ),
                  signal,
                })
              : [];
            const cleanById = new Map(
              cleanResults.map((item) => [item.caseId, item]),
            );
            const preparedScenes = new Map<
              string,
              ReturnType<typeof readPreparedScene>
            >();
            const results: NativeShaderValidationCaseResult[] = [];
            for (const item of claimed.cases) {
              if (signal.aborted)
                throw new Error("GPU validation was canceled.");
              if (item.fixture) {
                const result = cleanById.get(item.caseId);
                if (!result)
                  throw new Error("A clean GPU case did not return a result.");
                results.push(result);
              } else if (item.presentationFault) {
                const prepared = await callAction(
                  "prepare-native-shader-validation",
                  {
                    designId,
                    requestId: claimed.requestId,
                  },
                );
                if (
                  !prepared ||
                  typeof prepared !== "object" ||
                  !("faultGrant" in prepared) ||
                  !prepared.faultGrant ||
                  typeof prepared.faultGrant !== "object"
                )
                  throw new Error("presentation-fault-grant-unreadable");
                results.push(
                  await validateNativePresentationFaultInEditor({
                    designId,
                    fileId: claimed.fileId,
                    ownerTabId: tabId,
                    requestId: claimed.requestId,
                    item,
                    grant: prepared.faultGrant as NativePresentationFaultGrant,
                    expectedVersionHash: claimed.expectedVersionHash,
                    signal,
                  }),
                );
              } else {
                let preparedScene:
                  | ReturnType<typeof readPreparedScene>
                  | undefined;
                if (item.mountedFrame) {
                  const viewport = item.mountedFrame.viewport;
                  const key = `${viewport.width}x${viewport.height}@${item.mountedFrame.pixelRatio}`;
                  preparedScene = preparedScenes.get(key);
                  if (!preparedScene) {
                    preparedScene = readPreparedScene(
                      await callAction(
                        "prepare-native-scene-export",
                        {
                          designId,
                          fileId: claimed.fileId,
                          viewportWidth: viewport.width,
                          viewportHeight: viewport.height,
                          pixelRatio: item.mountedFrame.pixelRatio,
                        },
                        { method: "GET", signal },
                      ),
                      {
                        designId,
                        fileId: claimed.fileId,
                        width: viewport.width,
                        height: viewport.height,
                        pixelRatio: item.mountedFrame.pixelRatio,
                        expectedVersionHash: claimed.expectedVersionHash,
                      },
                    );
                    preparedScenes.set(key, preparedScene);
                  }
                }
                results.push(
                  await validateNativeShaderCaseInEditor({
                    fileId: claimed.fileId,
                    item,
                    preparedScene,
                    signal,
                  }),
                );
              }
            }
            return results;
          },
          invoke: (name, input) => callAction(name, input),
          readState: () =>
            readClientAppState(nativeShaderValidationStateKey(designId, tabId)),
        });
      } catch (error) {
        onError.current(error);
      } finally {
        busy = false;
      }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 2_000);
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [args.designId, args.enabled]);
}
