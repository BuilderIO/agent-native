const REPOSITORY_PART_MEDIA_TYPE = "application/x-agent-native-repository-part";

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function message(value: unknown): Record<string, unknown> | undefined {
  const outer = record(value);
  return record(outer?.message) ?? outer;
}

export function threadMessageRecord(
  value: unknown,
): Record<string, unknown> | undefined {
  return message(value);
}

function parts(value: Record<string, unknown>): Record<string, unknown>[] {
  const content = value.parts ?? value.content;
  const values = Array.isArray(content)
    ? content
    : typeof content === "string"
      ? [{ type: "text", text: content }]
      : [];
  return values.flatMap((part) => {
    const entry = record(part);
    if (!entry) return [];
    return entry.type === "tool-call"
      ? [
          {
            type: "data",
            mediaType: REPOSITORY_PART_MEDIA_TYPE,
            data: entry,
          },
        ]
      : [entry];
  });
}

function explicitRunId(value: Record<string, unknown>): string | undefined {
  const runId = record(value.metadata)?.runId;
  return typeof runId === "string" ? runId : undefined;
}

function foldedRunIds(value: Record<string, unknown>): string[] {
  const custom = record(record(value.metadata)?.custom);
  const folded = Array.isArray(custom?.foldedRunIds)
    ? custom.foldedRunIds.filter(
        (runId): runId is string => typeof runId === "string",
      )
    : [];
  const runId = explicitRunId(value);
  return [...new Set([...folded, ...(runId ? [runId] : [])])];
}

function eventRunIds(events: unknown, runs: unknown): Map<string, Set<string>> {
  const result = new Map<string, Set<string>>();
  const remember = (messageId: unknown, runId: unknown) => {
    if (typeof messageId !== "string" || typeof runId !== "string") return;
    const ids = result.get(messageId) ?? new Set<string>();
    ids.add(runId);
    result.set(messageId, ids);
  };
  for (const value of Array.isArray(events) ? events : []) {
    const event = record(value);
    const eventMessage = record(event?.message);
    if (
      (event?.type === "message.created" ||
        event?.type === "message.completed") &&
      eventMessage?.role === "assistant"
    ) {
      remember(eventMessage.id ?? event?.messageId, event?.runId);
    }
  }
  for (const value of Array.isArray(runs) ? runs : []) {
    const run = record(value);
    remember(run?.activeMessageId, run?.id);
  }
  return result;
}

function eventMessageIdsByRun(
  runIdsByMessageId: Map<string, Set<string>>,
): Map<string, Set<string>> {
  const result = new Map<string, Set<string>>();
  for (const [messageId, runIds] of runIdsByMessageId) {
    for (const runId of runIds) {
      const messageIds = result.get(runId) ?? new Set<string>();
      messageIds.add(messageId);
      result.set(runId, messageIds);
    }
  }
  return result;
}

function assistantRunId(
  value: Record<string, unknown>,
  runIdsByMessageId: Map<string, Set<string>>,
  inferredRunId?: string,
): string | undefined {
  if (value.role !== "assistant") return undefined;
  const eventRunIds =
    typeof value.id === "string" ? runIdsByMessageId.get(value.id) : undefined;
  return (
    (eventRunIds?.size === 1 ? [...eventRunIds][0] : undefined) ??
    explicitRunId(value) ??
    (eventRunIds?.size ? undefined : inferredRunId)
  );
}

function text(
  value: Record<string, unknown>,
  ignoreNonTextParts = false,
): string | undefined {
  if (value.role !== "assistant") return undefined;
  const messageParts = parts(value);
  if (
    !ignoreNonTextParts &&
    messageParts.some(
      (part) =>
        part.type !== "text" &&
        part.type !== "reasoning" &&
        !(
          part.type === "data" &&
          part.mediaType === REPOSITORY_PART_MEDIA_TYPE &&
          record(part.data)?.type === "tool-call"
        ),
    )
  ) {
    return undefined;
  }
  return messageParts
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text as string)
    .join("");
}

