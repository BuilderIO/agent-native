import { readFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";

type Handoff = {
  scope: string;
  owner: string;
  ownerSlackId?: string;
  action: string;
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
  ticketUrl?: string;
};

type Parent = {
  ts: string;
  threadParentTs: string;
  // Required on root messages so administrative posts are not counted as reports.
  rootClassification?: "report" | "administrative";
  rootClassificationReason?: string;
  reactionChecked: boolean;
  reactionSummary: string;
  reactionOwners: Record<string, string[]>;
  disposition: string;
  // Latest relevant human thread reply other than statusReply; null if none.
  latestRelevantHumanReply?: {
    ts: string;
    actorId: string;
    text: string;
  } | null;
  // Latest reply by this sweep actor in the root thread, read from Slack.
  latestOwnedReply?: {
    ts: string;
    threadParentTs: string;
    actorId: string;
    text: string;
  };
  statusReply?: {
    ts: string;
    threadParentTs: string;
    actorId: string;
    disposition: string;
    evidence: string;
    text: string;
  };
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
  replies: Array<{
    ts: string;
    actorId: string;
    kind: "human" | "sweep" | "bot";
    text: string;
    // Slack reaction read-back for workflow marks only; unrelated emoji are omitted.
    workflowReactionSummary: string;
    workflowReactionOwners: Record<string, string[]>;
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

type Channel = {
  channelId: string;
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

function validateThreadSnapshot(
  parentName: string,
  rootTs: string,
  snapshot: ThreadSnapshot | undefined,
  parent: Parent,
  sweepActorId: string,
): void {
  if (!snapshot) {
    throw new Error(
      `${parentName}: read the complete Slack thread again and record its threadSnapshot before reconciling owned marks`,
    );
  }
  if (snapshot.rootTs !== rootTs) {
    throw new Error(
      `${parentName}: threadSnapshot must identify the exact root`,
    );
  }
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
  const sweepReplies: ThreadSnapshot["replies"] = [];
  const humanReplies: ThreadSnapshot["replies"] = [];
  const repliesByTimestamp = new Map<
    string,
    ThreadSnapshot["replies"][number]
  >();
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
      (reply.kind === "sweep") !== (reply.actorId === sweepActorId)
    ) {
      throw new Error(
        `${replyName}: record the exact author, message text, and human/sweep/bot classification`,
      );
    }
    if (repliesByTimestamp.has(reply.ts)) {
      throw new Error(
        `${parentName}: threadSnapshot has a duplicate reply timestamp`,
      );
    }
    repliesByTimestamp.set(reply.ts, reply);
    if (reply.kind === "sweep") sweepReplies.push(reply);
    if (reply.kind === "human") humanReplies.push(reply);
    previousReplyTs = replyTs;
  }
  if (snapshot.replies.length > 0 && BigInt(readAt) < previousReplyTs / 1000n) {
    throw new Error(
      `${parentName}: threadSnapshot.readAt must be after the newest reply it records`,
    );
  }

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
        latestHumanReply.text !== recordedHumanReply.text))
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
      !acceptance ||
      repliesByTimestamp.get(acceptance.ts)?.actorId !== acceptance.actorId ||
      repliesByTimestamp.get(acceptance.ts)?.text !== acceptance.text
    ) {
      throw new Error(
        `${parentName}: threadSnapshot must confirm each handoff acceptance in the source thread`,
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
  return handoffs.every((handoff) =>
    [handoff.owner, handoff.action].every((phrase) => {
      const normalizedPhrase = normalizeReplyPhrase(phrase);
      return normalizedPhrase !== "" && reply.includes(` ${normalizedPhrase} `);
    }),
  );
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
  return (
    /\b(?:can|could|would|will)\s+you\b|\bplease\b/i.test(text) &&
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
    "(?:take|handle|do|own|accept|review|investigate|fix|choose|configure|set|complete|help with|work on|commit|promise)";
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
  return /\b(?:(?:i|we)(?:'ll|\s+will|\s+can)\s+(?:take|handle|do|own|accept|review|investigate|fix|choose|configure|set|complete|help with|work on)\b|(?:i|we)(?:'m|\s+am)\s+(?:taking|handling|doing|owning|accepting|reviewing|investigating|fixing|choosing|configuring|setting|completing|working on)\b|happy to (?:take|handle|do|test|fix|review|investigate)\b|will do\b|i(?:'m| am) on it\b)/i.test(
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
  if (
    !/^(?:yes|yeah|yep|yup|sure|okay|ok|absolutely|definitely)(?:\s+(?:sure|absolutely|definitely))?$/.test(
      firstClause,
    ) ||
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
    !/No\s+(?:✅|:white_check_mark:)\s*(?:—|–|-|because|:)\s*\S.{4,}/i.test(
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
      `${parentName}: status reply must name this actor's accepted 🎫 handoff`,
    );
  }
  if (
    !hasTicket &&
    !/No\s+(?:🎫|:ticket:)\s*(?:—|–|-|because|:)\s*\S.{4,}/i.test(text)
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
  if (
    disposition === "Blocked on human owner" &&
    (handoffs.length === 0 || !hasTicket)
  ) {
    throw new Error(
      `${parentName}: Blocked on human owner needs a distinct handoff assigned to a named individual and this actor's 🎫`,
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

function validateOwnedDispositionScopes(
  parentName: string,
  parent: Parent,
  hasOwnedReaction: boolean,
  hasEye: boolean,
  hasCheckmark: boolean,
  fixedScopeNames: Set<string>,
  unfinishedScopeNames: Set<string>,
  handoffs: Handoff[],
): void {
  if (!hasOwnedReaction) return;

  if (parent.disposition === "Skipped") {
    throw new Error(
      `${parentName}: Skipped is closed; remove this actor's 👀, ✅, and 🎫`,
    );
  }

  const hasOpenFollowUp = unfinishedScopeNames.size > 0 || handoffs.length > 0;
  if (
    parent.disposition === "Fixed" &&
    (unfinishedScopeNames.size > 0 || handoffs.length > 0)
  ) {
    throw new Error(
      `${parentName}: Fixed disposition cannot retain an unfinished scope or handoff; use Partially fixed`,
    );
  }
  if (hasOpenFollowUp && !hasEye) {
    throw new Error(
      `${parentName}: unfinished work or a human handoff must keep this actor's 👀`,
    );
  }

  const closedDispositions = new Set([
    "Fixed",
    "Shipped",
    "Live verified",
    "Resolved elsewhere",
    "Skipped",
    "Clustered",
    "Abandoned - no answer in 4 days",
  ]);
  if (openDispositions.has(parent.disposition) && !hasEye) {
    throw new Error(
      `${parentName}: ${parent.disposition} is open; keep this actor's 👀 until its scopes and follow-ups close`,
    );
  }
  const abandonedReporterWaitWithInternalWork =
    parent.disposition === "Abandoned - no answer in 4 days" &&
    unfinishedScopeNames.size > 0;
  if (
    hasEye &&
    closedDispositions.has(parent.disposition) &&
    !abandonedReporterWaitWithInternalWork
  ) {
    throw new Error(
      `${parentName}: ${parent.disposition} is closed; remove this actor's 👀`,
    );
  }

  const hasFixedScope = fixedScopeNames.size > 0;
  if (hasCheckmark !== hasFixedScope) {
    throw new Error(
      `${parentName}: a ✅ requires verified scope evidence, and every verified scope needs ✅`,
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
      `${parentName}: verified scope needs Verified locally, Fixed, Partially fixed, or Resolved elsewhere disposition`,
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
    (!hasFixedScope ||
      (unfinishedScopeNames.size === 0 && handoffs.length === 0))
  ) {
    throw new Error(
      `${parentName}: Partially fixed needs a verified fixed scope and a distinct unfinished report scope or handoff`,
    );
  }
}

function validateOwnedElsewhere(
  parentName: string,
  disposition: string,
  hasOwnedReaction: boolean,
): void {
  if (disposition === "Owned elsewhere" && hasOwnedReaction) {
    throw new Error(
      `${parentName}: Owned elsewhere is only valid for an item with no reaction owned by this actor`,
    );
  }
}

function validateSupplementalRootAudit(
  channelName: string,
  rootTs: string,
  parent: Parent,
  sweepActorId: string,
  threadSnapshot: ThreadSnapshot | undefined,
): void {
  const parentName = `${channelName} supplemental root ${rootTs}`;
  const timestamp = slackTimestamp(parent.ts, `${parentName}.ts`);
  const threadParentTimestamp = slackTimestamp(
    parent.threadParentTs,
    `${parentName}.threadParentTs`,
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

  const ownsEye = (parent.reactionOwners.eyes ?? []).includes(sweepActorId);
  const hasCheckmark = (parent.reactionOwners.white_check_mark ?? []).includes(
    sweepActorId,
  );
  const hasTicket = (parent.reactionOwners.ticket ?? []).includes(sweepActorId);
  const hasOwnedReaction = ownsEye || hasCheckmark || hasTicket;
  validateOwnedElsewhere(parentName, parent.disposition, hasOwnedReaction);
  if (!hasOwnedReaction) return;

  if (
    !Object.prototype.hasOwnProperty.call(parent, "latestRelevantHumanReply")
  ) {
    throw new Error(
      `${parentName}: record the latest relevant human reply, or null if there is none`,
    );
  }
  const decision = parent.reactionDecision;
  for (const [key, present] of [
    ["checkmark", hasCheckmark],
    ["ticket", hasTicket],
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
  validateStatusReactionLanguage(
    parentName,
    reply.text,
    hasCheckmark,
    hasTicket,
    parent.fixedScopes ?? [],
    parent.unfinishedScopes ?? [],
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
      !humanReply.text.trim() ||
      replyTs <= slackTimestamp(humanReply.ts, `${parentName}.humanReply.ts`)
    ) {
      throw new Error(
        `${parentName}: status reply must follow the latest relevant human reply`,
      );
    }
    humanReplyTs = slackTimestamp(humanReply.ts, `${parentName}.humanReply.ts`);
  }

  const {
    fixedScopes,
    fixedScopeNames,
    unfinishedScopes,
    unfinishedScopeNames,
  } = validateScopeEvidence(parentName, parent);
  validateFixedScopeFreshness(parentName, parent);
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

  if (parent.handoff && parent.handoffs !== undefined) {
    throw new Error(`${parentName}: use handoff or handoffs, not both`);
  }
  const handoffs = parent.handoffs ?? (parent.handoff ? [parent.handoff] : []);
  if (
    (parent.handoffs !== undefined && !Array.isArray(parent.handoffs)) ||
    !Array.isArray(handoffs) ||
    hasTicket !== handoffs.length > 0
  ) {
    throw new Error(
      `${parentName}: a root 🎫 requires a distinct handoff assigned to a named individual, and each handoff needs 🎫`,
    );
  }
  const handoffScopes = new Set<string>();
  for (const [handoffIndex, handoff] of handoffs.entries()) {
    if (
      !handoff ||
      typeof handoff.scope !== "string" ||
      !handoff.scope.trim() ||
      typeof handoff.owner !== "string" ||
      !handoff.owner.trim() ||
      !isNamedHumanOwner(handoff.owner) ||
      typeof handoff.action !== "string" ||
      !handoff.action.trim()
    ) {
      throw new Error(
        `${parentName}: handoff ${handoffIndex + 1} needs a distinct scope, assigned individual, and action`,
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
  validateThreadSnapshot(
    parentName,
    parent.ts,
    threadSnapshot,
    parent,
    sweepActorId,
  );
  validateOwnedDispositionScopes(
    parentName,
    parent,
    hasOwnedReaction,
    ownsEye,
    hasCheckmark,
    fixedScopeNames,
    unfinishedScopeNames,
    handoffs,
  );
  validateHumanOwnerBlock(parentName, parent.disposition, handoffs, hasTicket);
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
      `${parentName}: status reply must name each assigned individual owner and action`,
    );
  }
}

const MAX_READ_AGE_MS = 15 * 60 * 1000;
const MAX_FUTURE_SKEW_MS = 60 * 1000;

type ValidationOptions = { requireFreshReads?: boolean };

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
      for (const [replyIndex, reply] of snapshot.replies.entries()) {
        const replyName = `${name}.threadSnapshots[${snapshotIndex}] reply ${replyIndex + 1}`;
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
          replyName,
          reply.workflowReactionSummary,
          reply.workflowReactionOwners,
        );
        if (
          ["eyes", "white_check_mark", "ticket"].some((emoji) =>
            (reply.workflowReactionOwners[emoji] ?? []).includes(
              inventory.sweepActorId,
            ),
          )
        ) {
          throw new Error(
            `${replyName}: this actor's 👀, ✅, and 🎫 belong on the report root, not a reply`,
          );
        }
      }
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

    for (const [pageIndex, page] of channel.pages.entries()) {
      const pageName = `${name} page ${pageIndex + 1}`;
      const cursor = page.cursor ?? null;
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
        if (permalink !== null && sourceTimestamp === permalink) {
          permalinkFound = true;
        }
      }

      for (const [parentIndex, parent] of page.parents.entries()) {
        const parentName = `${pageName} parent ${parentIndex + 1}`;
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

        const ownsEye = (parent.reactionOwners.eyes ?? []).includes(
          inventory.sweepActorId,
        );
        const hasCheckmark = (
          parent.reactionOwners.white_check_mark ?? []
        ).includes(inventory.sweepActorId);
        const hasTicket = (parent.reactionOwners.ticket ?? []).includes(
          inventory.sweepActorId,
        );
        if (
          timestamp !== threadParentTimestamp &&
          (ownsEye || hasCheckmark || hasTicket)
        ) {
          throw new Error(
            `${parentName}: this actor's 👀, ✅, and 🎫 belong on the report root, not a reply row`,
          );
        }
        const reconcilesOwnedStatus = ownsEye || hasCheckmark || hasTicket;
        validateOwnedElsewhere(
          parentName,
          parent.disposition,
          reconcilesOwnedStatus,
        );
        if (
          timestamp >= cutoff &&
          timestamp === threadParentTimestamp &&
          parent.rootClassification === "report" &&
          !reconcilesOwnedStatus &&
          openDispositions.has(parent.disposition)
        ) {
          throw new Error(
            `${parentName}: an in-scope open report needs this actor's 👀 and a current status reply`,
          );
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
          const {
            fixedScopes,
            fixedScopeNames,
            unfinishedScopes,
            unfinishedScopeNames,
          } = validateScopeEvidence(parentName, parent);
          validateFixedScopeFreshness(parentName, parent);
          const reactionDecision = parent.reactionDecision;
          if (!reactionDecision) {
            throw new Error(
              `${parentName}: record a ✅ and 🎫 decision for every owned eye or own status mark`,
            );
          }
          for (const reaction of ["checkmark", "ticket"] as const) {
            const decision = reactionDecision[reaction];
            const present = reaction === "checkmark" ? hasCheckmark : hasTicket;
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
              !latestRelevantHumanReply.text.trim()
            ) {
              throw new Error(
                `${parentName}: latestRelevantHumanReply needs a non-sweep human Slack actor ID, verbatim text, or null`,
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
          validateStatusReactionLanguage(
            parentName,
            reply.text,
            hasCheckmark,
            hasTicket,
            fixedScopes,
            unfinishedScopes,
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
          if (parent.handoff && parent.handoffs !== undefined) {
            throw new Error(`${parentName}: use handoff or handoffs, not both`);
          }
          if (
            parent.handoffs !== undefined &&
            !Array.isArray(parent.handoffs)
          ) {
            throw new Error(`${parentName}: handoffs must be an array`);
          }
          const handoffs =
            parent.handoffs ?? (parent.handoff ? [parent.handoff] : []);
          const threadSnapshot = threadSnapshots.get(parent.threadParentTs);
          validateThreadSnapshot(
            parentName,
            parent.threadParentTs,
            threadSnapshot,
            parent,
            inventory.sweepActorId,
          );
          const handoffScopes = new Set<string>();
          for (const [handoffIndex, handoff] of handoffs.entries()) {
            if (
              !handoff ||
              typeof handoff.scope !== "string" ||
              !handoff.scope.trim() ||
              typeof handoff.owner !== "string" ||
              !handoff.owner.trim() ||
              !isNamedHumanOwner(handoff.owner) ||
              typeof handoff.action !== "string" ||
              !handoff.action.trim()
            ) {
              throw new Error(
                `${parentName}: handoff ${handoffIndex + 1} needs a distinct scope, assigned individual, and action`,
              );
            }
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
            const normalizedScope = normalizeScope(handoff.scope);
            if (handoffScopes.has(normalizedScope)) {
              throw new Error(`${parentName}: handoff scopes must be distinct`);
            }
            handoffScopes.add(normalizedScope);
            if (fixedScopeNames.has(normalizedScope)) {
              throw new Error(
                `${parentName}: 🎫 handoff scope must be distinct from verified fixed scopes`,
              );
            }
          }
          if (handoffs.length > 0 && !hasTicket) {
            throw new Error(
              `${parentName}: every handoff needs this actor's 🎫`,
            );
          }
          if (handoffs.length === 0 && hasTicket) {
            throw new Error(
              `${parentName}: this actor's 🎫 needs a distinct handoff owner and action`,
            );
          }
          validateOwnedDispositionScopes(
            parentName,
            parent,
            reconcilesOwnedStatus,
            ownsEye,
            hasCheckmark,
            fixedScopeNames,
            unfinishedScopeNames,
            handoffs,
          );
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
              `${parentName}: status reply must name each handoff's owner and action`,
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

      const nextCursor = page.nextCursor || null;
      if (nextCursor !== null && typeof nextCursor !== "string") {
        throw new Error(`${pageName}: nextCursor must be a string`);
      }
      const isLastPage = pageIndex === channel.pages.length - 1;
      if (nextCursor && seenCursors.has(nextCursor)) {
        throw new Error(
          `${pageName}: nextCursor repeats a cursor already used`,
        );
      }
      if (page.exhausted === true && nextCursor) {
        throw new Error(`${pageName}: exhausted page cannot have a nextCursor`);
      }
      if (!isLastPage) {
        if (!nextCursor) {
          throw new Error(
            `${pageName}: missing nextCursor before another page`,
          );
        }
        expectedCursor = nextCursor;
      } else {
        const crossedCutoff = page.parents.some(
          (parent) => slackTimestamp(parent.ts, `${pageName}.ts`) < cutoff,
        );
        if (nextCursor && !crossedCutoff) {
          throw new Error(
            `${pageName}: fetch the next cursor or include a parent older than cutoffTs`,
          );
        }
        if (!nextCursor && page.exhausted !== true && !crossedCutoff) {
          throw new Error(
            `${pageName}: mark Slack exhaustion or include a parent older than cutoffTs`,
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
        rootTimestamp,
        rootAudit,
        inventory.sweepActorId,
        threadSnapshots.get(rootAudit.ts),
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
      for (const parent of ownedTickets) {
        const handoffs =
          parent.handoffs ?? (parent.handoff ? [parent.handoff] : []);
        for (const handoff of handoffs) {
          distinctHandoffs.add(
            [handoff.scope, handoff.owner, handoff.action]
              .map(normalizeScope)
              .join("\u0000"),
          );
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
      summaries.push(
        `${channel.channelId}: in-scope ${label} ${rows.length}; owned 👀 ${ownedEyes.length}, ✅ marks ${ownedCheckmarks.length} for ${verifiedScopeCount} verified scopes, 🎫 marks ${ownedTickets.length} for ${distinctHandoffs.size} distinct human handoffs, eye-only ${eyeOnlyRows.length}`,
      );
      if (eyeOnlyRows.length > 0) {
        summaries.push(
          `${channel.channelId}: ${label} eye-only pending reasons: ${eyeOnlyRows
            .map((parent) => {
              const decision = parent.reactionDecision!;
              return `${parent.ts} — ✅ ${decision.checkmark.reason}; 🎫 ${decision.ticket.reason}`;
            })
            .join(" | ")}`,
        );
      }
    };
    summarizeMarks([...distinctReportRoots.values()], "report roots");
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

  if (permalink !== null && !permalinkFound) {
    throw new Error(
      "The requested permalink timestamp is missing from the inventory",
    );
  }

  return summaries;
}

const args = process.argv.slice(2).filter((argument) => argument !== "--");
if (args[0] === "--self-test" && args.length === 1) {
  const valid: Inventory = {
    cutoffTs: "10.000000",
    permalinkTs: "10.000000",
    sweepActorId: "USWEEPER",
    channels: [
      {
        channelId: "C_TEST",
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
                rootClassification: "report",
                reactionChecked: true,
                reactionSummary: "none",
                reactionOwners: {},
                disposition: "Skipped",
              },
              {
                ts: "10.000000",
                threadParentTs: "10.000000",
                rootClassification: "report",
                reactionChecked: true,
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
    rootClassification: "report",
    reactionChecked: true,
    reactionSummary: "none",
    reactionOwners: {},
    disposition: "Skipped",
    ...overrides,
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
      text: `${disposition}: ${evidence}. No :white_check_mark: — no root scope has passed verification. No :ticket: — no distinct action has been accepted by a named human. this was sent from a bot.`,
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
            ? { ...parent, threadParentTs: "8.500000" }
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
        if (!ownsMark || !parent.statusReply) continue;
        const rootTs = parent.threadParentTs;
        const replies = repliesByRoot.get(rootTs) ?? new Map();
        const addReply = (
          ts: string,
          actorId: string,
          kind: ThreadSnapshot["replies"][number]["kind"],
          text: string,
        ): void => {
          const existing = replies.get(ts);
          if (
            existing &&
            (existing.actorId !== actorId || existing.text !== text)
          ) {
            throw new Error(`self-test fixture has conflicting reply ${ts}`);
          }
          replies.set(ts, {
            ts,
            actorId,
            kind,
            text,
            workflowReactionSummary: "none",
            workflowReactionOwners: {},
          });
        };
        if (parent.latestRelevantHumanReply) {
          const reply = parent.latestRelevantHumanReply;
          addReply(reply.ts, reply.actorId, "human", reply.text);
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
        }
        const status = parent.statusReply;
        addReply(
          status.ts,
          status.actorId,
          status.actorId === inventory.sweepActorId ? "sweep" : "human",
          status.text,
        );
        repliesByRoot.set(rootTs, replies);
      }
      return {
        ...channel,
        pages,
        threadSnapshots: [...repliesByRoot.entries()].map(
          ([rootTs, replies]) => {
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
              replies: orderedReplies,
            };
          },
        ),
      };
    }),
  });
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
            text: "In progress: Alex Rivera will choose the remaining behavior. Handoff: Alex Rivera — choose the remaining behavior. No :white_check_mark: — no verified scope is complete yet. :ticket: tracks Alex Rivera's accepted action. this was sent from a bot.",
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
      name: "owned reactions on a reply must be moved to the report root",
      inventory: {
        ...valid,
        channels: valid.channels.map((channel) => ({
          ...channel,
          threadSnapshots: channel.threadSnapshots?.map((snapshot) => ({
            ...snapshot,
            replies: snapshot.replies.map((reply) =>
              reply.ts === "12.000000"
                ? {
                    ...reply,
                    workflowReactionSummary: "eyes (1): USWEEPER",
                    workflowReactionOwners: { eyes: ["USWEEPER"] },
                  }
                : reply,
            ),
          })),
        })),
      },
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
      name: "Owned elsewhere cannot hide this actor's eye or checkmark",
      inventory: withSweepOwnedParent({ disposition: "Owned elsewhere" }),
    },
    {
      name: "Owned elsewhere cannot hide this actor's checkmark without an eye",
      inventory: withUnownedCheckmark({ disposition: "Owned elsewhere" }),
    },
    {
      name: "Owned elsewhere cannot hide this actor's ticket",
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
      name: "latest relevant human reply needs nonempty verbatim text",
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
      name: "reply row status is posted in a different thread",
      inventory: {
        ...valid,
        channels: valid.channels.map((channel) => ({
          ...channel,
          pages: channel.pages.map((page) => ({
            ...page,
            parents: page.parents.map((parent) =>
              parent.ts === "10.000000"
                ? { ...parent, threadParentTs: "9.500000" }
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
      name: "fully fixed work releases this actor's eye",
      inventory: withSweepOwnedParent({
        reactionSummary: "eyes (1): USWEEPER; white_check_mark (1): USWEEPER",
        reactionOwners: {
          eyes: ["USWEEPER"],
          white_check_mark: ["USWEEPER"],
        },
      }),
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
      name: "Skipped is terminal and cannot retain any of this actor's marks",
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
                ? { ...parent, threadParentTs: "8.500000" }
                : parent,
            ),
          })),
        })),
      },
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
                ? { ...parent, threadParentTs: "8.500000" }
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
          withSupplementalRootAudit(ownedSupplementalRootAudit()),
        );
        return {
          ...complete,
          channels: complete.channels.map((channel) => ({
            ...channel,
            threadSnapshots: channel.threadSnapshots?.map((snapshot) => ({
              ...snapshot,
              replies: snapshot.replies.map((reply) => ({
                ...reply,
                ts: "8.400000",
              })),
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
                ? { ...parent, threadParentTs: "8.500000" }
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
      name: "supplemental Fixed disposition cannot retain this actor's eye",
      inventory: withSupplementalRootAudit(
        ownedSupplementalRootAudit({ disposition: "Fixed" }),
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
            text: "Partially fixed: root motion timeline passed focused verification. :white_check_mark: covers the root motion timeline. No :ticket: — no distinct action has been accepted by a named human. this was sent from a bot.",
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
                ? { ...parent, threadParentTs: "10.500000" }
                : parent,
            ),
          })),
        })),
      },
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
                    statusReply: {
                      ...parent.statusReply!,
                      threadParentTs: "9.500000",
                    },
                  }
                : parent.ts === "9.500000"
                  ? { ...parent, threadParentTs: "9.000000" }
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
      "an in-scope open report needs this actor's 👀 and a current status reply",
    "other actors' marks do not replace this actor's eye on open report":
      "an in-scope open report needs this actor's 👀 and a current status reply",
    "owned marks need a fresh full-thread read":
      "read the complete Slack thread again and record its threadSnapshot before reconciling owned marks",
    "a newer thread reply invalidates the recorded snapshot":
      "threadSnapshot reveals a newer or unrecorded human reply; update the status before reconciling",
    "thread snapshot count must match the complete reply read":
      "threadSnapshot must contain every reply reported by Slack",
    "owned reactions on a reply must be moved to the report root":
      "this actor's 👀, ✅, and 🎫 belong on the report root, not a reply",
    "exhausted final page cannot retain a next cursor":
      "exhausted page cannot have a nextCursor",
    "noncanonical disposition label":
      "use an exact canonical disposition for every parent",
    "missing disposition row": "a source message has no disposition row",
    "missing permalink":
      "The requested permalink timestamp is missing from the inventory",
    "permalink is not the inclusive cutoff":
      "permalinkTs must equal the inclusive cutoffTs",
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
    "Owned elsewhere cannot hide this actor's eye or checkmark":
      "Owned elsewhere is only valid for an item with no reaction owned by this actor",
    "Owned elsewhere cannot hide this actor's checkmark without an eye":
      "Owned elsewhere is only valid for an item with no reaction owned by this actor",
    "Owned elsewhere cannot hide this actor's ticket":
      "Owned elsewhere is only valid for an item with no reaction owned by this actor",
    "owned eye missing latest-human-reply audit":
      "latestRelevantHumanReply needs a non-sweep human Slack actor ID, verbatim text, or null",
    "later human reply invalidates the older status reply":
      "status reply must be newer than the latest relevant human reply in the thread",
    "later human reproduction report makes fixed proof stale":
      "a later human reply says the issue persists; rerun direct proof after reply 11.000000 or reopen this scope",
    "latest relevant human reply needs nonempty verbatim text":
      "latestRelevantHumanReply needs a non-sweep human Slack actor ID, verbatim text, or null",
    "latest relevant human reply cannot be this sweep actor":
      "latestRelevantHumanReply needs a non-sweep human Slack actor ID, verbatim text, or null",
    "owned eye missing explicit reaction decisions":
      "record a ✅ and 🎫 decision for every owned eye or own status mark",
    "reaction owner map omits an observed eye":
      "reactionOwners is missing the observed eyes owners",
    "status reply from a different actor":
      "record the latest same-actor reply from the full thread read",
    "reply row status is posted in a different thread":
      "this actor's 👀, ✅, and 🎫 belong on the report root, not a reply row",
    "checkmark without an owned eye still needs a status reply":
      "an owned 👀 or own ✅/🎫 needs a same-parent status reply by the same actor",
    "fully fixed work releases this actor's eye":
      "Fixed is closed; remove this actor's 👀",
    "checkmark without an owned eye still needs its recorded evidence":
      "status reply must state the exact disposition and include its recorded evidence",
    "ticket without an owned eye still needs reaction decisions":
      "record a ✅ and 🎫 decision for every owned eye or own status mark",
    "unfinished accepted handoff requires this actor's eye":
      "unfinished work or a human handoff must keep this actor's 👀",
    "Skipped is terminal and cannot retain any of this actor's marks":
      "Skipped is closed; remove this actor's 👀, ✅, and 🎫",
    "open work must retain this actor's eye":
      "unfinished work or a human handoff must keep this actor's 👀",
    "reply root is missing from page rows and threadRoots":
      "threadParentTs does not resolve to an in-page root or verified threadRoots entry",
    "supplemental root needs its own reaction and disposition audit":
      "every supplemental root needs its own reaction and disposition audit row",
    "supplemental root thread replies must follow the root":
      "threadSnapshot replies must be oldest-first",
    "supplemental root eye needs current status and reaction decisions":
      "an owned root eye or mark needs its latest same-actor status reply",
    "supplemental root cannot mark an owned report Owned elsewhere":
      "Owned elsewhere is only valid for an item with no reaction owned by this actor",
    "supplemental Fixed disposition cannot retain this actor's eye":
      "Fixed is closed; remove this actor's 👀",
    "supplemental Partially fixed disposition needs an unfinished scope":
      "Partially fixed needs a verified fixed scope and a distinct unfinished report scope or handoff",
    "supplemental Fixed disposition cannot retain an accepted handoff":
      "Fixed disposition cannot retain an unfinished scope or handoff; use Partially fixed",
    "supplemental human-owner block needs owner acceptance":
      "🎫 needs a named human other than this actor and explicit acceptance of the recorded action, or a direct in-thread request followed by their assent",
    "supplemental root inside the cutoff bypasses the source manifest":
      "a supplemental thread root must predate cutoffTs; include roots within the scoped window in the source manifest",
    "reply points to an in-page reply instead of its root":
      "this actor's 👀, ✅, and 🎫 belong on the report root, not a reply row",
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
      "status reply must name each handoff's owner and action",
    "handoff reply must name the recorded action":
      "status reply must name each handoff's owner and action",
    "handoff reply must match owner word boundaries":
      "status reply must name each handoff's owner and action",
    "Verified locally scope without a checkmark":
      "a ✅ requires verified scope evidence, and every verified scope needs ✅",
    "checkmark without verified fixed scope":
      "a ✅ requires verified scope evidence, and every verified scope needs ✅",
    "partially fixed without verified fixed-scope evidence":
      "Partially fixed needs a verified fixed scope and a distinct unfinished report scope or handoff",
    "partially fixed needs an unfinished scope as well as a fixed scope":
      "Partially fixed needs a verified fixed scope and a distinct unfinished report scope or handoff",
    "handoff without a fixed scope is not partially fixed":
      "Partially fixed needs a verified fixed scope and a distinct unfinished report scope or handoff",
    "ticket reaction without a human handoff":
      "this actor's 🎫 needs a distinct handoff owner and action",
    "human handoff without a ticket reaction":
      "every handoff needs this actor's 🎫",
    "ticket handoff cannot name an unassigned role":
      "handoff 1 needs a distinct scope, assigned individual, and action",
    "ticket handoff needs the assigned human's acceptance":
      "threadSnapshot must confirm each handoff acceptance in the source thread",
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
    "ticket refusal is not acceptance":
      "🎫 needs a named human other than this actor and explicit acceptance of the recorded action, or a direct in-thread request followed by their assent",
    "later owner refusal withdraws an accepted handoff":
      "the assigned owner withdrew the handoff after accepting it",
    "later bandwidth withdrawal withdraws an accepted handoff":
      "the assigned owner withdrew the handoff after accepting it",
    "later refusal stays visible after a later benign owner reply":
      "the assigned owner withdrew the handoff after accepting it",
    "Blocked on human owner without a handoff or ticket":
      "Blocked on human owner needs a distinct handoff assigned to a named individual and this actor's 🎫",
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
    // Handoff-only work remains In progress and can carry 🎫 without a fixed scope.
    validateTestInventory(withUnownedTicket());
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
          text: "In progress: Alex Rivera will take a look. Handoff: Alex Rivera — take a look. No :white_check_mark: — no verified scope is complete yet. :ticket: tracks Alex Rivera's accepted action. this was sent from a bot.",
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
          text: "Blocked on human owner: Alex Rivera must configure VERCEL_TOKEN. No :white_check_mark: — no fix is verified yet. :ticket: tracks Alex Rivera's accepted VERCEL_TOKEN action. this was sent from a bot.",
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
                      threadParentTs: "9.500000",
                      disposition: "Partially fixed",
                      statusReply: {
                        ...parent.statusReply!,
                        threadParentTs: "9.500000",
                        disposition: "Partially fixed",
                        evidence:
                          "the verified scope is complete; a separate handoff remains.",
                        text: "Partially fixed: the verified scope is complete; a separate handoff remains. Handoffs: secondary request — Alex Rivera to choose the remaining behavior; release timing — Morgan Lee to schedule the rollout. :white_check_mark: covers first scope. :ticket: tracks the accepted handoffs. this was sent from a bot.",
                      },
                      latestOwnedReply: {
                        ...parent.latestOwnedReply!,
                        threadParentTs: "9.500000",
                        text: "Partially fixed: the verified scope is complete; a separate handoff remains. Handoffs: secondary request — Alex Rivera to choose the remaining behavior; release timing — Morgan Lee to schedule the rollout. :white_check_mark: covers first scope. :ticket: tracks the accepted handoffs. this was sent from a bot.",
                      },
                      reactionSummary:
                        "eyes (1): UOTHER; white_check_mark (1): UOTHER; ticket (1): UOTHER",
                      reactionOwners: {
                        eyes: ["UOTHER"],
                        white_check_mark: ["UOTHER"],
                        ticket: ["UOTHER"],
                      },
                      handoffs: [
                        {
                          scope: "secondary request",
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
                        {
                          scope: "release timing",
                          owner: "Morgan Lee",
                          ownerSlackId: "UANOTHER",
                          action: "schedule the rollout",
                          acceptanceReply: {
                            ts: "11.600000",
                            threadParentTs: "9.500000",
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
              ? { ...parent, threadParentTs: "8.500000" }
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
      !cutoffOverlapSummary[1].includes(
        "in-scope report roots 2; owned 👀 0, ✅ marks 1 for 1 verified scopes, 🎫 marks 0 for 0 distinct human handoffs",
      ) ||
      !cutoffOverlapSummary[2].includes("in-scope administrative roots 0") ||
      !cutoffOverlapSummary[3].includes("in-scope reply rows 0") ||
      !cutoffOverlapSummary[4].includes(
        "pre-cutoff rows audited 2 source messages, 1 supplemental roots; excluded from in-scope totals",
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
      !administrativeRootSummary[1].includes("in-scope report roots 1;") ||
      !administrativeRootSummary[2].includes(
        "in-scope administrative roots 1 (11.000000: Grouped CI ledger, not feedback); excluded from report totals",
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
    const snapshotContractCases = new Set([
      "owned marks need a fresh full-thread read",
      "a newer thread reply invalidates the recorded snapshot",
      "thread snapshot count must match the complete reply read",
      "owned reactions on a reply must be moved to the report root",
      "supplemental root thread replies must follow the root",
      "later refusal stays visible after a later benign owner reply",
    ]);
    const staleOwnedReplyAuditCases = new Set([
      "owned eye missing latest same-actor reply audit",
      "newer same-actor correction invalidates an older status reply",
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
          pages: channel.pages.map((page) => ({ ...page, readAt: pageReadAt })),
          threadSnapshots: channel.threadSnapshots?.map((snapshot) => ({
            ...snapshot,
            readAt: snapshotReadAt,
          })),
        })),
      };
    };
    const freshPageReadAt = new Date(now - 30_000).toISOString();
    const freshSnapshotReadAt = new Date(now - 1_000).toISOString();
    validateInventory(
      inventoryWithReadTimes(freshPageReadAt, freshSnapshotReadAt),
      { requireFreshReads: true },
    );
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
      `Feedback inventory checker self-test passed (${invalid.length + freshnessFailures.length} negative cases; 17 positive cases).`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Feedback inventory checker self-test failed: ${message}`);
    process.exit(1);
  }
  process.exit(0);
}

const inputPath = args[0];
if (!inputPath || args.length !== 1) {
  console.error(
    "Usage: pnpm feedback:inventory-check -- .tmp/feedback-inventory.json",
  );
  process.exit(2);
}

try {
  const inventory = JSON.parse(readFileSync(inputPath, "utf8")) as Inventory;
  const summaries = validateInventory(inventory, { requireFreshReads: true });
  console.log(
    `Feedback inventory is complete through the requested cutoff.\n${summaries.join("\n")}`,
  );
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Feedback inventory check failed: ${message}`);
  process.exit(1);
}
