import { useT } from "@agent-native/core/client/i18n";
import {
  IconAlertTriangle,
  IconCheck,
  IconCopy,
  IconHistory,
  IconX,
} from "@tabler/icons-react";
import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { useEffect, useRef, useState } from "react";

import { LiveWaveform } from "../components/live-waveform";

type FlowState =
  | "idle"
  | "recording"
  | "processing"
  | "complete"
  | "copied"
  | "cancelled"
  | "error";
type FlowProcessingStage =
  | "initializing"
  | "finalizing"
  | "transcribing"
  | "cleaning"
  | "pasting"
  | "saving-history";
type FlowFailure =
  | "permission"
  | "microphone-unavailable"
  | "no-speech"
  | "meeting-capture-active"
  | "provider"
  | "paste"
  | "history-save";
type FlowInsertion = "inserted" | "copied";
type FlowStateChangePayload = {
  state: FlowState;
  stage?: FlowProcessingStage;
  busyAcknowledgement?: boolean;
  runId?: number;
  startedAtMs?: number;
  failure?: FlowFailure;
  insertion?: FlowInsertion | null;
  recoverable?: boolean;
  historySaved?: boolean;
  retryHistory?: boolean;
  cleanupFailed?: boolean;
  backtrackFailed?: boolean;
  transcript?: string;
  originalTranscript?: string;
};