function reasoning(value: Record<string, unknown>): string {
  return parts(value)
    .flatMap((part) =>
      part.type === "reasoning" && typeof part.text === "string"
        ? [part.text]
        : [],
    )
    .join("");
}

function isPrefixCompatible(left: string, right: string): boolean {
  return left.startsWith(right) || right.startsWith(left);
}

function rootToolCalls(
  value: Record<string, unknown>,
): Record<string, unknown>[] {
  return parts(value).flatMap((part) => {
    if (part.type !== "data" || part.mediaType !== REPOSITORY_PART_MEDIA_TYPE) {
      return [];
    }
    const data = record(part.data);
    return data?.type === "tool-call" ? [data] : [];
  });
}

function sameValue(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => sameValue(value, right[index]))
    );
  }
  const leftRecord = record(left);
  const rightRecord = record(right);
  if (!leftRecord || !rightRecord) return false;
  const leftKeys = Object.keys(leftRecord).sort();
  const rightKeys = Object.keys(rightRecord).sort();
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every(
      (key, index) =>
        key === rightKeys[index] &&
        sameValue(leftRecord[key], rightRecord[key]),
    )
  );
}

function representedToolCallMessageIds(
  value: Record<string, unknown>,
  toolCalls: unknown,
): Set<string> | undefined {
  const calls = rootToolCalls(value);
  const byId = new Map(
    (Array.isArray(toolCalls) ? toolCalls : []).flatMap((entry) => {
      const call = record(entry);
      return typeof call?.id === "string" ? [[call.id, call] as const] : [];
    }),
  );
  const messageIds = new Set<string>();
  for (const rootCall of calls) {
    const id =
      typeof rootCall.toolCallId === "string"
        ? rootCall.toolCallId
        : typeof rootCall.id === "string"
          ? rootCall.id
          : undefined;
    const call = id ? byId.get(id) : undefined;
    // A tool call's identity is its id, name, and args. Never compare results:
    // the stored root keeps the model-facing text while the snapshot output is
    // the structured chat-UI result, so one call never compares equal and its
    // reply renders twice.
    if (
      !call ||
      (typeof rootCall.toolName === "string" &&
        rootCall.toolName !== call.name) ||
      (Object.prototype.hasOwnProperty.call(rootCall, "args") &&
        !sameValue(rootCall.args, call.input))
    ) {
      return undefined;
    }
    if (typeof call.messageId === "string") messageIds.add(call.messageId);
  }
  return messageIds;
}

function contentMatches(
  root: Record<string, unknown>,
  candidate: Record<string, unknown>,
  toolMessageIds: Set<string> | undefined,
): boolean {
  const rootText = text(root);
  const candidateText = text(candidate);
  if (rootText === undefined || candidateText === undefined) return false;
  const sameText = Boolean(
    rootText && candidateText && isPrefixCompatible(rootText, candidateText),
  );
  const reasoningMatches = Boolean(
    reasoning(root) && reasoning(root) === reasoning(candidate),
  );
  const toolCallMatch = Boolean(
    typeof candidate.id === "string" && toolMessageIds?.has(candidate.id),
  );
  // Saved tool calls can be missing or trimmed. Text still identifies the
  // reply; empty text does not, and the caller keeps a second assistant.
  if (rootToolCalls(root).length > 0 && toolMessageIds === undefined) {
    return sameText;
  }
  return (
    (sameText && (rootText.length > 0 || candidateText.length > 0)) ||
    (reasoningMatches && !rootText && !candidateText) ||
    (toolCallMatch && !rootText && !candidateText)
  );
}

