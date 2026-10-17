import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";

type Handoff = {
  scope: string;
  owner: string;
  ownerSlackId?: string;
  action: string;
  status?: "unassigned" | "accepted" | "completed";
  requestReply?: {
    ts: string;
    threadParentTs: string;
    actorId: string;
    text: string;
  };
  acceptanceReply?: {
    ts: string;
    threadParentTs: string;
    actorId: string;
    text: string;
  };
  completion?: {
    evidence: string;
    sourceUrl?: string;
    reply?: {
      ts: string;
      threadParentTs: string;
      actorId: string;
      text: string;
    };
  };
  ticketUrl?: string;
};

type StatusReply = {
  ts: string;
  threadParentTs: string;
  actorId: string;
  disposition: string;
  evidence: string;
  text: string;
};

type OtherOwnerEvidence = {
  actorId: string;
  statusReply: StatusReply;
};

type SlackFileAttachment = {
  id: string;
  name: string;
  mimeType: string;
};

type HistoricalReactionMark = {
  emoji: "white_check_mark" | "ticket";
  scope: string;
  reason: string;
  previousStatus: StatusReply;
  handoff?: Handoff;
  withdrawalReply?: {
    ts: string;
    threadParentTs: string;
    actorId: string;
    text: string;
  };
};

type RootResolution =
  | {
      evidence: "slack_message.thread_ts";
      sourceThreadTs: string | null;
      rootTs: string;
    }
  | {
      evidence: "slack_permalink.thread_ts";
      sourceThreadTs: string | null;
      rootTs: string;
      sourcePermalink: string;
    }
  | {
      evidence: "slack_reply_permalink.thread_ts";
      sourceThreadTs: string;
      sourceMessageTs: string;
      rootTs: string;
      sourcePermalink: string;
    };

type Parent = {
  ts: string;
  threadParentTs: string;
  rootResolution?: RootResolution;
  // Required on root messages so administrative posts are not counted as reports.
  rootClassification?: "report" | "administrative";
  rootClassificationReason?: string;
  // Attachments on this source message, preserved from Slack's read-back.
  files?: SlackFileAttachment[];
  reactionChecked: boolean;
  // Exact time of the latest root reaction read-back.
  reactionReadAt?: string;
  // Set only when this sweep changed a root reaction; read-back must follow it.
  reactionWriteAt?: string;
  reactionSummary: string;
  reactionOwners: Record<string, string[]>;
  disposition: string;
  // Latest relevant human thread reply other than statusReply; null if none.
  latestRelevantHumanReply?: {
    ts: string;
    actorId: string;
    text: string;
    files?: SlackFileAttachment[];
  } | null;
  // Latest reply by this sweep actor in the root thread, read from Slack.
  latestOwnedReply?: {
    ts: string;
    threadParentTs: string;
    actorId: string;
    text: string;
  };
  statusReply?: StatusReply;
  // Permanently retained marks whose formerly verified/accepted meaning changed.
  historicalReactionMarks?: HistoricalReactionMark[];
  // A different actor's active root 👀 plus their current status, for Owned elsewhere.
  otherOwnerEvidence?: OtherOwnerEvidence;
  reactionDecision?: {
    checkmark: { state: "present" | "none"; reason: string };
    ticket: { state: "present" | "none"; reason: string };
  };
  fixedScopes?: Array<{
    scope: string;
    verification: string;
    verifiedAfterHumanReplyTs?: string;
  }>;
  unfinishedScopes?: Array<{ scope: string; evidence: string }>;
  handoff?: Handoff;
  handoffs?: Handoff[];
};

type ThreadSnapshot = {
  rootTs: string;
  readAt: string;
  replyCount: number;
  rootFiles?: SlackFileAttachment[];
  replies: Array<{
    ts: string;
    actorId: string;
    kind: "human" | "sweep" | "bot";
    text: string;
    files?: SlackFileAttachment[];
    // Slack reaction read-back for workflow marks only; unrelated emoji are omitted.
    workflowReactionSummary: string;
    workflowReactionOwners: Record<string, string[]>;
    workflowReactionReadAt?: string;
  }>;
};

type Page = {
  readAt?: string;
  cursor: string | null;
  nextCursor: string | null;
  exhausted: boolean;
  messageCount: number;
  sourceTimestamps: string[];
  parents: Parent[];
};

type SourceReceiptPage = Omit<
  Pick<
    Page,
    | "cursor"
    | "nextCursor"
    | "exhausted"
    | "readAt"
    | "messageCount"
    | "sourceTimestamps"
  >,
  "readAt"
> & { readAt: string };

type SourceReceiptRow = { ts: string; root: string };

type SourceReceiptChannel = {
  channelId: string;
  pages: SourceReceiptPage[];
  rows: SourceReceiptRow[];
};

type SourceReceipt = {
  channels: Record<string, SourceReceiptChannel>;
};

type RawSourcePageEvidence = SourceReceiptPage & {
  rows: SourceReceiptRow[];
};

type RawSourcePages = Record<string, RawSourcePageEvidence[]>;

type ChannelScanQuery = {
  tool: "slack_search_public";
  after: string;
  filters: string;
  keywords: [];
  natural_language_query: "";
  include_bots: true;
  include_context: false;
  content_types: "messages";
  limit: 20;
  sort: "timestamp";
  sort_dir: "desc";
  response_format: "detailed";
};

type Channel = {
  channelId: string;
  scanQuery: ChannelScanQuery;
  oldestQuery: string | null;
  pages: Page[];
  // Actual Slack root timestamps fetched for replies whose roots are off-page.
  threadRoots?: string[];
  // The root message's own reaction and disposition audit, not just the reply.
  threadRootAudits?: Parent[];
  // Full read_thread read-backs for every root with this actor's marks.
  threadSnapshots?: ThreadSnapshot[];
};

type Inventory = {
  cutoffTs: string;
  permalinkTs?: string;
  sweepActorId: string;
  channels: Channel[];
};

const canonicalDispositions = new Set([
  "Fixed",
  "Partially fixed",
  "Shipped",
  "Live verified",
  "Open - no question",
  "Resolved elsewhere",
  "Skipped",
  "Clustered",
  "Abandoned - no answer in 4 days",
  "Verified locally",
  "Built - live unverified",
  "Deployed - live unverified",
  "Not reproducible - attempted",
  "In progress",
  "Asked",
  "Clarification needed",
  "Blocked on reporter",
  "Blocked on human owner",
  "Owned elsewhere",
]);

const openDispositions = new Set([
  "Partially fixed",
  "Open - no question",
  "Verified locally",
  "Built - live unverified",
  "Deployed - live unverified",
  "Not reproducible - attempted",
  "In progress",
  "Asked",
  "Clarification needed",
  "Blocked on reporter",
  "Blocked on human owner",
]);

function slackTimestamp(value: unknown, label: string): bigint {
  const match = /^(\d+)\.(\d{1,6})$/.exec(String(value ?? ""));
  if (!match) throw new Error(`${label} must be a Slack timestamp`);
  return BigInt(match[1]) * 1_000_000n + BigInt(match[2].padEnd(6, "0"));
}

function isSlackUserId(value: unknown): value is string {
  return typeof value === "string" && /^[UW][A-Z0-9]+$/.test(value);
}

function validateSlackFiles(
  label: string,
  files: SlackFileAttachment[] | undefined,
): void {
  if (
    files !== undefined &&
    (!Array.isArray(files) ||
      files.some(
        (file) =>
          !file ||
          !/^F[A-Z0-9]+$/.test(file.id) ||
          typeof file.name !== "string" ||
          !file.name.trim() ||
          typeof file.mimeType !== "string" ||
          !file.mimeType.trim(),
      ) ||
      new Set(files.map((file) => file.id)).size !== files.length)
  ) {
    throw new Error(
      `${label}: preserve each Slack attachment's exact file ID, name, and MIME type`,
    );
  }
}

function validateSourceFilesInSnapshot(
  parentName: string,
  parent: Parent,
  snapshot: ThreadSnapshot | undefined,
): void {
  if (!snapshot) {
    if (parent.files?.length) {
      throw new Error(
        `${parentName}: attached source files need a full thread read-back`,
      );
    }
    return;
  }
  const snapshotFiles =
    parent.ts === parent.threadParentTs
      ? snapshot.rootFiles
      : snapshot.replies.find((reply) => reply.ts === parent.ts)?.files;
  if (
    JSON.stringify(snapshotFiles ?? []) !== JSON.stringify(parent.files ?? [])
  ) {
    throw new Error(
      `${parentName}: threadSnapshot attachment IDs, names, and MIME types must match the source message`,
    );
  }
}

type WorkflowReactionState = {
  eyes: boolean;
  white_check_mark: boolean;
  ticket: boolean;
};

function workflowReactionState(
  owners: Record<string, string[]> | undefined,
  actorId: string,
): WorkflowReactionState {
  return {
    eyes: (owners?.eyes ?? []).includes(actorId),
    white_check_mark: (owners?.white_check_mark ?? []).includes(actorId),
    ticket: (owners?.ticket ?? []).includes(actorId),
  };
}

function hasWorkflowReaction(state: WorkflowReactionState): boolean {
  return state.eyes || state.white_check_mark || state.ticket;
}

function validateLegacyReplyReactionReadback(
  parentName: string,
  parent: Parent,
  snapshot: ThreadSnapshot | undefined,
  sweepActorId: string,
  requireFreshReads: boolean,
): void {
  const sourceReactions = workflowReactionState(
    parent.reactionOwners,
    sweepActorId,
  );
  if (!hasWorkflowReaction(sourceReactions)) return;

  const readback = snapshot?.replies.find((reply) => reply.ts === parent.ts);
  if (!readback) {
    throw new Error(
      `${parentName}: retained reply workflow marks need an exact full-thread reaction read-back`,
    );
  }
  validateReactionOwners(
    `${parentName}.threadSnapshot reply ${parent.ts}`,
    readback.workflowReactionSummary,
    readback.workflowReactionOwners,
  );
  if (typeof readback.workflowReactionReadAt !== "string") {
    throw new Error(
      `${parentName}: retained reply workflow marks need a timestamped exact reaction read-back`,
    );
  }
  if (requireFreshReads) {
    const reactionReadAt = validateReadAt(
      readback.workflowReactionReadAt,
      `${parentName}.threadSnapshot reply ${parent.ts}.workflowReactionReadAt`,
      "read the exact reply reactions again before recap",
    );
    if (reactionReadAt < Date.parse(snapshot!.readAt)) {
      throw new Error(
        `${parentName}: reply reaction read-back must follow its full-thread read`,
      );
    }
  }

  const workflowOwners = (owners: Record<string, string[]>) =>
    Object.fromEntries(
      (["eyes", "white_check_mark", "ticket"] as const)
        .filter((emoji) => owners[emoji]?.length)
        .map((emoji) => [emoji, [...owners[emoji]].sort()]),
    );
  if (
    !isDeepStrictEqual(
      workflowOwners(parent.reactionOwners),
      workflowOwners(readback.workflowReactionOwners),
    )
  ) {
    throw new Error(
      `${parentName}: retained reply workflow marks must match the full-thread reaction read-back`,
    );
  }
}

function validateRootResolution(
  parentName: string,
  parent: Parent,
  channelId: string,
  messageTimestamp: bigint,
  threadParentTimestamp: bigint,
): void {
  const resolution = parent.rootResolution;
  if (
    !resolution ||
    ![
      "slack_message.thread_ts",
      "slack_permalink.thread_ts",
      "slack_reply_permalink.thread_ts",
    ].includes(resolution.evidence) ||
    !Object.prototype.hasOwnProperty.call(resolution, "sourceThreadTs")
  ) {
    throw new Error(
      `${parentName}: rootResolution must record the source thread_ts or a canonical source/reply permalink and resolved root`,
    );
  }

  const resolvedRootTimestamp = slackTimestamp(
    resolution.rootTs,
    `${parentName}.rootResolution.rootTs`,
  );
  if (resolvedRootTimestamp !== threadParentTimestamp) {
    throw new Error(
      `${parentName}: rootResolution rootTs must match threadParentTs`,
    );
  }

  if (
    resolution.evidence === "slack_permalink.thread_ts" ||
    resolution.evidence === "slack_reply_permalink.thread_ts"
  ) {
    if (typeof resolution.sourcePermalink !== "string") {
      throw new Error(
        `${parentName}: permalink rootResolution needs the exact source permalink`,
      );
    }
    let sourcePermalink: URL;
    try {
      sourcePermalink = new URL(resolution.sourcePermalink);
    } catch {
      throw new Error(
        `${parentName}: rootResolution sourcePermalink must be a canonical Slack message permalink`,
      );
    }
    const pathMatch = /^\/archives\/([^/]+)\/p(\d+)$/.exec(
      sourcePermalink.pathname,
    );
    if (
      sourcePermalink.protocol !== "https:" ||
      !sourcePermalink.hostname.endsWith(".slack.com") ||
      sourcePermalink.username ||
      sourcePermalink.password ||
      sourcePermalink.hash ||
      !pathMatch ||
      pathMatch[1] !== channelId ||
      pathMatch[2]!.length < 7
    ) {
      throw new Error(
        `${parentName}: rootResolution sourcePermalink must identify this channel's canonical message`,
      );
    }
    const permalinkTimestamp = slackTimestamp(
      `${pathMatch[2]!.slice(0, -6)}.${pathMatch[2]!.slice(-6)}`,
      `${parentName}.rootResolution.sourcePermalink timestamp`,
    );
    const expectedMessageTimestamp =
      resolution.evidence === "slack_reply_permalink.thread_ts"
        ? slackTimestamp(
            resolution.sourceMessageTs,
            `${parentName}.rootResolution.sourceMessageTs`,
          )
        : messageTimestamp;
    if (permalinkTimestamp !== expectedMessageTimestamp) {
      throw new Error(
        `${parentName}: source permalink message timestamp must match its recorded source message`,
      );
    }
    const permalinkThreadTimestamps =
      sourcePermalink.searchParams.getAll("thread_ts");
    if (permalinkThreadTimestamps.length > 1) {
      throw new Error(
        `${parentName}: source permalink must have at most one thread_ts query value`,
      );
    }
    if (resolution.sourceThreadTs === null) {
      if (
        permalinkThreadTimestamps.length > 0 &&
        slackTimestamp(
          permalinkThreadTimestamps[0],
          `${parentName}.rootResolution.sourcePermalink thread_ts`,
        ) !== messageTimestamp
      ) {
        throw new Error(
          `${parentName}: source permalink thread_ts contradicts the claimed self-root`,
        );
      }
    } else {
      if (permalinkThreadTimestamps.length !== 1) {
        throw new Error(
          `${parentName}: reply permalink rootResolution needs its exact thread_ts query value`,
        );
      }
      const permalinkThreadTimestamp = slackTimestamp(
        permalinkThreadTimestamps[0],
        `${parentName}.rootResolution.sourcePermalink thread_ts`,
      );
      const sourceThreadTimestamp = slackTimestamp(
        resolution.sourceThreadTs,
        `${parentName}.rootResolution.sourceThreadTs`,
      );
      if (permalinkThreadTimestamp !== sourceThreadTimestamp) {
        throw new Error(
          `${parentName}: source permalink thread_ts must match sourceThreadTs`,
        );
      }
      if (
        resolution.evidence === "slack_reply_permalink.thread_ts" &&
        sourceThreadTimestamp >= expectedMessageTimestamp
      ) {
        throw new Error(
          `${parentName}: a reply permalink must identify a message newer than its thread root`,
        );
      }
    }
  }

  if (resolution.sourceThreadTs === null) {
    if (
      messageTimestamp !== threadParentTimestamp ||
      messageTimestamp !== resolvedRootTimestamp
    ) {
      throw new Error(
        `${parentName}: missing source thread_ts proves a self-root only when rootTs equals the message timestamp`,
      );
    }
    return;
  }

  const sourceThreadTimestamp = slackTimestamp(
    resolution.sourceThreadTs,
    `${parentName}.rootResolution.sourceThreadTs`,
  );
  if (
    sourceThreadTimestamp > messageTimestamp ||
    sourceThreadTimestamp !== threadParentTimestamp ||
    sourceThreadTimestamp !== resolvedRootTimestamp
  ) {
    throw new Error(
      `${parentName}: source message thread_ts must match the verified parent root`,
    );
  }
}

function validateThreadSnapshotStructure(
  parentName: string,
  rootTs: string,
  snapshot: ThreadSnapshot | undefined,
  sweepActorId: string,
  requireFreshReads = false,
): void {
  if (!snapshot) {
    throw new Error(
      `${parentName}: read the complete Slack thread again and record its threadSnapshot`,
    );
  }
  if (snapshot.rootTs !== rootTs) {
    throw new Error(
      `${parentName}: threadSnapshot must identify the exact root`,
    );
  }
  validateSlackFiles(
    `${parentName}.threadSnapshot.rootFiles`,
    snapshot.rootFiles,
  );
  const rootTimestamp = slackTimestamp(
    rootTs,
    `${parentName}.threadSnapshot.rootTs`,
  );
  if (
    !Number.isInteger(snapshot.replyCount) ||
    !Array.isArray(snapshot.replies) ||
    snapshot.replyCount !== snapshot.replies.length
  ) {
    throw new Error(
      `${parentName}: threadSnapshot must contain every reply reported by Slack`,
    );
  }
  const readAt = Date.parse(snapshot.readAt);
  if (
    !Number.isFinite(readAt) ||
    new Date(readAt).toISOString() !== snapshot.readAt
  ) {
    throw new Error(
      `${parentName}: threadSnapshot.readAt must be an ISO timestamp`,
    );
  }

  let previousReplyTs = rootTimestamp;
  for (const [replyIndex, reply] of snapshot.replies.entries()) {
    const replyName = `${parentName}.threadSnapshot reply ${replyIndex + 1}`;
    const replyTs = slackTimestamp(reply.ts, `${replyName}.ts`);
    if (replyTs <= previousReplyTs) {
      throw new Error(
        `${parentName}: threadSnapshot replies must be oldest-first`,
      );
    }
    if (
      typeof reply.actorId !== "string" ||
      !reply.actorId.trim() ||
      !["human", "sweep", "bot"].includes(reply.kind) ||
      typeof reply.text !== "string" ||
      (reply.kind === "human" &&
        !reply.text.trim() &&
        (!Array.isArray(reply.files) || reply.files.length === 0)) ||
      (reply.kind === "sweep") !== (reply.actorId === sweepActorId)
    ) {
      throw new Error(
        `${replyName}: record the exact author, message text or attachments, and human/sweep/bot classification`,
      );
    }
    validateSlackFiles(`${replyName}.files`, reply.files);
    if (
      typeof reply.workflowReactionSummary !== "string" ||
      !reply.workflowReactionSummary.trim() ||
      !reply.workflowReactionOwners ||
      typeof reply.workflowReactionOwners !== "object" ||
      Array.isArray(reply.workflowReactionOwners)
    ) {
      throw new Error(
        `${replyName}: record workflow reaction owners for each reply`,
      );
    }
    validateReactionOwners(
      `${replyName}.workflowReactions`,
      reply.workflowReactionSummary,
      reply.workflowReactionOwners,
    );
    const hasWorkflowReaction = ["eyes", "white_check_mark", "ticket"].some(
      (emoji) => (reply.workflowReactionOwners[emoji]?.length ?? 0) > 0,
    );
    if (hasWorkflowReaction) {
      const reactionReadAt = reply.workflowReactionReadAt;
      const reactionReadTime =
        typeof reactionReadAt === "string" ? Date.parse(reactionReadAt) : NaN;
      if (
        !Number.isFinite(reactionReadTime) ||
        new Date(reactionReadTime).toISOString() !== reactionReadAt
      ) {
        throw new Error(
          `${replyName}.workflowReactionReadAt must be an ISO timestamp`,
        );
      }
      if (reactionReadTime < readAt) {
        throw new Error(
          `${replyName}: reaction read-back must follow the full-thread read`,
        );
      }
      if (requireFreshReads) {
        validateReadAt(
          reply.workflowReactionReadAt,
          `${replyName}.workflowReactionReadAt`,
          "read the exact reply reactions again before recap",
        );
      }
    }
    previousReplyTs = replyTs;
  }
  if (snapshot.replies.length > 0 && BigInt(readAt) < previousReplyTs / 1000n) {
    throw new Error(
      `${parentName}: threadSnapshot.readAt must be after the newest reply it records`,
    );
  }
}

function validateThreadSnapshot(
  parentName: string,
  rootTs: string,
  snapshot: ThreadSnapshot | undefined,
  parent: Parent,
  sweepActorId: string,
): void {
  validateThreadSnapshotStructure(parentName, rootTs, snapshot, sweepActorId);
  const replies = snapshot!.replies;
  const sweepReplies = replies.filter((reply) => reply.kind === "sweep");
  const humanReplies = replies.filter((reply) => reply.kind === "human");
  const repliesByTimestamp = new Map(replies.map((reply) => [reply.ts, reply]));

  const statusReply = parent.statusReply;
  const latestOwnedReply = parent.latestOwnedReply;
  const lastSweepReply = sweepReplies.at(-1);
  if (
    !statusReply ||
    !latestOwnedReply ||
    !lastSweepReply ||
    lastSweepReply.ts !== statusReply.ts ||
    lastSweepReply.actorId !== statusReply.actorId ||
    lastSweepReply.text !== statusReply.text ||
    latestOwnedReply.ts !== lastSweepReply.ts ||
    latestOwnedReply.actorId !== lastSweepReply.actorId ||
    latestOwnedReply.text !== lastSweepReply.text
  ) {
    throw new Error(
      `${parentName}: threadSnapshot must confirm the status is this actor's latest reply in the root thread`,
    );
  }
  if (repliesByTimestamp.get(statusReply.ts)?.text !== statusReply.text) {
    throw new Error(
      `${parentName}: threadSnapshot is missing the exact status reply read-back`,
    );
  }

  const latestHumanReply = humanReplies.at(-1);
  const recordedHumanReply = parent.latestRelevantHumanReply;
  if (
    (latestHumanReply === undefined) !== (recordedHumanReply === null) ||
    (latestHumanReply !== undefined &&
      (!recordedHumanReply ||
        latestHumanReply.ts !== recordedHumanReply.ts ||
        latestHumanReply.actorId !== recordedHumanReply.actorId ||
        latestHumanReply.text !== recordedHumanReply.text ||
        JSON.stringify(latestHumanReply.files ?? []) !==
          JSON.stringify(recordedHumanReply.files ?? [])))
  ) {
    throw new Error(
      `${parentName}: threadSnapshot reveals a newer or unrecorded human reply; update the status before reconciling`,
    );
  }

  const handoffs = parent.handoffs ?? (parent.handoff ? [parent.handoff] : []);
  for (const handoff of handoffs) {
    const request = handoff.requestReply;
    if (
      request &&
      (repliesByTimestamp.get(request.ts)?.actorId !== request.actorId ||
        repliesByTimestamp.get(request.ts)?.text !== request.text)
    ) {
      throw new Error(
        `${parentName}: threadSnapshot must confirm each direct handoff request in the source thread`,
      );
    }
    const acceptance = handoff.acceptanceReply;
    if (
      acceptance &&
      (repliesByTimestamp.get(acceptance.ts)?.actorId !== acceptance.actorId ||
        repliesByTimestamp.get(acceptance.ts)?.text !== acceptance.text)
    ) {
      throw new Error(
        `${parentName}: threadSnapshot must confirm each handoff acceptance in the source thread`,
      );
    }
    const completionReply = handoff.completion?.reply;
    if (
      completionReply &&
      (repliesByTimestamp.get(completionReply.ts)?.actorId !==
        completionReply.actorId ||
        repliesByTimestamp.get(completionReply.ts)?.text !==
          completionReply.text)
    ) {
      throw new Error(
        `${parentName}: threadSnapshot must confirm each handoff completion reply in the source thread`,
      );
    }
  }
}

