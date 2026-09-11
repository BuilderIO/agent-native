import { mergeCodeAgentTranscriptEvents } from "@agent-native/core/client/agent-chat";
import { PromptComposer } from "@agent-native/core/client/composer";
import {
  IconEye,
  IconLoader2,
  IconMessageCircle,
  IconX,
} from "@tabler/icons-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import type { CodeAgentsHost } from "./CodeAgentsApp.js";
import type { CodeAgentRun, CodeAgentTranscriptEvent } from "./types.js";

export const SESSION_WATCH_TRANSCRIPT_EVENT_LIMIT = 200;

export function mergeSessionWatchTranscriptEvents(
  current: CodeAgentTranscriptEvent[],
  incoming: CodeAgentTranscriptEvent[],
): CodeAgentTranscriptEvent[] {
  return mergeCodeAgentTranscriptEvents(current, incoming).slice(
    -SESSION_WATCH_TRANSCRIPT_EVENT_LIMIT,
  );
}

/**
 * A deliberately small second-session surface. It watches a run through the
 * same transcript subscription as the main chat and sends follow-ups through
 * the host's existing run-manager boundary, so watching never grants direct
 * access to another session's files or process.
 */
export function SessionWatchPanel({
  host,
  run,
  sourceRunId,
  onClose,
}: {
  host: CodeAgentsHost;
  run: CodeAgentRun;
  sourceRunId?: string | null;
  onClose: () => void;
}) {
  const [events, setEvents] = useState<CodeAgentTranscriptEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [, setPrompt] = useState("");
  const transcriptGenerationRef = useRef(0);

  const loadTranscript = useCallback(
    async (generation?: number) => {
      const requestGeneration = generation ?? transcriptGenerationRef.current;
      try {
        const result = await host.readTranscript({
          goalId: run.goalId,
          runId: run.id,
        });
        if (requestGeneration !== transcriptGenerationRef.current) return;
        if (result.status !== "ok") {
          setError(
            result.error ?? "This session is not reporting a transcript.",
          );
          return;
        }
        setError(null);
        setEvents((current) =>
          mergeSessionWatchTranscriptEvents(current, result.events),
        );
      } catch (caught) {
        if (requestGeneration !== transcriptGenerationRef.current) return;
        setError(caught instanceof Error ? caught.message : String(caught));
      } finally {
        if (requestGeneration === transcriptGenerationRef.current) {
          setLoading(false);
        }
      }
    },
    [host, run.goalId, run.id],
  );

  useEffect(() => {
    const generation = transcriptGenerationRef.current + 1;
    transcriptGenerationRef.current = generation;
    setEvents([]);
    setError(null);
    setLoading(true);

    // Subscribe before reading the snapshot. The merge below keeps events that
    // arrive in the gap between those two operations.
    const unsubscribe = host.subscribeTranscript?.(
      { goalId: run.goalId, runId: run.id },
      (batch) => {
        if (generation !== transcriptGenerationRef.current) return;
        if (batch.status !== "ok") {
          setError(batch.error ?? "The watched session could not be updated.");
          return;
        }
        setError(null);
        if (batch.events.length > 0) {
          setEvents((current) =>
            mergeSessionWatchTranscriptEvents(current, batch.events),
          );
        }
      },
    );
    void loadTranscript(generation);
    const interval = window.setInterval(
      () => void loadTranscript(generation),
      10_000,
    );
    return () => {
      unsubscribe?.();
      window.clearInterval(interval);
    };
  }, [host, loadTranscript, run.goalId, run.id]);

  async function sendFollowUp(
    text: string,
    _files: File[],
    _references: unknown[],
    options: { intent?: "immediate" | "queued" },
  ) {
    const trimmed = text.trim();
    if (!trimmed || sending) return;
    setSending(true);
    try {
      const result = await host.appendFollowUp({
        goalId: run.goalId,
        runId: run.id,
        prompt: trimmed,
        followUpMode: options.intent === "queued" ? "queued" : "immediate",
        metadata: {
          sessionBridge: "watch-panel",
          ...(sourceRunId ? { sourceRunId } : {}),
        },
      });
      if (!result.ok) {
        toast("Could not message this session", {
          description: result.error ?? result.message,
          duration: 3200,
        });
        return;
      }
      setPrompt("");
      toast("Message sent to session", { duration: 1600 });
      await loadTranscript();
    } catch (caught) {
      toast("Could not message this session", {
        description: caught instanceof Error ? caught.message : String(caught),
        duration: 3200,
      });
    } finally {
      setSending(false);
    }
  }

  return (
    <section className="code-agents-session-watch" aria-label="Watched session">
      <div className="code-agents-session-watch__header">
        <div className="code-agents-session-watch__title">
          <IconEye size={15} strokeWidth={1.8} aria-hidden="true" />
          <div className="min-w-0">
            <strong>Watching {run.title || "Untitled session"}</strong>
            <span title={run.id}>Session {run.id}</span>
          </div>
        </div>
        <button
          type="button"
          className="code-agents-session-watch__close"
          onClick={onClose}
          aria-label="Stop watching session"
          title="Stop watching"
        >
          <IconX size={15} strokeWidth={1.8} />
        </button>
      </div>

      <div className="code-agents-session-watch__body">
        <div className="code-agents-session-watch__events">
          {loading ? (
            <div className="code-agents-session-watch__state">
              <IconLoader2 className="code-agents-spin" size={15} />
              <span>Reading session…</span>
            </div>
          ) : error ? (
            <div className="code-agents-session-watch__state code-agents-session-watch__state--error">
              {error}
            </div>
          ) : events.length === 0 ? (
            <div className="code-agents-session-watch__state">
              <IconMessageCircle size={15} />
              <span>No transcript events yet.</span>
            </div>
          ) : (
            events.slice(-8).map((event) => (
              <article
                key={event.id}
                className="code-agents-session-watch__event"
              >
                <span>{event.type}</span>
                <p>{event.text}</p>
              </article>
            ))
          )}
        </div>
        <PromptComposer
          className="code-agents-standard-composer code-agents-session-watch__composer"
          layoutVariant="compact"
          draftScope={`agent-native-code:watch:${run.id}`}
          disabled={sending}
          placeholder="Message this session…"
          showModelSelector={false}
          modelStatusChecksEnabled={false}
          attachmentsEnabled={false}
          voiceEnabled={false}
          includeDefaultSlashCommands={false}
          includeDefaultSlashSkills={false}
          preserveDraftOnSubmit={false}
          onTextChange={setPrompt}
          onSubmit={sendFollowUp}
        />
      </div>
    </section>
  );
}