function foldedProjectionMatches(
  root: Record<string, unknown>,
  snapshotMessagesByRunId: Map<string, Record<string, unknown>[]>,
  foldedIds: string[],
  messageIdsByRun: Map<string, Set<string>>,
): boolean {
  if (foldedIds.length < 2) return false;
  const groups = foldedIds.map((runId) =>
    (snapshotMessagesByRunId.get(runId) ?? []).filter(
      (candidate) => candidate.id !== root.id,
    ),
  );
  const presentIndices = groups.flatMap((group, index) =>
    group.length > 0 ? [index] : [],
  );
  if (presentIndices.length === 0) return false;
  const first = presentIndices[0]!;
  const last = presentIndices.at(-1)!;
  if (last - first + 1 !== presentIndices.length) return false;

  const projectedText = groups
    .slice(first, last + 1)
    .flatMap((group, index) => {
      const runId = foldedIds[first + index]!;
      if (
        group.some(
          (candidate) =>
            explicitRunId(candidate) !== runId &&
            messageIdsByRun.get(runId)?.size !== 1,
        )
      ) {
        return [undefined];
      }
      return group.map((candidate) => text(candidate, true));
    });
  if (projectedText.some((value) => value === undefined)) return false;
  const candidateText = projectedText.join("");
  const rootText = text(root);
  if (!rootText || !candidateText) return false;
  const isPrefix = first === 0 && rootText.startsWith(candidateText);
  const isSuffix =
    last === foldedIds.length - 1 && rootText.endsWith(candidateText);
  return isPrefix || isSuffix;
}