function isNamedHumanOwner(owner: string): boolean {
  const personName = owner.split(/[/(]/, 1)[0]!.trim();
  if (
    /\b(?:unassigned|not assigned|owner|lead|team|admin|author|engineer(?:ing)?|product|release|workspace|app|production|security|data|code|actions|role|analyst|designer|developer|manager|director|reviewer|maintainer|approver|support|ops|on[ -]?call|platform)\b/i.test(
      personName,
    )
  ) {
    return false;
  }
  const nameParts = personName.split(/\s+/);
  return (
    nameParts.length > 0 &&
    nameParts.length <= 4 &&
    nameParts.every((part) => /^(?:\p{Lu}[\p{L}'’.-]*|[A-Z]\.)$/u.test(part))
  );
}

function validateReactionOwners(
  parentName: string,
  reactionSummary: string,
  reactionOwners: Record<string, string[]>,
): void {
  const summary = reactionSummary.trim();
  if (summary === "none") {
    if (Object.keys(reactionOwners).length > 0) {
      throw new Error(
        `${parentName}: reactionOwners must be empty when the observed reaction state is none`,
      );
    }
    return;
  }

  const observed = new Map<string, string[]>();
  for (const [reactionIndex, entry] of summary.split(/;\s*/).entries()) {
    const match = /^(.+?)\s+\((\d+)\):\s*(.+)$/.exec(entry);
    if (!match) {
      throw new Error(
        `${parentName}: reactionSummary must list each emoji, count, and exact owner IDs`,
      );
    }
    const emoji = match[1].trim();
    const count = Number(match[2]);
    const summaryOwners = match[3].split(/,\s*/);
    if (!emoji || observed.has(emoji)) {
      throw new Error(
        `${parentName}: reactionSummary has a missing or duplicate emoji entry at ${reactionIndex + 1}`,
      );
    }
    if (
      !Number.isInteger(count) ||
      count < 1 ||
      summaryOwners.length !== count ||
      summaryOwners.some((owner) => !isSlackUserId(owner)) ||
      new Set(summaryOwners).size !== summaryOwners.length
    ) {
      throw new Error(
        `${parentName}: reactionSummary counts and owner IDs must agree`,
      );
    }
    observed.set(emoji, summaryOwners);
  }

  for (const [emoji, summaryOwners] of observed) {
    const owners = reactionOwners[emoji];
    if (!Array.isArray(owners)) {
      throw new Error(
        `${parentName}: reactionOwners is missing the observed ${emoji} owners`,
      );
    }
    if (
      owners.some((owner) => !isSlackUserId(owner)) ||
      new Set(owners).size !== owners.length ||
      owners.length !== summaryOwners.length ||
      owners.some((owner) => !summaryOwners.includes(owner))
    ) {
      throw new Error(
        `${parentName}: reactionOwners must match every exact owner in reactionSummary`,
      );
    }
  }

  for (const [emoji, owners] of Object.entries(reactionOwners)) {
    if (!observed.has(emoji) || !Array.isArray(owners) || owners.length === 0) {
      throw new Error(
        `${parentName}: reactionOwners has an unobserved or empty ${emoji} entry`,
      );
    }
  }
}

function normalizeScope(scope: string): string {
  return scope.replace(/[*_`]/g, "").trim().replace(/\s+/g, " ").toLowerCase();
}

function normalizeReplyPhrase(phrase: string): string {
  return (
    phrase
      .replace(/[*_`]/g, "")
      .toLowerCase()
      .match(/[\p{L}\p{N}]+/gu)
      ?.filter((word) => !["a", "an", "the"].includes(word))
      .join(" ") ?? ""
  );
}

function replyNamesHandoffs(text: string, handoffs: Handoff[]): boolean {
  const reply = ` ${normalizeReplyPhrase(text)} `;
  return handoffs.every((handoff) => {
    const namesRecordedAction = [
      handoff.scope,
      handoff.owner,
      handoff.action,
    ].every((phrase) => {
      const normalizedPhrase = normalizeReplyPhrase(phrase);
      return normalizedPhrase !== "" && reply.includes(` ${normalizedPhrase} `);
    });
    return (
      namesRecordedAction &&
      (handoff.status !== "unassigned" || reply.includes(" unassigned "))
    );
  });
}

function replyNamesHandoffAction(text: string, action: string): boolean {
  const reply = ` ${normalizeReplyPhrase(text)} `;
  const normalizedAction = normalizeReplyPhrase(action);
  return normalizedAction !== "" && reply.includes(` ${normalizedAction} `);
}

function replyNamesHandoffOwner(text: string, handoff: Handoff): boolean {
  const normalizedReply = ` ${normalizeReplyPhrase(text)} `;
  const normalizedOwner = normalizeReplyPhrase(handoff.owner);
  const ownerNameIsPresent =
    normalizedOwner !== "" && normalizedReply.includes(` ${normalizedOwner} `);
  const ownerMentionIsPresent =
    isSlackUserId(handoff.ownerSlackId) &&
    new RegExp(`<@${handoff.ownerSlackId}(?:\\|[^>]+)?>`).test(text);
  return ownerNameIsPresent || ownerMentionIsPresent;
}

function replyDirectlyRequestsHandoff(text: string, handoff: Handoff): boolean {
  const requestsAssignedWork =
    /\b(?:can|could|would|will)\s+you\b|\bplease\b/i.test(text) ||
    /\b(?:this|that|it)\s+(?:is|was)\s+in\s+your\s+(?:to[ -]?do|todo|pr|queue)\b/i.test(
      text,
    );
  return (
    requestsAssignedWork &&
    replyNamesHandoffOwner(text, handoff) &&
    replyNamesHandoffAction(text, handoff.action)
  );
}

function replyExplicitlyRefusesHandoff(text: string): boolean {
  const normalized = text
    .normalize("NFKC")
    .replace(/[’‘]/g, "'")
    .toLowerCase();
  const refusedAction =
    "(?:take|handle|do|own|accept|review|investigate|fix|choose|configure|set|schedule|complete|test|expand|supersede|help with|work on|commit|promise)";
  return (
    new RegExp(
      `\\b(?:(?:i|we)\\s+(?:(?:will|can|could|would|am|are|do)\\s+)?not\\s+(?:able to\\s+|going to\\s+)?${refusedAction}\\b|(?:i|we)'(?:ll|m|re|d|ve)\\s+not\\s+${refusedAction}\\b|(?:can't|cannot|won't|wouldn't|shouldn't|don't|do not|will not|would not|could not)\\s+${refusedAction}\\b|not\\s+going to\\s+${refusedAction}\\b|declin(?:e|ed|ing)\\s+(?:to\\s+)?${refusedAction}\\b)`,
    ).test(normalized) ||
    /\b(?:i|we)\s+(?:need to|have to)\s+back out\b|\b(?:i|we)\s+(?:no longer|don't|do not)\s+have\s+(?:the\s+)?(?:time|capacity|bandwidth)\b|\b(?:not sure|unsure|uncertain)\s+(?:if|whether)\s+(?:i|we)\s+(?:can|will)\b|\b(?:i|we)\s+(?:may|might)\s+not be able to\b/i.test(
      normalized,
    )
  );
}

function replyExplicitlyAcceptsHandoff(text: string): boolean {
  const normalized = text
    .normalize("NFKC")
    .replace(/[’‘]/g, "'")
    .toLowerCase();
  if (replyExplicitlyRefusesHandoff(normalized)) return false;
  const firstClause = normalized.split(/[.!?;\n]/, 1)[0] ?? normalized;
  if (
    /\b(?:maybe|perhaps|possibly|might|may|could|would)\b|\b(?:if|unless|provided that|depending on)\b/.test(
      firstClause,
    )
  ) {
    return false;
  }
  return /\b(?:(?:i|we)(?:'ll|\s+will|\s+can)\s+(?:take|handle|do|own|accept|review|investigate|fix|choose|configure|set|schedule|complete|test|expand|supersede|help with|work on)\b|(?:i|we)(?:'m|\s+am)\s+(?:taking|handling|doing|owning|accepting|reviewing|investigating|fixing|choosing|configuring|setting|scheduling|completing|testing|expanding|superseding|working on)\b|happy to (?:take|handle|do|test|fix|review|investigate)\b|will do\b|i(?:'m| am) on it\b)/i.test(
    normalized,
  );
}

function replyContextuallyAssentsToHandoff(text: string): boolean {
  const normalized = text
    .normalize("NFKC")
    .replace(/[’‘]/g, "'")
    .toLowerCase()
    .trim();
  const firstClause = normalized.split(/[,.!?;\n—–]/, 1)[0]?.trim() ?? "";
  const confirmsAssignedPr =
    /^(?:yes|yeah|yep|yup|sure|okay|ok)\s+(?:(?:that|this|it)\s+)?(?:is|was|it's|it['’]s)\s+on\s+my\s+pr\b/.test(
      firstClause,
    );
  if (
    (!/^(?:yes|yeah|yep|yup|sure|okay|ok|absolutely|definitely)(?:\s+(?:sure|absolutely|definitely))?$/.test(
      firstClause,
    ) &&
      !confirmsAssignedPr) ||
    replyExplicitlyRefusesHandoff(normalized)
  ) {
    return false;
  }

  const continuation = normalized
    .slice(firstClause.length)
    .replace(/^[\s,.;:—–-]+/, "");
  return !/^(?:but\s+)?(?:maybe|perhaps|possibly|i\s+(?:might|may|could|would|guess)|i(?:'m|\s+am)\s+not\s+sure|not\s+sure|if|unless|depending|let\s+me\s+(?:think|consider)|i(?:'ll|\s+will)\s+(?:think|consider))\b/.test(
    continuation,
  );
}

function validateHandoffAcceptance(
  parentName: string,
  handoff: Handoff,
  rootTs: bigint,
  threadParentTs: bigint,
  statusReplyTs: bigint,
  latestHumanReplyTs: bigint | null,
  latestHumanReply: Parent["latestRelevantHumanReply"],
  threadReplies: ThreadSnapshot["replies"],
  sweepActorId: string,
): void {
  const acceptance = handoff.acceptanceReply;
  const request = handoff.requestReply;
  if (handoff.status === "unassigned") {
    if (handoff.ownerSlackId !== undefined || acceptance !== undefined) {
      throw new Error(
        `${parentName}: an unassigned handoff cannot claim a Slack owner or acceptance`,
      );
    }
    if (request) {
      const requestTs = slackTimestamp(
        request.ts,
        `${parentName}.handoff.requestReply.ts`,
      );
      if (
        request.actorId !== sweepActorId ||
        !isSlackUserId(request.actorId) ||
        slackTimestamp(
          request.threadParentTs,
          `${parentName}.handoff.requestReply.threadParentTs`,
        ) !== threadParentTs ||
        requestTs <= rootTs ||
        requestTs >= statusReplyTs ||
        typeof request.text !== "string" ||
        !request.text.trim() ||
        !replyNamesHandoffAction(request.text, handoff.action)
      ) {
        throw new Error(
          `${parentName}: an unassigned handoff request must be this actor's read-back in the source thread and name the recorded action`,
        );
      }
    }
    return;
  }
  const explicitlyAcceptsAction =
    !!acceptance &&
    replyExplicitlyAcceptsHandoff(acceptance.text) &&
    replyNamesHandoffAction(acceptance.text, handoff.action);
  if (
    !isSlackUserId(handoff.ownerSlackId) ||
    handoff.ownerSlackId === sweepActorId ||
    !acceptance ||
    acceptance.actorId !== handoff.ownerSlackId ||
    !isSlackUserId(acceptance.actorId) ||
    typeof acceptance.text !== "string" ||
    !acceptance.text.trim() ||
    (!explicitlyAcceptsAction &&
      !(request && replyContextuallyAssentsToHandoff(acceptance.text)))
  ) {
    throw new Error(
      `${parentName}: 🎫 needs a named human other than this actor and explicit acceptance of the recorded action, or a direct in-thread request followed by their assent`,
    );
  }

  const acceptanceTs = slackTimestamp(
    acceptance.ts,
    `${parentName}.handoff.acceptanceReply.ts`,
  );
  if (request) {
    const requestTs = slackTimestamp(
      request.ts,
      `${parentName}.handoff.requestReply.ts`,
    );
    if (
      request.actorId !== sweepActorId ||
      !isSlackUserId(request.actorId) ||
      slackTimestamp(
        request.threadParentTs,
        `${parentName}.handoff.requestReply.threadParentTs`,
      ) !== threadParentTs ||
      requestTs <= rootTs ||
      requestTs >= acceptanceTs ||
      typeof request.text !== "string" ||
      !request.text.trim()
    ) {
      throw new Error(
        `${parentName}: direct handoff request must be this actor's read-back in the source thread before the assigned owner's reply`,
      );
    }
    if (!replyDirectlyRequestsHandoff(request.text, handoff)) {
      throw new Error(
        `${parentName}: direct handoff request must name the assigned human and exact recorded action`,
      );
    }
  }

  if (
    slackTimestamp(
      acceptance.threadParentTs,
      `${parentName}.handoff.acceptanceReply.threadParentTs`,
    ) !== threadParentTs ||
    acceptanceTs <= rootTs ||
    acceptanceTs >= statusReplyTs ||
    latestHumanReplyTs === null ||
    acceptanceTs > latestHumanReplyTs
  ) {
    throw new Error(
      `${parentName}: handoff acceptance must be a read-back reply by the assigned owner in this thread, before the status reply`,
    );
  }

  const withdrewHandoff = threadReplies.some((reply) => {
    const replyTs = slackTimestamp(
      reply.ts,
      `${parentName}.threadSnapshot.handoffReply.ts`,
    );
    return (
      reply.actorId === handoff.ownerSlackId &&
      replyTs > acceptanceTs &&
      replyTs < statusReplyTs &&
      reply.kind === "human" &&
      replyExplicitlyRefusesHandoff(reply.text)
    );
  });
  if (withdrewHandoff) {
    throw new Error(
      `${parentName}: the assigned owner withdrew the handoff after accepting it`,
    );
  }
}

function validateCompletedHandoff(
  parentName: string,
  handoff: Handoff,
  threadParentTs: bigint,
  statusReply: StatusReply,
  threadReplies: ThreadSnapshot["replies"],
): void {
  if (handoff.status !== "completed") {
    if (handoff.completion !== undefined) {
      throw new Error(
        `${parentName}: only a completed handoff may include completion evidence`,
      );
    }
    return;
  }

  const completion = handoff.completion;
  if (
    !completion ||
    typeof completion.evidence !== "string" ||
    !completion.evidence.trim() ||
    (!completion.sourceUrl && !completion.reply)
  ) {
    throw new Error(
      `${parentName}: a completed handoff needs evidence and a source URL or owner reply`,
    );
  }
  if (completion.sourceUrl) {
    let sourceUrl: URL;
    try {
      sourceUrl = new URL(completion.sourceUrl);
    } catch {
      throw new Error(
        `${parentName}: completed handoff sourceUrl must be an absolute URL`,
      );
    }
    if (sourceUrl.protocol !== "https:") {
      throw new Error(
        `${parentName}: completed handoff sourceUrl must use HTTPS`,
      );
    }
  }

  if (completion.reply) {
    const acceptance = handoff.acceptanceReply;
    const completionReply = completion.reply;
    const completionTs = slackTimestamp(
      completionReply.ts,
      `${parentName}.handoff.completion.reply.ts`,
    );
    const acceptanceTs = acceptance
      ? slackTimestamp(
          acceptance.ts,
          `${parentName}.handoff.acceptanceReply.ts`,
        )
      : 0n;
    const snapshotReply = threadReplies.find(
      (reply) => reply.ts === completionReply.ts,
    );
    if (
      !acceptance ||
      completionReply.actorId !== handoff.ownerSlackId ||
      slackTimestamp(
        completionReply.threadParentTs,
        `${parentName}.handoff.completion.reply.threadParentTs`,
      ) !== threadParentTs ||
      completionTs <= acceptanceTs ||
      completionTs >=
        slackTimestamp(statusReply.ts, `${parentName}.statusReply.ts`) ||
      !snapshotReply ||
      snapshotReply.kind !== "human" ||
      snapshotReply.actorId !== completionReply.actorId ||
      snapshotReply.text !== completionReply.text
    ) {
      throw new Error(
        `${parentName}: completed handoff reply must be a later read-back from its accepted owner in this thread`,
      );
    }
  }

  if (
    !/\b(?:completed|complete|merged|shipped|delivered|done)\b/i.test(
      statusReply.text,
    ) ||
    !statusReply.evidence.includes(completion.evidence)
  ) {
    throw new Error(
      `${parentName}: current status must state that the accepted action completed and include its completion evidence`,
    );
  }
}

function validateHistoricalReactionMarks(
  parentName: string,
  parent: Parent,
  currentStatus: StatusReply,
  threadSnapshot: ThreadSnapshot,
  sweepActorId: string,
): { checkmark: boolean; ticket: boolean } {
  const marks = parent.historicalReactionMarks ?? [];
  if (!Array.isArray(marks)) {
    throw new Error(`${parentName}: historicalReactionMarks must be an array`);
  }
  const result = { checkmark: false, ticket: false };
  const currentTs = slackTimestamp(
    currentStatus.ts,
    `${parentName}.statusReply.ts`,
  );
  const rootTs = slackTimestamp(
    parent.threadParentTs,
    `${parentName}.threadParentTs`,
  );
  for (const [index, mark] of marks.entries()) {
    const label = `${parentName}.historicalReactionMarks[${index + 1}]`;
    if (
      !mark ||
      !["white_check_mark", "ticket"].includes(mark.emoji) ||
      typeof mark.scope !== "string" ||
      !mark.scope.trim() ||
      typeof mark.reason !== "string" ||
      !mark.reason.trim() ||
      !mark.previousStatus
    ) {
      throw new Error(
        `${label}: historical mark needs emoji, scope, reason, and its prior status`,
      );
    }
    if (!(parent.reactionOwners[mark.emoji] ?? []).includes(sweepActorId)) {
      throw new Error(
        `${label}: preserve history only for a reaction this actor still owns`,
      );
    }
    const previous = mark.previousStatus;
    const previousTs = slackTimestamp(
      previous.ts,
      `${label}.previousStatus.ts`,
    );
    if (
      previous.actorId !== sweepActorId ||
      slackTimestamp(
        previous.threadParentTs,
        `${label}.previousStatus.threadParentTs`,
      ) !== rootTs ||
      previousTs <= rootTs ||
      previousTs >= currentTs ||
      typeof previous.text !== "string" ||
      !previous.text.trim() ||
      typeof previous.evidence !== "string" ||
      !previous.evidence.trim() ||
      !previous.text.includes(previous.evidence.trim())
    ) {
      throw new Error(
        `${label}: prior status must be this actor's earlier same-thread read-back`,
      );
    }
    const previousReadback = threadSnapshot.replies.find(
      (reply) => reply.ts === previous.ts,
    );
    if (
      !previousReadback ||
      previousReadback.actorId !== sweepActorId ||
      previousReadback.kind !== "sweep" ||
      previousReadback.text !== previous.text
    ) {
      throw new Error(
        `${label}: prior status must match the captured full-thread read`,
      );
    }
    const emojiPattern =
      mark.emoji === "white_check_mark"
        ? /(?:✅|:white_check_mark:)/i
        : /(?:🎫|:ticket:)/i;
    if (
      !emojiPattern.test(previous.text) ||
      !normalizeScope(previous.text).includes(normalizeScope(mark.scope))
    ) {
      throw new Error(
        `${label}: prior status must name the marked scope and reaction`,
      );
    }
    if (
      !/\b(?:historical|previously|superseded)\b/i.test(currentStatus.text) ||
      !emojiPattern.test(currentStatus.text) ||
      !normalizeScope(currentStatus.text).includes(
        normalizeScope(mark.scope),
      ) ||
      !currentStatus.text.includes(mark.reason.trim())
    ) {
      throw new Error(
        `${label}: current status must explain why the retained reaction is historical`,
      );
    }
    const reactionDecision =
      mark.emoji === "white_check_mark"
        ? parent.reactionDecision?.checkmark
        : parent.reactionDecision?.ticket;
    if (
      !reactionDecision ||
      reactionDecision.state !== "present" ||
      !/\b(?:historical|previously|superseded)\b/i.test(
        reactionDecision.reason,
      ) ||
      !reactionDecision.reason.includes(mark.reason.trim())
    ) {
      throw new Error(
        `${label}: inventory decision must label and explain the historical reaction`,
      );
    }

    if (mark.emoji === "white_check_mark") {
      if (mark.handoff || mark.withdrawalReply) {
        throw new Error(
          `${label}: a historical ✅ cannot contain handoff evidence`,
        );
      }
      result.checkmark = true;
      continue;
    }

    result.ticket = true;
    const handoff = mark.handoff;
    const withdrawal = mark.withdrawalReply;
    if (
      !handoff ||
      !withdrawal ||
      !isSlackUserId(handoff.ownerSlackId) ||
      handoff.ownerSlackId === sweepActorId ||
      handoff.scope !== mark.scope ||
      typeof handoff.action !== "string" ||
      !handoff.action.trim()
    ) {
      throw new Error(
        `${label}: a historical 🎫 needs the original accepted handoff and its withdrawal`,
      );
    }
    const acceptance = handoff.acceptanceReply;
    if (
      !acceptance ||
      acceptance.actorId !== handoff.ownerSlackId ||
      !isSlackUserId(acceptance.actorId) ||
      slackTimestamp(
        acceptance.threadParentTs,
        `${label}.acceptanceReply.threadParentTs`,
      ) !== rootTs
    ) {
      throw new Error(
        `${label}: historical 🎫 acceptance must belong to its named owner and root thread`,
      );
    }
    const acceptanceTs = slackTimestamp(
      acceptance.ts,
      `${label}.acceptanceReply.ts`,
    );
    const explicitAcceptance =
      replyExplicitlyAcceptsHandoff(acceptance.text) &&
      replyNamesHandoffAction(acceptance.text, handoff.action);
    const request = handoff.requestReply;
    if (
      !explicitAcceptance &&
      !(request && replyContextuallyAssentsToHandoff(acceptance.text))
    ) {
      throw new Error(
        `${label}: historical 🎫 still needs exact owner acceptance of the action`,
      );
    }
    if (request) {
      if (
        request.actorId !== sweepActorId ||
        slackTimestamp(
          request.threadParentTs,
          `${label}.requestReply.threadParentTs`,
        ) !== rootTs ||
        slackTimestamp(request.ts, `${label}.requestReply.ts`) >=
          acceptanceTs ||
        !replyDirectlyRequestsHandoff(request.text, handoff)
      ) {
        throw new Error(
          `${label}: historical contextual assent needs its exact preceding request`,
        );
      }
    }
    const acceptanceReadback = threadSnapshot.replies.find(
      (reply) => reply.ts === acceptance.ts,
    );
    if (
      !acceptanceReadback ||
      acceptanceReadback.actorId !== handoff.ownerSlackId ||
      acceptanceReadback.kind !== "human" ||
      acceptanceReadback.text !== acceptance.text
    ) {
      throw new Error(
        `${label}: historical handoff acceptance must match the captured human reply`,
      );
    }
    if (!replyNamesHandoffs(previous.text, [handoff])) {
      throw new Error(
        `${label}: prior ticket status must name the accepted owner's action`,
      );
    }
    const withdrawalTs = slackTimestamp(
      withdrawal.ts,
      `${label}.withdrawalReply.ts`,
    );
    const withdrawalReadback = threadSnapshot.replies.find(
      (reply) => reply.ts === withdrawal.ts,
    );
    if (
      withdrawal.actorId !== handoff.ownerSlackId ||
      slackTimestamp(
        withdrawal.threadParentTs,
        `${label}.withdrawalReply.threadParentTs`,
      ) !== rootTs ||
      withdrawalTs <= acceptanceTs ||
      withdrawalTs >= currentTs ||
      !replyExplicitlyRefusesHandoff(withdrawal.text) ||
      !withdrawalReadback ||
      withdrawalReadback.actorId !== withdrawal.actorId ||
      withdrawalReadback.kind !== "human" ||
      withdrawalReadback.text !== withdrawal.text ||
      !replyNamesHandoffAction(withdrawal.text, handoff.action) ||
      previousTs >= withdrawalTs
    ) {
      throw new Error(
        `${label}: historical 🎫 needs the owner's later, read-back refusal of the accepted action`,
      );
    }
    if (request) {
      const requestReadback = threadSnapshot.replies.find(
        (reply) => reply.ts === request.ts,
      );
      if (
        !requestReadback ||
        requestReadback.actorId !== sweepActorId ||
        requestReadback.text !== request.text
      ) {
        throw new Error(
          `${label}: historical contextual request must match the captured thread`,
        );
      }
    }
  }
  return result;
}

function replyStatesDisposition(text: string, disposition: string): boolean {
  const visibleText = text.replace(/[*_`]/g, "");
  if (
    disposition.toLowerCase() === "fixed" &&
    (/\b(?:(?:is|was|remains)\s+)?(?:not|never)\s+(?:(?:yet|fully|truly|really|actually)\s+)*fixed\b|\bunfixed\b/i.test(
      visibleText,
    ) ||
      /\b(?:still|remains)\s+broken\b/i.test(visibleText))
  ) {
    return false;
  }
  const escapedDisposition = disposition.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const label = new RegExp(
    `(?:^|[\\n.!?;:]\\s*)${escapedDisposition}(?=$|[\\s:—–.!?;,()-])`,
    "i",
  );
  if (label.test(visibleText)) return true;

  return (
    disposition.toLowerCase() === "fixed" &&
    /\bis\s+fixed(?=$|[\s:—–.!?;,()-])/i.test(visibleText)
  );
}

function validateStatusReactionLanguage(
  parentName: string,
  text: string,
  hasCheckmark: boolean,
  hasTicket: boolean,
  fixedScopes: NonNullable<Parent["fixedScopes"]>,
  unfinishedScopes: NonNullable<Parent["unfinishedScopes"]>,
  historicalReactionMarks: NonNullable<Parent["historicalReactionMarks"]> = [],
): void {
  if (!text.includes("this was sent from a bot.")) {
    throw new Error(
      `${parentName}: latest status reply must include the exact bot disclosure`,
    );
  }

  const checkmarkMentioned = /(?:✅|:white_check_mark:)/i.test(text);
  if (hasCheckmark && !checkmarkMentioned) {
    throw new Error(
      `${parentName}: status reply must name the verified scope covered by this actor's ✅`,
    );
  }
  const normalizedReply = normalizeScope(text);
  if (
    hasCheckmark &&
    fixedScopes.some(
      (scope) => !normalizedReply.includes(normalizeScope(scope.scope)),
    )
  ) {
    throw new Error(
      `${parentName}: status reply must name every fixed scope covered by this actor's ✅`,
    );
  }
  for (const mark of historicalReactionMarks) {
    if (
      mark.emoji === "white_check_mark" &&
      !fixedScopes.some(
        (scope) => normalizeScope(scope.scope) === normalizeScope(mark.scope),
      )
    ) {
      if (
        !/\b(?:historical|previously|superseded)\b/i.test(text) ||
        !normalizedReply.includes(normalizeScope(mark.scope)) ||
        !text.includes(mark.reason)
      ) {
        throw new Error(
          `${parentName}: status reply must identify each retained historical ✅ scope and why it no longer represents current proof`,
        );
      }
    }
    if (mark.emoji === "ticket") {
      if (
        !/\b(?:historical|previously|superseded)\b/i.test(text) ||
        !normalizedReply.includes(normalizeScope(mark.scope)) ||
        !text.includes(mark.reason)
      ) {
        throw new Error(
          `${parentName}: status reply must identify each retained historical 🎫 action and why it was withdrawn`,
        );
      }
    }
  }
  if (
    unfinishedScopes.some(
      (scope) => !normalizedReply.includes(normalizeScope(scope.scope)),
    )
  ) {
    throw new Error(
      `${parentName}: status reply must name every unfinished scope that remains open`,
    );
  }
  if (
    !hasCheckmark &&
    !/No\s+(?:✅|:white_check_mark:)(?:\s+from\s+(?:me|this actor))?\s*(?:(?:—|–|-|:)\s*\S.{4,}|(?:applies?\s+)?because\s+\S.{4,})/i.test(
      text,
    )
  ) {
    throw new Error(
      `${parentName}: status reply must say why this actor has no ✅`,
    );
  }

  const ticketMentioned = /(?:🎫|:ticket:)/i.test(text);
  if (hasTicket && !ticketMentioned) {
    throw new Error(
      `${parentName}: status reply must name this actor's 🎫 human/team action`,
    );
  }
  if (
    !hasTicket &&
    !/No\s+(?:🎫|:ticket:)(?:\s+from\s+(?:me|this actor))?\s*(?:(?:—|–|-|:)\s*\S.{4,}|(?:applies?\s+)?because\s+\S.{4,})/i.test(
      text,
    )
  ) {
    throw new Error(
      `${parentName}: status reply must say why this actor has no 🎫`,
    );
  }
}

function validateHumanOwnerBlock(
  parentName: string,
  disposition: string,
  handoffs: Handoff[],
  hasTicket: boolean,
): void {
  const activeHandoffs = handoffs.filter(
    (handoff) => handoff.status !== "completed",
  );
  if (
    disposition === "Blocked on human owner" &&
    (activeHandoffs.length === 0 || !hasTicket)
  ) {
    throw new Error(
      `${parentName}: Blocked on human owner needs a distinct human/team action and this actor's 🎫`,
    );
  }
}

function validateScopeEvidence(
  parentName: string,
  parent: Parent,
): {
  fixedScopes: NonNullable<Parent["fixedScopes"]>;
  fixedScopeNames: Set<string>;
  unfinishedScopes: NonNullable<Parent["unfinishedScopes"]>;
  unfinishedScopeNames: Set<string>;
} {
  const fixedScopes = parent.fixedScopes ?? [];
  if (!Array.isArray(fixedScopes)) {
    throw new Error(`${parentName}: fixedScopes must be an array`);
  }
  const fixedScopeNames = new Set<string>();
  for (const [scopeIndex, fixedScope] of fixedScopes.entries()) {
    if (
      !fixedScope ||
      typeof fixedScope.scope !== "string" ||
      !fixedScope.scope.trim() ||
      typeof fixedScope.verification !== "string" ||
      !fixedScope.verification.trim()
    ) {
      throw new Error(
        `${parentName}: fixed scope ${scopeIndex + 1} needs scope and verification evidence`,
      );
    }
    if (fixedScope.verifiedAfterHumanReplyTs !== undefined) {
      slackTimestamp(
        fixedScope.verifiedAfterHumanReplyTs,
        `${parentName}.fixedScopes[${scopeIndex + 1}].verifiedAfterHumanReplyTs`,
      );
      if (
        fixedScope.verifiedAfterHumanReplyTs !==
        parent.latestRelevantHumanReply?.ts
      ) {
        throw new Error(
          `${parentName}: reverified scope must name the latest human reply it follows`,
        );
      }
    }
    const normalizedScope = normalizeScope(fixedScope.scope);
    if (fixedScopeNames.has(normalizedScope)) {
      throw new Error(`${parentName}: fixed scopes must be distinct`);
    }
    fixedScopeNames.add(normalizedScope);
  }

  const unfinishedScopes =
    parent.unfinishedScopes === undefined ? [] : parent.unfinishedScopes;
  if (!Array.isArray(unfinishedScopes)) {
    throw new Error(`${parentName}: unfinishedScopes must be an array`);
  }
  const unfinishedScopeNames = new Set<string>();
  for (const [scopeIndex, unfinishedScope] of unfinishedScopes.entries()) {
    if (
      !unfinishedScope ||
      typeof unfinishedScope.scope !== "string" ||
      !unfinishedScope.scope.trim() ||
      typeof unfinishedScope.evidence !== "string" ||
      !unfinishedScope.evidence.trim()
    ) {
      throw new Error(
        `${parentName}: unfinished scope ${scopeIndex + 1} needs a scope and evidence that it remains open`,
      );
    }
    const normalizedScope = normalizeScope(unfinishedScope.scope);
    if (
      unfinishedScopeNames.has(normalizedScope) ||
      fixedScopeNames.has(normalizedScope)
    ) {
      throw new Error(
        `${parentName}: unfinished scopes must be distinct from each other and from fixed scopes`,
      );
    }
    unfinishedScopeNames.add(normalizedScope);
  }

  return {
    fixedScopes,
    fixedScopeNames,
    unfinishedScopes,
    unfinishedScopeNames,
  };
}

function validateFixedScopeFreshness(parentName: string, parent: Parent): void {
  const humanReply = parent.latestRelevantHumanReply;
  if (!humanReply || !humanReplyContradictsFix(humanReply.text)) return;

  for (const [scopeIndex, scope] of (parent.fixedScopes ?? []).entries()) {
    const scopeName = `${parentName}.fixedScopes[${scopeIndex + 1}]`;
    if (
      scope.verifiedAfterHumanReplyTs !== humanReply.ts ||
      !/\b(?:re[- ]?tested|re[- ]?ran|replayed|reproduced|exercised)\b/i.test(
        scope.verification,
      )
    ) {
      throw new Error(
        `${scopeName}: a later human reply says the issue persists; rerun direct proof after reply ${humanReply.ts} or reopen this scope`,
      );
    }
  }
}

function humanReplyContradictsFix(text: string): boolean {
  return /\b(?:still (?:happening|occurs?|failing|broken|not working|unresolved)|(?:issue|bug|problem) still (?:happens?|occurs?|fails?|exists)|same issue|not fixed|not resolved|remains? broken|did(?:n't| not) fix|does(?:n't| not) work|continues? to (?:fail|happen|occur))\b/i.test(
    text.replace(/[’‘]/g, "'"),
  );
}

function validateDispositionScopes(
  parentName: string,
  parent: Parent,
  hasOwnedReaction: boolean,
  requireSweepOwnership: boolean,
  hasEye: boolean,
  hasCheckmark: boolean,
  fixedScopeNames: Set<string>,
  unfinishedScopeNames: Set<string>,
  handoffs: Handoff[],
  hasHistoricalCheckmark = false,
): void {
  const hasFixedScope = fixedScopeNames.size > 0;
  const hasUnfinishedScope = unfinishedScopeNames.size > 0;
  const activeHandoffs = handoffs.filter(
    (handoff) => handoff.status !== "completed",
  );
  const hasOpenFollowUp = hasUnfinishedScope || activeHandoffs.length > 0;

  if (parent.disposition === "Skipped" && (hasFixedScope || hasOpenFollowUp)) {
    throw new Error(
      `${parentName}: Skipped cannot retain any fixed scope, unfinished scope, or handoff`,
    );
  }
  if (parent.disposition === "Fixed" && hasOpenFollowUp) {
    throw new Error(
      `${parentName}: Fixed disposition cannot retain an unfinished scope or handoff; use Partially fixed`,
    );
  }
  if (
    hasOpenFollowUp &&
    hasFixedScope &&
    !["Partially fixed", "Verified locally"].includes(parent.disposition)
  ) {
    throw new Error(
      `${parentName}: fixed and unfinished scopes need Verified locally before merge or Partially fixed after merge`,
    );
  }
  const abandonedReporterWaitWithInternalWork =
    parent.disposition === "Abandoned - no answer in 4 days" &&
    hasUnfinishedScope &&
    activeHandoffs.length === 0;
  const closedDispositions = new Set([
    "Fixed",
    "Shipped",
    "Live verified",
    "Resolved elsewhere",
    "Skipped",
    "Clustered",
    "Owned elsewhere",
    "Abandoned - no answer in 4 days",
  ]);
  if (
    hasOpenFollowUp &&
    closedDispositions.has(parent.disposition) &&
    !abandonedReporterWaitWithInternalWork
  ) {
    throw new Error(
      `${parentName}: unfinished work or a human handoff needs an open disposition`,
    );
  }
  if (!hasOwnedReaction) {
    if (
      parent.disposition === "Owned elsewhere" &&
      (hasFixedScope || hasOpenFollowUp)
    ) {
      throw new Error(
        `${parentName}: Owned elsewhere cannot record this actor's fixed scopes, unfinished scopes, or handoffs`,
      );
    }
    if (requireSweepOwnership) {
      if (hasOpenFollowUp && !hasEye) {
        throw new Error(
          `${parentName}: unfinished work or a human handoff must keep this actor's 👀`,
        );
      }
      if (openDispositions.has(parent.disposition) && !hasEye) {
        throw new Error(
          `${parentName}: ${parent.disposition} is open; keep this actor's 👀 until its scopes and follow-ups close`,
        );
      }
    }
  } else {
    if (hasOpenFollowUp && !hasEye) {
      throw new Error(
        `${parentName}: unfinished work or a human handoff must keep this actor's 👀`,
      );
    }
    if (openDispositions.has(parent.disposition) && !hasEye) {
      throw new Error(
        `${parentName}: ${parent.disposition} is open; keep this actor's 👀 until its scopes and follow-ups close`,
      );
    }
  }
  if (
    (hasCheckmark && !hasFixedScope && !hasHistoricalCheckmark) ||
    (!hasCheckmark && hasFixedScope)
  ) {
    throw new Error(
      `${parentName}: a current ✅ needs verified scope evidence (or an explicitly documented historical mark), and every verified scope needs ✅`,
    );
  }
  if (
    hasFixedScope &&
    ![
      "Fixed",
      "Partially fixed",
      "Verified locally",
      "Resolved elsewhere",
    ].includes(parent.disposition)
  ) {
    throw new Error(
      `${parentName}: verified scope needs Fixed, Partially fixed, Verified locally, or Resolved elsewhere disposition`,
    );
  }
  if (parent.disposition === "Verified locally" && !hasFixedScope) {
    throw new Error(
      `${parentName}: Verified locally needs direct post-change proof for at least one scope`,
    );
  }
  if (parent.disposition === "Fixed" && !hasFixedScope) {
    throw new Error(
      `${parentName}: Fixed disposition needs verified fixed-scope evidence`,
    );
  }
  if (
    parent.disposition === "Partially fixed" &&
    (!hasFixedScope || !hasOpenFollowUp)
  ) {
    throw new Error(
      `${parentName}: Partially fixed needs a verified fixed scope and a distinct unfinished report scope or handoff`,
    );
  }
}

function validateOtherOwnerEvidence(
  parentName: string,
  parent: Parent,
  sweepActorId: string,
  rootTs: string,
  threadSnapshot: ThreadSnapshot | undefined,
  isInScopeReport: boolean,
  hasOwnedReaction: boolean,
): void {
  const evidence = parent.otherOwnerEvidence;
  const otherEyeOwners = (parent.reactionOwners.eyes ?? []).filter(
    (actorId) => actorId !== sweepActorId,
  );
  const hasCurrentOpenStatus = (actorId: string): boolean => {
    if (!threadSnapshot || threadSnapshot.rootTs !== rootTs) return false;
    const latestReply = [...threadSnapshot.replies]
      .reverse()
      .find((reply) => reply.actorId === actorId && reply.kind === "human");
    return (
      latestReply !== undefined &&
      [...openDispositions].some((disposition) =>
        replyStatesDisposition(latestReply.text, disposition),
      )
    );
  };
  const activeOtherEyeOwners = otherEyeOwners.filter(hasCurrentOpenStatus);

  if (parent.disposition !== "Owned elsewhere") {
    if (evidence) {
      throw new Error(
        `${parentName}: otherOwnerEvidence is only valid with Owned elsewhere`,
      );
    }
    if (
      isInScopeReport &&
      !hasOwnedReaction &&
      openDispositions.has(parent.disposition) &&
      otherEyeOwners.length > 0
    ) {
      if (!threadSnapshot || threadSnapshot.rootTs !== rootTs) {
        throw new Error(
          `${parentName}: read the complete root thread before treating another actor's eye as historical or active ownership`,
        );
      }
    }
    if (
      isInScopeReport &&
      !hasOwnedReaction &&
      activeOtherEyeOwners.length > 0
    ) {
      throw new Error(
        `${parentName}: another actor owns this report; do not add this actor's 👀 or reply—record Owned elsewhere with current owner evidence`,
      );
    }
    return;
  }

  if (
    !evidence ||
    !isSlackUserId(evidence.actorId) ||
    evidence.actorId === sweepActorId ||
    !otherEyeOwners.includes(evidence.actorId)
  ) {
    throw new Error(
      `${parentName}: Owned elsewhere needs another actor's root 👀 and their current same-thread status`,
    );
  }

  const status = evidence.statusReply;
  if (
    !status ||
    status.actorId !== evidence.actorId ||
    !openDispositions.has(status.disposition) ||
    typeof status.evidence !== "string" ||
    !status.evidence.trim() ||
    typeof status.text !== "string" ||
    !status.text.trim() ||
    !replyStatesDisposition(status.text, status.disposition) ||
    !status.text.includes(status.evidence.trim())
  ) {
    throw new Error(
      `${parentName}: Owned elsewhere needs that owner's current open status and evidence`,
    );
  }

  const rootTimestamp = slackTimestamp(rootTs, `${parentName}.rootTs`);
  const statusTimestamp = slackTimestamp(
    status.ts,
    `${parentName}.otherOwnerEvidence.statusReply.ts`,
  );
  if (
    slackTimestamp(
      status.threadParentTs,
      `${parentName}.otherOwnerEvidence.statusReply.threadParentTs`,
    ) !== rootTimestamp ||
    statusTimestamp <= rootTimestamp
  ) {
    throw new Error(
      `${parentName}: other owner's status must follow and belong to the exact root thread`,
    );
  }

  if (
    !threadSnapshot ||
    threadSnapshot.rootTs !== rootTs ||
    !Array.isArray(threadSnapshot.replies) ||
    threadSnapshot.replyCount !== threadSnapshot.replies.length
  ) {
    throw new Error(
      `${parentName}: Owned elsewhere needs a complete captured thread with the owner's status`,
    );
  }
  const snapshotReadAt = Date.parse(threadSnapshot.readAt);
  if (
    !Number.isFinite(snapshotReadAt) ||
    new Date(snapshotReadAt).toISOString() !== threadSnapshot.readAt
  ) {
    throw new Error(
      `${parentName}: other-owner thread snapshot needs an ISO read timestamp`,
    );
  }

  let previousReplyTimestamp = rootTimestamp;
  let capturedStatus = false;
  let latestOwnerReply: ThreadSnapshot["replies"][number] | undefined;
  const laterHumanReplies: ThreadSnapshot["replies"] = [];
  for (const [replyIndex, reply] of threadSnapshot.replies.entries()) {
    const replyTimestamp = slackTimestamp(
      reply.ts,
      `${parentName}.otherOwnerEvidence.threadSnapshot.replies[${replyIndex}].ts`,
    );
    if (replyTimestamp <= previousReplyTimestamp) {
      throw new Error(
        `${parentName}: other-owner thread snapshot replies must be oldest-first and after the root`,
      );
    }
    previousReplyTimestamp = replyTimestamp;
    if (
      reply.ts === status.ts &&
      reply.actorId === status.actorId &&
      reply.kind === "human" &&
      reply.text === status.text
    ) {
      capturedStatus = true;
    }
    if (reply.actorId === evidence.actorId) latestOwnerReply = reply;
    if (reply.kind === "human" && replyTimestamp > statusTimestamp) {
      laterHumanReplies.push(reply);
    }
  }
  if (
    !capturedStatus ||
    latestOwnerReply?.ts !== status.ts ||
    laterHumanReplies.length > 0
  ) {
    throw new Error(
      `${parentName}: Owned elsewhere status must be the owner's latest reply after the latest human reply, confirmed in the captured thread`,
    );
  }
}

function validateHandoffDefinitions(
  parentName: string,
  parent: Parent,
  fixedScopeNames: Set<string>,
): Handoff[] {
  if (parent.handoff && parent.handoffs !== undefined) {
    throw new Error(`${parentName}: use handoff or handoffs, not both`);
  }
  if (parent.handoffs !== undefined && !Array.isArray(parent.handoffs)) {
    throw new Error(`${parentName}: handoffs must be an array`);
  }
  const handoffs = parent.handoffs ?? (parent.handoff ? [parent.handoff] : []);
  const handoffScopes = new Set<string>();
  for (const [handoffIndex, handoff] of handoffs.entries()) {
    if (
      !handoff ||
      typeof handoff.scope !== "string" ||
      !handoff.scope.trim() ||
      typeof handoff.owner !== "string" ||
      !handoff.owner.trim() ||
      typeof handoff.action !== "string" ||
      !handoff.action.trim()
    ) {
      throw new Error(
        `${parentName}: handoff ${handoffIndex + 1} needs a distinct scope, responsible person/team, and action`,
      );
    }
    if (
      handoff.status !== undefined &&
      handoff.status !== "unassigned" &&
      handoff.status !== "accepted" &&
      handoff.status !== "completed"
    ) {
      throw new Error(
        `${parentName}: handoff status must be unassigned, accepted, or completed`,
      );
    }
    if (
      handoff.status === "unassigned"
        ? isNamedHumanOwner(handoff.owner) ||
          handoff.ownerSlackId !== undefined ||
          handoff.acceptanceReply !== undefined
        : !isNamedHumanOwner(handoff.owner)
    ) {
      throw new Error(
        `${parentName}: unassigned handoffs may name a team/role, while accepted handoffs need the named individual`,
      );
    }
    if (handoff.completion !== undefined && handoff.status !== "completed") {
      throw new Error(
        `${parentName}: completion evidence requires handoff status completed`,
      );
    }
    const normalizedScope = normalizeScope(handoff.scope);
    if (handoffScopes.has(normalizedScope)) {
      throw new Error(`${parentName}: handoff scopes must be distinct`);
    }
    if (fixedScopeNames.has(normalizedScope)) {
      throw new Error(
        `${parentName}: 🎫 handoff scope must be distinct from verified fixed scopes`,
      );
    }
    handoffScopes.add(normalizedScope);
  }
  return handoffs;
}

function validateHandoffTicketParity(
  parentName: string,
  handoffs: Handoff[],
  hasTicket: boolean,
  hasHistoricalTicket = false,
): void {
  if (handoffs.length > 0 && !hasTicket) {
    throw new Error(`${parentName}: every handoff needs this actor's 🎫`);
  }
  if (handoffs.length === 0 && hasTicket && !hasHistoricalTicket) {
    throw new Error(
      `${parentName}: this actor's 🎫 needs a distinct active or explicitly historical human action`,
    );
  }
}

function validateSupplementalRootAudit(
  channelName: string,
  channelId: string,
  rootTs: string,
  parent: Parent,
  sweepActorId: string,
  threadSnapshot: ThreadSnapshot | undefined,
  requireFreshReads: boolean,
  finalPageReadAt: number | null,
): void {
  const parentName = `${channelName} supplemental root ${rootTs}`;
  validateSlackFiles(`${parentName}.files`, parent.files);
  const timestamp = slackTimestamp(parent.ts, `${parentName}.ts`);
  const threadParentTimestamp = slackTimestamp(
    parent.threadParentTs,
    `${parentName}.threadParentTs`,
  );
  validateSourceFilesInSnapshot(parentName, parent, threadSnapshot);
  validateRootResolution(
    parentName,
    parent,
    channelId,
    timestamp,
    threadParentTimestamp,
  );
  if (timestamp.toString() !== rootTs || timestamp !== threadParentTimestamp) {
    throw new Error(`${parentName}: audit row must be the self-root message`);
  }
  if (
    parent.rootClassification !== "report" &&
    parent.rootClassification !== "administrative"
  ) {
    throw new Error(
      `${parentName}: classify the root as report or administrative`,
    );
  }
  if (
    parent.rootClassification === "administrative" &&
    !parent.rootClassificationReason?.trim()
  ) {
    throw new Error(`${parentName}: administrative roots need a reason`);
  }
  if (parent.reactionChecked !== true) {
    throw new Error(`${parentName}: check reactions before triage`);
  }
  const reactionReadAt = validateRootReactionReadAt(
    parentName,
    parent,
    requireFreshReads,
  );
  if (
    requireFreshReads &&
    finalPageReadAt !== null &&
    reactionReadAt! < finalPageReadAt
  ) {
    throw new Error(
      `${parentName}: root reaction read-back must follow the final channel page`,
    );
  }
  if (
    typeof parent.disposition !== "string" ||
    !canonicalDispositions.has(parent.disposition)
  ) {
    throw new Error(
      `${parentName}: use an exact canonical disposition for every root`,
    );
  }
  if (
    typeof parent.reactionSummary !== "string" ||
    !parent.reactionSummary.trim() ||
    !parent.reactionOwners ||
    typeof parent.reactionOwners !== "object" ||
    Array.isArray(parent.reactionOwners)
  ) {
    throw new Error(`${parentName}: record the exact observed reaction state`);
  }
  validateReactionOwners(
    parentName,
    parent.reactionSummary,
    parent.reactionOwners,
  );

  const rootReactionState = workflowReactionState(
    parent.reactionOwners,
    sweepActorId,
  );
  const hasOwnedReaction = hasWorkflowReaction(rootReactionState);
  if (parent.rootClassification === "administrative" && hasOwnedReaction) {
    throw new Error(
      `${parentName}: this actor's workflow marks cannot be placed on an administrative root`,
    );
  }
  validateOtherOwnerEvidence(
    parentName,
    parent,
    sweepActorId,
    rootTs,
    threadSnapshot,
    false,
    hasOwnedReaction,
  );

  const {
    fixedScopes,
    fixedScopeNames,
    unfinishedScopes,
    unfinishedScopeNames,
  } = validateScopeEvidence(parentName, parent);
  validateFixedScopeFreshness(parentName, parent);
  const handoffs = validateHandoffDefinitions(
    parentName,
    parent,
    fixedScopeNames,
  );
  const historicalMarks = parent.historicalReactionMarks ?? [];
  const hasHistoricalCheckmark = historicalMarks.some(
    (mark) => mark.emoji === "white_check_mark",
  );
  const hasHistoricalTicket = historicalMarks.some(
    (mark) => mark.emoji === "ticket",
  );
  if (!hasOwnedReaction) {
    if (historicalMarks.length > 0) {
      throw new Error(
        `${parentName}: historical reaction evidence needs a retained root mark owned by this actor`,
      );
    }
    validateThreadSnapshotStructure(
      parentName,
      parent.ts,
      threadSnapshot,
      sweepActorId,
      requireFreshReads,
    );
    validateDispositionScopes(
      parentName,
      parent,
      false,
      false,
      rootReactionState.eyes,
      rootReactionState.white_check_mark,
      fixedScopeNames,
      unfinishedScopeNames,
      handoffs,
      hasHistoricalCheckmark,
    );
    validateHandoffTicketParity(
      parentName,
      handoffs,
      rootReactionState.ticket,
      hasHistoricalTicket,
    );
    return;
  }
  validateHandoffTicketParity(
    parentName,
    handoffs,
    rootReactionState.ticket,
    hasHistoricalTicket,
  );
  validateDispositionScopes(
    parentName,
    parent,
    true,
    false,
    rootReactionState.eyes,
    rootReactionState.white_check_mark,
    fixedScopeNames,
    unfinishedScopeNames,
    handoffs,
    hasHistoricalCheckmark,
  );

  if (
    !Object.prototype.hasOwnProperty.call(parent, "latestRelevantHumanReply")
  ) {
    throw new Error(
      `${parentName}: record the latest relevant human reply, or null if there is none`,
    );
  }
  const decision = parent.reactionDecision;
  for (const [key, present] of [
    ["checkmark", rootReactionState.white_check_mark],
    ["ticket", rootReactionState.ticket],
  ] as const) {
    const markDecision = decision?.[key];
    if (
      !markDecision ||
      markDecision.state !== (present ? "present" : "none") ||
      !markDecision.reason?.trim()
    ) {
      throw new Error(
        `${parentName}: record a matching ✅ and 🎫 decision with a reason`,
      );
    }
  }

  const reply = parent.statusReply;
  const latestOwnedReply = parent.latestOwnedReply;
  if (
    !reply ||
    !latestOwnedReply ||
    reply.actorId !== sweepActorId ||
    latestOwnedReply.actorId !== sweepActorId ||
    reply.ts !== latestOwnedReply.ts ||
    reply.text !== latestOwnedReply.text ||
    typeof reply.text !== "string" ||
    !reply.text.trim() ||
    typeof reply.evidence !== "string" ||
    !reply.evidence.trim() ||
    reply.disposition !== parent.disposition ||
    !replyStatesDisposition(reply.text, parent.disposition) ||
    !reply.text.includes(reply.evidence.trim())
  ) {
    throw new Error(
      `${parentName}: an owned root eye or mark needs its latest same-actor status reply`,
    );
  }
  if (historicalMarks.length > 0) {
    if (!threadSnapshot) {
      throw new Error(
        `${parentName}: historical reaction marks require the captured full thread`,
      );
    }
    validateHistoricalReactionMarks(
      parentName,
      parent,
      reply,
      threadSnapshot,
      sweepActorId,
    );
  }
  validateStatusReactionLanguage(
    parentName,
    reply.text,
    rootReactionState.white_check_mark,
    rootReactionState.ticket,
    parent.fixedScopes ?? [],
    parent.unfinishedScopes ?? [],
    historicalMarks,
  );
  const replyTs = slackTimestamp(reply.ts, `${parentName}.statusReply.ts`);
  if (
    slackTimestamp(
      reply.threadParentTs,
      `${parentName}.statusReply.threadParentTs`,
    ) !== timestamp ||
    slackTimestamp(
      latestOwnedReply.threadParentTs,
      `${parentName}.latestOwnedReply.threadParentTs`,
    ) !== timestamp ||
    replyTs <= timestamp
  ) {
    throw new Error(
      `${parentName}: status reply must follow and belong to the root thread`,
    );
  }
  const humanReply = parent.latestRelevantHumanReply;
  let humanReplyTs: bigint | null = null;
  if (humanReply !== null) {
    if (
      !humanReply ||
      !isSlackUserId(humanReply.actorId) ||
      humanReply.actorId === sweepActorId ||
      typeof humanReply.text !== "string" ||
      (!humanReply.text.trim() &&
        (!Array.isArray(humanReply.files) || humanReply.files.length === 0)) ||
      replyTs <= slackTimestamp(humanReply.ts, `${parentName}.humanReply.ts`)
    ) {
      throw new Error(
        `${parentName}: status reply must follow the latest relevant human reply with its text or attachment evidence`,
      );
    }
    humanReplyTs = slackTimestamp(humanReply.ts, `${parentName}.humanReply.ts`);
  }

  if (
    fixedScopes.some(
      (fixedScope) => !reply.evidence.includes(fixedScope.verification.trim()),
    )
  ) {
    throw new Error(
      `${parentName}: status evidence must include every verified root scope`,
    );
  }
  if (
    unfinishedScopes.some(
      (unfinishedScope) =>
        !reply.evidence.includes(unfinishedScope.evidence.trim()),
    )
  ) {
    throw new Error(
      `${parentName}: status evidence must include every unfinished root scope`,
    );
  }

  validateThreadSnapshot(
    parentName,
    parent.ts,
    threadSnapshot,
    parent,
    sweepActorId,
  );
  validateHumanOwnerBlock(
    parentName,
    parent.disposition,
    handoffs,
    rootReactionState.ticket,
  );
  for (const handoff of handoffs) {
    validateHandoffAcceptance(
      parentName,
      handoff,
      timestamp,
      timestamp,
      replyTs,
      humanReplyTs,
      humanReply,
      threadSnapshot!.replies,
      sweepActorId,
    );
    validateCompletedHandoff(
      parentName,
      handoff,
      timestamp,
      reply,
      threadSnapshot!.replies,
    );
  }
  if (
    handoffs.some(
      (handoff) =>
        !handoff.scope.trim() ||
        !handoff.owner.trim() ||
        !handoff.action.trim(),
    ) ||
    (handoffs.length > 0 && !replyNamesHandoffs(reply.text, handoffs))
  ) {
    throw new Error(
      `${parentName}: status reply must name each handoff's scope, owner, and action`,
    );
  }
}

const MAX_READ_AGE_MS = 15 * 60 * 1000;
const MAX_FUTURE_SKEW_MS = 60 * 1000;

type ValidationOptions = {
  requireFreshReads?: boolean;
  sourceReceipt?: SourceReceipt;
  rawSourcePages?: RawSourcePages;
};

function validateReadAt(
  value: unknown,
  label: string,
  nextAction: string,
): number {
  if (typeof value !== "string") {
    throw new Error(
      `${label} must record the local ISO time of the completed read`,
    );
  }
  const readAt = Date.parse(value);
  if (!Number.isFinite(readAt) || new Date(readAt).toISOString() !== value) {
    throw new Error(`${label} must be an ISO timestamp`);
  }
  const age = Date.now() - readAt;
  if (age > MAX_READ_AGE_MS) {
    throw new Error(`${label} is older than 15 minutes; ${nextAction}`);
  }
  if (age < -MAX_FUTURE_SKEW_MS) {
    throw new Error(
      `${label} is more than one minute in the future; check the local clock and rescan`,
    );
  }
  return readAt;
}

function validateRootReactionReadAt(
  parentName: string,
  parent: Parent,
  requireFreshReads: boolean,
): number | undefined {
  const reactionReadAt = parent.reactionReadAt;
  const reactionWriteAt = parent.reactionWriteAt;
  let reactionReadTime: number | undefined;
  if (reactionReadAt !== undefined) {
    if (typeof reactionReadAt !== "string") {
      throw new Error(
        `${parentName}: root reaction read-back time must be an ISO timestamp`,
      );
    }
    reactionReadTime = Date.parse(reactionReadAt);
    if (
      !Number.isFinite(reactionReadTime) ||
      new Date(reactionReadTime).toISOString() !== reactionReadAt
    ) {
      throw new Error(
        `${parentName}: root reaction read-back time must be an ISO timestamp`,
      );
    }
  } else if (requireFreshReads) {
    throw new Error(
      `${parentName}: record when the exact root reaction read-back completed`,
    );
  }

  if (reactionWriteAt !== undefined) {
    if (typeof reactionWriteAt !== "string") {
      throw new Error(
        `${parentName}: root reaction write time must be an ISO timestamp`,
      );
    }
    const reactionWriteTime = Date.parse(reactionWriteAt);
    if (
      !Number.isFinite(reactionWriteTime) ||
      new Date(reactionWriteTime).toISOString() !== reactionWriteAt
    ) {
      throw new Error(
        `${parentName}: root reaction write time must be an ISO timestamp`,
      );
    }
    if (
      reactionReadTime === undefined ||
      reactionReadTime < reactionWriteTime
    ) {
      throw new Error(
        `${parentName}: root reaction read-back must follow the latest reaction write`,
      );
    }
  }

  if (requireFreshReads) {
    reactionReadTime = validateReadAt(
      reactionReadAt,
      `${parentName}.reactionReadAt`,
      "read the exact root reactions again before recap",
    );
  }
  return reactionReadTime;
}

const sourceReceiptChannelNames = new Map([
  ["C0C4U4XRT6X", "qa"],
  ["C0ATH3CCZT4", "product"],
  ["C0AJ5QV0J03", "dev"],
]);

function sourceReceiptChannelName(channelId: string, index: number): string {
  return (
    sourceReceiptChannelNames.get(channelId) ??
    ["qa", "product", "dev"][index] ??
    channelId
  );
}

function readRawSourcePages(
  directory: string,
  inventory: Inventory,
): RawSourcePages {
  const expectedChannels = new Set(
    inventory.channels.map((channel, index) =>
      sourceReceiptChannelName(channel.channelId, index),
    ),
  );
  const entries = readdirSync(directory);
  const files = entries.filter((file) =>
    /^rescan-feedback-[a-z0-9_-]+-\d+\.json$/i.test(file),
  );
  if (!files.length) {
    throw new Error(`${directory}: no captured raw Slack search pages found`);
  }
  const unexpectedFiles = entries.filter(
    (file) => !/^rescan-feedback-[a-z0-9_-]+-\d+\.json$/i.test(file),
  );
  if (unexpectedFiles.length) {
    throw new Error(
      `${directory}: unexpected files beside captured Slack pages: ${unexpectedFiles.join(", ")}`,
    );
  }

  const filesByChannel = new Map<string, string[]>();
  for (const file of files) {
    const match = /^rescan-feedback-([a-z0-9_-]+)-(\d+)\.json$/i.exec(file);
    const channelName = match?.[1];
    if (!channelName || !expectedChannels.has(channelName)) {
      throw new Error(
        `${directory}/${file}: page is outside the inventory channels`,
      );
    }
    const channelFiles = filesByChannel.get(channelName) ?? [];
    channelFiles.push(file);
    filesByChannel.set(channelName, channelFiles);
  }

  const result: RawSourcePages = {};
  for (const [channelIndex, channel] of inventory.channels.entries()) {
    const channelName = sourceReceiptChannelName(
      channel.channelId,
      channelIndex,
    );
    const channelFiles = filesByChannel.get(channelName) ?? [];
    channelFiles.sort(
      (left, right) =>
        Number(left.match(/-(\d+)\.json$/)?.[1]) -
        Number(right.match(/-(\d+)\.json$/)?.[1]),
    );
    result[channelName] = channelFiles.map((file, pageIndex) => {
      const path = join(directory, file);
      let saved: Record<string, unknown>;
      try {
        saved = JSON.parse(readFileSync(path, "utf8")) as Record<
          string,
          unknown
        >;
      } catch (error) {
        throw new Error(
          `${path}: could not read the captured Slack page: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      if (saved.isError === true || typeof saved.raw !== "string") {
        throw new Error(
          `${path}: captured Slack page read failed or has no raw response`,
        );
      }
      if (typeof saved.readAt !== "string") {
        throw new Error(`${path}: captured Slack page must record readAt`);
      }
      let response: { results?: unknown; pagination_info?: unknown };
      try {
        response = JSON.parse(saved.raw) as {
          results?: unknown;
          pagination_info?: unknown;
        };
      } catch (error) {
        throw new Error(
          `${path}: raw Slack response is not JSON: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      if (typeof response.results !== "string") {
        throw new Error(`${path}: raw Slack response has no detailed results`);
      }
      const blocks = response.results
        .split(/\n### Result \d+ of \d+\n/)
        .slice(1);
      const rows = blocks.map((block, rowIndex) => {
        const messageName = `${path} result ${rowIndex + 1}`;
        const ts = (block.match(/\nMessage_ts: ([0-9.]+)/) ?? [])[1];
        const permalink = (block.match(/\nPermalink: \[link\]\(([^\n]+)\)/) ??
          [])[1];
        if (!ts || !permalink) {
          throw new Error(
            `${messageName}: source timestamp or permalink is missing`,
          );
        }
        const timestamp = slackTimestamp(ts, `${messageName}.ts`);
        let url: URL;
        try {
          url = new URL(permalink);
        } catch {
          throw new Error(`${messageName}: source permalink is invalid`);
        }
        const pathMatch = /^\/archives\/([^/]+)\/p(\d+)$/.exec(url.pathname);
        if (
          url.protocol !== "https:" ||
          !url.hostname.endsWith(".slack.com") ||
          !pathMatch ||
          pathMatch[1] !== channel.channelId
        ) {
          throw new Error(
            `${messageName}: permalink does not identify the inventoried channel`,
          );
        }
        const permalinkTimestamp = `${pathMatch[2]!.slice(0, -6)}.${pathMatch[2]!.slice(-6)}`;
        if (
          slackTimestamp(permalinkTimestamp, `${messageName}.permalink`) !==
          timestamp
        ) {
          throw new Error(
            `${messageName}: permalink timestamp does not match the source message`,
          );
        }
        const threadTimestamps = url.searchParams.getAll("thread_ts");
        if (threadTimestamps.length > 1) {
          throw new Error(
            `${messageName}: permalink has multiple thread_ts values`,
          );
        }
        const threadTs = threadTimestamps[0] ?? null;
        if (threadTs !== null) {
          const parentTimestamp = slackTimestamp(
            threadTs,
            `${messageName}.thread_ts`,
          );
          if (parentTimestamp > timestamp) {
            throw new Error(
              `${messageName}: thread_ts is newer than the source message`,
            );
          }
        }
        return { ts, root: threadTs ?? ts };
      });
      const nextCursor =
        typeof response.pagination_info === "string"
          ? ((response.pagination_info.match(/cursor `([^`]+)`/) ?? [])[1] ??
            null)
          : null;
      const cursor = saved.cursor === undefined ? null : saved.cursor;
      if (cursor !== null && typeof cursor !== "string") {
        throw new Error(`${path}: request cursor must be a string or null`);
      }
      const sequence = Number(file.match(/-(\d+)\.json$/)?.[1]);
      if (sequence !== pageIndex) {
        throw new Error(
          `${path}: source page files must be numbered contiguously from 00`,
        );
      }
      return {
        cursor,
        nextCursor,
        exhausted: nextCursor === null,
        readAt: saved.readAt,
        messageCount: rows.length,
        sourceTimestamps: rows.map((row) => row.ts),
        rows,
      };
    });
  }
  return result;
}

function validateSourceReceipt(
  inventory: Inventory,
  receipt: SourceReceipt,
  requireFreshReads: boolean,
  rawSourcePages: RawSourcePages | undefined,
): void {
  if (
    !receipt ||
    typeof receipt !== "object" ||
    !receipt.channels ||
    typeof receipt.channels !== "object" ||
    Array.isArray(receipt.channels)
  ) {
    throw new Error("source receipt must contain a channels object");
  }
  if (!rawSourcePages) {
    throw new Error(
      "captured raw Slack source pages are required to validate the receipt",
    );
  }

  const expectedChannelNames = inventory.channels.map((channel, index) =>
    sourceReceiptChannelName(channel.channelId, index),
  );
  const actualChannelNames = Object.keys(receipt.channels);
  if (
    expectedChannelNames.length !== actualChannelNames.length ||
    expectedChannelNames.some((name) => !actualChannelNames.includes(name))
  ) {
    throw new Error(
      "source receipt channels must exactly match the inventoried channels",
    );
  }

  for (const [channelIndex, channel] of inventory.channels.entries()) {
    const name = sourceReceiptChannelName(channel.channelId, channelIndex);
    const receiptChannel = receipt.channels[name];
    if (!receiptChannel || typeof receiptChannel !== "object") {
      throw new Error(`${name}: source receipt channel is missing`);
    }
    if (receiptChannel.channelId !== channel.channelId) {
      throw new Error(
        `${name}: source receipt channelId does not match the inventory`,
      );
    }
    if (!Array.isArray(receiptChannel.pages)) {
      throw new Error(`${name}: source receipt pages must be an array`);
    }
    if (receiptChannel.pages.length !== channel.pages.length) {
      throw new Error(
        `${name}: source receipt page count does not match the inventory`,
      );
    }
    if (!Array.isArray(receiptChannel.rows)) {
      throw new Error(`${name}: source receipt rows must be an array`);
    }

    for (const [pageIndex, page] of channel.pages.entries()) {
      const receiptPage = receiptChannel.pages[pageIndex];
      const pageName = `${name} source receipt page ${pageIndex + 1}`;
      if (!receiptPage || typeof receiptPage !== "object") {
        throw new Error(`${pageName} is missing`);
      }
      if (typeof receiptPage.readAt !== "string") {
        throw new Error(`${pageName}.readAt must be an ISO timestamp`);
      }
      const receiptReadAt = Date.parse(receiptPage.readAt);
      if (
        !Number.isFinite(receiptReadAt) ||
        new Date(receiptReadAt).toISOString() !== receiptPage.readAt
      ) {
        throw new Error(`${pageName}.readAt must be an ISO timestamp`);
      }
      if (requireFreshReads) {
        validateReadAt(
          receiptPage.readAt,
          `${pageName}.readAt`,
          "rerun the complete channel scan before recap",
        );
      }

      for (const field of [
        "cursor",
        "nextCursor",
        "exhausted",
        "readAt",
        "messageCount",
        "sourceTimestamps",
      ] as const) {
        if (!isDeepStrictEqual(receiptPage[field], page[field])) {
          throw new Error(
            `${pageName}.${field} does not match the reviewed inventory; rebuild the inventory from the source receipt`,
          );
        }
      }
    }

    const inventoryRows = channel.pages.flatMap((page) => page.parents);
    const rawPages = rawSourcePages[name];
    if (!Array.isArray(rawPages) || rawPages.length !== channel.pages.length) {
      throw new Error(
        `${name}: captured raw Slack page count does not match the inventory`,
      );
    }
    const rawRows: SourceReceiptRow[] = [];
    for (const [pageIndex, rawPage] of rawPages.entries()) {
      const inventoryPage = channel.pages[pageIndex]!;
      const receiptPage = receiptChannel.pages[pageIndex]!;
      const pageName = `${name} raw Slack source page ${pageIndex + 1}`;
      for (const field of [
        "cursor",
        "nextCursor",
        "exhausted",
        "readAt",
        "messageCount",
        "sourceTimestamps",
      ] as const) {
        if (
          !isDeepStrictEqual(rawPage[field], inventoryPage[field]) ||
          !isDeepStrictEqual(rawPage[field], receiptPage[field])
        ) {
          throw new Error(
            `${pageName}.${field} does not match the captured source, receipt, and inventory`,
          );
        }
      }
      rawRows.push(...rawPage.rows);
    }
    if (!isDeepStrictEqual(rawRows, receiptChannel.rows)) {
      throw new Error(
        `${name}: raw Slack source rows do not match the independent source receipt`,
      );
    }
    if (receiptChannel.rows.length !== inventoryRows.length) {
      throw new Error(
        `${name}: source receipt row count does not match the inventory`,
      );
    }
    for (const [rowIndex, parent] of inventoryRows.entries()) {
      const receiptRow = receiptChannel.rows[rowIndex];
      if (
        !receiptRow ||
        typeof receiptRow.ts !== "string" ||
        typeof receiptRow.root !== "string"
      ) {
        throw new Error(
          `${name}: source receipt row ${rowIndex + 1} is invalid`,
        );
      }
      slackTimestamp(
        receiptRow.ts,
        `${name} source receipt row ${rowIndex + 1}.ts`,
      );
      slackTimestamp(
        receiptRow.root,
        `${name} source receipt row ${rowIndex + 1}.root`,
      );
      if (
        receiptRow.ts !== parent.ts ||
        receiptRow.root !== parent.threadParentTs
      ) {
        throw new Error(
          `${name}: source receipt row ${rowIndex + 1} timestamp/root does not match the reviewed inventory`,
        );
      }
    }
  }
}

function validateInventory(
  inventory: Inventory,
  options: ValidationOptions = {},
): string[] {
  if (!inventory || !Array.isArray(inventory.channels)) {
    throw new Error("Expected { cutoffTs, channels } in the inventory JSON");
  }

  const cutoff = slackTimestamp(inventory.cutoffTs, "cutoffTs");
  if (!isSlackUserId(inventory.sweepActorId)) {
    throw new Error(
      "sweepActorId must be the exact Slack user ID used by the connector",
    );
  }
  const permalink = inventory.permalinkTs
    ? slackTimestamp(inventory.permalinkTs, "permalinkTs")
    : null;
  if (permalink !== null && permalink !== cutoff) {
    throw new Error("permalinkTs must equal the inclusive cutoffTs");
  }
  if (!inventory.channels.length)
    throw new Error("No channels were inventoried");

  const channelIds = new Set<string>();
  const summaries: string[] = [];
  let permalinkFound = false;

  for (const [channelIndex, channel] of inventory.channels.entries()) {
    const name = channel.channelId || `channel ${channelIndex + 1}`;
    if (!channel.channelId || channelIds.has(channel.channelId)) {
      throw new Error(`${name}: channelId is missing or duplicated`);
    }
    channelIds.add(channel.channelId);

    const scanQuery = channel.scanQuery as
      | Partial<ChannelScanQuery>
      | undefined;
    if (!scanQuery || scanQuery.tool !== "slack_search_public") {
      throw new Error(
        `${name}: record the exhaustive slack_search_public scan arguments`,
      );
    }
    const queryKeys = Object.keys(scanQuery).sort();
    const expectedQueryKeys = [
      "after",
      "content_types",
      "filters",
      "include_bots",
      "include_context",
      "keywords",
      "limit",
      "natural_language_query",
      "response_format",
      "sort",
      "sort_dir",
      "tool",
    ].sort();
    if (
      queryKeys.length !== expectedQueryKeys.length ||
      queryKeys.some((key, index) => key !== expectedQueryKeys[index])
    ) {
      throw new Error(
        `${name}: scanQuery may contain only the documented exhaustive search arguments`,
      );
    }
    if (scanQuery.filters !== `in:<#${channel.channelId}>`) {
      throw new Error(
        `${name}: scanQuery.filters must constrain only this channel, with no content or date narrowing`,
      );
    }
    if (scanQuery.after !== inventory.cutoffTs) {
      throw new Error(
        `${name}: scanQuery.after must equal the inclusive cutoffTs`,
      );
    }
    if (
      !Array.isArray(scanQuery.keywords) ||
      scanQuery.keywords.length !== 0 ||
      scanQuery.natural_language_query !== ""
    ) {
      throw new Error(
        `${name}: scanQuery must not narrow the channel inventory with keywords or semantic search`,
      );
    }
    if (
      scanQuery.include_bots !== true ||
      scanQuery.include_context !== false ||
      scanQuery.content_types !== "messages" ||
      scanQuery.limit !== 20 ||
      scanQuery.sort !== "timestamp" ||
      scanQuery.sort_dir !== "desc" ||
      scanQuery.response_format !== "detailed"
    ) {
      throw new Error(
        `${name}: scanQuery must include bots and all messages, request 20 detailed results, and sort newest-first by timestamp`,
      );
    }

    if (!Object.prototype.hasOwnProperty.call(channel, "oldestQuery")) {
      throw new Error(
        `${name}: oldestQuery must be recorded as a Slack timestamp or explicit null`,
      );
    }
    const oldestQuery =
      channel.oldestQuery === null
        ? null
        : slackTimestamp(channel.oldestQuery, `${name}.oldestQuery`);
    if (oldestQuery !== null && oldestQuery > cutoff - 1_000_000n) {
      throw new Error(
        `${name}: oldestQuery must start at least one second before cutoffTs`,
      );
    }
    if (!Array.isArray(channel.pages) || !channel.pages.length) {
      throw new Error(
        `${name}: record every Slack page, including an empty page`,
      );
    }
    const pageReadTimes = options.requireFreshReads
      ? channel.pages.map((page, pageIndex) =>
          validateReadAt(
            page.readAt,
            `${name} page ${pageIndex + 1}.readAt`,
            "rerun the complete channel scan before recap",
          ),
        )
      : [];
    const finalPageReadAt = pageReadTimes.length
      ? Math.max(...pageReadTimes)
      : null;
    if (
      channel.threadRoots !== undefined &&
      !Array.isArray(channel.threadRoots)
    ) {
      throw new Error(
        `${name}: threadRoots must be an array of Slack timestamps`,
      );
    }
    if (
      channel.threadRootAudits !== undefined &&
      !Array.isArray(channel.threadRootAudits)
    ) {
      throw new Error(
        `${name}: threadRootAudits must be an array of root disposition rows`,
      );
    }
    if (
      channel.threadSnapshots !== undefined &&
      !Array.isArray(channel.threadSnapshots)
    ) {
      throw new Error(
        `${name}: threadSnapshots must be an array of full thread reads`,
      );
    }
    const threadSnapshots = new Map<string, ThreadSnapshot>();
    const snapshotRootTimestamps = new Set<string>();
    for (const [snapshotIndex, snapshot] of (
      channel.threadSnapshots ?? []
    ).entries()) {
      if (options.requireFreshReads) {
        const snapshotReadAt = validateReadAt(
          snapshot.readAt,
          `${name}.threadSnapshots[${snapshotIndex}].readAt`,
          "read the complete thread again after the final channel scan",
        );
        if (finalPageReadAt !== null && snapshotReadAt < finalPageReadAt) {
          throw new Error(
            `${name} threadSnapshot ${snapshot.rootTs} predates the final channel page; read the thread again after the channel scan`,
          );
        }
      }
      const normalizedRootTs = slackTimestamp(
        snapshot.rootTs,
        `${name}.threadSnapshots[${snapshotIndex}].rootTs`,
      ).toString();
      if (snapshotRootTimestamps.has(normalizedRootTs)) {
        throw new Error(`${name}: threadSnapshots contains a duplicate root`);
      }
      validateThreadSnapshotStructure(
        `${name} threadSnapshot ${snapshot.rootTs}`,
        snapshot.rootTs,
        snapshot,
        inventory.sweepActorId,
        options.requireFreshReads === true,
      );
      snapshotRootTimestamps.add(normalizedRootTs);
      threadSnapshots.set(snapshot.rootTs, snapshot);
    }

    let expectedCursor: string | null = null;
    let previousTimestamp: bigint | null = null;
    let parentCount = 0;
    let overlapCount = 0;
    let cursorOverlapCount = 0;
    const seen = new Set<string>();
    const seenCursors = new Set<string>();
    const uniqueInWindow = new Set<string>();
    const parentsByTimestamp = new Map<string, Parent>();
    let oldestSourceTimestamp: bigint | null = null;

    for (const [pageIndex, page] of channel.pages.entries()) {
      const pageName = `${name} page ${pageIndex + 1}`;
      if (
        !page ||
        typeof page !== "object" ||
        Array.isArray(page) ||
        !Object.prototype.hasOwnProperty.call(page, "cursor")
      ) {
        throw new Error(
          `${pageName}: record the requested cursor explicitly, including null on the first page`,
        );
      }
      if (
        !Object.prototype.hasOwnProperty.call(page, "nextCursor") ||
        (page.nextCursor !== null &&
          (typeof page.nextCursor !== "string" || !page.nextCursor))
      ) {
        throw new Error(
          `${pageName}: record nextCursor explicitly as a non-empty cursor or null`,
        );
      }
      if (
        !Object.prototype.hasOwnProperty.call(page, "exhausted") ||
        typeof page.exhausted !== "boolean"
      ) {
        throw new Error(
          `${pageName}: record Slack's exhausted state as an explicit boolean`,
        );
      }
      const cursor = page.cursor;
      if (cursor !== null && (typeof cursor !== "string" || !cursor)) {
        throw new Error(`${pageName}: cursor must be a non-empty string`);
      }
      const nextCursor = page.nextCursor;
      if (cursor !== expectedCursor) {
        throw new Error(`${pageName}: cursor does not follow the prior page`);
      }
      if (cursor !== null) {
        if (typeof cursor !== "string" || !cursor) {
          throw new Error(`${pageName}: cursor must be a non-empty string`);
        }
        if (seenCursors.has(cursor)) {
          throw new Error(
            `${pageName}: cursor was already used by an earlier page`,
          );
        }
        seenCursors.add(cursor);
      }
      if (
        !Number.isInteger(page.messageCount) ||
        !Array.isArray(page.parents)
      ) {
        throw new Error(`${pageName}: include messageCount and source rows`);
      }
      if (!Array.isArray(page.sourceTimestamps)) {
        throw new Error(`${pageName}: include all sourceTimestamps from Slack`);
      }
      if (page.messageCount !== page.sourceTimestamps.length) {
        throw new Error(
          `${pageName}: messageCount does not match the source timestamp manifest`,
        );
      }
      if (page.messageCount !== page.parents.length) {
        throw new Error(`${pageName}: a source message has no disposition row`);
      }

      let previousSourceTimestamp: bigint | null = null;
      for (const [sourceIndex, sourceTs] of page.sourceTimestamps.entries()) {
        const sourceTimestamp = slackTimestamp(
          sourceTs,
          `${pageName} source timestamp ${sourceIndex + 1}`,
        );
        if (oldestQuery !== null && sourceTimestamp <= oldestQuery) {
          throw new Error(
            `${pageName} source timestamp ${sourceIndex + 1}: Slack's exclusive oldest bound excludes it`,
          );
        }
        if (
          previousSourceTimestamp !== null &&
          sourceTimestamp >= previousSourceTimestamp
        ) {
          throw new Error(
            `${pageName}: source timestamps are not newest-first`,
          );
        }
        previousSourceTimestamp = sourceTimestamp;
        if (
          oldestSourceTimestamp === null ||
          sourceTimestamp < oldestSourceTimestamp
        ) {
          oldestSourceTimestamp = sourceTimestamp;
        }
        if (permalink !== null && sourceTimestamp === permalink) {
          permalinkFound = true;
        }
      }

      for (const [parentIndex, parent] of page.parents.entries()) {
        const parentName = `${pageName} parent ${parentIndex + 1}`;
        validateSlackFiles(`${parentName}.files`, parent.files);
        const timestamp = slackTimestamp(parent.ts, `${parentName}.ts`);
        const threadParentTimestamp = slackTimestamp(
          parent.threadParentTs,
          `${parentName}.threadParentTs`,
        );
        if (threadParentTimestamp > timestamp) {
          throw new Error(
            `${parentName}: threadParentTs cannot be newer than the source message`,
          );
        }
        validateRootResolution(
          parentName,
          parent,
          channel.channelId,
          timestamp,
          threadParentTimestamp,
        );
        if (timestamp === threadParentTimestamp) {
          if (
            parent.rootClassification !== "report" &&
            parent.rootClassification !== "administrative"
          ) {
            throw new Error(
              `${parentName}: classify each channel post as a report or administrative root`,
            );
          }
          if (
            parent.rootClassification === "administrative" &&
            !parent.rootClassificationReason?.trim()
          ) {
            throw new Error(
              `${parentName}: administrative roots need a reason`,
            );
          }
        }
        const key = timestamp.toString();
        if (page.sourceTimestamps[parentIndex] !== parent.ts) {
          throw new Error(
            `${parentName}: disposition rows do not match the source timestamp manifest`,
          );
        }
        if (oldestQuery !== null && timestamp <= oldestQuery) {
          throw new Error(
            `${parentName}: Slack's exclusive oldest bound excludes it`,
          );
        }
        const isCursorOverlap =
          pageIndex > 0 &&
          parentIndex === 0 &&
          previousTimestamp !== null &&
          timestamp === previousTimestamp;
        if (seen.has(key) && !isCursorOverlap) {
          throw new Error(`${parentName}: duplicate parent timestamp`);
        }
        if (
          previousTimestamp !== null &&
          timestamp >= previousTimestamp &&
          !isCursorOverlap
        ) {
          throw new Error(
            `${parentName}: parents are not newest-first across pages`,
          );
        }
        if (parent.reactionChecked !== true) {
          throw new Error(`${parentName}: check reactions before triage`);
        }
        if (
          typeof parent.disposition !== "string" ||
          !canonicalDispositions.has(parent.disposition)
        ) {
          throw new Error(
            `${parentName}: use an exact canonical disposition for every parent`,
          );
        }
        if (
          typeof parent.reactionSummary !== "string" ||
          !parent.reactionSummary.trim()
        ) {
          throw new Error(`${parentName}: record the observed reaction state`);
        }
        if (
          !parent.reactionOwners ||
          typeof parent.reactionOwners !== "object" ||
          Array.isArray(parent.reactionOwners)
        ) {
          throw new Error(
            `${parentName}: record exact user IDs for every reaction`,
          );
        }
        validateReactionOwners(
          parentName,
          parent.reactionSummary,
          parent.reactionOwners,
        );

        const isRootMessage = timestamp === threadParentTimestamp;
        if (isRootMessage) {
          const reactionReadAt = validateRootReactionReadAt(
            parentName,
            parent,
            options.requireFreshReads === true,
          );
          if (
            options.requireFreshReads &&
            finalPageReadAt !== null &&
            reactionReadAt! < finalPageReadAt
          ) {
            throw new Error(
              parentName +
                ": root reaction read-back must follow the final channel page",
            );
          }
        }
        const threadSnapshot = threadSnapshots.get(parent.threadParentTs);
        validateSourceFilesInSnapshot(parentName, parent, threadSnapshot);
        if (
          !isRootMessage &&
          ((parent.fixedScopes?.length ?? 0) > 0 ||
            (parent.unfinishedScopes?.length ?? 0) > 0 ||
            parent.handoff !== undefined ||
            (parent.handoffs?.length ?? 0) > 0)
        ) {
          throw new Error(
            `${parentName}: scope and handoff evidence must be recorded on the actual root row; reply rows only audit reply-level history`,
          );
        }
        const rootReactionState = workflowReactionState(
          parent.reactionOwners,
          inventory.sweepActorId,
        );
        if (!isRootMessage) {
          validateLegacyReplyReactionReadback(
            parentName,
            parent,
            threadSnapshot,
            inventory.sweepActorId,
            options.requireFreshReads === true,
          );
        }
        const rootWorkflowState = rootReactionState;
        const ownsEye = rootWorkflowState.eyes;
        const hasCheckmark = rootWorkflowState.white_check_mark;
        const hasTicket = rootWorkflowState.ticket;
        const historicalMarks = parent.historicalReactionMarks ?? [];
        const hasHistoricalCheckmark = historicalMarks.some(
          (mark) => mark.emoji === "white_check_mark",
        );
        const hasHistoricalTicket = historicalMarks.some(
          (mark) => mark.emoji === "ticket",
        );
        const reconcilesOwnedStatus =
          isRootMessage && hasWorkflowReaction(rootWorkflowState);
        let fixedScopes: NonNullable<Parent["fixedScopes"]> = [];
        let fixedScopeNames = new Set<string>();
        let unfinishedScopes: NonNullable<Parent["unfinishedScopes"]> = [];
        let unfinishedScopeNames = new Set<string>();
        let handoffs: Handoff[] = [];
        if (isRootMessage) {
          const isInScopeReport =
            timestamp >= cutoff && parent.rootClassification === "report";
          if (
            parent.rootClassification === "administrative" &&
            reconcilesOwnedStatus
          ) {
            throw new Error(
              `${parentName}: this actor's workflow marks cannot be placed on an administrative root`,
            );
          }
          validateOtherOwnerEvidence(
            parentName,
            parent,
            inventory.sweepActorId,
            parent.ts,
            threadSnapshot,
            isInScopeReport,
            reconcilesOwnedStatus,
          );
          const scopeEvidence = validateScopeEvidence(parentName, parent);
          fixedScopes = scopeEvidence.fixedScopes;
          fixedScopeNames = scopeEvidence.fixedScopeNames;
          unfinishedScopes = scopeEvidence.unfinishedScopes;
          unfinishedScopeNames = scopeEvidence.unfinishedScopeNames;
          validateFixedScopeFreshness(parentName, parent);
          handoffs = validateHandoffDefinitions(
            parentName,
            parent,
            fixedScopeNames,
          );
          if (!reconcilesOwnedStatus) {
            if (historicalMarks.length > 0) {
              throw new Error(
                `${parentName}: historical reaction evidence needs a retained root mark owned by this actor`,
              );
            }
            validateDispositionScopes(
              parentName,
              parent,
              false,
              isInScopeReport,
              ownsEye,
              hasCheckmark,
              fixedScopeNames,
              unfinishedScopeNames,
              handoffs,
              hasHistoricalCheckmark,
            );
            validateHandoffTicketParity(
              parentName,
              handoffs,
              hasTicket,
              hasHistoricalTicket,
            );
          }
        }
        if (reconcilesOwnedStatus) {
          if (
            !Object.prototype.hasOwnProperty.call(
              parent,
              "latestRelevantHumanReply",
            )
          ) {
            throw new Error(
              `${parentName}: record the latest relevant human reply in this root thread, or null if there is none`,
            );
          }
          const reactionDecision = parent.reactionDecision;
          if (!reactionDecision) {
            throw new Error(
              `${parentName}: record a ✅ and 🎫 decision for every owned eye or own status mark`,
            );
          }
          for (const reaction of ["checkmark", "ticket"] as const) {
            const decision = reactionDecision[reaction];
            const present =
              reaction === "checkmark"
                ? rootWorkflowState.white_check_mark
                : rootWorkflowState.ticket;
            if (
              !decision ||
              decision.state !== (present ? "present" : "none") ||
              !decision.reason?.trim()
            ) {
              throw new Error(
                `${parentName}: ${reaction} decision must match the observed reaction and include a reason`,
              );
            }
          }
          validateHandoffTicketParity(
            parentName,
            handoffs,
            hasTicket,
            hasHistoricalTicket,
          );
          validateDispositionScopes(
            parentName,
            parent,
            true,
            timestamp >= cutoff && parent.rootClassification === "report",
            ownsEye,
            hasCheckmark,
            fixedScopeNames,
            unfinishedScopeNames,
            handoffs,
            hasHistoricalCheckmark,
          );
          const reply = parent.statusReply;
          if (!reply) {
            throw new Error(
              `${parentName}: an owned 👀 or own ✅/🎫 needs a same-parent status reply by the same actor`,
            );
          }
          const latestOwnedReply = parent.latestOwnedReply;
          if (
            !latestOwnedReply ||
            latestOwnedReply.actorId !== inventory.sweepActorId ||
            typeof latestOwnedReply.text !== "string" ||
            !latestOwnedReply.text.trim()
          ) {
            throw new Error(
              `${parentName}: record the latest same-actor reply from the full thread read`,
            );
          }
          const latestOwnedReplyTs = slackTimestamp(
            latestOwnedReply.ts,
            `${parentName}.latestOwnedReply.ts`,
          );
          if (
            slackTimestamp(
              latestOwnedReply.threadParentTs,
              `${parentName}.latestOwnedReply.threadParentTs`,
            ) !== threadParentTimestamp
          ) {
            throw new Error(
              `${parentName}: latestOwnedReply must belong to the source message's root thread`,
            );
          }
          const replyTs = slackTimestamp(
            reply.ts,
            `${parentName}.statusReply.ts`,
          );
          if (
            latestOwnedReplyTs !== replyTs ||
            latestOwnedReply.actorId !== reply.actorId ||
            latestOwnedReply.text !== reply.text
          ) {
            throw new Error(
              `${parentName}: statusReply must be the latest same-actor reply read from the full thread`,
            );
          }
          if (replyTs <= timestamp) {
            throw new Error(
              `${parentName}: status reply must be newer than its parent`,
            );
          }
          if (
            slackTimestamp(
              reply.threadParentTs,
              `${parentName}.statusReply.threadParentTs`,
            ) !== threadParentTimestamp
          ) {
            throw new Error(
              `${parentName}: status reply must belong to the source message's root thread`,
            );
          }
          const latestRelevantHumanReply = parent.latestRelevantHumanReply;
          let latestRelevantHumanReplyTs: bigint | null = null;
          if (latestRelevantHumanReply !== null) {
            if (
              !latestRelevantHumanReply ||
              !isSlackUserId(latestRelevantHumanReply.actorId) ||
              latestRelevantHumanReply.actorId === inventory.sweepActorId ||
              typeof latestRelevantHumanReply.text !== "string" ||
              (!latestRelevantHumanReply.text.trim() &&
                (!Array.isArray(latestRelevantHumanReply.files) ||
                  latestRelevantHumanReply.files.length === 0))
            ) {
              throw new Error(
                `${parentName}: latestRelevantHumanReply needs a non-sweep human Slack actor ID and verbatim text or attachment metadata, or null`,
              );
            }
            latestRelevantHumanReplyTs = slackTimestamp(
              latestRelevantHumanReply.ts,
              `${parentName}.latestRelevantHumanReply.ts`,
            );
            if (latestRelevantHumanReplyTs <= threadParentTimestamp) {
              throw new Error(
                `${parentName}: latestRelevantHumanReply must be a reply in the source message's root thread`,
              );
            }
            if (replyTs <= latestRelevantHumanReplyTs) {
              throw new Error(
                `${parentName}: status reply must be newer than the latest relevant human reply in the thread`,
              );
            }
          }
          if (reply.actorId !== inventory.sweepActorId) {
            throw new Error(
              `${parentName}: status reply author must match this actor's owned eye or status mark`,
            );
          }
          if (
            reply.disposition !== parent.disposition ||
            typeof reply.evidence !== "string" ||
            !reply.evidence.trim() ||
            typeof reply.text !== "string" ||
            !reply.text.trim() ||
            !replyStatesDisposition(reply.text, parent.disposition) ||
            !reply.text.includes(reply.evidence.trim())
          ) {
            throw new Error(
              `${parentName}: status reply must state the exact disposition and include its recorded evidence`,
            );
          }
          if (historicalMarks.length > 0) {
            if (!threadSnapshot) {
              throw new Error(
                `${parentName}: historical reaction marks require the captured full thread`,
              );
            }
            validateHistoricalReactionMarks(
              parentName,
              parent,
              reply,
              threadSnapshot,
              inventory.sweepActorId,
            );
          }
          validateStatusReactionLanguage(
            parentName,
            reply.text,
            hasCheckmark,
            hasTicket,
            fixedScopes,
            unfinishedScopes,
            historicalMarks,
          );
          if (
            fixedScopes.some(
              (fixedScope) =>
                !reply.evidence.includes(fixedScope.verification.trim()),
            )
          ) {
            throw new Error(
              `${parentName}: status reply evidence must include every fixed scope's recorded verification`,
            );
          }
          if (
            unfinishedScopes.some(
              (unfinishedScope) =>
                !reply.evidence.includes(unfinishedScope.evidence.trim()),
            )
          ) {
            throw new Error(
              `${parentName}: status reply evidence must include each unfinished scope's recorded evidence`,
            );
          }
          validateThreadSnapshot(
            parentName,
            parent.threadParentTs,
            threadSnapshot,
            parent,
            inventory.sweepActorId,
          );
          for (const handoff of handoffs) {
            validateHandoffAcceptance(
              parentName,
              handoff,
              threadParentTimestamp,
              threadParentTimestamp,
              replyTs,
              latestRelevantHumanReplyTs,
              latestRelevantHumanReply,
              threadSnapshot!.replies,
              inventory.sweepActorId,
            );
            validateCompletedHandoff(
              parentName,
              handoff,
              threadParentTimestamp,
              parent.statusReply!,
              threadSnapshot!.replies,
            );
          }
          validateHumanOwnerBlock(
            parentName,
            parent.disposition,
            handoffs,
            hasTicket,
          );
          if (
            handoffs.length > 0 &&
            !replyNamesHandoffs(parent.statusReply!.text, handoffs)
          ) {
            throw new Error(
              `${parentName}: status reply must name each handoff's scope, owner, and action`,
            );
          }
        }

        if (seen.has(key)) {
          const previousParent = parentsByTimestamp.get(key);
          if (!isCursorOverlap || !isDeepStrictEqual(previousParent, parent)) {
            throw new Error(
              `${parentName}: cursor-overlap row must exactly match the prior page's last source row`,
            );
          }
        } else {
          seen.add(key);
          parentsByTimestamp.set(key, parent);
        }
        previousTimestamp = timestamp;
        parentCount += 1;
        if (isCursorOverlap) cursorOverlapCount += 1;
        if (timestamp >= cutoff) uniqueInWindow.add(key);
        if (permalink !== null && timestamp === permalink)
          permalinkFound = true;
        if (timestamp < cutoff) overlapCount += 1;
      }

      const isLastPage = pageIndex === channel.pages.length - 1;
      if (nextCursor && seenCursors.has(nextCursor)) {
        throw new Error(
          `${pageName}: nextCursor repeats a cursor already used`,
        );
      }
      if (page.exhausted && nextCursor !== null) {
        throw new Error(`${pageName}: exhausted page cannot have a nextCursor`);
      }
      if (!isLastPage) {
        if (page.exhausted || nextCursor === null) {
          throw new Error(
            `${pageName}: non-final page must have a nextCursor and cannot be exhausted`,
          );
        }
        expectedCursor = nextCursor;
      } else {
        if (!page.exhausted || nextCursor !== null) {
          throw new Error(
            `${pageName}: follow every cursor until Slack reports exhaustion with nextCursor null`,
          );
        }
      }
    }

    const supplementalRoots = new Set<string>();
    for (const [rootIndex, root] of (channel.threadRoots ?? []).entries()) {
      const rootTime = slackTimestamp(
        root,
        `${name}.threadRoots[${rootIndex}]`,
      );
      if (rootTime >= cutoff) {
        throw new Error(
          `${name}: a supplemental thread root must predate cutoffTs; include roots within the scoped window in the source manifest`,
        );
      }
      if (oldestSourceTimestamp !== null && rootTime >= oldestSourceTimestamp) {
        throw new Error(
          `${name}: a supplemental root must predate every scanned source message; include roots inside the scanned range in the source manifest`,
        );
      }
      const rootTimestamp = rootTime.toString();
      if (supplementalRoots.has(rootTimestamp)) {
        throw new Error(`${name}: threadRoots contains a duplicate root`);
      }
      if (parentsByTimestamp.has(rootTimestamp)) {
        throw new Error(
          `${name}: threadRoots must include only roots outside page manifests`,
        );
      }
      supplementalRoots.add(rootTimestamp);
    }

    const auditedSupplementalRoots = new Set<string>();
    for (const [auditIndex, rootAudit] of (
      channel.threadRootAudits ?? []
    ).entries()) {
      const rootTimestamp = slackTimestamp(
        rootAudit.ts,
        `${name}.threadRootAudits[${auditIndex}].ts`,
      ).toString();
      if (!supplementalRoots.has(rootTimestamp)) {
        throw new Error(
          `${name}: threadRootAudits contains a root missing from threadRoots`,
        );
      }
      if (auditedSupplementalRoots.has(rootTimestamp)) {
        throw new Error(`${name}: threadRootAudits contains a duplicate root`);
      }
      auditedSupplementalRoots.add(rootTimestamp);
      validateSupplementalRootAudit(
        name,
        channel.channelId,
        rootTimestamp,
        rootAudit,
        inventory.sweepActorId,
        threadSnapshots.get(rootAudit.ts),
        options.requireFreshReads === true,
        finalPageReadAt,
      );
    }
    if (auditedSupplementalRoots.size !== supplementalRoots.size) {
      throw new Error(
        `${name}: every supplemental root needs its own reaction and disposition audit row`,
      );
    }

    const referencedSupplementalRoots = new Set<string>();
    for (const [timestamp, parent] of parentsByTimestamp) {
      const rootTimestamp = slackTimestamp(
        parent.threadParentTs,
        `${name} source ${parent.ts}.threadParentTs`,
      ).toString();
      if (rootTimestamp === timestamp) continue;
      const root = parentsByTimestamp.get(rootTimestamp);
      if (root) {
        if (
          slackTimestamp(
            root.threadParentTs,
            `${name} root ${root.ts}.threadParentTs`,
          ) !== slackTimestamp(root.ts, `${name} root ${root.ts}.ts`)
        ) {
          throw new Error(
            `${name} source ${parent.ts}: threadParentTs resolves to a reply, not the actual root`,
          );
        }
      } else if (supplementalRoots.has(rootTimestamp)) {
        referencedSupplementalRoots.add(rootTimestamp);
      } else {
        throw new Error(
          `${name} source ${parent.ts}: threadParentTs does not resolve to an in-page root or verified threadRoots entry`,
        );
      }
    }
    if (referencedSupplementalRoots.size !== supplementalRoots.size) {
      throw new Error(`${name}: threadRoots contains an unreferenced root`);
    }

    summaries.push(
      `${channel.channelId}: ${parentCount} source occurrences, ${uniqueInWindow.size} unique in window, ${overlapCount} cutoff overlap, ${cursorOverlapCount} page overlap, ${channel.pages.length} page(s)`,
    );

    const sourceRows = [...parentsByTimestamp.values()];
    const inScopeRows = sourceRows.filter(
      (parent) =>
        slackTimestamp(parent.ts, `${name} summary ${parent.ts}.ts`) >= cutoff,
    );
    const rootRows = inScopeRows.filter(
      (parent) =>
        slackTimestamp(
          parent.threadParentTs,
          `${name} summary ${parent.ts}.threadParentTs`,
        ) === slackTimestamp(parent.ts, `${name} summary ${parent.ts}.ts`),
    );
    const reportRoots = rootRows.filter(
      (parent) => parent.rootClassification === "report",
    );
    const administrativeRoots = rootRows.filter(
      (parent) => parent.rootClassification === "administrative",
    );
    const replyRows = inScopeRows.filter(
      (parent) =>
        slackTimestamp(
          parent.threadParentTs,
          `${name} summary reply ${parent.ts}.threadParentTs`,
        ) !==
        slackTimestamp(parent.ts, `${name} summary reply ${parent.ts}.ts`),
    );
    const distinctReportRoots = new Map(
      reportRoots.map((parent) => [parent.ts, parent]),
    );
    for (const supplementalRoot of channel.threadRootAudits ?? []) {
      const rootTimestamp = slackTimestamp(
        supplementalRoot.ts,
        `${name} summary supplemental root ${supplementalRoot.ts}.ts`,
      );
      if (rootTimestamp >= cutoff) {
        distinctReportRoots.set(supplementalRoot.ts, supplementalRoot);
      }
    }
    const summarizeMarks = (rows: Parent[], label: string): void => {
      const ownedEyes = rows.filter((parent) =>
        (parent.reactionOwners.eyes ?? []).includes(inventory.sweepActorId),
      );
      const ownedCheckmarks = rows.filter((parent) =>
        (parent.reactionOwners.white_check_mark ?? []).includes(
          inventory.sweepActorId,
        ),
      );
      const ownedTickets = rows.filter((parent) =>
        (parent.reactionOwners.ticket ?? []).includes(inventory.sweepActorId),
      );
      const verifiedScopeCount = ownedCheckmarks.reduce(
        (count, parent) => count + (parent.fixedScopes?.length ?? 0),
        0,
      );
      const distinctHandoffs = new Set<string>();
      const unassignedHandoffs = new Set<string>();
      for (const parent of ownedTickets) {
        const handoffs =
          parent.handoffs ?? (parent.handoff ? [parent.handoff] : []);
        for (const handoff of handoffs) {
          const key = [handoff.scope, handoff.owner, handoff.action]
            .map(normalizeScope)
            .join("\u0000");
          distinctHandoffs.add(key);
          if (handoff.status === "unassigned") unassignedHandoffs.add(key);
        }
      }
      const eyeOnlyRows = ownedEyes.filter(
        (parent) =>
          !(parent.reactionOwners.white_check_mark ?? []).includes(
            inventory.sweepActorId,
          ) &&
          !(parent.reactionOwners.ticket ?? []).includes(
            inventory.sweepActorId,
          ),
      );
      const openEyeOnlyRows = eyeOnlyRows.filter((parent) =>
        openDispositions.has(parent.disposition),
      );
      const closedEyeOnlyRows = eyeOnlyRows.filter(
        (parent) => !openDispositions.has(parent.disposition),
      );
      summaries.push(
        `${channel.channelId}: in-scope ${label} ${rows.length}; owned 👀 ${ownedEyes.length}, ✅ marks ${ownedCheckmarks.length} for ${verifiedScopeCount} verified scopes, 🎫 marks ${ownedTickets.length} for ${distinctHandoffs.size} distinct human actions (${distinctHandoffs.size - unassignedHandoffs.size} accepted, ${unassignedHandoffs.size} unassigned; including completed history), eye-only ${eyeOnlyRows.length}`,
      );
      if (openEyeOnlyRows.length > 0) {
        summaries.push(
          `${channel.channelId}: ${label} eye-only open pending reasons: ${openEyeOnlyRows
            .map((parent) => {
              const decision = parent.reactionDecision!;
              return `${parent.ts} — ✅ ${decision.checkmark.reason}; 🎫 ${decision.ticket.reason}`;
            })
            .join(" | ")}`,
        );
      }
      if (closedEyeOnlyRows.length > 0) {
        summaries.push(
          `${channel.channelId}: ${label} eye-only closed historical roots: ${closedEyeOnlyRows
            .map((parent) => `${parent.ts} — ${parent.disposition}`)
            .join(" | ")}`,
        );
      }
    };
    summarizeMarks([...distinctReportRoots.values()], "report roots");
    const summarizeReplyMarks = (
      snapshots: ThreadSnapshot[],
      label: string,
    ): string => {
      const replyMarkOwners = new Map<string, Map<string, number>>();
      for (const snapshot of snapshots) {
        for (const reply of snapshot.replies) {
          for (const emoji of ["eyes", "white_check_mark", "ticket"]) {
            for (const owner of reply.workflowReactionOwners[emoji] ?? []) {
              const owners = replyMarkOwners.get(emoji) ?? new Map();
              owners.set(owner, (owners.get(owner) ?? 0) + 1);
              replyMarkOwners.set(emoji, owners);
            }
          }
        }
      }
      const replyMarkSummary = (["eyes", "white_check_mark", "ticket"] as const)
        .map((emoji) => {
          const owners = replyMarkOwners.get(emoji) ?? new Map();
          const count = [...owners.values()].reduce(
            (total, ownerCount) => total + ownerCount,
            0,
          );
          const ownerSummary = [...owners]
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([owner, ownerCount]) => `${owner}: ${ownerCount}`)
            .join(", ");
          const symbol =
            emoji === "eyes"
              ? "👀"
              : emoji === "white_check_mark"
                ? "✅"
                : "🎫";
          return `${symbol} ${count}${ownerSummary ? ` (${ownerSummary})` : ""}`;
        })
        .join("; ");
      return `${channel.channelId}: ${label} root-thread reply marks (history only; never root checkoffs): ${replyMarkSummary}`;
    };
    const replySnapshots = channel.threadSnapshots ?? [];
    summaries.push(
      summarizeReplyMarks(
        replySnapshots.filter(
          (snapshot) =>
            slackTimestamp(
              snapshot.rootTs,
              `${name} summary thread ${snapshot.rootTs}.rootTs`,
            ) >= cutoff,
        ),
        "current-window",
      ),
    );
    summaries.push(
      summarizeReplyMarks(
        replySnapshots.filter(
          (snapshot) =>
            slackTimestamp(
              snapshot.rootTs,
              `${name} summary thread ${snapshot.rootTs}.rootTs`,
            ) < cutoff,
        ),
        "pre-cutoff boundary",
      ),
    );
    summaries.push(
      `${channel.channelId}: in-scope administrative roots ${administrativeRoots.length}${
        administrativeRoots.length
          ? ` (${administrativeRoots.map((parent) => `${parent.ts}: ${parent.rootClassificationReason}`).join(" | ")})`
          : ""
      }; excluded from report totals`,
    );
    summaries.push(
      `${channel.channelId}: in-scope reply rows ${replyRows.length}; excluded from report-root reaction totals`,
    );
    summaries.push(
      `${channel.channelId}: pre-cutoff rows audited ${sourceRows.length - inScopeRows.length} source messages, ${channel.threadRootAudits?.length ?? 0} supplemental roots; excluded from in-scope totals`,
    );
  }

  if (options.sourceReceipt) {
    validateSourceReceipt(
      inventory,
      options.sourceReceipt,
      options.requireFreshReads === true,
      options.rawSourcePages,
    );
  }

  if (permalink !== null && !permalinkFound) {
    throw new Error(
      "The requested permalink timestamp is missing from the inventory",
    );
  }

  return summaries;
}

const args = process.argv.slice(2).filter((argument) => argument !== "--");
if (args[0] === "--self-test" && args.length === 1) {
  for (const [text, action] of [
    ["I'll test this later today", "test this later today"],
    ["I'll supersede #7524", "supersede #7524"],
    [
      "I'll expand it to be all apps. + attachments",
      "expand it to be all apps",
    ],
  ]) {
    if (
      !replyExplicitlyAcceptsHandoff(text) ||
      !replyNamesHandoffAction(text, action)
    ) {
      throw new Error(
        `Feedback inventory checker self-test failed: explicit handoff acceptance was not recognized (${action}).`,
      );
    }
  }
  for (const text of [
    "I might test this later today",
    "I may expand it to be all apps",
    "I won't supersede #7524",
  ]) {
    if (replyExplicitlyAcceptsHandoff(text)) {
      throw new Error(
        `Feedback inventory checker self-test failed: a tentative handoff was accepted (${text}).`,
      );
    }
  }
  const assignedPrHandoff: Handoff = {
    scope: "Interact scrolling",
    owner: "Enzo",
    ownerSlackId: "U0BNS6TLRK8",
    action: "fix this",
  };
  const assignedPrRequest =
    "Yeah we need to fix this. <@U0BNS6TLRK8|Enzo> I think this is in your todo list? Otherwise I can take it on — a small PR to fix this would be ideal.";
  const assignedPrAcceptance = "yes that is on my PR. taking a look now";
  if (
    !replyDirectlyRequestsHandoff(assignedPrRequest, assignedPrHandoff) ||
    !replyContextuallyAssentsToHandoff(assignedPrAcceptance)
  ) {
    throw new Error(
      "Feedback inventory checker self-test failed: a named TODO/PR assignment and clear owner assent were not recognized.",
    );
  }
  if (
    replyDirectlyRequestsHandoff(
      "Enzo might look at this when he has time.",
      assignedPrHandoff,
    )
  ) {
    throw new Error(
      "Feedback inventory checker self-test failed: a mention without an assigned action was treated as a direct handoff request.",
    );
  }
  const valid: Inventory = {
    cutoffTs: "10.000000",
    permalinkTs: "10.000000",
    sweepActorId: "USWEEPER",
    channels: [
      {
        channelId: "C_TEST",
        scanQuery: {
          tool: "slack_search_public",
          after: "10.000000",
          filters: "in:<#C_TEST>",
          keywords: [],
          natural_language_query: "",
          include_bots: true,
          include_context: false,
          content_types: "messages",
          limit: 20,
          sort: "timestamp",
          sort_dir: "desc",
          response_format: "detailed",
        },
        oldestQuery: "9.000000",
        pages: [
          {
            cursor: null,
            nextCursor: null,
            exhausted: true,
            messageCount: 3,
            sourceTimestamps: ["11.000000", "10.000000", "9.500000"],
            parents: [
              {
                ts: "11.000000",
                threadParentTs: "11.000000",
                rootResolution: {
                  evidence: "slack_message.thread_ts",
                  sourceThreadTs: null,
                  rootTs: "11.000000",
                },
                rootClassification: "report",
                reactionChecked: true,
                reactionSummary: "none",
                reactionOwners: {},
                disposition: "Skipped",
              },
              {
                ts: "10.000000",
                threadParentTs: "10.000000",
                rootResolution: {
                  evidence: "slack_message.thread_ts",
                  sourceThreadTs: null,
                  rootTs: "10.000000",
                },
                rootClassification: "report",
                reactionChecked: true,
                reactionReadAt: "2030-01-01T00:00:00.000Z",
                reactionSummary: "white_check_mark (1): USWEEPER",
                reactionOwners: { white_check_mark: ["USWEEPER"] },
                disposition: "Fixed",
                latestRelevantHumanReply: null,
                latestOwnedReply: {
                  ts: "12.000000",
                  threadParentTs: "10.000000",
                  actorId: "USWEEPER",
                  text: "Fixed: focused test passed. :white_check_mark: covers the initial route screen. No :ticket: — no separate human-owned action remains. this was sent from a bot.",
                },
                reactionDecision: {
                  checkmark: {
                    state: "present",
                    reason: "Verified initial route screen behavior",
                  },
                  ticket: {
                    state: "none",
                    reason: "No separate human-owned action remains",
                  },
                },
                statusReply: {
                  ts: "12.000000",
                  threadParentTs: "10.000000",
                  actorId: "USWEEPER",
                  disposition: "Fixed",
                  evidence: "focused test passed",
                  text: "Fixed: focused test passed. :white_check_mark: covers the initial route screen. No :ticket: — no separate human-owned action remains. this was sent from a bot.",
                },
                fixedScopes: [
                  {
                    scope: "initial route screen",
                    verification: "focused test passed",
                  },
                ],
              },
              {
                ts: "9.500000",
                threadParentTs: "9.500000",
                rootResolution: {
                  evidence: "slack_message.thread_ts",
                  sourceThreadTs: null,
                  rootTs: "9.500000",
                },
                rootClassification: "report",
                reactionChecked: true,
                reactionSummary: "eyes (1): UOTHER",
                reactionOwners: { eyes: ["UOTHER"] },
                disposition: "Skipped",
              },
            ],
          },
        ],
        threadSnapshots: [
          {
            rootTs: "10.000000",
            readAt: "2030-01-01T00:00:00.000Z",
            replyCount: 1,
            replies: [
              {
                ts: "12.000000",
                actorId: "USWEEPER",
                kind: "sweep",
                text: "Fixed: focused test passed. :white_check_mark: covers the initial route screen. No :ticket: — no separate human-owned action remains. this was sent from a bot.",
                workflowReactionSummary: "none",
                workflowReactionOwners: {},
              },
            ],
          },
        ],
      },
    ],
  };
  const firstPage = valid.channels[0].pages[0];
  const latestOwnedReplyFrom = (
    reply: NonNullable<Parent["statusReply"]>,
  ): NonNullable<Parent["latestOwnedReply"]> => ({
    ts: reply.ts,
    threadParentTs: reply.threadParentTs,
    actorId: reply.actorId,
    text: reply.text,
  });
  const supplementalRootAudit = (
    ts: string,
    overrides: Partial<Parent> = {},
  ): Parent => ({
    ts,
    threadParentTs: ts,
    rootResolution: {
      evidence: "slack_message.thread_ts",
      sourceThreadTs: null,
      rootTs: ts,
    },
    rootClassification: "report",
    reactionChecked: true,
    reactionSummary: "none",
    reactionOwners: {},
    disposition: "Skipped",
    ...overrides,
  });
  const sourceThreadResolution = (rootTs: string): RootResolution => ({
    evidence: "slack_message.thread_ts",
    sourceThreadTs: rootTs,
    rootTs,
  });
  const sourcePermalink = (ts: string, threadTs?: string): string => {
    const match = /^(\d+)\.(\d{1,6})$/.exec(ts);
    if (!match) throw new Error(`invalid test timestamp ${ts}`);
    const timestampPath = `${match[1]}${match[2]!.padEnd(6, "0")}`;
    const query = threadTs ? `?thread_ts=${encodeURIComponent(threadTs)}` : "";
    return `https://builder-internal.slack.com/archives/C_TEST/p${timestampPath}${query}`;
  };
  const permalinkThreadResolution = (
    messageTs: string,
    rootTs: string,
  ): RootResolution => ({
    evidence: "slack_permalink.thread_ts",
    sourceThreadTs: rootTs,
    rootTs,
    sourcePermalink: sourcePermalink(messageTs, rootTs),
  });
  const replyPermalinkThreadResolution = (
    sourceMessageTs: string,
    rootTs: string,
  ): RootResolution => ({
    evidence: "slack_reply_permalink.thread_ts",
    sourceThreadTs: rootTs,
    sourceMessageTs,
    rootTs,
    sourcePermalink: sourcePermalink(sourceMessageTs, rootTs),
  });
  const ownedSupplementalRootAudit = (
    overrides: Partial<Parent> = {},
  ): Parent => {
    const disposition = overrides.disposition ?? "In progress";
    const evidence = "the reported root scope still needs verification";
    const statusReply = overrides.statusReply ?? {
      ts: "8.600000",
      threadParentTs: "8.500000",
      actorId: "USWEEPER",
      disposition,
      evidence,
      text: `${disposition}: ${evidence}. No :white_check_mark: — no root scope has passed verification. No :ticket: — no separate human/team action remains unfinished. this was sent from a bot.`,
    };
    return supplementalRootAudit("8.500000", {
      reactionSummary: "eyes (1): USWEEPER",
      reactionOwners: { eyes: ["USWEEPER"] },
      disposition,
      latestRelevantHumanReply: null,
      latestOwnedReply: latestOwnedReplyFrom(statusReply),
      reactionDecision: {
        checkmark: {
          state: "none",
          reason: "No root scope has passed verification",
        },
        ticket: {
          state: "none",
          reason: "No distinct human handoff is assigned",
        },
      },
      statusReply,
      ...overrides,
    });
  };
  const withSupplementalRootAudit = (rootAudit: Parent): Inventory => ({
    ...valid,
    channels: valid.channels.map((channel) => ({
      ...channel,
      threadRoots: ["8.500000"],
      threadRootAudits: [rootAudit],
      pages: channel.pages.map((page) => ({
        ...page,
        parents: page.parents.map((parent) =>
          parent.ts === "9.500000"
            ? {
                ...parent,
                threadParentTs: "8.500000",
                rootResolution: sourceThreadResolution("8.500000"),
              }
            : parent,
        ),
      })),
    })),
  });
  const withSweepOwnedParent = (overrides: Partial<Parent>): Inventory => ({
    ...valid,
    channels: valid.channels.map((channel) => ({
      ...channel,
      pages: channel.pages.map((page) => ({
        ...page,
        parents: page.parents.map((parent) => {
          if (parent.ts !== "10.000000") return parent;
          const updated = { ...parent, ...overrides };
          if (
            overrides.statusReply &&
            overrides.latestOwnedReply === undefined
          ) {
            updated.latestOwnedReply = latestOwnedReplyFrom(
              overrides.statusReply,
            );
          }
          return updated;
        }),
      })),
    })),
  });
  const withTestThreadSnapshots = (
    inventory: Inventory,
    syncLatestOwnedReply = false,
  ): Inventory => ({
    ...inventory,
    channels: inventory.channels.map((channel) => {
      const pages = syncLatestOwnedReply
        ? channel.pages.map((page) => ({
            ...page,
            parents: page.parents.map((parent) => {
              const ownsMark = ["eyes", "white_check_mark", "ticket"].some(
                (emoji) =>
                  parent.reactionOwners?.[emoji]?.includes(
                    inventory.sweepActorId,
                  ),
              );
              return ownsMark && parent.statusReply
                ? {
                    ...parent,
                    latestOwnedReply: latestOwnedReplyFrom(parent.statusReply),
                  }
                : parent;
            }),
          }))
        : channel.pages;
      const rows = [
        ...pages.flatMap((page) => page.parents),
        ...(channel.threadRootAudits ?? []),
      ];
      const repliesByRoot = new Map<
        string,
        Map<string, ThreadSnapshot["replies"][number]>
      >();
      for (const parent of rows) {
        const ownsMark = ["eyes", "white_check_mark", "ticket"].some((emoji) =>
          parent.reactionOwners?.[emoji]?.includes(inventory.sweepActorId),
        );
        const ownsReplyMark = parent.ts !== parent.threadParentTs && ownsMark;
        const otherOwnerStatus = parent.otherOwnerEvidence?.statusReply;
        if (
          (!ownsMark || !parent.statusReply) &&
          !otherOwnerStatus &&
          !ownsReplyMark
        ) {
          continue;
        }
        const rootTs = parent.threadParentTs;
        const replies = repliesByRoot.get(rootTs) ?? new Map();
        const addReply = (
          ts: string,
          actorId: string,
          kind: ThreadSnapshot["replies"][number]["kind"],
          text: string,
          workflowReactionSummary = "none",
          workflowReactionOwners: Record<string, string[]> = {},
          files?: SlackFileAttachment[],
        ): void => {
          const existing = replies.get(ts);
          if (
            existing &&
            (existing.actorId !== actorId ||
              existing.text !== text ||
              JSON.stringify(existing.files ?? []) !==
                JSON.stringify(files ?? []))
          ) {
            throw new Error(`self-test fixture has conflicting reply ${ts}`);
          }
          replies.set(ts, {
            ts,
            actorId,
            kind,
            text,
            ...(files?.length ? { files } : {}),
            workflowReactionSummary,
            workflowReactionOwners,
          });
        };
        if (parent.latestRelevantHumanReply) {
          const reply = parent.latestRelevantHumanReply;
          addReply(
            reply.ts,
            reply.actorId,
            reply.actorId === inventory.sweepActorId ? "sweep" : "human",
            reply.text,
            "none",
            {},
            reply.files,
          );
        }
        for (const handoff of parent.handoffs ??
          (parent.handoff ? [parent.handoff] : [])) {
          const request = handoff.requestReply;
          if (request) {
            addReply(
              request.ts,
              request.actorId,
              request.actorId === inventory.sweepActorId ? "sweep" : "human",
              request.text,
            );
          }
          const acceptance = handoff.acceptanceReply;
          if (acceptance) {
            addReply(
              acceptance.ts,
              acceptance.actorId,
              acceptance.actorId === inventory.sweepActorId ? "sweep" : "human",
              acceptance.text,
            );
          }
          const completionReply = handoff.completion?.reply;
          if (completionReply) {
            addReply(
              completionReply.ts,
              completionReply.actorId,
              completionReply.actorId === inventory.sweepActorId
                ? "sweep"
                : "human",
              completionReply.text,
            );
          }
        }
        for (const mark of parent.historicalReactionMarks ?? []) {
          addReply(
            mark.previousStatus.ts,
            mark.previousStatus.actorId,
            "sweep",
            mark.previousStatus.text,
          );
          if (mark.handoff?.requestReply) {
            const request = mark.handoff.requestReply;
            addReply(
              request.ts,
              request.actorId,
              request.actorId === inventory.sweepActorId ? "sweep" : "human",
              request.text,
            );
          }
          if (mark.handoff?.acceptanceReply) {
            const acceptance = mark.handoff.acceptanceReply;
            addReply(
              acceptance.ts,
              acceptance.actorId,
              "human",
              acceptance.text,
            );
          }
          if (mark.withdrawalReply) {
            addReply(
              mark.withdrawalReply.ts,
              mark.withdrawalReply.actorId,
              "human",
              mark.withdrawalReply.text,
            );
          }
        }
        const status = parent.statusReply;
        if (status) {
          addReply(
            status.ts,
            status.actorId,
            status.actorId === inventory.sweepActorId ? "sweep" : "human",
            status.text,
          );
        }
        if (otherOwnerStatus) {
          addReply(
            otherOwnerStatus.ts,
            otherOwnerStatus.actorId,
            "human",
            otherOwnerStatus.text,
          );
        }
        if (ownsReplyMark) {
          const sourceReply = replies.get(parent.ts);
          const workflowReactionOwners = Object.fromEntries(
            (["eyes", "white_check_mark", "ticket"] as const)
              .filter((emoji) => parent.reactionOwners[emoji]?.length)
              .map((emoji) => [
                emoji,
                [...parent.reactionOwners[emoji]!].sort(),
              ]),
          );
          const workflowReactionSummary = Object.entries(workflowReactionOwners)
            .map(
              ([emoji, owners]) =>
                `${emoji} (${owners.length}): ${owners.join(", ")}`,
            )
            .join("; ");
          replies.set(parent.ts, {
            ts: parent.ts,
            actorId: sourceReply?.actorId ?? inventory.sweepActorId,
            kind: sourceReply?.kind ?? "sweep",
            text: sourceReply?.text ?? "Legacy reply workflow mark retained.",
            ...(sourceReply?.files?.length ? { files: sourceReply.files } : {}),
            workflowReactionSummary,
            workflowReactionOwners,
            workflowReactionReadAt: parent.reactionReadAt,
          });
        }
        repliesByRoot.set(rootTs, replies);
      }
      return {
        ...channel,
        pages,
        threadSnapshots: [
          ...[...repliesByRoot.entries()].map(([rootTs, replies]) => {
            const orderedReplies = [...replies.values()].sort((a, b) =>
              slackTimestamp(a.ts, "test reply ts") <
              slackTimestamp(b.ts, "test reply ts")
                ? -1
                : 1,
            );
            return {
              rootTs,
              readAt: "2030-01-01T00:00:00.000Z",
              replyCount: orderedReplies.length,
              ...(rows.find(
                (parent) =>
                  parent.ts === rootTs && parent.threadParentTs === rootTs,
              )?.files?.length
                ? {
                    rootFiles: rows.find(
                      (parent) =>
                        parent.ts === rootTs &&
                        parent.threadParentTs === rootTs,
                    )!.files,
                  }
                : {}),
              replies: orderedReplies,
            };
          }),
          ...(channel.threadRootAudits ?? [])
            .filter((root) => !repliesByRoot.has(root.ts))
            .map((root) => ({
              rootTs: root.ts,
              readAt: "2030-01-01T00:00:00.000Z",
              replyCount: 0,
              ...(root.files?.length ? { rootFiles: root.files } : {}),
              replies: [],
            })),
        ],
      };
    }),
  });
  const withLegacyReplyEye = (): Inventory => {
    const statusReply: StatusReply = {
      ts: "9.600000",
      threadParentTs: "8.500000",
      actorId: "USWEEPER",
      disposition: "In progress",
      evidence: "the reported root scope still needs verification",
      text: "In progress: the reported root scope still needs verification. No :white_check_mark: — no root scope has passed verification. No :ticket: — no separate human/team action remains unfinished. this was sent from a bot.",
    };
    const inventory = withSupplementalRootAudit(
      ownedSupplementalRootAudit({ statusReply }),
    );
    const markedReply = {
      ...inventory,
      channels: inventory.channels.map((channel) => ({
        ...channel,
        pages: channel.pages.map((page) => ({
          ...page,
          parents: page.parents.map((parent) =>
            parent.ts === "9.500000"
              ? {
                  ...parent,
                  reactionSummary: "eyes (1): USWEEPER",
                  reactionOwners: { eyes: ["USWEEPER"] },
                  reactionReadAt: "2030-01-01T00:00:00.000Z",
                }
              : parent,
          ),
        })),
      })),
    };
    return withTestThreadSnapshots(markedReply);
  };
  const withHandoffReply = (text: string): Inventory => ({
    ...valid,
    channels: valid.channels.map((channel) => ({
      ...channel,
      pages: channel.pages.map((page) => ({
        ...page,
        parents: page.parents.map((parent) => {
          if (parent.ts !== "10.000000") return parent;
          const statusReply = {
            ...parent.statusReply!,
            disposition: "Partially fixed",
            evidence: "focused route-picker test passed; merge pending",
            text,
          };
          return {
            ...parent,
            disposition: "Partially fixed",
            reactionSummary:
              "eyes (1): USWEEPER; white_check_mark (1): USWEEPER; ticket (1): USWEEPER",
            reactionOwners: {
              eyes: ["USWEEPER"],
              white_check_mark: ["USWEEPER"],
              ticket: ["USWEEPER"],
            },
            reactionDecision: {
              checkmark: {
                state: "present",
                reason: "Verified route-picker fix",
              },
              ticket: {
                state: "present",
                reason: "A product owner has a distinct follow-up",
              },
            },
            latestRelevantHumanReply: {
              ts: "11.500000",
              actorId: "UOTHER",
              text: "I will choose the remaining behavior.",
            },
            handoffs: [
              {
                scope: "secondary request",
                owner: "Alex Rivera",
                ownerSlackId: "UOTHER",
                action: "choose the remaining behavior",
                acceptanceReply: {
                  ts: "11.500000",
                  threadParentTs: "10.000000",
                  actorId: "UOTHER",
                  text: "I will choose the remaining behavior.",
                },
              },
            ],
            fixedScopes: [
              {
                scope: "route-picker behavior",
                verification: "focused route-picker test passed; merge pending",
              },
            ],
            statusReply,
            latestOwnedReply: latestOwnedReplyFrom(statusReply),
          };
        }),
      })),
    })),
  });
  const withUnownedCheckmark = (
    overrides: Partial<Parent> = {},
  ): Inventory => ({
    ...valid,
    channels: valid.channels.map((channel) => ({
      ...channel,
      pages: channel.pages.map((page) => ({
        ...page,
        parents: page.parents.map((parent) =>
          parent.ts === "10.000000"
            ? {
                ...parent,
                reactionSummary:
                  "1+ (1): UOTHER; white_check_mark (1): USWEEPER",
                reactionOwners: {
                  "1+": ["UOTHER"],
                  white_check_mark: ["USWEEPER"],
                },
                reactionDecision: {
                  checkmark: {
                    state: "present",
                    reason: "Verified initial route screen fix",
                  },
                  ticket: {
                    state: "none",
                    reason: "No separate human-owned action remains",
                  },
                },
                ...overrides,
              }
            : parent,
        ),
      })),
    })),
  });
  const withUnownedTicket = (overrides: Partial<Parent> = {}): Inventory => ({
    ...valid,
    channels: valid.channels.map((channel) => ({
      ...channel,
      pages: channel.pages.map((page) => ({
        ...page,
        parents: page.parents.map((parent) => {
          if (parent.ts !== "10.000000") return parent;
          const statusReply = {
            ...parent.statusReply!,
            disposition: "In progress",
            evidence: "Alex Rivera will choose the remaining behavior",
            text: "In progress: Alex Rivera will choose the remaining behavior. Handoff: remaining design choice — Alex Rivera — choose the remaining behavior. No :white_check_mark: — no verified scope is complete yet. :ticket: tracks Alex Rivera's accepted action. this was sent from a bot.",
          };
          const updated: Parent = {
            ...parent,
            disposition: "In progress",
            reactionSummary: "eyes (1): USWEEPER; ticket (1): USWEEPER",
            reactionOwners: {
              eyes: ["USWEEPER"],
              ticket: ["USWEEPER"],
            },
            reactionDecision: {
              checkmark: {
                state: "none",
                reason: "No verified scope is complete yet",
              },
              ticket: {
                state: "present",
                reason: "A product owner owns the remaining action",
              },
            },
            fixedScopes: [],
            latestRelevantHumanReply: {
              ts: "11.500000",
              actorId: "UOTHER",
              text: "I will choose the remaining behavior.",
            },
            handoffs: [
              {
                scope: "remaining design choice",
                owner: "Alex Rivera",
                ownerSlackId: "UOTHER",
                action: "choose the remaining behavior",
                acceptanceReply: {
                  ts: "11.500000",
                  threadParentTs: "10.000000",
                  actorId: "UOTHER",
                  text: "I will choose the remaining behavior.",
                },
              },
            ],
            statusReply,
            ...overrides,
          };
          updated.latestOwnedReply = latestOwnedReplyFrom(updated.statusReply!);
          return updated;
        }),
      })),
    })),
  });
  const withUnassignedTeamTicket = (
    overrides: Partial<Parent> = {},
  ): Inventory =>
    withUnownedTicket({
      latestRelevantHumanReply: null,
      handoffs: [
        {
          scope: "remaining design choice",
          owner: "Product team",
          action: "choose the remaining behavior",
          status: "unassigned",
        },
      ],
      statusReply: {
        ts: "12.000000",
        threadParentTs: "10.000000",
        actorId: "USWEEPER",
        disposition: "In progress",
        evidence:
          "the Product team still needs to choose the remaining behavior",
        text: "In progress: the Product team still needs to choose the remaining behavior. Handoff: remaining design choice — Product team — choose the remaining behavior; owner unassigned. No :white_check_mark: — no verified scope is complete yet. :ticket: tracks the unfinished Product team action; owner unassigned. this was sent from a bot.",
      },
      ...overrides,
    });
  const withOtherOwnerRoot = (overrides: Partial<Parent> = {}): Inventory => ({
    ...valid,
    channels: valid.channels.map((channel) => ({
      ...channel,
      pages: channel.pages.map((page) => ({
        ...page,
        parents: page.parents.map((parent) => {
          if (parent.ts !== "10.000000") return parent;
          const statusReply: StatusReply = {
            ts: "12.000000",
            threadParentTs: "10.000000",
            actorId: "UOTHER",
            disposition: "In progress",
            evidence: "I am actively testing the new behavior",
            text: "In progress: I am actively testing the new behavior.",
          };
          return {
            ...parent,
            disposition: "Owned elsewhere",
            reactionSummary: "eyes (1): UOTHER",
            reactionOwners: { eyes: ["UOTHER"] },
            latestRelevantHumanReply: null,
            latestOwnedReply: undefined,
            statusReply: undefined,
            fixedScopes: [],
            unfinishedScopes: [],
            otherOwnerEvidence: { actorId: "UOTHER", statusReply },
            ...overrides,
          };
        }),
      })),
    })),
  });
  const withContextualTicket = (
    requestText = "<@UOTHER> can you choose the remaining behavior?",
    acceptanceText = "Yeah sure, I think I have a PR coming up that fixes this.",
    requestOverrides: Partial<NonNullable<Handoff["requestReply"]>> = {},
  ): Inventory => {
    const requestReply = {
      ts: "11.250000",
      threadParentTs: "10.000000",
      actorId: "USWEEPER",
      text: requestText,
      ...requestOverrides,
    };
    const acceptanceReply = {
      ts: "11.500000",
      threadParentTs: "10.000000",
      actorId: "UOTHER",
      text: acceptanceText,
    };
    return withUnownedTicket({
      latestRelevantHumanReply: acceptanceReply,
      handoffs: [
        {
          scope: "remaining design choice",
          owner: "Alex Rivera",
          ownerSlackId: "UOTHER",
          action: "choose the remaining behavior",
          requestReply,
          acceptanceReply,
        },
      ],
    });
  };
  const invalid = [
    {
      name: "root messages must be classified before report totals",
      inventory: {
        ...valid,
        channels: valid.channels.map((channel) => ({
          ...channel,
          pages: channel.pages.map((page) => ({
            ...page,
            parents: page.parents.map((parent) =>
              parent.ts === "11.000000"
                ? { ...parent, rootClassification: undefined }
                : parent,
            ),
          })),
        })),
      },
    },
    {
      name: "administrative root needs a visible exclusion reason",
      inventory: {
        ...valid,
        channels: valid.channels.map((channel) => ({
          ...channel,
          pages: channel.pages.map((page) => ({
            ...page,
            parents: page.parents.map((parent) =>
              parent.ts === "11.000000"
                ? {
                    ...parent,
                    rootClassification: "administrative" as const,
                    rootClassificationReason: undefined,
                  }
                : parent,
            ),
          })),
        })),
      },
    },
    {
      name: "open in-scope report without this actor's eye is rejected",
      inventory: {
        ...valid,
        channels: valid.channels.map((channel) => ({
          ...channel,
          pages: channel.pages.map((page) => ({
            ...page,
            parents: page.parents.map((parent) =>
              parent.ts === "11.000000"
                ? { ...parent, disposition: "In progress" }
                : parent,
            ),
          })),
        })),
      },
    },
    {
      name: "reply rows cannot carry scope evidence outside the root checkoff",
      inventory: {
        ...valid,
        channels: valid.channels.map((channel) => ({
          ...channel,
          pages: channel.pages.map((page) => ({
            ...page,
            parents: page.parents.map((parent) =>
              parent.ts === "11.000000"
                ? {
                    ...parent,
                    threadParentTs: "10.000000",
                    rootResolution: sourceThreadResolution("10.000000"),
                    fixedScopes: [
                      {
                        scope: "reply-only behavior",
                        verification: "a reply-level test passed",
                      },
                    ],
                  }
                : parent,
            ),
          })),
        })),
      },
    },
    {
      name: "another actor's eye is not auto-claimed or replied to",
      inventory: withOtherOwnerRoot({
        disposition: "In progress",
        otherOwnerEvidence: undefined,
      }),
    },
    {
      name: "current open owner eye cannot be auto-claimed",
      inventory: (() => {
        const withSnapshot = withTestThreadSnapshots(withOtherOwnerRoot());
        return {
          ...withSnapshot,
          channels: withSnapshot.channels.map((channel) => ({
            ...channel,
            pages: channel.pages.map((page) => ({
              ...page,
              parents: page.parents.map((parent) =>
                parent.ts === "10.000000"
                  ? {
                      ...parent,
                      disposition: "In progress",
                      otherOwnerEvidence: undefined,
                    }
                  : parent,
              ),
            })),
          })),
        };
      })(),
    },
    {
      name: "Owned elsewhere needs an open latest owner status, not a historical eye",
      inventory: withOtherOwnerRoot({
        otherOwnerEvidence: {
          actorId: "UOTHER",
          statusReply: {
            ts: "12.000000",
            threadParentTs: "10.000000",
            actorId: "UOTHER",
            disposition: "Skipped",
            evidence: "the report is no longer actionable",
            text: "Skipped: the report is no longer actionable.",
          },
        },
      }),
    },
    {
      name: "Owned elsewhere needs another actor's root eye",
      inventory: withOtherOwnerRoot({
        reactionSummary: "none",
        reactionOwners: {},
      }),
    },
    {
      name: "Owned elsewhere status must exist in the captured thread",
      inventory: {
        ...withTestThreadSnapshots(withOtherOwnerRoot()),
        channels: withTestThreadSnapshots(withOtherOwnerRoot()).channels.map(
          (channel) => ({ ...channel, threadSnapshots: [] }),
        ),
      },
    },
    {
      name: "Owned elsewhere status cannot precede a later human reply",
      inventory: withOtherOwnerRoot({
        latestRelevantHumanReply: {
          ts: "13.000000",
          actorId: "UOTHER",
          text: "I am still checking the behavior.",
        },
      }),
    },
    {
      name: "other actors' marks do not replace this actor's eye on open report",
      inventory: {
        ...valid,
        channels: valid.channels.map((channel) => ({
          ...channel,
          pages: channel.pages.map((page) => ({
            ...page,
            parents: page.parents.map((parent) =>
              parent.ts === "10.000000"
                ? {
                    ...parent,
                    reactionSummary:
                      "eyes (1): UOTHER; white_check_mark (1): UOTHER; ticket (1): UOTHER",
                    reactionOwners: {
                      eyes: ["UOTHER"],
                      white_check_mark: ["UOTHER"],
                      ticket: ["UOTHER"],
                    },
                    disposition: "Partially fixed",
                    statusReply: undefined,
                    fixedScopes: [
                      {
                        scope: "verified route behavior",
                        verification:
                          "another actor verified the route behavior",
                      },
                    ],
                    handoffs: [
                      {
                        scope: "remaining design choice",
                        owner: "Alex Rivera",
                        ownerSlackId: "UOTHER",
                        action: "choose the remaining behavior",
                      },
                    ],
                  }
                : parent,
            ),
          })),
        })),
      },
    },
    {
      name: "administrative manifest roots cannot carry this actor's workflow marks",
      inventory: {
        ...valid,
        channels: valid.channels.map((channel) => ({
          ...channel,
          pages: channel.pages.map((page) => ({
            ...page,
            parents: page.parents.map((parent) =>
              parent.ts === "11.000000"
                ? {
                    ...parent,
                    rootClassification: "administrative" as const,
                    rootClassificationReason: "release announcement",
                    reactionSummary: "eyes (1): USWEEPER",
                    reactionOwners: { eyes: ["USWEEPER"] },
                  }
                : parent,
            ),
          })),
        })),
      },
    },
    {
      name: "owned marks need a fresh full-thread read",
      inventory: {
        ...valid,
        channels: valid.channels.map((channel) => ({
          ...channel,
          threadSnapshots: [],
        })),
      },
    },
    {
      name: "a newer thread reply invalidates the recorded snapshot",
      inventory: {
        ...valid,
        channels: valid.channels.map((channel) => ({
          ...channel,
          threadSnapshots: channel.threadSnapshots?.map((snapshot) => ({
            ...snapshot,
            replyCount: snapshot.replyCount + 1,
            replies: [
              ...snapshot.replies,
              {
                ts: "13.000000",
                actorId: "UOTHER",
                kind: "human" as const,
                text: "The same issue is still happening after the fix.",
                workflowReactionSummary: "none",
                workflowReactionOwners: {},
              },
            ],
          })),
        })),
      },
    },
    {
      name: "thread snapshot count must match the complete reply read",
      inventory: {
        ...valid,
        channels: valid.channels.map((channel) => ({
          ...channel,
          threadSnapshots: channel.threadSnapshots?.map((snapshot) => ({
            ...snapshot,
            replyCount: snapshot.replyCount + 1,
          })),
        })),
      },
    },
    {
      name: "legacy reply marks must match the captured reaction read-back",
      inventory: (() => {
        const withMark = withLegacyReplyEye();
        return {
          ...withMark,
          channels: withMark.channels.map((channel) => ({
            ...channel,
            threadSnapshots: channel.threadSnapshots?.map((snapshot) => ({
              ...snapshot,
              replies: snapshot.replies.map((reply) =>
                reply.ts === "9.500000"
                  ? {
                      ...reply,
                      workflowReactionSummary: "none",
                      workflowReactionOwners: {},
                    }
                  : reply,
              ),
            })),
          })),
        };
      })(),
    },
    {
      name: "exhausted final page cannot retain a next cursor",
      inventory: {
        ...valid,
        channels: valid.channels.map((channel) => ({
          ...channel,
          pages: channel.pages.map((page, pageIndex) =>
            pageIndex === channel.pages.length - 1
              ? { ...page, nextCursor: "stale-cursor" }
              : page,
          ),
        })),
      },
    },
    {
      name: "requested page cursor must be explicit",
      inventory: {
        ...valid,
        channels: valid.channels.map((channel) => ({
          ...channel,
          pages: channel.pages.map((page, pageIndex) =>
            pageIndex === 0
              ? (Object.fromEntries(
                  Object.entries(page).filter(([key]) => key !== "cursor"),
                ) as unknown as Page)
              : page,
          ),
        })),
      },
    },
    {
      name: "next page cursor must be explicit",
      inventory: {
        ...valid,
        channels: valid.channels.map((channel) => ({
          ...channel,
          pages: channel.pages.map((page, pageIndex) =>
            pageIndex === 0
              ? (Object.fromEntries(
                  Object.entries(page).filter(([key]) => key !== "nextCursor"),
                ) as unknown as Page)
              : page,
          ),
        })),
      },
    },
    {
      name: "empty next page cursor is not explicit exhaustion",
      inventory: {
        ...valid,
        channels: valid.channels.map((channel) => ({
          ...channel,
          pages: channel.pages.map((page, pageIndex) =>
            pageIndex === 0 ? { ...page, nextCursor: "" } : page,
          ),
        })),
      },
    },
    {
      name: "Slack exhaustion state must be explicit",
      inventory: {
        ...valid,
        channels: valid.channels.map((channel) => ({
          ...channel,
          pages: channel.pages.map((page, pageIndex) =>
            pageIndex === channel.pages.length - 1
              ? (Object.fromEntries(
                  Object.entries(page).filter(([key]) => key !== "exhausted"),
                ) as unknown as Page)
              : page,
          ),
        })),
      },
    },
    {
      name: "final page must report Slack exhaustion",
      inventory: {
        ...valid,
        channels: valid.channels.map((channel) => ({
          ...channel,
          pages: channel.pages.map((page, pageIndex) =>
            pageIndex === channel.pages.length - 1
              ? { ...page, exhausted: false }
              : page,
          ),
        })),
      },
    },
    {
      name: "noncanonical disposition label",
      inventory: {
        ...valid,
        channels: valid.channels.map((channel) => ({
          ...channel,
          pages: channel.pages.map((page) => ({
            ...page,
            parents: page.parents.map((parent) =>
              parent.ts === "9.500000"
                ? { ...parent, disposition: "Reviewed by another actor" }
                : parent,
            ),
          })),
        })),
      },
    },
    {
      name: "missing disposition row",
      inventory: {
        ...valid,
        channels: valid.channels.map((channel) => ({
          ...channel,
          pages: channel.pages.map((page) => ({
            ...page,
            parents: page.parents.slice(1),
          })),
        })),
      },
    },
    {
      name: "missing permalink",
      inventory: {
        ...valid,
        channels: valid.channels.map((channel) => ({
          ...channel,
          pages: channel.pages.map((page) => ({
            ...page,
            messageCount: 1,
            sourceTimestamps: ["11.000000"],
            parents: page.parents.slice(0, 1),
          })),
        })),
      },
    },
    {
      name: "permalink is not the inclusive cutoff",
      inventory: { ...valid, cutoffTs: "10.000001" },
    },
    {
      name: "channel-wide scan query is required",
      inventory: {
        ...valid,
        channels: valid.channels.map(
          (channel) =>
            Object.fromEntries(
              Object.entries(channel).filter(([key]) => key !== "scanQuery"),
            ) as unknown as Channel,
        ),
      },
    },
    {
      name: "scan query cannot use lexical keywords",
      inventory: {
        ...valid,
        channels: valid.channels.map((channel) => ({
          ...channel,
          scanQuery: {
            ...channel.scanQuery,
            keywords: ["button"],
          } as unknown as ChannelScanQuery,
        })),
      },
    },
    {
      name: "scan query must include bot messages",
      inventory: {
        ...valid,
        channels: valid.channels.map((channel) => ({
          ...channel,
          scanQuery: {
            ...channel.scanQuery,
            include_bots: false,
          } as unknown as ChannelScanQuery,
        })),
      },
    },
    {
      name: "scan query must cover the exact channel and inclusive cutoff",
      inventory: {
        ...valid,
        channels: valid.channels.map((channel) => ({
          ...channel,
          scanQuery: {
            ...channel.scanQuery,
            after: "10.000001",
            filters: "in:<#C_TEST> button",
          } as unknown as ChannelScanQuery,
        })),
      },
    },
    {
      name: "scan query must use the exact inclusive cutoff",
      inventory: {
        ...valid,
        channels: valid.channels.map((channel) => ({
          ...channel,
          scanQuery: {
            ...channel.scanQuery,
            after: "9.000000",
          } as unknown as ChannelScanQuery,
        })),
      },
    },
    {
      name: "scan query cannot contain undocumented filters",
      inventory: {
        ...valid,
        channels: valid.channels.map((channel) => ({
          ...channel,
          scanQuery: {
            ...channel.scanQuery,
            before: "11.000000",
          } as unknown as ChannelScanQuery,
        })),
      },
    },
    {
      name: "oldestQuery is omitted instead of explicitly recorded",
      inventory: {
        ...valid,
        channels: valid.channels.map(
          (channel) =>
            Object.fromEntries(
              Object.entries(channel).filter(([key]) => key !== "oldestQuery"),
            ) as unknown as Channel,
        ),
      },
    },
    {
      name: "oldestQuery cannot be an empty string",
      inventory: {
        ...valid,
        channels: valid.channels.map((channel) => ({
          ...channel,
          oldestQuery: "",
        })),
      },
    },
    {
      name: "owned eye missing a status reply",
      inventory: {
        ...valid,
        channels: valid.channels.map((channel) => ({
          ...channel,
          pages: channel.pages.map((page) => ({
            ...page,
            parents: page.parents.map((parent) =>
              parent.ts === "10.000000"
                ? { ...parent, statusReply: undefined }
                : parent,
            ),
          })),
        })),
      },
    },
    {
      name: "owned eye missing latest same-actor reply audit",
      inventory: withSweepOwnedParent({ latestOwnedReply: undefined }),
    },
    {
      name: "newer same-actor correction invalidates an older status reply",
      inventory: withSweepOwnedParent({
        latestOwnedReply: {
          ts: "13.000000",
          threadParentTs: "10.000000",
          actorId: "USWEEPER",
          text: "In progress: previous status was incorrect; investigation continues",
        },
      }),
    },
    {
      name: "Owned elsewhere with an eye still needs active-owner evidence",
      inventory: withSweepOwnedParent({ disposition: "Owned elsewhere" }),
    },
    {
      name: "Owned elsewhere with a checkmark still needs active-owner evidence",
      inventory: withUnownedCheckmark({ disposition: "Owned elsewhere" }),
    },
    {
      name: "Owned elsewhere with a ticket still needs active-owner evidence",
      inventory: withUnownedTicket({ disposition: "Owned elsewhere" }),
    },
    {
      name: "owned eye missing latest-human-reply audit",
      inventory: withSweepOwnedParent({ latestRelevantHumanReply: undefined }),
    },
    {
      name: "later human reply invalidates the older status reply",
      inventory: withSweepOwnedParent({
        latestRelevantHumanReply: {
          ts: "13.000000",
          actorId: "UOTHER",
          text: "Reporter says the crash still happens after reopening the project.",
        },
      }),
    },
    {
      name: "later human reproduction report makes fixed proof stale",
      inventory: withSweepOwnedParent({
        latestRelevantHumanReply: {
          ts: "11.000000",
          actorId: "UOTHER",
          text: "Reporter confirms the issue still occurs after reopening the project.",
        },
      }),
    },
    {
      name: "empty human reply without text or attachments is invalid",
      inventory: withSweepOwnedParent({
        latestRelevantHumanReply: {
          ts: "11.000000",
          actorId: "UOTHER",
          text: "",
        },
      }),
    },
    {
      name: "latest relevant human reply cannot be this sweep actor",
      inventory: withSweepOwnedParent({
        latestRelevantHumanReply: {
          ts: "11.000000",
          actorId: "USWEEPER",
          text: "This is the sweep's own status reply.",
        },
      }),
    },
    {
      name: "owned eye missing explicit reaction decisions",
      inventory: {
        ...valid,
        channels: valid.channels.map((channel) => ({
          ...channel,
          pages: channel.pages.map((page) => ({
            ...page,
            parents: page.parents.map((parent) =>
              parent.ts === "10.000000"
                ? { ...parent, reactionDecision: undefined }
                : parent,
            ),
          })),
        })),
      },
    },
    {
      name: "reaction owner map omits an observed eye",
      inventory: {
        ...valid,
        channels: valid.channels.map((channel) => ({
          ...channel,
          pages: channel.pages.map((page) => ({
            ...page,
            parents: page.parents.map((parent) =>
              parent.ts === "10.000000"
                ? {
                    ...parent,
                    reactionSummary:
                      "eyes (1): USWEEPER; white_check_mark (1): USWEEPER",
                    reactionOwners: {
                      white_check_mark: ["USWEEPER"],
                    },
                  }
                : parent,
            ),
          })),
        })),
      },
    },
    {
      name: "status reply from a different actor",
      inventory: {
        ...valid,
        channels: valid.channels.map((channel) => ({
          ...channel,
          pages: channel.pages.map((page) => ({
            ...page,
            parents: page.parents.map((parent) =>
              parent.ts === "10.000000"
                ? {
                    ...parent,
                    statusReply: { ...parent.statusReply!, actorId: "UOTHER" },
                  }
                : parent,
            ),
          })),
        })),
      },
    },
    {
      name: "status reply audit points to a different thread",
      inventory: {
        ...valid,
        channels: valid.channels.map((channel) => ({
          ...channel,
          pages: channel.pages.map((page) => ({
            ...page,
            parents: page.parents.map((parent) =>
              parent.ts === "10.000000"
                ? {
                    ...parent,
                    statusReply: {
                      ...parent.statusReply!,
                      threadParentTs: "9.500000",
                    },
                  }
                : parent,
            ),
          })),
        })),
      },
    },
    {
      name: "checkmark without an owned eye still needs a status reply",
      inventory: withUnownedCheckmark({ statusReply: undefined }),
    },
    {
      name: "checkmark without an owned eye still needs its recorded evidence",
      inventory: withUnownedCheckmark({
        statusReply: {
          ts: "12.000000",
          threadParentTs: "10.000000",
          actorId: "USWEEPER",
          disposition: "Fixed",
          evidence: "focused test passed in the open PR; merge pending",
          text: "Fixed: a different note",
        },
      }),
    },
    {
      name: "ticket without an owned eye still needs reaction decisions",
      inventory: withUnownedTicket({
        reactionSummary: "ticket (1): USWEEPER",
        reactionOwners: { ticket: ["USWEEPER"] },
        reactionDecision: undefined,
      }),
    },
    {
      name: "unfinished accepted handoff requires this actor's eye",
      inventory: withUnownedTicket({
        reactionSummary: "ticket (1): USWEEPER",
        reactionOwners: { ticket: ["USWEEPER"] },
      }),
    },
    {
      name: "Fixed cannot hide an unfinished scope without this actor's marks",
      inventory: withSweepOwnedParent({
        reactionSummary: "none",
        reactionOwners: {},
        disposition: "Fixed",
        latestOwnedReply: undefined,
        statusReply: undefined,
        fixedScopes: [],
        unfinishedScopes: [
          {
            scope: "remaining route behavior",
            evidence: "the remaining route behavior is still unverified",
          },
        ],
      }),
    },
    {
      name: "Fixed cannot hide an open handoff without this actor's marks",
      inventory: withSweepOwnedParent({
        reactionSummary: "none",
        reactionOwners: {},
        disposition: "Fixed",
        latestOwnedReply: undefined,
        statusReply: undefined,
        fixedScopes: [],
        handoffs: [
          {
            scope: "remaining route behavior",
            owner: "Alex Rivera",
            action: "choose the remaining behavior",
          },
        ],
      }),
    },
    {
      name: "Partially fixed without a fixed scope is rejected without this actor's marks",
      inventory: withSupplementalRootAudit(
        supplementalRootAudit("8.500000", {
          disposition: "Partially fixed",
          unfinishedScopes: [
            {
              scope: "remaining route behavior",
              evidence: "the remaining route behavior is still unverified",
            },
          ],
        }),
      ),
    },
    {
      name: "Skipped cannot retain fixed scopes or handoffs even when marks remain",
      inventory: withUnownedTicket({
        disposition: "Skipped",
        reactionSummary:
          "eyes (1): USWEEPER; white_check_mark (1): USWEEPER; ticket (1): USWEEPER",
        reactionOwners: {
          eyes: ["USWEEPER"],
          white_check_mark: ["USWEEPER"],
          ticket: ["USWEEPER"],
        },
        reactionDecision: {
          checkmark: {
            state: "present",
            reason: "Verified route-picker behavior",
          },
          ticket: {
            state: "present",
            reason: "Alex Rivera accepted a separate follow-up",
          },
        },
        fixedScopes: [
          {
            scope: "route-picker behavior",
            verification: "focused route-picker test passed; merge pending",
          },
        ],
        statusReply: {
          ts: "12.000000",
          threadParentTs: "10.000000",
          actorId: "USWEEPER",
          disposition: "Skipped",
          evidence:
            "focused route-picker test passed; merge pending; Alex Rivera will choose the remaining behavior",
          text: "Skipped: focused route-picker test passed; merge pending; Alex Rivera will choose the remaining behavior. :white_check_mark: covers route-picker behavior. :ticket: tracks Alex Rivera's accepted follow-up. this was sent from a bot.",
        },
      }),
    },
    {
      name: "open work must retain this actor's eye",
      inventory: withSweepOwnedParent({
        disposition: "Partially fixed",
        reactionSummary: "white_check_mark (1): USWEEPER",
        reactionOwners: { white_check_mark: ["USWEEPER"] },
        unfinishedScopes: [
          {
            scope: "paragraph selection behavior",
            evidence: "paragraph selection remains broken",
          },
        ],
        statusReply: {
          ...firstPage.parents[1]!.statusReply!,
          disposition: "Partially fixed",
          evidence:
            "focused test passed in the open PR; merge pending; paragraph selection remains broken",
          text: "Partially fixed: focused test passed in the open PR; merge pending; paragraph selection remains broken. :white_check_mark: covers the initial route screen. Open scope: paragraph selection behavior — paragraph selection remains broken. No :ticket: — no named human accepted a separate action. this was sent from a bot.",
        },
      }),
    },
    {
      name: "reply root is missing from page rows and threadRoots",
      inventory: {
        ...valid,
        channels: valid.channels.map((channel) => ({
          ...channel,
          pages: channel.pages.map((page) => ({
            ...page,
            parents: page.parents.map((parent) =>
              parent.ts === "9.500000"
                ? {
                    ...parent,
                    threadParentTs: "8.500000",
                    rootResolution: sourceThreadResolution("8.500000"),
                  }
                : parent,
            ),
          })),
        })),
      },
    },
    {
      name: "reply misclassified as a self-root",
      inventory: {
        ...valid,
        channels: valid.channels.map((channel) => ({
          ...channel,
          pages: channel.pages.map((page) => ({
            ...page,
            parents: page.parents.map((parent) =>
              parent.ts === "9.500000"
                ? {
                    ...parent,
                    threadParentTs: "9.500000",
                    rootResolution: {
                      evidence: "slack_message.thread_ts",
                      sourceThreadTs: "8.500000",
                      rootTs: "9.500000",
                    },
                  }
                : parent,
            ),
          })),
        })),
      },
    },
    {
      name: "root cannot be accepted without source thread resolution",
      inventory: {
        ...valid,
        channels: valid.channels.map((channel) => ({
          ...channel,
          pages: channel.pages.map((page) => ({
            ...page,
            parents: page.parents.map((parent) =>
              parent.ts === "11.000000"
                ? { ...parent, rootResolution: undefined }
                : parent,
            ),
          })),
        })),
      },
    },
    {
      name: "permalink thread_ts cannot contradict a claimed self-root",
      inventory: {
        ...valid,
        channels: valid.channels.map((channel) => ({
          ...channel,
          pages: channel.pages.map((page) => ({
            ...page,
            parents: page.parents.map((parent) =>
              parent.ts === "9.500000"
                ? {
                    ...parent,
                    rootResolution: {
                      evidence: "slack_permalink.thread_ts" as const,
                      sourceThreadTs: null,
                      rootTs: "9.500000",
                      sourcePermalink: sourcePermalink("9.500000", "8.500000"),
                    },
                  }
                : parent,
            ),
          })),
        })),
      },
    },
    {
      name: "reply permalink must resolve to its exact supplemental root",
      inventory: withSupplementalRootAudit(
        supplementalRootAudit("8.500000", {
          rootResolution: {
            ...replyPermalinkThreadResolution("8.600000", "8.500000"),
            sourcePermalink: sourcePermalink("8.600000", "8.400000"),
          },
        }),
      ),
    },
    {
      name: "supplemental root needs its own reaction and disposition audit",
      inventory: {
        ...valid,
        channels: valid.channels.map((channel) => ({
          ...channel,
          threadRoots: ["8.500000"],
          pages: channel.pages.map((page) => ({
            ...page,
            parents: page.parents.map((parent) =>
              parent.ts === "9.500000"
                ? {
                    ...parent,
                    threadParentTs: "8.500000",
                    rootResolution: sourceThreadResolution("8.500000"),
                  }
                : parent,
            ),
          })),
        })),
      },
    },
    {
      name: "supplemental root thread replies must follow the root",
      inventory: (() => {
        const complete = withTestThreadSnapshots(
          withSupplementalRootAudit(supplementalRootAudit("8.500000")),
        );
        return {
          ...complete,
          channels: complete.channels.map((channel) => ({
            ...channel,
            threadSnapshots: channel.threadSnapshots?.map((snapshot) => ({
              ...snapshot,
              replyCount: 1,
              replies: [
                {
                  ts: "8.400000",
                  actorId: "UOTHER",
                  kind: "human" as const,
                  text: "Older reply than its root.",
                  workflowReactionSummary: "none",
                  workflowReactionOwners: {},
                },
              ],
            })),
          })),
        };
      })(),
    },
    {
      name: "supplemental root eye needs current status and reaction decisions",
      inventory: {
        ...valid,
        channels: valid.channels.map((channel) => ({
          ...channel,
          threadRoots: ["8.500000"],
          threadRootAudits: [
            supplementalRootAudit("8.500000", {
              reactionSummary: "eyes (1): USWEEPER",
              reactionOwners: { eyes: ["USWEEPER"] },
              disposition: "In progress",
              latestRelevantHumanReply: null,
              reactionDecision: {
                checkmark: {
                  state: "none",
                  reason: "No verified root scope is complete",
                },
                ticket: {
                  state: "none",
                  reason: "No distinct human handoff is assigned",
                },
              },
            }),
          ],
          pages: channel.pages.map((page) => ({
            ...page,
            parents: page.parents.map((parent) =>
              parent.ts === "9.500000"
                ? {
                    ...parent,
                    threadParentTs: "8.500000",
                    rootResolution: sourceThreadResolution("8.500000"),
                  }
                : parent,
            ),
          })),
        })),
      },
    },
    {
      name: "supplemental root cannot mark an owned report Owned elsewhere",
      inventory: withSupplementalRootAudit(
        ownedSupplementalRootAudit({ disposition: "Owned elsewhere" }),
      ),
    },
    {
      name: "administrative supplemental roots cannot carry this actor's workflow marks",
      inventory: withSupplementalRootAudit(
        supplementalRootAudit("8.500000", {
          rootClassification: "administrative",
          rootClassificationReason: "release announcement",
          reactionSummary: "eyes (1): USWEEPER",
          reactionOwners: { eyes: ["USWEEPER"] },
        }),
      ),
    },
    {
      name: "supplemental Fixed cannot hide an unfinished scope without this actor's marks",
      inventory: withSupplementalRootAudit(
        supplementalRootAudit("8.500000", {
          disposition: "Fixed",
          unfinishedScopes: [
            {
              scope: "remaining root behavior",
              evidence: "the remaining root behavior is still unverified",
            },
          ],
        }),
      ),
    },
    {
      name: "supplemental Partially fixed disposition needs an unfinished scope",
      inventory: withSupplementalRootAudit(
        ownedSupplementalRootAudit({
          disposition: "Partially fixed",
          reactionSummary: "eyes (1): USWEEPER; white_check_mark (1): USWEEPER",
          reactionOwners: {
            eyes: ["USWEEPER"],
            white_check_mark: ["USWEEPER"],
          },
          reactionDecision: {
            checkmark: {
              state: "present",
              reason:
                "The root motion-timeline path passed focused verification",
            },
            ticket: {
              state: "none",
              reason: "No distinct human handoff is assigned",
            },
          },
          fixedScopes: [
            {
              scope: "root motion timeline",
              verification: "root motion timeline passed focused verification",
            },
          ],
          statusReply: {
            ts: "8.600000",
            threadParentTs: "8.500000",
            actorId: "USWEEPER",
            disposition: "Partially fixed",
            evidence: "root motion timeline passed focused verification",
            text: "Partially fixed: root motion timeline passed focused verification. :white_check_mark: covers the root motion timeline. No :ticket: — no separate human/team action remains unfinished. this was sent from a bot.",
          },
        }),
      ),
    },
    {
      name: "supplemental Fixed disposition cannot retain an accepted handoff",
      inventory: withSupplementalRootAudit(
        ownedSupplementalRootAudit({
          disposition: "Fixed",
          reactionSummary:
            "eyes (1): USWEEPER; white_check_mark (1): USWEEPER; ticket (1): USWEEPER",
          reactionOwners: {
            eyes: ["USWEEPER"],
            white_check_mark: ["USWEEPER"],
            ticket: ["USWEEPER"],
          },
          reactionDecision: {
            checkmark: {
              state: "present",
              reason: "The root motion timeline passed focused verification",
            },
            ticket: {
              state: "present",
              reason: "Alex accepted the separate route-verification action",
            },
          },
          latestRelevantHumanReply: {
            ts: "8.550000",
            actorId: "UOTHER",
            text: "I will verify the remote route.",
          },
          fixedScopes: [
            {
              scope: "root motion timeline",
              verification: "root motion timeline passed focused verification",
            },
          ],
          handoffs: [
            {
              scope: "remote route verification",
              owner: "Alex Rivera",
              ownerSlackId: "UOTHER",
              action: "verify the remote route",
              acceptanceReply: {
                ts: "8.550000",
                threadParentTs: "8.500000",
                actorId: "UOTHER",
                text: "I will verify the remote route.",
              },
            },
          ],
          statusReply: {
            ts: "8.600000",
            threadParentTs: "8.500000",
            actorId: "USWEEPER",
            disposition: "Fixed",
            evidence: "root motion timeline passed focused verification",
            text: "Fixed: Alex Rivera will verify the remote route; root motion timeline passed focused verification. :white_check_mark: covers the root motion timeline. :ticket: tracks Alex Rivera's accepted remote route verification. this was sent from a bot.",
          },
        }),
      ),
    },
    {
      name: "supplemental human-owner block needs owner acceptance",
      inventory: withSupplementalRootAudit(
        ownedSupplementalRootAudit({
          disposition: "Blocked on human owner",
          reactionSummary: "eyes (1): USWEEPER; ticket (1): USWEEPER",
          reactionOwners: { eyes: ["USWEEPER"], ticket: ["USWEEPER"] },
          reactionDecision: {
            checkmark: {
              state: "none",
              reason: "No root scope has passed verification",
            },
            ticket: {
              state: "present",
              reason: "Alex accepted the separate route-verification action",
            },
          },
          latestRelevantHumanReply: {
            ts: "8.550000",
            actorId: "UOTHER",
            text: "Thanks for the context.",
          },
          handoffs: [
            {
              scope: "remote route verification",
              owner: "Alex Rivera",
              ownerSlackId: "UOTHER",
              action: "verify the remote route",
              acceptanceReply: {
                ts: "8.550000",
                threadParentTs: "8.500000",
                actorId: "UOTHER",
                text: "Thanks for the context.",
              },
            },
          ],
          statusReply: {
            ts: "8.600000",
            threadParentTs: "8.500000",
            actorId: "USWEEPER",
            disposition: "Blocked on human owner",
            evidence: "the reported root scope still needs verification",
            text: "Blocked on human owner: Alex Rivera will verify the remote route; the reported root scope still needs verification. No :white_check_mark: — no root scope has passed verification. :ticket: tracks Alex Rivera's accepted remote route verification. this was sent from a bot.",
          },
        }),
      ),
    },
    {
      name: "supplemental root inside the cutoff bypasses the source manifest",
      inventory: {
        ...valid,
        channels: valid.channels.map((channel) => ({
          ...channel,
          threadRoots: ["10.500000"],
          pages: channel.pages.map((page) => ({
            ...page,
            parents: page.parents.map((parent) =>
              parent.ts === "11.000000"
                ? {
                    ...parent,
                    threadParentTs: "10.500000",
                    rootResolution: sourceThreadResolution("10.500000"),
                  }
                : parent,
            ),
          })),
        })),
      },
    },
    {
      name: "supplemental root must predate every scanned source message",
      inventory: (() => {
        const base = withSupplementalRootAudit(
          supplementalRootAudit("9.750000"),
        );
        return {
          ...base,
          channels: base.channels.map((channel) => ({
            ...channel,
            threadRoots: ["9.750000"],
            threadRootAudits: [supplementalRootAudit("9.750000")],
            pages: channel.pages.map((page) => ({
              ...page,
              parents: page.parents.map((parent) =>
                parent.ts === "10.000000"
                  ? {
                      ...parent,
                      threadParentTs: "9.750000",
                      rootResolution: sourceThreadResolution("9.750000"),
                      rootClassification: undefined,
                      reactionSummary: "none",
                      reactionOwners: {},
                      disposition: "Skipped",
                      latestRelevantHumanReply: undefined,
                      latestOwnedReply: undefined,
                      statusReply: undefined,
                      reactionDecision: undefined,
                      fixedScopes: undefined,
                      unfinishedScopes: undefined,
                      handoff: undefined,
                      handoffs: undefined,
                      otherOwnerEvidence: undefined,
                    }
                  : parent,
              ),
            })),
          })),
        };
      })(),
    },
    {
      name: "reply points to an in-page reply instead of its root",
      inventory: {
        ...valid,
        channels: valid.channels.map((channel) => ({
          ...channel,
          threadRoots: ["9.000000"],
          threadRootAudits: [supplementalRootAudit("9.000000")],
          pages: channel.pages.map((page) => ({
            ...page,
            parents: page.parents.map((parent) =>
              parent.ts === "10.000000"
                ? {
                    ...parent,
                    threadParentTs: "9.500000",
                    rootResolution: sourceThreadResolution("9.500000"),
                    statusReply: {
                      ...parent.statusReply!,
                      threadParentTs: "9.500000",
                    },
                    fixedScopes: [],
                    unfinishedScopes: [],
                    handoff: undefined,
                    handoffs: undefined,
                  }
                : parent.ts === "9.500000"
                  ? {
                      ...parent,
                      threadParentTs: "9.000000",
                      rootResolution: sourceThreadResolution("9.000000"),
                    }
                  : parent,
            ),
          })),
        })),
      },
    },
    {
      name: "status reply text omits its disposition",
      inventory: {
        ...valid,
        channels: valid.channels.map((channel) => ({
          ...channel,
          pages: channel.pages.map((page) => ({
            ...page,
            parents: page.parents.map((parent) =>
              parent.ts === "10.000000"
                ? {
                    ...parent,
                    statusReply: {
                      ...parent.statusReply!,
                      text: "Verified the UI",
                    },
                  }
                : parent,
            ),
          })),
        })),
      },
    },
    {
      name: "status reply does not claim the disposition inside a negated phrase",
      inventory: {
        ...valid,
        channels: valid.channels.map((channel) => ({
          ...channel,
          pages: channel.pages.map((page) => ({
            ...page,
            parents: page.parents.map((parent) =>
              parent.ts === "10.000000"
                ? {
                    ...parent,
                    statusReply: {
                      ...parent.statusReply!,
                      evidence: "Not fixed — the route is still broken",
                      text: "Not fixed — the route is still broken",
                    },
                  }
                : parent,
            ),
          })),
        })),
      },
    },
    {
      name: "Fixed label cannot contradict a later unfixed claim",
      inventory: {
        ...valid,
        channels: valid.channels.map((channel) => ({
          ...channel,
          pages: channel.pages.map((page) => ({
            ...page,
            parents: page.parents.map((parent) =>
              parent.ts === "10.000000"
                ? {
                    ...parent,
                    statusReply: {
                      ...parent.statusReply!,
                      evidence: "the route is still not fixed",
                      text: "Fixed: the route is still not fixed",
                    },
                  }
                : parent,
            ),
          })),
        })),
      },
    },
    {
      name: "Fixed label cannot claim a report described as not truly fixed",
      inventory: {
        ...valid,
        channels: valid.channels.map((channel) => ({
          ...channel,
          pages: channel.pages.map((page) => ({
            ...page,
            parents: page.parents.map((parent) =>
              parent.ts === "10.000000"
                ? {
                    ...parent,
                    statusReply: {
                      ...parent.statusReply!,
                      evidence: "the route is not truly fixed",
                      text: "Fixed: the route is not truly fixed",
                    },
                  }
                : parent,
            ),
          })),
        })),
      },
    },
    {
      name: "status reply must include its recorded evidence",
      inventory: {
        ...valid,
        channels: valid.channels.map((channel) => ({
          ...channel,
          pages: channel.pages.map((page) => ({
            ...page,
            parents: page.parents.map((parent) =>
              parent.ts === "10.000000"
                ? {
                    ...parent,
                    statusReply: {
                      ...parent.statusReply!,
                      text: "Fixed — a different note",
                    },
                  }
                : parent,
            ),
          })),
        })),
      },
    },
    {
      name: "status reply evidence must match fixed-scope verification",
      inventory: {
        ...valid,
        channels: valid.channels.map((channel) => ({
          ...channel,
          pages: channel.pages.map((page) => ({
            ...page,
            parents: page.parents.map((parent) =>
              parent.ts === "10.000000"
                ? {
                    ...parent,
                    fixedScopes: [
                      {
                        ...parent.fixedScopes![0]!,
                        verification: "a separate check that the reply omits",
                      },
                    ],
                  }
                : parent,
            ),
          })),
        })),
      },
    },
    {
      name: "handoff reply must name the recorded owner",
      inventory: withHandoffReply(
        "Partially fixed: focused route-picker test passed; merge pending. :white_check_mark: covers route-picker behavior. Handoff: secondary request — choose the remaining behavior. :ticket: tracks the accepted follow-up. this was sent from a bot.",
      ),
    },
    {
      name: "handoff reply must name the recorded action",
      inventory: withHandoffReply(
        "Partially fixed: focused route-picker test passed; merge pending. :white_check_mark: covers route-picker behavior. Handoff: secondary request — Alex Rivera will follow up. :ticket: tracks the accepted follow-up. this was sent from a bot.",
      ),
    },
    {
      name: "handoff reply must name the recorded scope",
      inventory: withHandoffReply(
        "Partially fixed: focused route-picker test passed; merge pending. :white_check_mark: covers route-picker behavior. Handoff: Alex Rivera will choose the remaining behavior. :ticket: tracks the accepted follow-up. this was sent from a bot.",
      ),
    },
    {
      name: "handoff reply must match owner word boundaries",
      inventory: withHandoffReply(
        "Partially fixed: focused route-picker test passed; merge pending. :white_check_mark: covers route-picker behavior. Handoff: secondary request — Product ownership will choose the remaining behavior. :ticket: tracks the accepted follow-up. this was sent from a bot.",
      ),
    },
    {
      name: "Verified locally scope without a checkmark",
      inventory: {
        ...valid,
        channels: valid.channels.map((channel) => ({
          ...channel,
          pages: channel.pages.map((page) => ({
            ...page,
            parents: page.parents.map((parent) =>
              parent.ts === "10.000000"
                ? {
                    ...parent,
                    disposition: "Verified locally",
                    reactionSummary: "eyes (1): USWEEPER",
                    reactionOwners: { eyes: ["USWEEPER"] },
                    reactionDecision: {
                      checkmark: {
                        state: "none",
                        reason: "The earlier checkmark was removed",
                      },
                      ticket: {
                        state: "none",
                        reason: "No separate human-owned action remains",
                      },
                    },
                    statusReply: {
                      ...parent.statusReply!,
                      disposition: "Verified locally",
                      evidence:
                        "focused test passed in the open PR; merge pending",
                      text: "Verified locally: focused test passed in the open PR; merge pending. No :white_check_mark: — the verified initial route screen still needs its checkmark. No :ticket: — no separate human action was accepted. this was sent from a bot.",
                    },
                  }
                : parent,
            ),
          })),
        })),
      },
    },
    {
      name: "checkmark without verified fixed scope",
      inventory: {
        ...valid,
        channels: valid.channels.map((channel) => ({
          ...channel,
          pages: channel.pages.map((page) => ({
            ...page,
            parents: page.parents.map((parent) =>
              parent.ts === "10.000000"
                ? { ...parent, fixedScopes: [] }
                : parent,
            ),
          })),
        })),
      },
    },
    {
      name: "partially fixed without verified fixed-scope evidence",
      inventory: {
        ...valid,
        channels: valid.channels.map((channel) => ({
          ...channel,
          pages: channel.pages.map((page) => ({
            ...page,
            parents: page.parents.map((parent) =>
              parent.ts === "10.000000"
                ? {
                    ...parent,
                    reactionSummary: "eyes (1): USWEEPER",
                    reactionOwners: { eyes: ["USWEEPER"] },
                    reactionDecision: {
                      checkmark: {
                        state: "none",
                        reason: "No verified scope is complete yet",
                      },
                      ticket: {
                        state: "none",
                        reason: "No separate human-owned action remains",
                      },
                    },
                    disposition: "Partially fixed",
                    statusReply: {
                      ...parent.statusReply!,
                      disposition: "Partially fixed",
                      evidence: "further work remains in progress.",
                      text: "Partially fixed: further work remains in progress. No :white_check_mark: — no scope is verified. No :ticket: — no separate human action was accepted. this was sent from a bot.",
                    },
                    fixedScopes: [],
                  }
                : parent,
            ),
          })),
        })),
      },
    },
    {
      name: "partially fixed needs an unfinished scope as well as a fixed scope",
      inventory: withSweepOwnedParent({
        disposition: "Partially fixed",
        reactionSummary: "eyes (1): USWEEPER; white_check_mark (1): USWEEPER",
        reactionOwners: {
          eyes: ["USWEEPER"],
          white_check_mark: ["USWEEPER"],
        },
        statusReply: {
          ...firstPage.parents[1]!.statusReply!,
          disposition: "Partially fixed",
          evidence: "focused test passed in the open PR; merge pending",
          text: "Partially fixed: focused test passed in the open PR; merge pending. :white_check_mark: covers the initial route screen. No :ticket: — no separate human action was accepted. this was sent from a bot.",
        },
      }),
    },
    {
      name: "handoff without a fixed scope is not partially fixed",
      inventory: withUnownedTicket({
        disposition: "Partially fixed",
        statusReply: {
          ts: "12.000000",
          threadParentTs: "10.000000",
          actorId: "USWEEPER",
          disposition: "Partially fixed",
          evidence: "Alex Rivera will choose the remaining behavior",
          text: "Partially fixed: Alex Rivera will choose the remaining behavior. No :white_check_mark: — no scope is verified. :ticket: tracks Alex Rivera's accepted action. this was sent from a bot.",
        },
      }),
    },
    {
      name: "ticket reaction without a human handoff",
      inventory: {
        ...valid,
        channels: valid.channels.map((channel) => ({
          ...channel,
          pages: channel.pages.map((page) => ({
            ...page,
            parents: page.parents.map((parent) =>
              parent.ts === "10.000000"
                ? {
                    ...parent,
                    reactionOwners: {
                      eyes: ["USWEEPER"],
                      white_check_mark: ["USWEEPER"],
                      ticket: ["USWEEPER"],
                    },
                    reactionSummary:
                      "eyes (1): USWEEPER; white_check_mark (1): USWEEPER; ticket (1): USWEEPER",
                    reactionDecision: {
                      checkmark: {
                        state: "present",
                        reason: "Verified initial route screen fix",
                      },
                      ticket: {
                        state: "present",
                        reason: "A separate human-owned action remains",
                      },
                    },
                    statusReply: {
                      ...parent.statusReply!,
                      text: "Fixed: focused test passed in the open PR; merge pending. :white_check_mark: covers the initial route screen. :ticket: claims a separate accepted action, but no human handoff was recorded. this was sent from a bot.",
                    },
                  }
                : parent,
            ),
          })),
        })),
      },
    },
    {
      name: "human handoff without a ticket reaction",
      inventory: {
        ...valid,
        channels: valid.channels.map((channel) => ({
          ...channel,
          pages: channel.pages.map((page) => ({
            ...page,
            parents: page.parents.map((parent) => {
              if (parent.ts !== "10.000000") return parent;
              return {
                ...parent,
                latestRelevantHumanReply: {
                  ts: "11.500000",
                  actorId: "UOTHER",
                  text: "I will choose the remaining behavior.",
                },
                handoffs: [
                  {
                    scope: "remaining design choice",
                    owner: "Alex Rivera",
                    ownerSlackId: "UOTHER",
                    action: "choose the remaining behavior",
                    acceptanceReply: {
                      ts: "11.500000",
                      threadParentTs: "10.000000",
                      actorId: "UOTHER",
                      text: "I will choose the remaining behavior.",
                    },
                  },
                ],
              };
            }),
          })),
        })),
      },
    },
    {
      name: "ticket handoff cannot name an unassigned role",
      inventory: withUnownedTicket({
        handoffs: [
          {
            scope: "remaining design choice",
            owner: "Product/engineering lead (not assigned)",
            ownerSlackId: "UOTHER",
            action: "choose the remaining behavior",
            acceptanceReply: {
              ts: "11.500000",
              threadParentTs: "10.000000",
              actorId: "UOTHER",
              text: "I will choose the remaining behavior.",
            },
          },
        ],
      }),
    },
    {
      name: "unassigned team handoff cannot claim a named owner",
      inventory: withUnassignedTeamTicket({
        handoffs: [
          {
            scope: "remaining design choice",
            owner: "Alex Rivera",
            ownerSlackId: "UOTHER",
            action: "choose the remaining behavior",
            status: "unassigned",
            acceptanceReply: {
              ts: "11.500000",
              threadParentTs: "10.000000",
              actorId: "UOTHER",
              text: "I will choose the remaining behavior.",
            },
          },
        ],
      }),
    },
    {
      name: "ticket handoff needs the assigned human's acceptance",
      inventory: withUnownedTicket({
        handoffs: [
          {
            scope: "remaining design choice",
            owner: "Alex Rivera",
            ownerSlackId: "UOTHER",
            action: "choose the remaining behavior",
          },
        ],
      }),
    },
    {
      name: "ticket handoff cannot assign the sweep actor",
      inventory: withUnownedTicket({
        latestRelevantHumanReply: null,
        handoffs: [
          {
            scope: "remaining design choice",
            owner: "Steve",
            ownerSlackId: "USWEEPER",
            action: "choose the remaining behavior",
            acceptanceReply: {
              ts: "11.500000",
              threadParentTs: "10.000000",
              actorId: "USWEEPER",
              text: "I will choose the remaining behavior.",
            },
          },
        ],
      }),
    },
    {
      name: "ticket acceptance must come from the assigned human",
      inventory: withUnownedTicket({
        latestRelevantHumanReply: {
          ts: "11.500000",
          actorId: "UANOTHER",
          text: "I will choose the remaining behavior.",
        },
        handoffs: [
          {
            scope: "remaining design choice",
            owner: "Alex Rivera",
            ownerSlackId: "UOTHER",
            action: "choose the remaining behavior",
            acceptanceReply: {
              ts: "11.500000",
              threadParentTs: "10.000000",
              actorId: "UANOTHER",
              text: "I will choose the remaining behavior.",
            },
          },
        ],
      }),
    },
    {
      name: "ticket acceptance must be in the source thread",
      inventory: withUnownedTicket({
        handoffs: [
          {
            scope: "remaining design choice",
            owner: "Alex Rivera",
            ownerSlackId: "UOTHER",
            action: "choose the remaining behavior",
            acceptanceReply: {
              ts: "11.500000",
              threadParentTs: "9.500000",
              actorId: "UOTHER",
              text: "I will choose the remaining behavior.",
            },
          },
        ],
      }),
    },
    {
      name: "ticket acceptance must explicitly accept the work",
      inventory: withUnownedTicket({
        latestRelevantHumanReply: {
          ts: "11.500000",
          actorId: "UOTHER",
          text: "Thanks, I saw the report.",
        },
        handoffs: [
          {
            scope: "remaining design choice",
            owner: "Alex Rivera",
            ownerSlackId: "UOTHER",
            action: "choose the remaining behavior",
            acceptanceReply: {
              ts: "11.500000",
              threadParentTs: "10.000000",
              actorId: "UOTHER",
              text: "Thanks, I saw the report.",
            },
          },
        ],
      }),
    },
    {
      name: "direct ticket request must name the assigned human",
      inventory: withContextualTicket(
        "<@UANOTHER> can you choose the remaining behavior?",
      ),
    },
    {
      name: "direct ticket request must name the recorded action",
      inventory: withContextualTicket(
        "<@UOTHER> can you review the remaining behavior?",
      ),
    },
    {
      name: "direct ticket request must precede acceptance in the source thread",
      inventory: withContextualTicket(undefined, undefined, {
        ts: "11.750000",
      }),
    },
    {
      name: "contextual ticket request must be in the source thread",
      inventory: withContextualTicket(undefined, undefined, {
        threadParentTs: "9.500000",
      }),
    },
    {
      name: "hedged contextual ticket assent does not accept the work",
      inventory: withContextualTicket(
        undefined,
        "Yeah, maybe I can choose the remaining behavior.",
      ),
    },
    {
      name: "refused contextual ticket assent does not accept the work",
      inventory: withContextualTicket(
        undefined,
        "Yeah sure, but I can't choose the remaining behavior.",
      ),
    },
    {
      name: "deliberative contextual assent does not accept the work",
      inventory: withContextualTicket(
        undefined,
        "Yeah sure, I'll think about it.",
      ),
    },
    {
      name: "consideration contextual assent does not accept the work",
      inventory: withContextualTicket(
        undefined,
        "Yeah sure, I'll consider it.",
      ),
    },
    {
      name: "request to think contextual assent does not accept the work",
      inventory: withContextualTicket(undefined, "Yeah sure, let me think."),
    },
    {
      name: "tentative guess contextual assent does not accept the work",
      inventory: withContextualTicket(undefined, "Yeah, I guess."),
    },
    {
      name: "hedged ticket acceptance does not accept the work",
      inventory: withUnownedTicket({
        latestRelevantHumanReply: {
          ts: "11.500000",
          actorId: "UOTHER",
          text: "I can maybe choose the remaining behavior.",
        },
        handoffs: [
          {
            scope: "remaining design choice",
            owner: "Alex Rivera",
            ownerSlackId: "UOTHER",
            action: "choose the remaining behavior",
            acceptanceReply: {
              ts: "11.500000",
              threadParentTs: "10.000000",
              actorId: "UOTHER",
              text: "I can maybe choose the remaining behavior.",
            },
          },
        ],
      }),
    },
    {
      name: "tentative ticket acceptance does not accept the work",
      inventory: withUnownedTicket({
        latestRelevantHumanReply: {
          ts: "11.500000",
          actorId: "UOTHER",
          text: "Maybe I'll choose the remaining behavior.",
        },
        handoffs: [
          {
            scope: "remaining design choice",
            owner: "Alex Rivera",
            ownerSlackId: "UOTHER",
            action: "choose the remaining behavior",
            acceptanceReply: {
              ts: "11.500000",
              threadParentTs: "10.000000",
              actorId: "UOTHER",
              text: "Maybe I'll choose the remaining behavior.",
            },
          },
        ],
      }),
    },
    {
      name: "ticket acceptance must name the recorded action",
      inventory: withUnownedTicket({
        latestRelevantHumanReply: {
          ts: "11.500000",
          actorId: "UOTHER",
          text: "I'll ask the team who can own this.",
        },
        handoffs: [
          {
            scope: "remaining design choice",
            owner: "Alex Rivera",
            ownerSlackId: "UOTHER",
            action: "choose the remaining behavior",
            acceptanceReply: {
              ts: "11.500000",
              threadParentTs: "10.000000",
              actorId: "UOTHER",
              text: "I'll ask the team who can own this.",
            },
          },
        ],
      }),
    },
    {
      name: "completed handoff needs completion evidence",
      inventory: withUnownedTicket({
        handoffs: [
          {
            scope: "remaining design choice",
            owner: "Alex Rivera",
            ownerSlackId: "UOTHER",
            action: "choose the remaining behavior",
            status: "completed",
            acceptanceReply: {
              ts: "11.500000",
              threadParentTs: "10.000000",
              actorId: "UOTHER",
              text: "I will choose the remaining behavior.",
            },
            completion: {
              evidence: "Alex Rivera completed the remaining design choice",
            },
          },
        ],
      }),
    },
    {
      name: "ticket refusal is not acceptance",
      inventory: withUnownedTicket({
        latestRelevantHumanReply: {
          ts: "11.500000",
          actorId: "UOTHER",
          text: "I’ll not take this on.",
        },
        handoffs: [
          {
            scope: "remaining design choice",
            owner: "Alex Rivera",
            ownerSlackId: "UOTHER",
            action: "choose the remaining behavior",
            acceptanceReply: {
              ts: "11.500000",
              threadParentTs: "10.000000",
              actorId: "UOTHER",
              text: "I’ll not take this on.",
            },
          },
        ],
      }),
    },
    {
      name: "later owner refusal withdraws an accepted handoff",
      inventory: withUnownedTicket({
        latestRelevantHumanReply: {
          ts: "12.500000",
          actorId: "UOTHER",
          text: "I need to back out of this.",
        },
        handoffs: [
          {
            scope: "remaining design choice",
            owner: "Alex Rivera",
            ownerSlackId: "UOTHER",
            action: "choose the remaining behavior",
            acceptanceReply: {
              ts: "11.500000",
              threadParentTs: "10.000000",
              actorId: "UOTHER",
              text: "I will choose the remaining behavior.",
            },
          },
        ],
        statusReply: {
          ts: "13.000000",
          threadParentTs: "10.000000",
          actorId: "USWEEPER",
          disposition: "In progress",
          evidence: "Alex Rivera will choose the remaining behavior",
          text: "In progress: Alex Rivera will choose the remaining behavior. Handoff: Alex Rivera — choose the remaining behavior. No :white_check_mark: — no scope passed verification. :ticket: tracks Alex Rivera's accepted action. this was sent from a bot.",
        },
      }),
    },
    {
      name: "later bandwidth withdrawal withdraws an accepted handoff",
      inventory: withUnownedTicket({
        latestRelevantHumanReply: {
          ts: "12.500000",
          actorId: "UOTHER",
          text: "I no longer have bandwidth to choose the remaining behavior.",
        },
        handoffs: [
          {
            scope: "remaining design choice",
            owner: "Alex Rivera",
            ownerSlackId: "UOTHER",
            action: "choose the remaining behavior",
            acceptanceReply: {
              ts: "11.500000",
              threadParentTs: "10.000000",
              actorId: "UOTHER",
              text: "I will choose the remaining behavior.",
            },
          },
        ],
        statusReply: {
          ts: "13.000000",
          threadParentTs: "10.000000",
          actorId: "USWEEPER",
          disposition: "In progress",
          evidence: "Alex Rivera withdrew the accepted action",
          text: "In progress: Alex Rivera withdrew the accepted action. Handoff: Alex Rivera — choose the remaining behavior. No :white_check_mark: — no scope has been verified. :ticket: is stale because Alex Rivera withdrew the action. this was sent from a bot.",
        },
      }),
    },
    {
      name: "later refusal stays visible after a later benign owner reply",
      inventory: (() => {
        const base = withUnownedTicket({
          latestRelevantHumanReply: {
            ts: "12.500000",
            actorId: "UOTHER",
            text: "Thanks, I saw the report.",
          },
          handoffs: [
            {
              scope: "remaining design choice",
              owner: "Alex Rivera",
              ownerSlackId: "UOTHER",
              action: "choose the remaining behavior",
              acceptanceReply: {
                ts: "11.500000",
                threadParentTs: "10.000000",
                actorId: "UOTHER",
                text: "I will choose the remaining behavior.",
              },
            },
          ],
          statusReply: {
            ts: "13.000000",
            threadParentTs: "10.000000",
            actorId: "USWEEPER",
            disposition: "In progress",
            evidence: "Alex Rivera's accepted action is withdrawn",
            text: "In progress: Alex Rivera's accepted action is withdrawn. Handoff: Alex Rivera — choose the remaining behavior. No :white_check_mark: — no scope has been verified. :ticket: is stale because Alex Rivera withdrew the action. this was sent from a bot.",
          },
        });
        return {
          ...base,
          channels: base.channels.map((channel) => ({
            ...channel,
            threadSnapshots: channel.threadSnapshots?.map((snapshot) =>
              snapshot.rootTs === "10.000000"
                ? {
                    ...snapshot,
                    replyCount: 4,
                    replies: [
                      {
                        ts: "11.500000",
                        actorId: "UOTHER",
                        kind: "human" as const,
                        text: "I will choose the remaining behavior.",
                        workflowReactionSummary: "none",
                        workflowReactionOwners: {},
                      },
                      {
                        ts: "12.000000",
                        actorId: "UOTHER",
                        kind: "human" as const,
                        text: "I can't take this after all.",
                        workflowReactionSummary: "none",
                        workflowReactionOwners: {},
                      },
                      {
                        ts: "12.500000",
                        actorId: "UOTHER",
                        kind: "human" as const,
                        text: "Thanks, I saw the report.",
                        workflowReactionSummary: "none",
                        workflowReactionOwners: {},
                      },
                      {
                        ts: "13.000000",
                        actorId: "USWEEPER",
                        kind: "sweep" as const,
                        text: "In progress: Alex Rivera's accepted action is withdrawn. Handoff: Alex Rivera — choose the remaining behavior. No :white_check_mark: — no scope has been verified. :ticket: is stale because Alex Rivera withdrew the action. this was sent from a bot.",
                        workflowReactionSummary: "none",
                        workflowReactionOwners: {},
                      },
                    ],
                  }
                : snapshot,
            ),
          })),
        };
      })(),
    },
    {
      name: "Blocked on human owner without a handoff or ticket",
      inventory: withUnownedTicket({
        disposition: "Blocked on human owner",
        reactionSummary: "eyes (1): USWEEPER",
        reactionOwners: { eyes: ["USWEEPER"] },
        reactionDecision: {
          checkmark: {
            state: "none",
            reason: "No fixed scope has passed verification",
          },
          ticket: {
            state: "none",
            reason: "No human owner has been assigned",
          },
        },
        handoffs: [],
        statusReply: {
          ...firstPage.parents[1]!.statusReply!,
          disposition: "Blocked on human owner",
          evidence: "no human owner has been assigned to the remaining action",
          text: "Blocked on human owner: no human owner has been assigned to the remaining action. No :white_check_mark: — no scope passed verification. No :ticket: — no named human accepted a separate action. this was sent from a bot.",
        },
      }),
    },
    {
      name: "Fixed disposition cannot retain an unfinished handoff",
      inventory: {
        ...valid,
        channels: valid.channels.map((channel) => ({
          ...channel,
          pages: channel.pages.map((page) => ({
            ...page,
            parents: page.parents.map((parent) =>
              parent.ts === "10.000000"
                ? {
                    ...parent,
                    reactionOwners: {
                      eyes: ["USWEEPER"],
                      white_check_mark: ["USWEEPER"],
                      ticket: ["USWEEPER"],
                    },
                    reactionSummary:
                      "eyes (1): USWEEPER; white_check_mark (1): USWEEPER; ticket (1): USWEEPER",
                    reactionDecision: {
                      checkmark: {
                        state: "present",
                        reason: "Verified initial route screen fix",
                      },
                      ticket: {
                        state: "present",
                        reason: "Another distinct human-owned action remains",
                      },
                    },
                    latestRelevantHumanReply: {
                      ts: "11.500000",
                      actorId: "UOTHER",
                      text: "I will choose the remaining behavior.",
                    },
                    handoffs: [
                      {
                        scope: "secondary request",
                        owner: "Alex Rivera",
                        ownerSlackId: "UOTHER",
                        action: "choose the remaining behavior",
                        acceptanceReply: {
                          ts: "11.500000",
                          threadParentTs: "10.000000",
                          actorId: "UOTHER",
                          text: "I will choose the remaining behavior.",
                        },
                      },
                    ],
                    statusReply: {
                      ...parent.statusReply!,
                      text: "Fixed: focused test passed in the open PR; merge pending. :white_check_mark: covers the initial route screen. Handoff: Alex Rivera — choose the remaining behavior. :ticket: tracks Alex Rivera's accepted action. this was sent from a bot.",
                    },
                  }
                : parent,
            ),
          })),
        })),
      },
    },
    {
      name: "duplicate handoff scopes are not distinct",
      inventory: {
        ...valid,
        channels: valid.channels.map((channel) => ({
          ...channel,
          pages: channel.pages.map((page) => ({
            ...page,
            parents: page.parents.map((parent) =>
              parent.ts === "10.000000"
                ? {
                    ...parent,
                    reactionSummary:
                      "eyes (1): USWEEPER; white_check_mark (1): USWEEPER; ticket (1): USWEEPER",
                    reactionOwners: {
                      eyes: ["USWEEPER"],
                      white_check_mark: ["USWEEPER"],
                      ticket: ["USWEEPER"],
                    },
                    reactionDecision: {
                      checkmark: {
                        state: "present",
                        reason: "Verified initial route screen fix",
                      },
                      ticket: {
                        state: "present",
                        reason: "Alex Rivera accepted the remaining action",
                      },
                    },
                    latestRelevantHumanReply: {
                      ts: "11.600000",
                      actorId: "UOTHER",
                      text: "I will choose the remaining behavior.",
                    },
                    statusReply: {
                      ...parent.statusReply!,
                      text: "Fixed: focused test passed in the open PR; merge pending. :white_check_mark: covers the initial route screen. Handoff: Alex Rivera — choose the remaining behavior. :ticket: tracks Alex Rivera's accepted action. this was sent from a bot.",
                    },
                    handoffs: [
                      {
                        scope: "remaining setup",
                        owner: "Alex Rivera",
                        ownerSlackId: "UOTHER",
                        action: "choose the remaining behavior",
                        acceptanceReply: {
                          ts: "11.500000",
                          threadParentTs: "10.000000",
                          actorId: "UOTHER",
                          text: "I will choose the remaining behavior.",
                        },
                      },
                      {
                        scope: "  Remaining   setup ",
                        owner: "Alex Rivera",
                        ownerSlackId: "UOTHER",
                        action: "choose the remaining behavior",
                        acceptanceReply: {
                          ts: "11.600000",
                          threadParentTs: "10.000000",
                          actorId: "UOTHER",
                          text: "I will choose the remaining behavior.",
                        },
                      },
                    ],
                  }
                : parent,
            ),
          })),
        })),
      },
    },
    {
      name: "cursor overlap row differs from the prior page snapshot",
      inventory: {
        ...valid,
        channels: [
          {
            ...valid.channels[0],
            pages: [
              {
                ...firstPage,
                cursor: null,
                nextCursor: "next-page",
                exhausted: false,
                messageCount: 2,
                sourceTimestamps: ["11.000000", "10.000000"],
                parents: firstPage.parents.slice(0, 2),
              },
              {
                cursor: "next-page",
                nextCursor: null,
                exhausted: true,
                messageCount: 2,
                sourceTimestamps: ["10.000000", "9.500000"],
                parents: [
                  {
                    ...firstPage.parents[1],
                    statusReply: {
                      ...firstPage.parents[1].statusReply!,
                      evidence: "A different snapshot was observed",
                    },
                  },
                  firstPage.parents[2],
                ],
              },
            ],
          },
        ],
      },
    },
    {
      name: "cursor cycle",
      inventory: {
        ...valid,
        channels: [
          {
            ...valid.channels[0],
            pages: [
              {
                ...firstPage,
                cursor: null,
                nextCursor: "next-page",
                exhausted: false,
                messageCount: 2,
                sourceTimestamps: ["11.000000", "10.000000"],
                parents: firstPage.parents.slice(0, 2),
              },
              {
                cursor: "next-page",
                nextCursor: "next-page",
                exhausted: true,
                messageCount: 2,
                sourceTimestamps: ["10.000000", "9.500000"],
                parents: [firstPage.parents[1], firstPage.parents[2]],
              },
            ],
          },
        ],
      },
    },
  ];
  const expectedDiagnostics: Record<string, string> = {
    "root messages must be classified before report totals":
      "classify each channel post as a report or administrative root",
    "administrative root needs a visible exclusion reason":
      "administrative roots need a reason",
    "open in-scope report without this actor's eye is rejected":
      "In progress is open; keep this actor's 👀 until its scopes and follow-ups close",
    "reply rows cannot carry scope evidence outside the root checkoff":
      "scope and handoff evidence must be recorded on the actual root row; reply rows only audit reply-level history",
    "another actor's eye is not auto-claimed or replied to":
      "read the complete root thread before treating another actor's eye as historical or active ownership",
    "current open owner eye cannot be auto-claimed":
      "another actor owns this report; do not add this actor's 👀 or reply—record Owned elsewhere with current owner evidence",
    "Owned elsewhere needs an open latest owner status, not a historical eye":
      "Owned elsewhere needs that owner's current open status and evidence",
    "Owned elsewhere needs another actor's root eye":
      "Owned elsewhere needs another actor's root 👀 and their current same-thread status",
    "Owned elsewhere status must exist in the captured thread":
      "Owned elsewhere needs a complete captured thread with the owner's status",
    "Owned elsewhere status cannot precede a later human reply":
      "Owned elsewhere status must be the owner's latest reply after the latest human reply, confirmed in the captured thread",
    "other actors' marks do not replace this actor's eye on open report":
      "read the complete root thread before treating another actor's eye as historical or active ownership",
    "administrative manifest roots cannot carry this actor's workflow marks":
      "this actor's workflow marks cannot be placed on an administrative root",
    "owned marks need a fresh full-thread read":
      "read the complete Slack thread again and record its threadSnapshot",
    "a newer thread reply invalidates the recorded snapshot":
      "threadSnapshot reveals a newer or unrecorded human reply; update the status before reconciling",
    "thread snapshot count must match the complete reply read":
      "threadSnapshot must contain every reply reported by Slack",
    "legacy reply marks must match the captured reaction read-back":
      "retained reply workflow marks must match the full-thread reaction read-back",
    "exhausted final page cannot retain a next cursor":
      "exhausted page cannot have a nextCursor",
    "requested page cursor must be explicit":
      "record the requested cursor explicitly, including null on the first page",
    "next page cursor must be explicit":
      "record nextCursor explicitly as a non-empty cursor or null",
    "empty next page cursor is not explicit exhaustion":
      "record nextCursor explicitly as a non-empty cursor or null",
    "Slack exhaustion state must be explicit":
      "record Slack's exhausted state as an explicit boolean",
    "final page must report Slack exhaustion":
      "follow every cursor until Slack reports exhaustion with nextCursor null",
    "noncanonical disposition label":
      "use an exact canonical disposition for every parent",
    "missing disposition row": "a source message has no disposition row",
    "missing permalink":
      "The requested permalink timestamp is missing from the inventory",
    "permalink is not the inclusive cutoff":
      "permalinkTs must equal the inclusive cutoffTs",
    "channel-wide scan query is required":
      "record the exhaustive slack_search_public scan arguments",
    "scan query cannot use lexical keywords":
      "scanQuery must not narrow the channel inventory with keywords or semantic search",
    "scan query must include bot messages":
      "scanQuery must include bots and all messages, request 20 detailed results, and sort newest-first by timestamp",
    "scan query must cover the exact channel and inclusive cutoff":
      "scanQuery.filters must constrain only this channel, with no content or date narrowing",
    "scan query must use the exact inclusive cutoff":
      "scanQuery.after must equal the inclusive cutoffTs",
    "scan query cannot contain undocumented filters":
      "scanQuery may contain only the documented exhaustive search arguments",
    "oldestQuery is omitted instead of explicitly recorded":
      "oldestQuery must be recorded as a Slack timestamp or explicit null",
    "oldestQuery cannot be an empty string":
      "oldestQuery must be a Slack timestamp",
    "owned eye missing a status reply":
      "an owned 👀 or own ✅/🎫 needs a same-parent status reply by the same actor",
    "owned eye missing latest same-actor reply audit":
      "record the latest same-actor reply from the full thread read",
    "newer same-actor correction invalidates an older status reply":
      "statusReply must be the latest same-actor reply read from the full thread",
    "Owned elsewhere with an eye still needs active-owner evidence":
      "Owned elsewhere needs another actor's root 👀 and their current same-thread status",
    "Owned elsewhere with a checkmark still needs active-owner evidence":
      "Owned elsewhere needs another actor's root 👀 and their current same-thread status",
    "Owned elsewhere with a ticket still needs active-owner evidence":
      "Owned elsewhere needs another actor's root 👀 and their current same-thread status",
    "owned eye missing latest-human-reply audit":
      "latestRelevantHumanReply needs a non-sweep human Slack actor ID and verbatim text or attachment metadata, or null",
    "later human reply invalidates the older status reply":
      "status reply must be newer than the latest relevant human reply in the thread",
    "later human reproduction report makes fixed proof stale":
      "a later human reply says the issue persists; rerun direct proof after reply 11.000000 or reopen this scope",
    "empty human reply without text or attachments is invalid":
      "record the exact author, message text or attachments, and human/sweep/bot classification",
    "latest relevant human reply cannot be this sweep actor":
      "latestRelevantHumanReply needs a non-sweep human Slack actor ID and verbatim text or attachment metadata, or null",
    "owned eye missing explicit reaction decisions":
      "record a ✅ and 🎫 decision for every owned eye or own status mark",
    "reaction owner map omits an observed eye":
      "reactionOwners is missing the observed eyes owners",
    "status reply from a different actor":
      "record the latest same-actor reply from the full thread read",
    "status reply audit points to a different thread":
      "status reply must belong to the source message's root thread",
    "checkmark without an owned eye still needs a status reply":
      "an owned 👀 or own ✅/🎫 needs a same-parent status reply by the same actor",
    "checkmark without an owned eye still needs its recorded evidence":
      "status reply must state the exact disposition and include its recorded evidence",
    "ticket without an owned eye still needs reaction decisions":
      "record a ✅ and 🎫 decision for every owned eye or own status mark",
    "unfinished accepted handoff requires this actor's eye":
      "unfinished work or a human handoff must keep this actor's 👀",
    "Skipped cannot retain fixed scopes or handoffs even when marks remain":
      "Skipped cannot retain any fixed scope, unfinished scope, or handoff",
    "Fixed cannot hide an unfinished scope without this actor's marks":
      "Fixed disposition cannot retain an unfinished scope or handoff; use Partially fixed",
    "Fixed cannot hide an open handoff without this actor's marks":
      "Fixed disposition cannot retain an unfinished scope or handoff; use Partially fixed",
    "Partially fixed without a fixed scope is rejected without this actor's marks":
      "Partially fixed needs a verified fixed scope and a distinct unfinished report scope or handoff",
    "open work must retain this actor's eye":
      "unfinished work or a human handoff must keep this actor's 👀",
    "reply root is missing from page rows and threadRoots":
      "threadParentTs does not resolve to an in-page root or verified threadRoots entry",
    "reply misclassified as a self-root":
      "source message thread_ts must match the verified parent root",
    "root cannot be accepted without source thread resolution":
      "rootResolution must record the source thread_ts or a canonical source/reply permalink and resolved root",
    "permalink thread_ts cannot contradict a claimed self-root":
      "source permalink thread_ts contradicts the claimed self-root",
    "reply permalink must resolve to its exact supplemental root":
      "source permalink thread_ts must match sourceThreadTs",
    "supplemental root needs its own reaction and disposition audit":
      "every supplemental root needs its own reaction and disposition audit row",
    "supplemental root thread replies must follow the root":
      "threadSnapshot replies must be oldest-first",
    "supplemental root eye needs current status and reaction decisions":
      "an owned root eye or mark needs its latest same-actor status reply",
    "supplemental root cannot mark an owned report Owned elsewhere":
      "Owned elsewhere needs another actor's root 👀 and their current same-thread status",
    "administrative supplemental roots cannot carry this actor's workflow marks":
      "this actor's workflow marks cannot be placed on an administrative root",
    "supplemental Fixed cannot hide an unfinished scope without this actor's marks":
      "Fixed disposition cannot retain an unfinished scope or handoff; use Partially fixed",
    "supplemental Partially fixed disposition needs an unfinished scope":
      "Partially fixed needs a verified fixed scope and a distinct unfinished report scope or handoff",
    "supplemental Fixed disposition cannot retain an accepted handoff":
      "Fixed disposition cannot retain an unfinished scope or handoff; use Partially fixed",
    "supplemental human-owner block needs owner acceptance":
      "🎫 needs a named human other than this actor and explicit acceptance of the recorded action, or a direct in-thread request followed by their assent",
    "supplemental root inside the cutoff bypasses the source manifest":
      "a supplemental thread root must predate cutoffTs; include roots within the scoped window in the source manifest",
    "supplemental root must predate every scanned source message":
      "a supplemental root must predate every scanned source message; include roots inside the scanned range in the source manifest",
    "reply points to an in-page reply instead of its root":
      "threadParentTs resolves to a reply, not the actual root",
    "status reply text omits its disposition":
      "status reply must state the exact disposition and include its recorded evidence",
    "status reply does not claim the disposition inside a negated phrase":
      "status reply must state the exact disposition and include its recorded evidence",
    "Fixed label cannot contradict a later unfixed claim":
      "status reply must state the exact disposition and include its recorded evidence",
    "Fixed label cannot claim a report described as not truly fixed":
      "status reply must state the exact disposition and include its recorded evidence",
    "status reply must include its recorded evidence":
      "status reply must state the exact disposition and include its recorded evidence",
    "status reply evidence must match fixed-scope verification":
      "status reply evidence must include every fixed scope's recorded verification",
    "handoff reply must name the recorded owner":
      "status reply must name each handoff's scope, owner, and action",
    "handoff reply must name the recorded action":
      "status reply must name each handoff's scope, owner, and action",
    "handoff reply must name the recorded scope":
      "status reply must name each handoff's scope, owner, and action",
    "handoff reply must match owner word boundaries":
      "status reply must name each handoff's scope, owner, and action",
    "Verified locally scope without a checkmark":
      "a current ✅ needs verified scope evidence (or an explicitly documented historical mark), and every verified scope needs ✅",
    "checkmark without verified fixed scope":
      "a current ✅ needs verified scope evidence (or an explicitly documented historical mark), and every verified scope needs ✅",
    "partially fixed without verified fixed-scope evidence":
      "Partially fixed needs a verified fixed scope and a distinct unfinished report scope or handoff",
    "partially fixed needs an unfinished scope as well as a fixed scope":
      "Partially fixed needs a verified fixed scope and a distinct unfinished report scope or handoff",
    "handoff without a fixed scope is not partially fixed":
      "Partially fixed needs a verified fixed scope and a distinct unfinished report scope or handoff",
    "ticket reaction without a human handoff":
      "this actor's 🎫 needs a distinct active or explicitly historical human action",
    "human handoff without a ticket reaction":
      "every handoff needs this actor's 🎫",
    "ticket handoff cannot name an unassigned role":
      "unassigned handoffs may name a team/role, while accepted handoffs need the named individual",
    "unassigned team handoff cannot claim a named owner":
      "unassigned handoffs may name a team/role, while accepted handoffs need the named individual",
    "ticket handoff needs the assigned human's acceptance":
      "🎫 needs a named human other than this actor and explicit acceptance of the recorded action, or a direct in-thread request followed by their assent",
    "ticket handoff cannot assign the sweep actor":
      "🎫 needs a named human other than this actor and explicit acceptance of the recorded action, or a direct in-thread request followed by their assent",
    "ticket acceptance must come from the assigned human":
      "🎫 needs a named human other than this actor and explicit acceptance of the recorded action, or a direct in-thread request followed by their assent",
    "ticket acceptance must be in the source thread":
      "handoff acceptance must be a read-back reply by the assigned owner in this thread, before the status reply",
    "ticket acceptance must explicitly accept the work":
      "🎫 needs a named human other than this actor and explicit acceptance of the recorded action, or a direct in-thread request followed by their assent",
    "direct ticket request must name the assigned human":
      "direct handoff request must name the assigned human and exact recorded action",
    "direct ticket request must name the recorded action":
      "direct handoff request must name the assigned human and exact recorded action",
    "direct ticket request must precede acceptance in the source thread":
      "direct handoff request must be this actor's read-back in the source thread before the assigned owner's reply",
    "contextual ticket request must be in the source thread":
      "direct handoff request must be this actor's read-back in the source thread before the assigned owner's reply",
    "hedged contextual ticket assent does not accept the work":
      "🎫 needs a named human other than this actor and explicit acceptance of the recorded action, or a direct in-thread request followed by their assent",
    "refused contextual ticket assent does not accept the work":
      "🎫 needs a named human other than this actor and explicit acceptance of the recorded action, or a direct in-thread request followed by their assent",
    "deliberative contextual assent does not accept the work":
      "🎫 needs a named human other than this actor and explicit acceptance of the recorded action, or a direct in-thread request followed by their assent",
    "consideration contextual assent does not accept the work":
      "🎫 needs a named human other than this actor and explicit acceptance of the recorded action, or a direct in-thread request followed by their assent",
    "request to think contextual assent does not accept the work":
      "🎫 needs a named human other than this actor and explicit acceptance of the recorded action, or a direct in-thread request followed by their assent",
    "tentative guess contextual assent does not accept the work":
      "🎫 needs a named human other than this actor and explicit acceptance of the recorded action, or a direct in-thread request followed by their assent",
    "hedged ticket acceptance does not accept the work":
      "🎫 needs a named human other than this actor and explicit acceptance of the recorded action, or a direct in-thread request followed by their assent",
    "tentative ticket acceptance does not accept the work":
      "🎫 needs a named human other than this actor and explicit acceptance of the recorded action, or a direct in-thread request followed by their assent",
    "ticket acceptance must name the recorded action":
      "🎫 needs a named human other than this actor and explicit acceptance of the recorded action, or a direct in-thread request followed by their assent",
    "completed handoff needs completion evidence":
      "a completed handoff needs evidence and a source URL or owner reply",
    "ticket refusal is not acceptance":
      "🎫 needs a named human other than this actor and explicit acceptance of the recorded action, or a direct in-thread request followed by their assent",
    "later owner refusal withdraws an accepted handoff":
      "the assigned owner withdrew the handoff after accepting it",
    "later bandwidth withdrawal withdraws an accepted handoff":
      "the assigned owner withdrew the handoff after accepting it",
    "later refusal stays visible after a later benign owner reply":
      "the assigned owner withdrew the handoff after accepting it",
    "Blocked on human owner without a handoff or ticket":
      "Blocked on human owner needs a distinct human/team action and this actor's 🎫",
    "Fixed disposition cannot retain an unfinished handoff":
      "Fixed disposition cannot retain an unfinished scope or handoff; use Partially fixed",
    "duplicate handoff scopes are not distinct":
      "handoff scopes must be distinct",
    "cursor overlap row differs from the prior page snapshot":
      "status reply must state the exact disposition and include its recorded evidence",
    "cursor cycle": "nextCursor repeats a cursor already used",
  };
  if (Object.keys(expectedDiagnostics).length !== invalid.length) {
    throw new Error(
      `self-test expected diagnostics cover ${Object.keys(expectedDiagnostics).length} cases; found ${invalid.length}`,
    );
  }
  const validateTestInventory = (inventory: Inventory): string[] =>
    validateInventory(withTestThreadSnapshots(inventory));
  try {
    validateTestInventory(valid);
    validateTestInventory(
      withSweepOwnedParent({
        latestRelevantHumanReply: {
          ts: "11.000000",
          actorId: "UOTHER",
          text: "",
          files: [{ id: "FIMAGE1", name: "image.png", mimeType: "image/png" }],
        },
      }),
    );
    validateTestInventory(
      withSweepOwnedParent({
        disposition: "In progress",
        reactionSummary: "eyes (1): USWEEPER; white_check_mark (1): UOTHER",
        reactionOwners: {
          eyes: ["USWEEPER"],
          white_check_mark: ["UOTHER"],
        },
        reactionDecision: {
          checkmark: {
            state: "none",
            reason: "This actor has no direct browser proof",
          },
          ticket: {
            state: "none",
            reason: "No named human accepted a separate action",
          },
        },
        statusReply: {
          ...firstPage.parents[1]!.statusReply!,
          disposition: "In progress",
          evidence:
            "the reported interaction behavior still needs direct browser proof",
          text: "In progress: the reported interaction behavior still needs direct browser proof. No :white_check_mark: from me — I do not have direct browser proof; the existing root checkmark belongs to another reviewer. Open scope: reported interaction behavior — replay it in the running app. No :ticket: — no named human accepted a separate action. this was sent from a bot.",
        },
        fixedScopes: [],
        unfinishedScopes: [
          {
            scope: "reported interaction behavior",
            evidence:
              "the reported interaction behavior still needs direct browser proof",
          },
        ],
      }),
    );
    const rootTen = valid.channels[0]!.pages[0]!.parents.find(
      (parent) => parent.ts === "10.000000",
    )!;
    const historicalCheckReason =
      "A newer run reproduced the dialog error, so the earlier checkmark is historical.";
    const historicalCheckStatus: StatusReply = {
      ts: "13.000000",
      threadParentTs: "10.000000",
      actorId: "USWEEPER",
      disposition: "In progress",
      evidence:
        "a newer run still shows the create action for an existing account",
      text: `In progress: a newer run still shows the create action for an existing account. :white_check_mark: for the initial route screen is historical. ${historicalCheckReason} No :ticket: — no separate human action was accepted. this was sent from a bot.`,
    };
    const historicalCheckInventory = withSweepOwnedParent({
      disposition: "In progress",
      reactionSummary: "eyes (1): USWEEPER; white_check_mark (1): USWEEPER",
      reactionOwners: {
        eyes: ["USWEEPER"],
        white_check_mark: ["USWEEPER"],
      },
      reactionDecision: {
        checkmark: {
          state: "present",
          reason: `Historical prior proof: ${historicalCheckReason}`,
        },
        ticket: {
          state: "none",
          reason: "No separate human action was accepted",
        },
      },
      latestRelevantHumanReply: {
        ts: "11.500000",
        actorId: "UOTHER",
        text: "A newer run still shows the create action for an existing account.",
      },
      fixedScopes: [],
      unfinishedScopes: [
        {
          scope: "initial route screen",
          evidence:
            "a newer run still shows the create action for an existing account",
        },
      ],
      historicalReactionMarks: [
        {
          emoji: "white_check_mark",
          scope: "initial route screen",
          reason: historicalCheckReason,
          previousStatus: {
            ...rootTen.statusReply!,
            ts: "10.500000",
            threadParentTs: "10.000000",
          },
        },
      ],
      statusReply: historicalCheckStatus,
    });
    validateTestInventory(historicalCheckInventory);

    const ticketHistoryBase = withUnownedTicket();
    const ticketHistoryParent =
      ticketHistoryBase.channels[0]!.pages[0]!.parents.find(
        (parent) => parent.ts === "10.000000",
      )!;
    const originalHandoff = ticketHistoryParent.handoffs![0]!;
    const originalTicketStatus = ticketHistoryParent.statusReply!;
    const withdrawalReply = {
      ts: "12.500000",
      threadParentTs: "10.000000",
      actorId: "UOTHER",
      text: "I cannot choose the remaining behavior after all.",
    };
    const historicalTicketReason =
      "Alex Rivera withdrew the accepted choice, so the retained ticket is historical.";
    const historicalTicketEvidence =
      "Alex Rivera declined to choose the remaining behavior; the design choice remains unresolved.";
    const historicalTicketStatus: StatusReply = {
      ts: "13.000000",
      threadParentTs: "10.000000",
      actorId: "USWEEPER",
      disposition: "In progress",
      evidence: historicalTicketEvidence,
      text: `In progress: ${historicalTicketEvidence} :ticket: for Alex Rivera's accepted remaining design choice is historical. ${historicalTicketReason} No :white_check_mark: — no scope has passed verification. this was sent from a bot.`,
    };
    const historicalTicketInventory = withUnownedTicket({
      disposition: "In progress",
      reactionDecision: {
        checkmark: {
          state: "none",
          reason: "No verified scope is complete yet",
        },
        ticket: {
          state: "present",
          reason: `Historical accepted handoff: ${historicalTicketReason}`,
        },
      },
      latestRelevantHumanReply: withdrawalReply,
      unfinishedScopes: [
        {
          scope: "remaining design choice",
          evidence: historicalTicketEvidence,
        },
      ],
      handoffs: undefined,
      historicalReactionMarks: [
        {
          emoji: "ticket",
          scope: "remaining design choice",
          reason: historicalTicketReason,
          previousStatus: originalTicketStatus,
          handoff: originalHandoff,
          withdrawalReply,
        },
      ],
      statusReply: historicalTicketStatus,
    });
    validateTestInventory(historicalTicketInventory);
    const botHistoricalAcceptance = withTestThreadSnapshots(
      historicalTicketInventory,
    );
    const botHistoricalAcceptanceReply =
      botHistoricalAcceptance.channels[0]!.threadSnapshots?.[0]!.replies.find(
        (reply) => reply.ts === originalHandoff.acceptanceReply!.ts,
      );
    if (!botHistoricalAcceptanceReply) {
      throw new Error(
        "self-test setup failed to find historical ticket acceptance",
      );
    }
    botHistoricalAcceptanceReply.kind = "bot";
    try {
      validateInventory(botHistoricalAcceptance);
      throw new Error(
        "self-test failed to reject bot historical handoff acceptance",
      );
    } catch (error) {
      if (
        error instanceof Error &&
        error.message ===
          "self-test failed to reject bot historical handoff acceptance"
      ) {
        throw error;
      }
      if (
        !(error instanceof Error) ||
        !error.message.endsWith(
          "historical handoff acceptance must match the captured human reply",
        )
      ) {
        throw new Error(
          "self-test failed to reject bot historical handoff acceptance",
          {
            cause: error,
          },
        );
      }
    }
    const expectHistoricalMarkFailure = (
      name: string,
      inventory: Inventory,
      diagnostic: string,
    ): void => {
      try {
        validateTestInventory(inventory);
        throw new Error(`self-test failed to reject ${name}`);
      } catch (error) {
        if (
          error instanceof Error &&
          error.message.startsWith("self-test failed")
        ) {
          throw error;
        }
        if (!(error instanceof Error) || !error.message.endsWith(diagnostic)) {
          throw new Error(
            `self-test ${name} expected diagnostic "${diagnostic}"; received "${error instanceof Error ? error.message : String(error)}"`,
          );
        }
      }
    };
    expectHistoricalMarkFailure(
      "historical checkmark needs a prior marked proof reply",
      {
        ...historicalCheckInventory,
        channels: historicalCheckInventory.channels.map((channel) => ({
          ...channel,
          pages: channel.pages.map((page) => ({
            ...page,
            parents: page.parents.map((parent) =>
              parent.ts === "10.000000"
                ? {
                    ...parent,
                    historicalReactionMarks:
                      parent.historicalReactionMarks?.map((mark) => ({
                        ...mark,
                        previousStatus: {
                          ...mark.previousStatus,
                          text: "Fixed: focused test passed for the initial route screen. No checkmark was set. this was sent from a bot.",
                        },
                      })),
                  }
                : parent,
            ),
          })),
        })),
      },
      "prior status must name the marked scope and reaction",
    );
    expectHistoricalMarkFailure(
      "historical ticket withdrawal needs the assigned owner's reply",
      {
        ...historicalTicketInventory,
        channels: historicalTicketInventory.channels.map((channel) => ({
          ...channel,
          pages: channel.pages.map((page) => ({
            ...page,
            parents: page.parents.map((parent) =>
              parent.ts === "10.000000"
                ? {
                    ...parent,
                    latestRelevantHumanReply: {
                      ...parent.latestRelevantHumanReply!,
                      actorId: "UOTHER2",
                    },
                    historicalReactionMarks:
                      parent.historicalReactionMarks?.map((mark) =>
                        mark.emoji === "ticket" && mark.withdrawalReply
                          ? {
                              ...mark,
                              withdrawalReply: {
                                ...mark.withdrawalReply,
                                actorId: "UOTHER2",
                              },
                            }
                          : mark,
                      ),
                  }
                : parent,
            ),
          })),
        })),
      },
      "historical 🎫 needs the owner's later, read-back refusal of the accepted action",
    );
    validateTestInventory(withOtherOwnerRoot());
    validateTestInventory({
      ...valid,
      channels: valid.channels.map((channel) => ({
        ...channel,
        pages: channel.pages.map((page) => ({
          ...page,
          parents: page.parents.map((parent) =>
            parent.ts === "11.000000"
              ? {
                  ...parent,
                  reactionSummary: "eyes (1): UOTHER",
                  reactionOwners: { eyes: ["UOTHER"] },
                  disposition: "Skipped",
                  otherOwnerEvidence: undefined,
                }
              : parent,
          ),
        })),
        threadSnapshots: [
          ...(channel.threadSnapshots ?? []),
          {
            rootTs: "11.000000",
            readAt: "2030-01-01T00:00:00.000Z",
            replyCount: 1,
            replies: [
              {
                ts: "12.000000",
                actorId: "UOTHER",
                kind: "human" as const,
                text: "Skipped: no actionable follow-up remains.",
                workflowReactionSummary: "none",
                workflowReactionOwners: {},
              },
            ],
          },
        ],
      })),
    });
    validateTestInventory(
      withSupplementalRootAudit(
        supplementalRootAudit("8.500000", {
          disposition: "In progress",
          unfinishedScopes: [
            {
              scope: "older report behavior",
              evidence: "the older report still needs a direct retest",
            },
          ],
        }),
      ),
    );
    const skippedWithHistoricalEye = {
      ts: "12.000000",
      threadParentTs: "10.000000",
      actorId: "USWEEPER",
      disposition: "Skipped",
      evidence: "direct reproduction showed the report was out of scope",
      text: "Skipped: direct reproduction showed the report was out of scope. No :white_check_mark: — no fixed scope was verified. No :ticket: — no human handoff remains. this was sent from a bot.",
    } satisfies StatusReply;
    validateTestInventory(
      withSweepOwnedParent({
        disposition: "Skipped",
        reactionSummary: "eyes (1): USWEEPER",
        reactionOwners: { eyes: ["USWEEPER"] },
        latestRelevantHumanReply: null,
        statusReply: skippedWithHistoricalEye,
        reactionDecision: {
          checkmark: {
            state: "none",
            reason: "The report was out of scope; no fix was verified",
          },
          ticket: {
            state: "none",
            reason: "No separate human action remains",
          },
        },
        fixedScopes: [],
        unfinishedScopes: [],
        handoffs: [],
      }),
    );
    const replyCheckInventory = withTestThreadSnapshots(
      withSupplementalRootAudit(ownedSupplementalRootAudit()),
    );
    const replyCheckWithCapturedSnapshot: Inventory = {
      ...replyCheckInventory,
      channels: replyCheckInventory.channels.map((channel) => ({
        ...channel,
        threadSnapshots: channel.threadSnapshots?.map((snapshot) =>
          snapshot.rootTs === "8.500000"
            ? {
                ...snapshot,
                replies: snapshot.replies.map((reply) =>
                  reply.ts === "8.600000"
                    ? {
                        ...reply,
                        workflowReactionSummary:
                          "white_check_mark (1): USWEEPER",
                        workflowReactionOwners: {
                          white_check_mark: ["USWEEPER"],
                        },
                        workflowReactionReadAt: "2030-01-01T00:00:01.000Z",
                      }
                    : reply,
                ),
              }
            : snapshot,
        ),
      })),
    };
    const replyCheckSummary = validateInventory(replyCheckWithCapturedSnapshot);
    if (
      !replyCheckSummary.some((line) =>
        line.includes("owned 👀 0, ✅ marks 1 for 1 verified scopes"),
      ) ||
      !replyCheckSummary.some((line) =>
        line.includes(
          "pre-cutoff boundary root-thread reply marks (history only; never root checkoffs): 👀 0; ✅ 1 (USWEEPER: 1); 🎫 0",
        ),
      )
    ) {
      throw new Error(
        "self-test failed to keep reply-level checkmarks out of root checkoff counts",
      );
    }
    const currentReplyMarkInventory = withTestThreadSnapshots(valid);
    const currentReplyMarkWithReadback: Inventory = {
      ...currentReplyMarkInventory,
      channels: currentReplyMarkInventory.channels.map((channel) => ({
        ...channel,
        threadSnapshots: channel.threadSnapshots?.map((snapshot) =>
          snapshot.rootTs === "10.000000"
            ? {
                ...snapshot,
                replies: snapshot.replies.map((reply) =>
                  reply.ts === "12.000000"
                    ? {
                        ...reply,
                        workflowReactionSummary: "eyes (1): USWEEPER",
                        workflowReactionOwners: { eyes: ["USWEEPER"] },
                        workflowReactionReadAt: "2030-01-01T00:00:01.000Z",
                      }
                    : reply,
                ),
              }
            : snapshot,
        ),
      })),
    };
    const currentReplyMarkSummary = validateInventory(
      currentReplyMarkWithReadback,
    );
    if (
      !currentReplyMarkSummary.some((line) =>
        line.includes(
          "current-window root-thread reply marks (history only; never root checkoffs): 👀 1 (USWEEPER: 1); ✅ 0; 🎫 0",
        ),
      )
    ) {
      throw new Error(
        "self-test failed to separate current-window reply marks from boundary history",
      );
    }
    const ownedElsewhereStatusReply: StatusReply = {
      ts: "12.500000",
      threadParentTs: "10.000000",
      actorId: "USWEEPER",
      disposition: "Owned elsewhere",
      evidence: "Alex Rivera is actively testing the new behavior",
      text: "Owned elsewhere: Alex Rivera is actively testing the new behavior. No :white_check_mark: — no verified scope is complete. No :ticket: — no distinct human action is accepted by this actor. this was sent from a bot.",
    };
    validateTestInventory(
      withOtherOwnerRoot({
        reactionSummary: "eyes (2): UOTHER, USWEEPER",
        reactionOwners: { eyes: ["UOTHER", "USWEEPER"] },
        latestRelevantHumanReply: {
          ts: "12.000000",
          actorId: "UOTHER",
          text: "In progress: I am actively testing the new behavior.",
        },
        latestOwnedReply: latestOwnedReplyFrom(ownedElsewhereStatusReply),
        reactionDecision: {
          checkmark: {
            state: "none",
            reason: "No verified scope is complete yet",
          },
          ticket: {
            state: "none",
            reason: "No distinct human action is accepted by this actor",
          },
        },
        statusReply: ownedElsewhereStatusReply,
      }),
    );
    validateTestInventory(
      withSweepOwnedParent({
        reactionSummary: "eyes (1): USWEEPER; white_check_mark (1): USWEEPER",
        reactionOwners: {
          eyes: ["USWEEPER"],
          white_check_mark: ["USWEEPER"],
        },
      }),
    );
    validateTestInventory(
      withSupplementalRootAudit(
        supplementalRootAudit("8.500000", {
          rootResolution: replyPermalinkThreadResolution(
            "8.600000",
            "8.500000",
          ),
        }),
      ),
    );
    validateTestInventory(
      withSweepOwnedParent({
        disposition: "Skipped",
        reactionSummary: "eyes (1): USWEEPER",
        reactionOwners: { eyes: ["USWEEPER"] },
        fixedScopes: [],
        unfinishedScopes: [],
        handoffs: [],
        reactionDecision: {
          checkmark: {
            state: "none",
            reason: "No scope is verified",
          },
          ticket: {
            state: "none",
            reason: "No distinct human action is assigned",
          },
        },
        statusReply: {
          ...firstPage.parents[1]!.statusReply!,
          disposition: "Skipped",
          evidence: "no follow-up action is needed for this report",
          text: "Skipped: no follow-up action is needed for this report. No :white_check_mark: — no scope is verified. No :ticket: — no distinct human action is assigned. this was sent from a bot.",
        },
      }),
    );
    validateTestInventory(withLegacyReplyEye());
    const permalinkResolvedInventory = withSupplementalRootAudit(
      ownedSupplementalRootAudit({
        rootResolution: {
          evidence: "slack_permalink.thread_ts",
          sourceThreadTs: null,
          rootTs: "8.500000",
          sourcePermalink: sourcePermalink("8.500000"),
        },
      }),
    );
    validateTestInventory({
      ...permalinkResolvedInventory,
      channels: permalinkResolvedInventory.channels.map((channel) => ({
        ...channel,
        pages: channel.pages.map((page) => ({
          ...page,
          parents: page.parents.map((parent) =>
            parent.ts === "9.500000"
              ? {
                  ...parent,
                  rootResolution: permalinkThreadResolution(
                    "9.500000",
                    "8.500000",
                  ),
                }
              : parent,
          ),
        })),
      })),
    });
    validateTestInventory(
      withSweepOwnedParent({
        disposition: "Verified locally",
        reactionSummary: "eyes (1): USWEEPER; white_check_mark (1): USWEEPER",
        reactionOwners: {
          eyes: ["USWEEPER"],
          white_check_mark: ["USWEEPER"],
        },
        statusReply: {
          ...firstPage.parents[1]!.statusReply!,
          disposition: "Verified locally",
          evidence:
            "focused behavior test passed in the open PR; merge pending",
          text: "Verified locally: focused behavior test passed in the open PR; merge pending. :white_check_mark: covers the initial route screen. No :ticket: — no separate human-owned action remains. this was sent from a bot.",
        },
        fixedScopes: [
          {
            scope: "initial route screen",
            verification:
              "focused behavior test passed in the open PR; merge pending",
          },
        ],
      }),
    );
    validateTestInventory(
      withSweepOwnedParent({
        disposition: "Verified locally",
        reactionSummary: "eyes (1): USWEEPER; white_check_mark (1): USWEEPER",
        reactionOwners: {
          eyes: ["USWEEPER"],
          white_check_mark: ["USWEEPER"],
        },
        statusReply: {
          ...firstPage.parents[1]!.statusReply!,
          disposition: "Verified locally",
          evidence:
            "focused behavior test passed in the open PR; merge pending; paragraph selection remains unverified",
          text: "Verified locally: focused behavior test passed in the open PR; merge pending; paragraph selection remains unverified. :white_check_mark: covers the initial route screen. Open scope: paragraph selection behavior — paragraph selection remains unverified. No :ticket: — no separate human-owned action remains. this was sent from a bot.",
        },
        fixedScopes: [
          {
            scope: "initial route screen",
            verification:
              "focused behavior test passed in the open PR; merge pending",
          },
        ],
        unfinishedScopes: [
          {
            scope: "paragraph selection behavior",
            evidence: "paragraph selection remains unverified",
          },
        ],
      }),
    );
    validateTestInventory(
      withSweepOwnedParent({
        disposition: "Resolved elsewhere",
        reactionSummary: "white_check_mark (1): USWEEPER",
        reactionOwners: { white_check_mark: ["USWEEPER"] },
        reactionDecision: {
          checkmark: {
            state: "present",
            reason: "PR #7714 merged the verified label correction",
          },
          ticket: {
            state: "none",
            reason: "No distinct human handoff remains",
          },
        },
        statusReply: {
          ...firstPage.parents[1]!.statusReply!,
          disposition: "Resolved elsewhere",
          evidence: "PR #7714 merged the label correction at `829d09b196`",
          text: "Resolved elsewhere: PR #7714 merged the label correction at `829d09b196`. :white_check_mark: covers the merged Netlify/Vercel label correction. No :ticket: — Enzo’s configuration action is complete and no separate human-owned action remains. this was sent from a bot.",
        },
        fixedScopes: [
          {
            scope: "Netlify/Vercel label correction",
            verification:
              "PR #7714 merged the label correction at `829d09b196`",
          },
        ],
      }),
    );
    const reverifiedAfterReporterReply =
      "focused route test re-tested after reporter confirmation and passed";
    validateTestInventory(
      withSweepOwnedParent({
        latestRelevantHumanReply: {
          ts: "11.000000",
          actorId: "UOTHER",
          text: "Reporter confirms the issue still occurs after reopening the project.",
        },
        fixedScopes: [
          {
            scope: "initial route screen",
            verification: reverifiedAfterReporterReply,
            verifiedAfterHumanReplyTs: "11.000000",
          },
        ],
        statusReply: {
          ...firstPage.parents[1]!.statusReply!,
          evidence: reverifiedAfterReporterReply,
          text: `Fixed: ${reverifiedAfterReporterReply}. :white_check_mark: covers the initial route screen. No :ticket: — no separate human-owned action remains. this was sent from a bot.`,
        },
      }),
    );
    validateTestInventory(
      withSweepOwnedParent({
        disposition: "Partially fixed",
        reactionSummary: "eyes (1): USWEEPER; white_check_mark (1): USWEEPER",
        reactionOwners: {
          eyes: ["USWEEPER"],
          white_check_mark: ["USWEEPER"],
        },
        unfinishedScopes: [
          {
            scope: "paragraph selection behavior",
            evidence: "paragraph selection remains broken",
          },
        ],
        statusReply: {
          ...firstPage.parents[1]!.statusReply!,
          disposition: "Partially fixed",
          evidence:
            "focused test passed in the open PR; merge pending; paragraph selection remains broken",
          text: "Partially fixed: focused test passed in the open PR; merge pending; paragraph selection remains broken. :white_check_mark: covers the initial route screen. Open scope: paragraph selection behavior — paragraph selection remains broken. No :ticket: — no named human accepted a separate action. this was sent from a bot.",
        },
      }),
    );
    validateTestInventory(
      withSweepOwnedParent({
        disposition: "Abandoned - no answer in 4 days",
        reactionSummary: "eyes (1): USWEEPER",
        reactionOwners: { eyes: ["USWEEPER"] },
        reactionDecision: {
          checkmark: {
            state: "none",
            reason: "The remaining behavior has not passed verification.",
          },
          ticket: {
            state: "none",
            reason: "No named human accepted the remaining internal work.",
          },
        },
        fixedScopes: [],
        unfinishedScopes: [
          {
            scope: "recording start and stop affordance",
            evidence: "the remaining control behavior is still unverified",
          },
        ],
        statusReply: {
          ...firstPage.parents[1]!.statusReply!,
          disposition: "Abandoned - no answer in 4 days",
          evidence: "the remaining control behavior is still unverified",
          text: "Abandoned - no answer in 4 days: the reporter wait is closed; the remaining control behavior is still unverified. Open scope: recording start and stop affordance. No :white_check_mark: — no fixed scope has passed verification. No :ticket: — no named human accepted a distinct action. this was sent from a bot.",
        },
      }),
    );
    validateTestInventory(withUnownedCheckmark());
    // Unassigned team work is ticketed before a person accepts it.
    validateTestInventory(withUnassignedTeamTicket());
    // Accepted handoff-only work remains In progress and can carry 🎫 without a fixed scope.
    validateTestInventory(withUnownedTicket());
    const completedHandoffReply = {
      ts: "12.000000",
      threadParentTs: "10.000000",
      actorId: "UOTHER",
      text: "I have chosen the remaining behavior.",
    };
    const completedHandoffEvidence =
      "Alex Rivera completed the remaining design choice";
    validateTestInventory(
      withUnownedTicket({
        latestRelevantHumanReply: completedHandoffReply,
        disposition: "Fixed",
        reactionSummary:
          "eyes (1): USWEEPER; white_check_mark (1): USWEEPER; ticket (1): USWEEPER",
        reactionOwners: {
          eyes: ["USWEEPER"],
          white_check_mark: ["USWEEPER"],
          ticket: ["USWEEPER"],
        },
        reactionDecision: {
          checkmark: {
            state: "present",
            reason: "The initial route screen passed focused verification",
          },
          ticket: {
            state: "present",
            reason:
              "The accepted action is completed and its ticket remains as history",
          },
        },
        fixedScopes: [
          {
            scope: "initial route screen",
            verification: "focused test passed",
          },
        ],
        unfinishedScopes: [],
        handoffs: [
          {
            scope: "remaining design choice",
            owner: "Alex Rivera",
            ownerSlackId: "UOTHER",
            action: "choose the remaining behavior",
            status: "completed",
            acceptanceReply: {
              ts: "11.500000",
              threadParentTs: "10.000000",
              actorId: "UOTHER",
              text: "I will choose the remaining behavior.",
            },
            completion: {
              evidence: completedHandoffEvidence,
              reply: completedHandoffReply,
            },
          },
        ],
        statusReply: {
          ts: "13.000000",
          threadParentTs: "10.000000",
          actorId: "USWEEPER",
          disposition: "Fixed",
          evidence: `focused test passed; ${completedHandoffEvidence}`,
          text: `Fixed: focused test passed; ${completedHandoffEvidence}. The initial route screen is verified. Handoff complete: Alex Rivera completed the remaining design choice by choosing the remaining behavior (action: choose the remaining behavior). :white_check_mark: covers the initial route screen; :ticket: stays as history for the completed accepted action. this was sent from a bot.`,
        },
      }),
    );
    const completedHandoffWithoutEvidence = withUnownedTicket({
      handoffs: [
        {
          scope: "remaining design choice",
          owner: "Alex Rivera",
          ownerSlackId: "UOTHER",
          action: "choose the remaining behavior",
          status: "completed",
          acceptanceReply: {
            ts: "11.500000",
            threadParentTs: "10.000000",
            actorId: "UOTHER",
            text: "I will choose the remaining behavior.",
          },
          completion: {
            evidence: "Alex Rivera completed the remaining design choice",
          },
        },
      ],
    });
    try {
      validateTestInventory(completedHandoffWithoutEvidence);
      throw new Error(
        "self-test failed to reject a completed handoff without verifiable evidence",
      );
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !error.message.includes(
          "a completed handoff needs evidence and a source URL or owner reply",
        )
      ) {
        throw error;
      }
    }
    // A named direct request plus the assigned human's immediate assent is a
    // valid handoff even when their assent reply does not restate the action.
    validateTestInventory(withContextualTicket());
    const eagerAcceptance =
      "I can't wait — I will choose the remaining behavior.";
    validateTestInventory(
      withUnownedTicket({
        latestRelevantHumanReply: {
          ts: "11.500000",
          actorId: "UOTHER",
          text: eagerAcceptance,
        },
        handoffs: [
          {
            scope: "remaining design choice",
            owner: "Alex Rivera",
            ownerSlackId: "UOTHER",
            action: "choose the remaining behavior",
            acceptanceReply: {
              ts: "11.500000",
              threadParentTs: "10.000000",
              actorId: "UOTHER",
              text: eagerAcceptance,
            },
          },
        ],
      }),
    );
    const tentativeAcceptance =
      "I'm not sure yet, but I'll choose the remaining behavior.";
    validateTestInventory(
      withUnownedTicket({
        latestRelevantHumanReply: {
          ts: "11.500000",
          actorId: "UOTHER",
          text: tentativeAcceptance,
        },
        handoffs: [
          {
            scope: "remaining design choice",
            owner: "Alex Rivera",
            ownerSlackId: "UOTHER",
            action: "choose the remaining behavior",
            acceptanceReply: {
              ts: "11.500000",
              threadParentTs: "10.000000",
              actorId: "UOTHER",
              text: tentativeAcceptance,
            },
          },
        ],
      }),
    );
    const explicitActionDespiteUncertainty = "I'm not sure, I'll take a look.";
    validateTestInventory(
      withUnownedTicket({
        latestRelevantHumanReply: {
          ts: "11.500000",
          actorId: "UOTHER",
          text: explicitActionDespiteUncertainty,
        },
        handoffs: [
          {
            scope: "remaining design choice",
            owner: "Alex Rivera",
            ownerSlackId: "UOTHER",
            action: "take a look",
            acceptanceReply: {
              ts: "11.500000",
              threadParentTs: "10.000000",
              actorId: "UOTHER",
              text: explicitActionDespiteUncertainty,
            },
          },
        ],
        statusReply: {
          ...firstPage.parents[1]!.statusReply!,
          disposition: "In progress",
          evidence: "Alex Rivera will take a look",
          text: "In progress: Alex Rivera will take a look. Handoff: remaining design choice — Alex Rivera — take a look. No :white_check_mark: — no verified scope is complete yet. :ticket: tracks Alex Rivera's accepted action. this was sent from a bot.",
        },
      }),
    );
    validateTestInventory(
      withUnownedTicket({
        disposition: "Blocked on human owner",
        latestRelevantHumanReply: {
          ts: "11.500000",
          actorId: "UOTHER",
          text: "I will configure VERCEL_TOKEN.",
        },
        handoffs: [
          {
            scope: "scheduled canary credentials",
            owner: "Alex Rivera",
            ownerSlackId: "UOTHER",
            action: "configure VERCEL_TOKEN",
            acceptanceReply: {
              ts: "11.500000",
              threadParentTs: "10.000000",
              actorId: "UOTHER",
              text: "I will configure VERCEL_TOKEN.",
            },
          },
        ],
        statusReply: {
          ...firstPage.parents[1]!.statusReply!,
          disposition: "Blocked on human owner",
          evidence: "Alex Rivera must configure VERCEL_TOKEN.",
          text: "Blocked on human owner: Alex Rivera must configure VERCEL_TOKEN. Handoff: scheduled canary credentials — Alex Rivera — configure VERCEL_TOKEN. No :white_check_mark: — no fix is verified yet. :ticket: tracks Alex Rivera's accepted VERCEL_TOKEN action. this was sent from a bot.",
        },
      }),
    );
    validateTestInventory(
      withHandoffReply(
        "Partially fixed: focused route-picker test passed; merge pending. Handoff: secondary request — Alex Rivera to choose the remaining behavior. :white_check_mark: covers route-picker behavior. :ticket: tracks Alex Rivera's accepted follow-up. this was sent from a bot.",
      ),
    );
    validateTestInventory({
      ...valid,
      channels: valid.channels.map((channel) => ({
        ...channel,
        pages: channel.pages.map((page) => ({
          ...page,
          parents: page.parents.map((parent) =>
            parent.ts === "10.000000"
              ? {
                  ...parent,
                  disposition: "Clarification needed",
                  reactionSummary: "eyes (1): USWEEPER",
                  reactionOwners: { eyes: ["USWEEPER"] },
                  reactionDecision: {
                    checkmark: {
                      state: "none",
                      reason:
                        "No scope is verified while clarification is pending",
                    },
                    ticket: {
                      state: "none",
                      reason:
                        "The unanswered reporter request is not a human handoff",
                    },
                  },
                  fixedScopes: [],
                  statusReply: {
                    ...parent.statusReply!,
                    disposition: "Clarification needed",
                    evidence:
                      "waiting for the URL already requested in this thread",
                    text: "Clarification needed: waiting for the URL already requested in this thread. Evidence: waiting for the URL already requested in this thread. No :white_check_mark: — the required URL is still missing. No :ticket: — a reporter clarification is not a named human handoff. this was sent from a bot.",
                  },
                  latestOwnedReply: {
                    ...parent.latestOwnedReply!,
                    text: "Clarification needed: waiting for the URL already requested in this thread. Evidence: waiting for the URL already requested in this thread. No :white_check_mark: — the required URL is still missing. No :ticket: — a reporter clarification is not a named human handoff. this was sent from a bot.",
                  },
                }
              : parent,
          ),
        })),
      })),
    });
    validateTestInventory({
      ...valid,
      channels: valid.channels.map((channel) => ({
        ...channel,
        oldestQuery: null,
      })),
    });
    validateTestInventory({
      ...valid,
      channels: [
        {
          ...valid.channels[0],
          pages: [
            {
              ...firstPage,
              parents: firstPage.parents.map((parent) =>
                parent.ts === "10.000000"
                  ? {
                      ...parent,
                      disposition: "Partially fixed",
                      statusReply: {
                        ...parent.statusReply!,
                        disposition: "Partially fixed",
                        evidence:
                          "the verified scope is complete; a separate handoff remains.",
                        text: "Partially fixed: the verified scope is complete; a separate handoff remains. Handoffs: secondary request — Alex Rivera to choose the remaining behavior; release timing — Morgan Lee to schedule the rollout. :white_check_mark: covers first scope. :ticket: tracks the accepted handoffs. this was sent from a bot.",
                      },
                      latestOwnedReply: {
                        ...parent.latestOwnedReply!,
                        text: "Partially fixed: the verified scope is complete; a separate handoff remains. Handoffs: secondary request — Alex Rivera to choose the remaining behavior; release timing — Morgan Lee to schedule the rollout. :white_check_mark: covers first scope. :ticket: tracks the accepted handoffs. this was sent from a bot.",
                      },
                      reactionSummary:
                        "eyes (1): USWEEPER; white_check_mark (1): USWEEPER; ticket (1): USWEEPER",
                      reactionOwners: {
                        eyes: ["USWEEPER"],
                        white_check_mark: ["USWEEPER"],
                        ticket: ["USWEEPER"],
                      },
                      handoffs: [
                        {
                          scope: "secondary request",
                          owner: "Alex Rivera",
                          ownerSlackId: "UOTHER",
                          action: "choose the remaining behavior",
                          acceptanceReply: {
                            ts: "11.500000",
                            threadParentTs: "10.000000",
                            actorId: "UOTHER",
                            text: "I will choose the remaining behavior.",
                          },
                        },
                        {
                          scope: "release timing",
                          owner: "Morgan Lee",
                          ownerSlackId: "UANOTHER",
                          action: "schedule the rollout",
                          acceptanceReply: {
                            ts: "11.600000",
                            threadParentTs: "10.000000",
                            actorId: "UANOTHER",
                            text: "I will schedule the rollout.",
                          },
                        },
                      ],
                      latestRelevantHumanReply: {
                        ts: "11.600000",
                        actorId: "UANOTHER",
                        text: "I will schedule the rollout.",
                      },
                      fixedScopes: [
                        {
                          scope: "first scope",
                          verification:
                            "the verified scope is complete; a separate handoff remains.",
                        },
                      ],
                      reactionDecision: {
                        checkmark: {
                          state: "present",
                          reason: "Verified first scope before PR merge",
                        },
                        ticket: {
                          state: "present",
                          reason: "Secondary request needs a product decision",
                        },
                      },
                    }
                  : parent,
              ),
            },
          ],
        },
      ],
    });
    const sweepActorWInventory: Inventory = {
      ...valid,
      sweepActorId: "WACTOR",
      channels: valid.channels.map((channel) => ({
        ...channel,
        pages: channel.pages.map((page) => ({
          ...page,
          parents: page.parents.map((parent) =>
            parent.ts === "10.000000"
              ? {
                  ...parent,
                  reactionSummary: parent.reactionSummary
                    .split("USWEEPER")
                    .join("WACTOR"),
                  reactionOwners: Object.fromEntries(
                    Object.entries(parent.reactionOwners).map(
                      ([emoji, owners]) => [
                        emoji,
                        owners.map((owner) =>
                          owner === "USWEEPER" ? "WACTOR" : owner,
                        ),
                      ],
                    ),
                  ),
                  statusReply: {
                    ...parent.statusReply!,
                    actorId: "WACTOR",
                  },
                  latestOwnedReply: {
                    ...parent.latestOwnedReply!,
                    actorId: "WACTOR",
                  },
                }
              : parent,
          ),
        })),
      })),
    };
    validateTestInventory(sweepActorWInventory);
    validateTestInventory({
      ...valid,
      channels: valid.channels.map((channel) => ({
        ...channel,
        threadRoots: ["8.500000"],
        threadRootAudits: [supplementalRootAudit("8.500000")],
        pages: channel.pages.map((page) => ({
          ...page,
          parents: page.parents.map((parent) =>
            parent.ts === "9.500000"
              ? {
                  ...parent,
                  threadParentTs: "8.500000",
                  rootResolution: sourceThreadResolution("8.500000"),
                }
              : parent,
          ),
        })),
      })),
    });
    const cutoffOverlapInventory = withSupplementalRootAudit(
      ownedSupplementalRootAudit(),
    );
    const cutoffOverlapChannel = cutoffOverlapInventory.channels[0]!;
    const cutoffOverlapSummary = validateTestInventory({
      ...valid,
      channels: [
        {
          ...cutoffOverlapChannel,
          oldestQuery: null,
          pages: [
            {
              ...firstPage,
              cursor: null,
              nextCursor: "next-page",
              exhausted: false,
              messageCount: 3,
              sourceTimestamps: ["11.000000", "10.000000", "9.500000"],
              parents: cutoffOverlapChannel.pages[0]!.parents,
            },
            {
              cursor: "next-page",
              nextCursor: null,
              exhausted: true,
              messageCount: 2,
              sourceTimestamps: ["9.500000", "9.000000"],
              parents: [
                cutoffOverlapChannel.pages[0]!.parents[2]!,
                {
                  ts: "9.000000",
                  threadParentTs: "9.000000",
                  rootResolution: {
                    evidence: "slack_message.thread_ts",
                    sourceThreadTs: null,
                    rootTs: "9.000000",
                  },
                  rootClassification: "report",
                  reactionChecked: true,
                  reactionSummary: "none",
                  reactionOwners: {},
                  disposition: "Skipped",
                },
              ],
            },
          ],
        },
      ],
    });
    if (
      !cutoffOverlapSummary[0].includes(
        "5 source occurrences, 2 unique in window, 3 cutoff overlap, 1 page overlap",
      )
    ) {
      throw new Error(
        "self-test failed to count cursor and cutoff overlaps independently",
      );
    }
    if (
      !cutoffOverlapSummary.some((line) =>
        line.includes(
          "in-scope report roots 2; owned 👀 0, ✅ marks 1 for 1 verified scopes, 🎫 marks 0 for 0 distinct human actions (0 accepted, 0 unassigned; including completed history)",
        ),
      ) ||
      !cutoffOverlapSummary.some((line) =>
        line.includes("in-scope administrative roots 0"),
      ) ||
      !cutoffOverlapSummary.some((line) =>
        line.includes("in-scope reply rows 0"),
      ) ||
      !cutoffOverlapSummary.some((line) =>
        line.includes(
          "pre-cutoff rows audited 2 source messages, 1 supplemental roots; excluded from in-scope totals",
        ),
      )
    ) {
      throw new Error(
        "self-test failed to keep pre-cutoff root marks out of current report counts",
      );
    }
    const administrativeRootSummary = validateTestInventory({
      ...valid,
      channels: valid.channels.map((channel) => ({
        ...channel,
        pages: channel.pages.map((page) => ({
          ...page,
          parents: page.parents.map((parent) =>
            parent.ts === "11.000000"
              ? {
                  ...parent,
                  rootClassification: "administrative" as const,
                  rootClassificationReason: "Grouped CI ledger, not feedback",
                }
              : parent,
          ),
        })),
      })),
    });
    if (
      !administrativeRootSummary.some((line) =>
        line.includes("in-scope report roots 1;"),
      ) ||
      !administrativeRootSummary.some((line) =>
        line.includes(
          "in-scope administrative roots 1 (11.000000: Grouped CI ledger, not feedback); excluded from report totals",
        ),
      )
    ) {
      throw new Error(
        "self-test failed to exclude administrative posts from report-root counts",
      );
    }
    const paginatedSummary = validateTestInventory({
      ...valid,
      channels: [
        {
          ...valid.channels[0],
          pages: [
            {
              ...firstPage,
              nextCursor: "next-page",
              exhausted: false,
              messageCount: 2,
              sourceTimestamps: ["11.000000", "10.000000"],
              parents: firstPage.parents.slice(0, 2),
            },
            {
              cursor: "next-page",
              nextCursor: null,
              exhausted: true,
              messageCount: 2,
              sourceTimestamps: ["10.000000", "9.500000"],
              parents: [firstPage.parents[1], firstPage.parents[2]],
            },
          ],
        },
      ],
    });
    if (
      !paginatedSummary[0].includes(
        "4 source occurrences, 2 unique in window, 1 cutoff overlap, 1 page overlap",
      )
    ) {
      throw new Error("self-test failed to count an inclusive cutoff overlap");
    }
    const eyeOnlySummary = validateTestInventory({
      ...valid,
      channels: valid.channels.map((channel) => ({
        ...channel,
        pages: channel.pages.map((page) => ({
          ...page,
          parents: page.parents.map((parent) =>
            parent.ts === "10.000000"
              ? {
                  ...parent,
                  reactionSummary: "eyes (1): USWEEPER",
                  reactionOwners: { eyes: ["USWEEPER"] },
                  disposition: "In progress",
                  latestOwnedReply: {
                    ...parent.latestOwnedReply!,
                    text: "In progress — the reported route still needs a live replay. Open scope: reported route. No ✅ — no fixed scope has passed verification. No 🎫 — no named human accepted a separate action. this was sent from a bot.",
                  },
                  reactionDecision: {
                    checkmark: {
                      state: "none",
                      reason: "The reported route still needs a live replay.",
                    },
                    ticket: {
                      state: "none",
                      reason: "No separate named human action is assigned.",
                    },
                  },
                  statusReply: {
                    ...parent.statusReply!,
                    disposition: "In progress",
                    evidence: "the reported route still needs a live replay",
                    text: "In progress — the reported route still needs a live replay. Open scope: reported route. No ✅ — no fixed scope has passed verification. No 🎫 — no named human accepted a separate action. this was sent from a bot.",
                  },
                  fixedScopes: [],
                  unfinishedScopes: [
                    {
                      scope: "reported route",
                      evidence: "the reported route still needs a live replay",
                    },
                  ],
                }
              : parent,
          ),
        })),
      })),
    });
    if (
      !eyeOnlySummary.some((line) =>
        line.includes(
          "10.000000 — ✅ The reported route still needs a live replay.; 🎫 No separate named human action is assigned.",
        ),
      )
    ) {
      throw new Error(
        "self-test failed to print the pending reasons for an eye-only report",
      );
    }
    const closedEyeOnlySummary = validateTestInventory({
      ...valid,
      channels: valid.channels.map((channel) => ({
        ...channel,
        pages: channel.pages.map((page) => ({
          ...page,
          parents: page.parents.map((parent) =>
            parent.ts === "10.000000"
              ? {
                  ...parent,
                  reactionSummary: "eyes (1): USWEEPER",
                  reactionOwners: { eyes: ["USWEEPER"] },
                  disposition: "Skipped",
                  latestOwnedReply: {
                    ...parent.latestOwnedReply!,
                    text: "Skipped: direct review showed no follow-up remains. No :white_check_mark: — no scope was verified. No :ticket: — no handoff remains. this was sent from a bot.",
                  },
                  statusReply: {
                    ...parent.statusReply!,
                    disposition: "Skipped",
                    evidence: "direct review showed no follow-up remains",
                    text: "Skipped: direct review showed no follow-up remains. No :white_check_mark: — no scope was verified. No :ticket: — no handoff remains. this was sent from a bot.",
                  },
                  reactionDecision: {
                    checkmark: {
                      state: "none",
                      reason: "No scope was verified",
                    },
                    ticket: {
                      state: "none",
                      reason: "No handoff remains",
                    },
                  },
                  fixedScopes: [],
                  unfinishedScopes: [],
                  handoffs: [],
                }
              : parent,
          ),
        })),
      })),
    });
    if (
      !closedEyeOnlySummary.some((line) =>
        line.includes("eye-only closed historical roots: 10.000000 — Skipped"),
      ) ||
      closedEyeOnlySummary.some(
        (line) =>
          line.includes("10.000000 — ✅") && line.includes("pending reasons"),
      )
    ) {
      throw new Error(
        "self-test failed to report a closed eye as historical instead of pending",
      );
    }
    const snapshotContractCases = new Set([
      "owned marks need a fresh full-thread read",
      "a newer thread reply invalidates the recorded snapshot",
      "thread snapshot count must match the complete reply read",
      "legacy reply marks must match the captured reaction read-back",
      "supplemental root thread replies must follow the root",
      "current open owner eye cannot be auto-claimed",
      "later refusal stays visible after a later benign owner reply",
      "Owned elsewhere status must exist in the captured thread",
    ]);
    const staleOwnedReplyAuditCases = new Set([
      "owned eye missing latest same-actor reply audit",
      "newer same-actor correction invalidates an older status reply",
      "status reply audit points to a different thread",
    ]);
    for (const testCase of invalid) {
      const expectedDiagnostic = expectedDiagnostics[testCase.name];
      if (!expectedDiagnostic) {
        throw new Error(
          `self-test has no expected diagnostic for ${testCase.name}`,
        );
      }
      try {
        const inventory = snapshotContractCases.has(testCase.name)
          ? (testCase.inventory as Inventory)
          : withTestThreadSnapshots(
              testCase.inventory as Inventory,
              !staleOwnedReplyAuditCases.has(testCase.name),
            );
        validateInventory(inventory);
        throw new Error(`self-test failed to reject ${testCase.name}`);
      } catch (error) {
        if (
          error instanceof Error &&
          error.message.startsWith("self-test failed")
        ) {
          throw error;
        }
        if (
          !(error instanceof Error) ||
          !error.message.endsWith(expectedDiagnostic)
        ) {
          throw new Error(
            `self-test ${testCase.name} expected diagnostic "${expectedDiagnostic}"; received "${error instanceof Error ? error.message : String(error)}"`,
          );
        }
      }
    }
    const now = Date.now();
    const inventoryWithReadTimes = (
      pageReadAt: string | undefined,
      snapshotReadAt: string,
    ): Inventory => {
      const inventory = withTestThreadSnapshots(valid);
      return {
        ...inventory,
        channels: inventory.channels.map((channel) => ({
          ...channel,
          pages: channel.pages.map((page) => ({
            ...page,
            readAt: pageReadAt,
            parents: page.parents.map((parent) =>
              parent.ts === parent.threadParentTs
                ? { ...parent, reactionReadAt: pageReadAt }
                : parent,
            ),
          })),
          threadRootAudits: channel.threadRootAudits?.map((parent) => ({
            ...parent,
            reactionReadAt: pageReadAt,
          })),
          threadSnapshots: channel.threadSnapshots?.map((snapshot) => ({
            ...snapshot,
            readAt: snapshotReadAt,
          })),
        })),
      };
    };
    const freshPageReadAt = new Date(now - 30_000).toISOString();
    const freshSnapshotReadAt = new Date(now - 1_000).toISOString();
    const reactionWriteAfterReadInventory = inventoryWithReadTimes(
      freshPageReadAt,
      freshSnapshotReadAt,
    );
    let reactionWriteCaseBuilt = false;
    const reactionWriteAfterRead: Inventory = {
      ...reactionWriteAfterReadInventory,
      channels: reactionWriteAfterReadInventory.channels.map((channel) => ({
        ...channel,
        pages: channel.pages.map((page) => ({
          ...page,
          parents: page.parents.map((parent) => {
            if (
              !reactionWriteCaseBuilt &&
              parent.ts === parent.threadParentTs
            ) {
              reactionWriteCaseBuilt = true;
              return {
                ...parent,
                reactionWriteAt: new Date(now - 5_000).toISOString(),
              };
            }
            return parent;
          }),
        })),
      })),
    };
    if (!reactionWriteCaseBuilt) {
      throw new Error("self-test fixture has no root reaction read-back");
    }
    validateInventory(
      inventoryWithReadTimes(freshPageReadAt, freshSnapshotReadAt),
      { requireFreshReads: true },
    );
    const sourceReceiptFor = (inventory: Inventory): SourceReceipt => ({
      channels: Object.fromEntries(
        inventory.channels.map((channel, channelIndex) => [
          sourceReceiptChannelName(channel.channelId, channelIndex),
          {
            channelId: channel.channelId,
            pages: channel.pages.map((page) => {
              if (!page.readAt) {
                throw new Error(
                  "self-test receipt fixture needs a page read timestamp",
                );
              }
              return {
                cursor: page.cursor,
                nextCursor: page.nextCursor,
                exhausted: page.exhausted,
                readAt: page.readAt,
                messageCount: page.messageCount,
                sourceTimestamps: [...page.sourceTimestamps],
              };
            }),
            rows: channel.pages.flatMap((page) =>
              page.parents.map((parent) => ({
                ts: parent.ts,
                root: parent.threadParentTs,
              })),
            ),
          },
        ]),
      ),
    });
    const rawSourcePagesFor = (receipt: SourceReceipt): RawSourcePages =>
      Object.fromEntries(
        Object.entries(receipt.channels).map(([name, channel]) => {
          let offset = 0;
          const pages = channel.pages.map((page) => {
            const rows = channel.rows.slice(offset, offset + page.messageCount);
            offset += page.messageCount;
            if (rows.length !== page.messageCount) {
              throw new Error(
                "self-test raw source fixture does not cover every page row",
              );
            }
            return { ...page, rows };
          });
          if (offset !== channel.rows.length) {
            throw new Error(
              "self-test raw source fixture has unassigned source rows",
            );
          }
          return [name, pages];
        }),
      ) as RawSourcePages;
    const receiptFreshInventory = inventoryWithReadTimes(
      freshPageReadAt,
      freshSnapshotReadAt,
    );
    const completeSourceReceipt = sourceReceiptFor(receiptFreshInventory);
    const completeRawSourcePages = rawSourcePagesFor(completeSourceReceipt);
    validateInventory(receiptFreshInventory, {
      requireFreshReads: true,
      sourceReceipt: completeSourceReceipt,
      rawSourcePages: completeRawSourcePages,
    });

    const pagedReceiptInventory: Inventory = {
      ...receiptFreshInventory,
      channels: receiptFreshInventory.channels.map((channel) => {
        const page = channel.pages[0]!;
        return {
          ...channel,
          pages: [
            {
              ...page,
              cursor: null,
              nextCursor: "next-page",
              exhausted: false,
              messageCount: 2,
              sourceTimestamps: page.sourceTimestamps.slice(0, 2),
              parents: page.parents.slice(0, 2),
            },
            {
              cursor: "next-page",
              nextCursor: null,
              exhausted: true,
              readAt: freshPageReadAt,
              messageCount: page.messageCount - 2,
              sourceTimestamps: page.sourceTimestamps.slice(2),
              parents: page.parents.slice(2),
            },
          ],
        };
      }),
    };
    const pagedSourceReceipt = sourceReceiptFor(pagedReceiptInventory);
    validateInventory(pagedReceiptInventory, {
      requireFreshReads: true,
      sourceReceipt: pagedSourceReceipt,
      rawSourcePages: rawSourcePagesFor(pagedSourceReceipt),
    });

    const omitNewestRowInventory: Inventory = {
      ...receiptFreshInventory,
      channels: receiptFreshInventory.channels.map((channel) => ({
        ...channel,
        pages: channel.pages.map((page) => ({
          ...page,
          messageCount: page.messageCount - 1,
          sourceTimestamps: page.sourceTimestamps.slice(1),
          parents: page.parents.slice(1),
        })),
      })),
    };
    const omittedTailReceipt: SourceReceipt = {
      channels: {
        ...pagedSourceReceipt.channels,
        qa: {
          ...pagedSourceReceipt.channels.qa!,
          pages: pagedSourceReceipt.channels.qa!.pages.slice(0, 1),
        },
      },
    };
    const tamperedTailReceipt: SourceReceipt = {
      channels: {
        ...pagedSourceReceipt.channels,
        qa: {
          ...pagedSourceReceipt.channels.qa!,
          pages: pagedSourceReceipt.channels.qa!.pages.map((page, index) =>
            index === 1 ? { ...page, nextCursor: "unexpected-page" } : page,
          ),
        },
      },
    };
    const mismatchedRootReceipt: SourceReceipt = {
      channels: {
        ...completeSourceReceipt.channels,
        qa: {
          ...completeSourceReceipt.channels.qa!,
          rows: completeSourceReceipt.channels.qa!.rows.map((row, index) =>
            index === 0 ? { ...row, root: "12.000000" } : row,
          ),
        },
      },
    };
    const omittedBothReceipt = sourceReceiptFor(omitNewestRowInventory);
    const staleSourceReceipt: SourceReceipt = {
      channels: {
        ...completeSourceReceipt.channels,
        qa: {
          ...completeSourceReceipt.channels.qa!,
          pages: completeSourceReceipt.channels.qa!.pages.map((page) => ({
            ...page,
            readAt: new Date(now - MAX_READ_AGE_MS - 1).toISOString(),
          })),
        },
      },
    };
    const sourceReceiptFailures = [
      {
        name: "inventory omits a source row from its receipt",
        inventory: omitNewestRowInventory,
        receipt: completeSourceReceipt,
        rawSourcePages: completeRawSourcePages,
        diagnostic: "source receipt page 1.messageCount does not match",
      },
      {
        name: "inventory and receipt both omit a captured source row",
        inventory: omitNewestRowInventory,
        receipt: omittedBothReceipt,
        rawSourcePages: completeRawSourcePages,
        diagnostic:
          "does not match the captured source, receipt, and inventory",
      },
      {
        name: "source receipt omits the tail page",
        inventory: pagedReceiptInventory,
        receipt: omittedTailReceipt,
        rawSourcePages: rawSourcePagesFor(pagedSourceReceipt),
        diagnostic: "source receipt page count does not match the inventory",
      },
      {
        name: "source receipt tail cursor is tampered",
        inventory: pagedReceiptInventory,
        receipt: tamperedTailReceipt,
        rawSourcePages: rawSourcePagesFor(tamperedTailReceipt),
        diagnostic: "source receipt page 2.nextCursor does not match",
      },
      {
        name: "source receipt root mapping differs",
        inventory: receiptFreshInventory,
        receipt: mismatchedRootReceipt,
        rawSourcePages: rawSourcePagesFor(mismatchedRootReceipt),
        diagnostic: "timestamp/root does not match the reviewed inventory",
      },
      {
        name: "stale source receipt page read",
        inventory: receiptFreshInventory,
        receipt: staleSourceReceipt,
        rawSourcePages: rawSourcePagesFor(staleSourceReceipt),
        diagnostic:
          "older than 15 minutes; rerun the complete channel scan before recap",
      },
    ];
    for (const testCase of sourceReceiptFailures) {
      try {
        validateInventory(testCase.inventory, {
          requireFreshReads: true,
          sourceReceipt: testCase.receipt,
          rawSourcePages: testCase.rawSourcePages,
        });
        throw new Error(`self-test failed to reject ${testCase.name}`);
      } catch (error) {
        if (
          error instanceof Error &&
          error.message.startsWith("self-test failed")
        ) {
          throw error;
        }
        if (
          !(error instanceof Error) ||
          !error.message.includes(testCase.diagnostic)
        ) {
          throw new Error(
            `self-test ${testCase.name} expected diagnostic containing "${testCase.diagnostic}"; received "${error instanceof Error ? error.message : String(error)}"`,
          );
        }
      }
    }
    const freshnessFailures = [
      {
        name: "stale channel page read",
        inventory: inventoryWithReadTimes(
          new Date(now - MAX_READ_AGE_MS - 1).toISOString(),
          freshSnapshotReadAt,
        ),
        diagnostic:
          "older than 15 minutes; rerun the complete channel scan before recap",
      },
      {
        name: "future channel page read",
        inventory: inventoryWithReadTimes(
          new Date(now + MAX_FUTURE_SKEW_MS + 10_000).toISOString(),
          freshSnapshotReadAt,
        ),
        diagnostic:
          "more than one minute in the future; check the local clock and rescan",
      },
      {
        name: "missing channel page read time",
        inventory: inventoryWithReadTimes(undefined, freshSnapshotReadAt),
        diagnostic: "must record the local ISO time of the completed read",
      },
      {
        name: "stale thread snapshot read",
        inventory: inventoryWithReadTimes(
          freshPageReadAt,
          new Date(now - MAX_READ_AGE_MS - 1).toISOString(),
        ),
        diagnostic:
          "older than 15 minutes; read the complete thread again after the final channel scan",
      },
      {
        name: "thread snapshot predates the final page",
        inventory: inventoryWithReadTimes(
          new Date(now - 1_000).toISOString(),
          new Date(now - 2_000).toISOString(),
        ),
        diagnostic:
          "predates the final channel page; read the thread again after the channel scan",
      },
      {
        name: "root reaction read-back predates the latest write",
        inventory: reactionWriteAfterRead,
        diagnostic:
          "root reaction read-back must follow the latest reaction write",
      },
    ];
    for (const testCase of freshnessFailures) {
      try {
        validateInventory(testCase.inventory, { requireFreshReads: true });
        throw new Error(`self-test failed to reject ${testCase.name}`);
      } catch (error) {
        if (
          error instanceof Error &&
          error.message.startsWith("self-test failed")
        ) {
          throw error;
        }
        if (
          !(error instanceof Error) ||
          !error.message.endsWith(testCase.diagnostic)
        ) {
          throw new Error(
            `self-test ${testCase.name} expected diagnostic "${testCase.diagnostic}"; received "${error instanceof Error ? error.message : String(error)}"`,
          );
        }
      }
    }
    console.log(
      `Feedback inventory checker self-test passed (${invalid.length + freshnessFailures.length + sourceReceiptFailures.length + 3} negative cases; 29 positive inventory cases; 6 handoff phrase cases).`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Feedback inventory checker self-test failed: ${message}`);
    process.exit(1);
  }
  process.exit(0);
}

const inputPath = args[0];
const sourceReceiptPath = args[1];
const rawSourcePagesDirectory = args[2];
if (
  !inputPath ||
  !sourceReceiptPath ||
  !rawSourcePagesDirectory ||
  args.length !== 3
) {
  console.error(
    "Usage: pnpm feedback:inventory-check -- .tmp/feedback-inventory.json .tmp/feedback-source-receipt.json .tmp/feedback-source-pages",
  );
  process.exit(2);
}

try {
  const inventory = JSON.parse(readFileSync(inputPath, "utf8")) as Inventory;
  const sourceReceipt = JSON.parse(
    readFileSync(sourceReceiptPath, "utf8"),
  ) as SourceReceipt;
  const rawSourcePages = readRawSourcePages(rawSourcePagesDirectory, inventory);
  const summaries = validateInventory(inventory, {
    requireFreshReads: true,
    sourceReceipt,
    rawSourcePages,
  });
  console.log(
    `Feedback inventory is complete through the requested cutoff.\n${summaries.join("\n")}`,
  );
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Feedback inventory check failed: ${message}`);
  process.exit(1);
}
