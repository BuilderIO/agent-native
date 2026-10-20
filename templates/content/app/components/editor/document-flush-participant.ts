import {
  compareAndSetClientAppState,
  readClientAppState,
} from "@agent-native/core/client/application-state";
import {
  flushAckKey,
  isDocumentFlushRequest,
  type DocumentFlushAck,
  type DocumentFlushClaim,
  type DocumentFlushRequest,
  type FlushEditorIdentity,
} from "@shared/document-flush-protocol";

export type FlushLocalSnapshot = {
  identity: string;
  generation: number;
  observation: number;
  valueEpoch: number;
  visualVersion: object | null;
  title: string;
  content: string;
  clean: boolean;
  claim: DocumentFlushClaim | null;
};

function unchanged(a: FlushLocalSnapshot, b: FlushLocalSnapshot): boolean {
  return (
    a.identity === b.identity &&
    a.generation === b.generation &&
    a.observation === b.observation &&
    a.valueEpoch === b.valueEpoch &&
    a.visualVersion === b.visualVersion &&
    a.title === b.title &&
    a.content === b.content
  );
}

// Save reconciliation can replace current values without creating an authored generation.
export function createFlushObservedRef(
  initial: string,
  changed: () => void,
): { current: string } {
  let value = initial;
  return {
    get current() {
      return value;
    },
    set current(next: string) {
      if (next !== value) changed();
      value = next;
    },
  };
}

export function createDocumentFlushParticipant(input: {
  identity: () => FlushEditorIdentity | null;
  documentId: () => string;
  snapshot: (propertyId?: string) => FlushLocalSnapshot;
  drain: (propertyId?: string) => Promise<void>;
  read?: typeof readClientAppState;
  compare?: typeof compareAndSetClientAppState;
}) {
  const read = input.read ?? readClientAppState;
  const compare = input.compare ?? compareAndSetClientAppState;
  const running = new Set<string>();
  const completed = new Set<string>();
  let lastRequestId: string | null = null;
  let prepared: {
    requestId: string;
    prepareToken: string;
    stabilityToken: string;
    snapshot: FlushLocalSnapshot;
  } | null = null;

  return async function respond(value: unknown): Promise<void> {
    if (
      !isDocumentFlushRequest(value) ||
      value.id !== input.documentId() ||
      value.expiresAt <= Date.now()
    )
      return;
    const request = value;
    if (lastRequestId !== request.requestId) {
      completed.clear();
      lastRequestId = request.requestId;
    }
    const identity = input.identity();
    if (
      !identity ||
      !request.targets.some(
        (target) =>
          target.clientId === identity.clientId &&
          target.editorSessionId === identity.editorSessionId,
      )
    )
      return;
    const key = flushAckKey(request, identity.clientId);
    if (running.has(key) || completed.has(key)) return;
    running.add(key);
    const abort = new AbortController();
    const timer = setTimeout(
      () => abort.abort(new Error("Document flush expired")),
      request.expiresAt - Date.now(),
    );
    async function bounded<T>(work: Promise<T>): Promise<T> {
      if (abort.signal.aborted) throw abort.signal.reason;
      let listener!: () => void;
      try {
        return await Promise.race([
          work,
          new Promise<never>((_, reject) => {
            listener = () => reject(abort.signal.reason);
            abort.signal.addEventListener("abort", listener, { once: true });
          }),
        ]);
      } finally {
        abort.signal.removeEventListener("abort", listener);
      }
    }
    const envelope = {
      protocol: request.protocol,
      id: request.id,
      requestId: request.requestId,
      phase: request.phase,
      phaseToken: request.phaseToken,
      ...identity,
    };
    const stillCurrent = async () => {
      const current = await bounded(
        read<DocumentFlushRequest>(`flush-request-${request.id}`, {
          signal: abort.signal,
        }),
      );
      return (
        isDocumentFlushRequest(current) &&
        input.documentId() === request.id &&
        current.requestId === request.requestId &&
        current.id === request.id &&
        current.phase === request.phase &&
        current.prepareToken === request.prepareToken &&
        current.phaseToken === request.phaseToken &&
        current.expiresAt > Date.now() &&
        input.identity()?.editorSessionId === identity!.editorSessionId &&
        input.identity()?.clientId === identity!.clientId
      );
    };
    async function publish(ack: DocumentFlushAck) {
      if (!(await stillCurrent()))
        throw new Error("Document flush phase changed before acknowledgment");
      if (!(await bounded(compare(key, null, ack, { signal: abort.signal })))) {
        throw new Error("Document flush acknowledgment CAS was refused");
      }
      if (!(await stillCurrent())) {
        if (!(await bounded(compare(key, ack, null, { signal: abort.signal }))))
          throw new Error(
            "Document flush late acknowledgment cleanup CAS was refused",
          );
      }
    }
    let preparingSnapshot: FlushLocalSnapshot | null = null;
    try {
      let ack: DocumentFlushAck;
      if (request.phase === "verify") {
        // This synchronous observation follows delivery of the post-capture token.
        const current = input.snapshot(request.propertyId);
        ack =
          prepared?.requestId === request.requestId &&
          prepared.prepareToken === request.prepareToken &&
          current.clean &&
          unchanged(prepared.snapshot, current)
            ? {
                ...envelope,
                status: "verified",
                stabilityToken: prepared.stabilityToken,
              }
            : { ...envelope, status: "changed" };
      } else {
        prepared = null;
        const before = input.snapshot(request.propertyId);
        preparingSnapshot = before;
        await bounded(input.drain(request.propertyId));
        const after = input.snapshot(request.propertyId);
        if (!unchanged(before, after)) ack = { ...envelope, status: "changed" };
        else if (!after.clean)
          ack = {
            ...envelope,
            status: "error",
            errorCode: "editor_save_unsettled",
          };
        else {
          let claim = after.claim;
          if (request.propertyId) {
            const bytes = await bounded(
              crypto.subtle.digest(
                "SHA-256",
                new TextEncoder().encode(after.content),
              ),
            );
            claim = {
              kind: "property",
              propertyId: request.propertyId,
              contentHash: `sha256:${Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("")}`,
            };
          }
          const current = input.snapshot(request.propertyId);
          if (!current.clean || !unchanged(after, current))
            ack = { ...envelope, status: "changed" };
          else if (!claim)
            ack = {
              ...envelope,
              status: "error",
              errorCode: "editor_save_unacknowledged",
            };
          else {
            const stabilityToken = crypto.randomUUID();
            prepared = {
              requestId: request.requestId,
              prepareToken: request.prepareToken,
              stabilityToken,
              snapshot: after,
            };
            ack = { ...envelope, status: "prepared", stabilityToken, claim };
          }
        }
      }
      await publish(ack);
      completed.add(key);
    } catch (error) {
      // Publication failures stay failures: the server sees a missing ACK and refuses freshness.
      if (!abort.signal.aborted) {
        try {
          await publish({
            ...envelope,
            ...(preparingSnapshot &&
            !unchanged(preparingSnapshot, input.snapshot(request.propertyId))
              ? { status: "changed" as const }
              : { status: "error" as const, errorCode: "editor_flush_failed" }),
          });
        } catch (publicationError) {
          console.error("Document flush acknowledgment failed", {
            error,
            publicationError,
            requestId: request.requestId,
          });
        }
      }
    } finally {
      clearTimeout(timer);
      running.delete(key);
    }
  };
}