/** AgentKit messages that represent durable root assistant messages. */
export function projectRootAssistantMessages(input: {
  rootMessages: unknown;
  snapshotMessages: unknown;
  events?: unknown;
  runs?: unknown;
  toolCalls?: unknown;
}): {
  representedRootMessageIds: Set<string>;
  snapshotMessageIdsByRootMessageId: Map<string, string>;
  snapshotRunIdsByMessageId: Map<string, string>;
} {
  const rootMessages = Array.isArray(input.rootMessages)
    ? input.rootMessages.flatMap((value) => {
        const entry = message(value);
        return entry ? [entry] : [];
      })
    : [];
  const snapshotMessages = Array.isArray(input.snapshotMessages)
    ? input.snapshotMessages.flatMap((value) => {
        const entry = message(value);
        return entry ? [entry] : [];
      })
    : [];
  const runIdsByMessageId = eventRunIds(input.events, input.runs);
  const messageIdsByRun = eventMessageIdsByRun(runIdsByMessageId);
  const snapshotUserIdsByRun = new Map<string, string | null>();
  for (const root of rootMessages) {
    if (root.role !== "user") continue;
    const custom = record(record(root.metadata)?.custom);
    const snapshotId =
      typeof custom?.agentKitMessageId === "string"
        ? custom.agentKitMessageId
        : typeof root.id === "string"
          ? root.id
          : undefined;
    const runId = custom?.submittedRunId;
    if (!snapshotId || typeof runId !== "string") continue;
    snapshotUserIdsByRun.set(
      snapshotId,
      snapshotUserIdsByRun.has(snapshotId) ? null : runId,
    );
  }
  const snapshotUserCounts = new Map<string, number>();
  for (const candidate of snapshotMessages) {
    if (candidate.role !== "user" || typeof candidate.id !== "string") continue;
    snapshotUserCounts.set(
      candidate.id,
      (snapshotUserCounts.get(candidate.id) ?? 0) + 1,
    );
  }
  for (const [snapshotId, runId] of snapshotUserIdsByRun) {
    if (snapshotUserCounts.get(snapshotId) !== 1 || runId === null) {
      snapshotUserIdsByRun.delete(snapshotId);
    }
  }
  const snapshotMessagesByRunId = new Map<string, Record<string, unknown>[]>();
  const snapshotRunIdsByMessageId = new Map<string, string>();
  let submittedRunId: string | undefined;
  for (const candidate of snapshotMessages) {
    if (candidate.role === "user") {
      const candidateRunId =
        typeof candidate.id === "string"
          ? snapshotUserIdsByRun.get(candidate.id)
          : undefined;
      submittedRunId =
        typeof candidateRunId === "string" ? candidateRunId : undefined;
      continue;
    }
    if (candidate.role !== "assistant") continue;
    const eventRunIds =
      typeof candidate.id === "string"
        ? runIdsByMessageId.get(candidate.id)
        : undefined;
    const inferredRunId =
      !eventRunIds?.size && !explicitRunId(candidate)
        ? submittedRunId
        : undefined;
    const runId = assistantRunId(candidate, runIdsByMessageId, inferredRunId);
    if (!runId || typeof candidate.id !== "string") continue;
    if (inferredRunId) snapshotRunIdsByMessageId.set(candidate.id, runId);
    const candidates = snapshotMessagesByRunId.get(runId);
    if (candidates) candidates.push(candidate);
    else snapshotMessagesByRunId.set(runId, [candidate]);
  }
  const represented = new Set<string>();
  const directMatches = new Map<string, string>();
  for (const root of rootMessages) {
    if (root.role !== "assistant" || typeof root.id !== "string") continue;
    const runId = explicitRunId(root);
    if (!runId) continue;
    const toolMessageIds = representedToolCallMessageIds(root, input.toolCalls);
    const sameRunCandidates = (snapshotMessagesByRunId.get(runId) ?? []).filter(
      (candidate) => candidate.id !== root.id,
    );
    const sameRunMatches = sameRunCandidates.filter((candidate) =>
      contentMatches(root, candidate, toolMessageIds),
    );
    const rootText = text(root);
    const matchingCandidate = sameRunMatches[0];
    const exactTextMatch =
      matchingCandidate !== undefined &&
      rootText !== undefined &&
      text(matchingCandidate) === rootText;
    const clientCanMatchPartial =
      matchingCandidate !== undefined &&
      (explicitRunId(matchingCandidate) === runId ||
        (typeof matchingCandidate.id === "string" &&
          (snapshotRunIdsByMessageId.get(matchingCandidate.id) === runId ||
            (runIdsByMessageId.get(matchingCandidate.id)?.size === 1 &&
              messageIdsByRun.get(runId)?.size === 1))));
    if (
      sameRunMatches.length === 1 &&
      (exactTextMatch ||
        (sameRunCandidates.length === 1 && clientCanMatchPartial))
    ) {
      represented.add(root.id);
      if (typeof matchingCandidate.id === "string") {
        directMatches.set(root.id, matchingCandidate.id);
      }
      continue;
    }
    if (
      toolMessageIds !== undefined &&
      foldedProjectionMatches(
        root,
        snapshotMessagesByRunId,
        foldedRunIds(root),
        messageIdsByRun,
      )
    ) {
      represented.add(root.id);
    }
  }
  const directMatchCountBySnapshotId = new Map<string, number>();
  for (const snapshotId of directMatches.values()) {
    directMatchCountBySnapshotId.set(
      snapshotId,
      (directMatchCountBySnapshotId.get(snapshotId) ?? 0) + 1,
    );
  }
  const snapshotMessageIdsByRootMessageId = new Map<string, string>();
  for (const [rootId, snapshotId] of directMatches) {
    if (directMatchCountBySnapshotId.get(snapshotId) !== 1) {
      represented.delete(rootId);
      continue;
    }
    snapshotMessageIdsByRootMessageId.set(rootId, snapshotId);
  }
  return {
    representedRootMessageIds: represented,
    snapshotMessageIdsByRootMessageId,
    snapshotRunIdsByMessageId,
  };
}

/** Root assistant IDs represented by the AgentKit snapshot. */
export function representedRootAssistantMessageIds(input: {
  rootMessages: unknown;
  snapshotMessages: unknown;
  events?: unknown;
  runs?: unknown;
  toolCalls?: unknown;
}): Set<string> {
  return projectRootAssistantMessages(input).representedRootMessageIds;
}