export function FlowBar() {
  const t = useT();
  const [payload, setPayload] = useState<FlowStateChangePayload>({
    state: "idle",
  });
  const [startedAtMs, setStartedAtMs] = useState<number | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [copying, setCopying] = useState(false);
  const [recoveryCopied, setRecoveryCopied] = useState(false);
  const [recoveryCopyFailed, setRecoveryCopyFailed] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const latestRunIdRef = useRef(0);
  const transcript = payload.transcript?.trim() ?? "";
  const recoveryVisible =
    payload.state === "error" && payload.recoverable === true && !!transcript;

  useEffect(() => {
    if (import.meta.env.DEV && window.location.hash === "#flow-bar/recovery") {
      setPayload({
        state: "error",
        runId: 1,
        failure: "paste",
        recoverable: true,
        historySaved: true,
        transcript:
          "Please send the revised agenda before lunch, and include the updated timeline.",
        originalTranscript:
          "Please send the revised agenda before lunch, uh, and include the updated timeline.",
        cleanupFailed: true,
      });
      return;
    }

    let unlisten: (() => void) | undefined;
    let disposed = false;
    void listen<FlowStateChangePayload>("voice:state-change", (event) => {
      const next = event.payload;
      if (!Number.isSafeInteger(next?.runId)) return;
      const runId = next.runId as number;
      if (runId < latestRunIdRef.current) return;
      latestRunIdRef.current = runId;
      setPayload(next);
      setRecoveryCopied(false);
      setRecoveryCopyFailed(false);
      if (next.state === "recording") {
        setStartedAtMs(next.startedAtMs ?? Date.now());
      }
      if (
        next.state === "error" ||
        next.state === "complete" ||
        next.state === "copied"
      ) {
        setRetrying(false);
      }
    })
      .then((stop) => {
        if (disposed) stop();
        else {
          unlisten = stop;
          void emit("voice:flow-bar-ready").catch(() => {});
        }
      })
      .catch(() => {});
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    void invoke("set_flow_bar_expanded", { expanded: recoveryVisible }).catch(
      () => {},
    );
  }, [recoveryVisible]);

  useEffect(() => {
    if (
      startedAtMs === null ||
      (payload.state !== "recording" && payload.state !== "processing")
    ) {
      return;
    }
    const updateElapsed = () =>
      setElapsedMs(Math.max(0, Date.now() - startedAtMs));
    updateElapsed();
    const timer = window.setInterval(updateElapsed, 100);
    return () => window.clearInterval(timer);
  }, [startedAtMs, payload.state]);

  const handleCancel = () => {
    void emit("voice:cancel").catch(() => {});
  };

  const handleAccept = () => {
    void emit("voice:accept").catch(() => {});
  };

  const handleDismiss = async () => {
    if (recoveryVisible && Number.isSafeInteger(payload.runId)) {
      try {
        await emit("voice:dismiss-recovery", { runId: payload.runId });
      } catch {
        return;
      }
    }
    await invoke("set_flow_bar_expanded", { expanded: false }).catch(() => {});
    await invoke("hide_flow_bar").catch(() => {});
  };

  const copyTranscript = async () => {
    if (!transcript || copying) return;
    setCopying(true);
    setRecoveryCopyFailed(false);
    try {
      const { writeText } =
        await import("@tauri-apps/plugin-clipboard-manager");
      await writeText(transcript);
      setRecoveryCopied(true);
    } catch {
      setRecoveryCopied(false);
      setRecoveryCopyFailed(true);
    } finally {
      setCopying(false);
    }
  };

  const retryHistory = () => {
    if (!payload.runId || retrying || !payload.retryHistory) return;
    setRetrying(true);
    void emit("voice:retry-history", { runId: payload.runId }).catch(() => {
      setRetrying(false);
    });
    window.setTimeout(() => setRetrying(false), 4_500);
  };

  const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
  const formattedElapsed = `${Math.floor(totalSeconds / 60)}:${String(
    totalSeconds % 60,
  ).padStart(2, "0")}`;
  const processingLabel = payload.busyAcknowledgement
    ? t("dictateRoute.flowBusy")
    : payload.stage === "initializing"
      ? t("dictateRoute.flowStarting")
      : payload.stage === "transcribing"
        ? t("dictateRoute.flowTranscribing")
        : payload.stage === "cleaning"
          ? t("dictateRoute.flowCleaning")
          : payload.stage === "pasting"
            ? t("dictateRoute.flowPasting")
            : payload.stage === "saving-history"
              ? t("dictateRoute.flowSavingHistory")
              : t("dictateRoute.flowFinalizing");
  const failureLabel =
    payload.failure === "permission"
      ? t("dictateRoute.flowPermissionFailed")
      : payload.failure === "microphone-unavailable"
        ? t("dictateRoute.flowMicrophoneUnavailable")
        : payload.failure === "no-speech"
          ? t("dictateRoute.noSpeechCaptured")
          : payload.failure === "meeting-capture-active"
            ? t("dictateRoute.flowMeetingCaptureActive")
            : payload.failure === "provider"
              ? t("dictateRoute.flowProviderFailed")
              : payload.failure === "paste"
                ? t("dictateRoute.flowPasteFailed")
                : payload.failure === "history-save"
                  ? payload.insertion === "copied"
                    ? t("dictateRoute.flowCopiedHistoryFailed")
                    : t("dictateRoute.flowPastedHistoryFailed")
                  : t("dictateRoute.flowProviderFailed");
  const stateLabel =
    payload.state === "recording"
      ? t("dictateRoute.listening")
      : payload.state === "processing"
        ? processingLabel
        : payload.state === "complete"
          ? t("dictateRoute.flowPasted")
          : payload.state === "copied"
            ? t("dictateRoute.flowCopied")
            : payload.state === "cancelled"
              ? t("dictateRoute.flowCancelled")
              : payload.state === "error"
                ? failureLabel
                : "";

  return (
    <div
      className="flow-bar-root record-pill-scope"
      role="status"
      aria-live="polite"
    >
      <div
        className={`flow-bar flow-bar-${payload.state}${payload.state === "recording" ? " flow-bar-listening" : ""}${recoveryVisible ? " flow-bar-recovery" : ""}`}
        aria-label={stateLabel || undefined}
      >
        {(payload.state === "recording" || payload.state === "idle") && (
          <div className="flow-bar-recording">
            <LiveWaveform
              className="flow-bar-meter"
              sources="mic"
              runId={payload.runId}
              bars={14}
              barGap={3}
            />
          </div>
        )}

        {payload.state === "processing" ? (
          <div className="flow-bar-processing" aria-label={processingLabel}>
            <span className="flow-bar-shimmer">{processingLabel}</span>
          </div>
        ) : null}

        {payload.state === "complete" || payload.state === "copied" ? (
          <div className="flow-bar-complete-content">
            <IconCheck size={14} stroke={2.25} aria-hidden="true" />
            <div className="flow-bar-result-copy">
              <strong>{stateLabel}</strong>
              {payload.historySaved ? (
                <span>{t("dictateRoute.dictationSaved")}</span>
              ) : null}
              {payload.cleanupFailed ? (
                <span>{t("dictateRoute.flowCleanupSkipped")}</span>
              ) : null}
              {payload.backtrackFailed ? (
                <span>{t("dictateRoute.flowBacktrackSkipped")}</span>
              ) : null}
            </div>
            <button
              type="button"
              className="flow-bar-dismiss"
              onClick={handleDismiss}
              aria-label={t("dictateRoute.flowDismiss")}
              title={t("dictateRoute.flowDismiss")}
            >
              <IconX size={14} stroke={2.25} aria-hidden="true" />
            </button>
          </div>
        ) : null}

        {payload.state === "error" ? (
          <div className="flow-bar-error-content">
            <div className="flow-bar-error-heading">
              <IconAlertTriangle size={15} stroke={2} aria-hidden="true" />
              <strong>{failureLabel}</strong>
              <button
                type="button"
                className="flow-bar-dismiss"
                onClick={handleDismiss}
                aria-label={t("dictateRoute.flowDismiss")}
                title={t("dictateRoute.flowDismiss")}
              >
                <IconX size={14} stroke={2.25} aria-hidden="true" />
              </button>
            </div>
            {payload.failure === "paste" && payload.historySaved ? (
              <span className="flow-bar-recovery-note">
                {t("dictateRoute.dictationSaved")}
              </span>
            ) : null}
            {payload.retryHistory && !payload.historySaved ? (
              <span className="flow-bar-recovery-note">
                {t("dictateRoute.flowHistoryNotSaved")}
              </span>
            ) : null}
            {payload.cleanupFailed ? (
              <span className="flow-bar-recovery-note">
                {t("dictateRoute.flowCleanupSkipped")}
              </span>
            ) : null}
            {payload.backtrackFailed ? (
              <span className="flow-bar-recovery-note">
                {t("dictateRoute.flowBacktrackSkipped")}
              </span>
            ) : null}
            {recoveryVisible ? (
              <>
                {payload.originalTranscript ? (
                  <details className="flow-bar-original">
                    <summary>
                      {t("dictateRoute.flowOriginalTranscript")}
                    </summary>
                    <p>{payload.originalTranscript}</p>
                  </details>
                ) : null}
                <textarea
                  className="flow-bar-transcript"
                  aria-label={t("dictateRoute.flowTranscriptRecovery")}
                  readOnly
                  value={transcript}
                  onFocus={(event) => event.currentTarget.select()}
                />
                <div className="flow-bar-recovery-actions">
                  <button
                    type="button"
                    className="flow-bar-action flow-bar-copy-action"
                    onClick={() => void copyTranscript()}
                    disabled={copying}
                  >
                    <IconCopy size={14} aria-hidden="true" />
                    {copying
                      ? t("dictateRoute.flowCopying")
                      : recoveryCopied
                        ? t("dictateRoute.copied")
                        : t("dictateRoute.copy")}
                  </button>
                  {recoveryCopyFailed ? (
                    <span className="flow-bar-recovery-note" role="alert">
                      {t("dictateRoute.copyFailed")}
                    </span>
                  ) : null}
                  {payload.retryHistory ? (
                    <button
                      type="button"
                      className="flow-bar-action"
                      onClick={retryHistory}
                      disabled={retrying}
                    >
                      <IconHistory size={14} aria-hidden="true" />
                      {retrying
                        ? t("dictateRoute.flowSavingHistory")
                        : t("dictateRoute.flowRetryHistory")}
                    </button>
                  ) : null}
                </div>
              </>
            ) : null}
          </div>
        ) : null}

        {payload.state === "cancelled" ? (
          <div className="flow-bar-complete">
            <span>{t("dictateRoute.flowCancelled")}</span>
            <button
              type="button"
              className="flow-bar-dismiss"
              onClick={handleDismiss}
              aria-label={t("dictateRoute.flowDismiss")}
              title={t("dictateRoute.flowDismiss")}
            >
              <IconX size={14} stroke={2.25} aria-hidden="true" />
            </button>
          </div>
        ) : null}

        {payload.state === "recording" ? (
          <div
            className="flow-bar-controls"
            aria-label={t("dictateRoute.listening")}
          >
            <button
              type="button"
              className="flow-bar-control flow-bar-cancel"
              onClick={handleCancel}
              aria-label={t("dictateRoute.flowCancelDictation")}
              title={t("dictateRoute.flowCancelDictation")}
            >
              <IconX size={16} stroke={2.25} aria-hidden="true" />
            </button>
            <time className="flow-bar-time" dateTime={`PT${elapsedMs / 1000}S`}>
              {formattedElapsed}
            </time>
            <button
              type="button"
              className="flow-bar-control flow-bar-accept"
              onClick={handleAccept}
              aria-label={t("dictateRoute.stop")}
              title={t("dictateRoute.stop")}
            >
              <IconCheck size={16} stroke={2.25} aria-hidden="true" />
            </button>
          </div>
        ) : payload.state === "processing" ? (
          <button
            type="button"
            className="flow-bar-cancel"
            onClick={handleCancel}
            disabled={
              payload.stage === "pasting" || payload.stage === "saving-history"
            }
            aria-label={t("dictateRoute.flowCancelDictation")}
            title={t("dictateRoute.flowCancelDictation")}
          >
            <IconX size={12} stroke={2.5} aria-hidden="true" />
          </button>
        ) : null}
      </div>
    </div>
  );
}
