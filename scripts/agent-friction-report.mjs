#!/usr/bin/env node
/**
 * agent-friction-report.mjs
 *
 * Measures how often the user has to correct an agent about the same thing,
 * by reading local Claude Code and Codex transcripts and counting matches for
 * a table of known friction patterns, bucketed by week.
 *
 * Why this exists: on 2026-07-31 an audit claimed unrequested branch creation
 * was a live problem needing a tool-level block. Measuring it showed the
 * opposite — 10 occurrences in early July, then zero in the twelve days after
 * `.agents/skills/new-branch/SKILL.md` gained its activation guard. Guidance
 * had already closed it, and a block would only have fired on the correct
 * post-merge workflow.
 *
 * That is the whole point: a claim about agent behaviour is checkable, and the
 * check is cheap. Before adding any mechanism that constrains agents, run this
 * and confirm the pattern is still live. After changing a skill, run it again
 * a couple of weeks later and confirm the pattern actually declined. A rule
 * nobody measures is a rule nobody can tell is working.
 *
 * Usage:
 *   node scripts/agent-friction-report.mjs                # last 8 weeks
 *   node scripts/agent-friction-report.mjs --weeks 4
 *   node scripts/agent-friction-report.mjs --pattern cheap-model
 *   node scripts/agent-friction-report.mjs --self-test
 *
 * Reads only local transcript files; makes no network calls and writes nothing.
 */

import { readdirSync, statSync, createReadStream } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";

/**
 * Each entry is a correction the user should not have to repeat. `fixedBy`
 * records the guidance that was supposed to close it, so a pattern that keeps
 * climbing after its skill landed is a visible failure of that skill — not a
 * reason to reach for a tool-level block first.
 */
const FOLLOWUP_ACTION = String.raw`(?:check(?:ed)?(?:\s+(?:back|whether|if))?|re-?check(?:ed)?|follow(?:ed)?[ -]+up(?:\s+(?:on|with))?|re-?read|revisit|re-?triage|disposition)`;
const FOLLOWUP_TARGET = String.raw`(?:clarification|unanswered\s+feedback|follow[ -]?up|reporter|repl(?:y|ies|ied)|response|thread)`;
const MISSED_FOLLOWUP_CONTEXT = String.raw`(?:miss(?:ed|ing)|prior|previous(?:ly)?|unanswered|pending|no\s+(?:reply|response)|still\s+(?:waiting|unanswered|no\s+(?:reply|response))|waiting\s+for|asked\s+for|requested\s+(?:a\s+)?clarification|reporter\s+(?:hasn['’]t|didn['’]t|never)\s+(?:repl(?:y|ied|ies)|respond))`;
const FEEDBACK_CORRECTION_GUARDS = String.raw`(?=[^.!?]{0,140}\b${FOLLOWUP_ACTION}\b)(?=[^.!?]{0,140}\b${FOLLOWUP_TARGET}\b)(?=[^.!?]{0,140}\b${MISSED_FOLLOWUP_CONTEXT}\b)[^.!?]{0,180}`;

const UNANSWERED_FEEDBACK_FOLLOWUP_RE = new RegExp(
  [
    String.raw`\b(?:did|have)\s+(?:you|we)\s+check\s+(?:whether|if)\s+the\s+reporter\s+(?:repl(?:y|ies|ied)|respond(?:ed|s)?)\s+to\s+the\s+clarification\b`,
    String.raw`\b(?:did|have)\s+(?:you|we)\b${FEEDBACK_CORRECTION_GUARDS}`,
    String.raw`\b(?:you|we)\s+(?:still\s+)?(?:haven['’]t|didn['’]t|never)\b${FEEDBACK_CORRECTION_GUARDS}`,
    String.raw`\b(?:why|how\s+come)\b[^.!?]{0,80}\b(?:didn['’]t|haven['’]t|never|still|not)\b${FEEDBACK_CORRECTION_GUARDS}`,
    String.raw`\b(?:please|can you|make sure|be sure)\b${FEEDBACK_CORRECTION_GUARDS}`,
  ].join("|"),
  "i",
);

const FEEDBACK_REGEX_CASES = [
  [true, "Did you recheck the unanswered feedback?"],
  [true, "Did you check whether the reporter replied to the clarification?"],
  [true, "Have you followed up on the clarification after the prior request?"],
  [true, "Why haven't you re-read the thread after the missed reporter reply?"],
  [true, "Please re-triage the pending clarification; no response arrived."],
  [false, "Have you checked back with the reporter about the thread?"],
  [false, "Please re-triage this clarification."],
  [false, "Nobody has responded."],
  [false, "Can you re-read the thread after the deploy?"],
  [false, "Did you re-triage this clarification again?"],
  [false, "Answered clarification from yesterday."],
  [false, "Follow-up pass complete."],
  [false, "eyes-only thread"],
];

const SHIPPING_CHURN_RE =
  /\b(?:don['’]?t|do not|stop)\b(?!\s+(?:forget|remember)\b)(?=[^.!?\n]{0,220}\b(?:(?:routin\w*|generic|maintenance|chore|repeated|again|100\s+times|clean|behind|timer)\b|unless[^.!?\n]{0,60}\b(?:conflict\w*|necessary|routin\w*|chore|clear)\b))[^.!?\n]{0,220}\b(?:merg(?:e|ed|es|ing)\s+(?:the\s+)?`?(?:origin\/)?main`?|chore(?:\s+|[- :])?\s*(?:publish\s+branch\s+work\s+)?commits?|ship:push|(?:generic|routine|maintenance|unnecessary)\s+(?:ship|publish)?\s*(?:commits?|changes?)|(?:ship|publish)\s+(?:(?:a|the|generic|routine|maintenance)\s+)?(?:commits?|changes?)|(?:push|commit)(?:ting|ing)?\s+(?:up\s+)?(?:(?:generic|routine|maintenance|unnecessary)\s+)?(?:commits?|changes?)|(?:updat(?:e|ing|ed)|sync(?:e|ing)|refresh(?:e|ing))\b[^.!?\n]{0,80}\b(?:from|with|against)\s+`?(?:origin\/)?main`?)\b|\bonly\s+(?:push(?:\s+up)?|merg(?:e|ed|es|ing)\s+(?:the\s+)?`?(?:origin\/)?main`?)\b[^.!?\n]{0,220}\b(?:CI\s+errors?|PR\s+feedback|merge\s+conflicts?|clear\s+(?:CI|merge)|prevent(?:s|ing)?\s+merge)\b/i;

// ponytail: count explicit "couldn't renew, so stopped" reports; broaden only from clear transcript examples.
const BABYSIT_LEASE_BLOCKS_WORK_RE = new RegExp(
  [
    String.raw`(?:^|[.!?\n])\s*(?!(?:if|when|unless|should|suppose|assuming)\b)[^.!?\n]{0,80}?\b(?:codex|agents?|sessions?|threads?)\b[^.!?\n]{0,80}\b(?:couldn['’]?t|could not|were unable to)\s+(?:get|acquire|renew)\b[^.!?\n]{0,50}\bleases?\b[^.!?\n]{0,40}\b(?:so|then|and then|therefore)\b\s+(?:would\s+)?(?:just\s+)?(?:(?:it|they|the\s+(?:session|task|thread|agent)|(?:session|task|thread|agent|codex))\s+)?stop\w*(?:\s+working)?\b(?=\s*(?:[.!?]|$))`,
    String.raw`\bi\s+(?:(?:had|have) to\s+)?(?:tell|told|asked|reminded)\s+(?:at\s+)?(?:the\s+)?(?:threads?|sessions?|agents?)\s+(?:to\s+)?finish(?:ing)?\s+shipping\s+and\s+(?:to\s+)?(?:ignore|bypass)\s+(?:the\s+)?leases?(?:\s+stuff)?\b`,
  ].join("|"),
  "i",
);

const STALE_PR_WATCHER_RE = new RegExp(
  [
    String.raw`\b(?:stop|remove|delete|pause|cancel|disable|turn off)\b[^.!?\n]{0,100}\b(?:ship[- ]watchdog|PR|pull request)\b[^.!?\n]{0,100}\b(?:monitor|watcher|babysitter|heartbeat)\b`,
    String.raw`\b(?:stop|remove|delete|pause|cancel|disable|turn off)\b[^.!?\n]{0,100}\b(?:monitor|watcher|babysitter|heartbeat)\b[^.!?\n]{0,100}\b(?:PR|pull request|ship[- ]watchdog)\b`,
    String.raw`\b(?:PR|pull request)\b[^.!?\n]{0,100}\b(?:merged|closed|complete|finished)\b[^.!?\n]{0,100}\b(?:monitor|watcher|babysitter|heartbeat|scheduled task)\b`,
    String.raw`\b(?:pointless|duplicate|stale|redundant)\b[^.!?\n]{0,80}\b(?:scheduled tasks?|monitors?|watchers?)\b[^.!?\n]{0,80}\b(?:repeat(?:ed)?|same thing|same status|again)\b`,
  ].join("|"),
  "i",
);

const SHIP_USER = String.raw`(?:i|we|(?:the\s+)?user)`;
const SHIP_OPT_OUT_TARGET = String.raw`(?:to\s+not\s+merge|not\s+to\s+merge|don['’]?t\s+merge(?:\s+(?:it|(?:the\s+)?(?:PR|pull request)(?:\s*#?\d+)?))?|do\s+not\s+merge(?:\s+(?:it|(?:the\s+)?(?:PR|pull request)(?:\s*#?\d+)?))?|leave\s+(?:(?:the\s+)?(?:PR|pull request)(?:\s*#?\d+)?|it)\s+(?:open|unmerged)|no[- ]merge|ship_mode\s*=\s*ready[- ]only|ready[- ]only(?:\s+(?:mode|shipment|endpoint))?)`;
const SHIP_AFFIRMATIVE_OPT_OUT_RE = new RegExp(
  String.raw`(?:\b${SHIP_USER}\s+(?:explicitly\s+)?(?:asked|told|said|requested)[^.!?\n]{0,100}\b${SHIP_OPT_OUT_TARGET}|\b${SHIP_USER}\s+(?:explicitly\s+)?(?:opted\s+out\s+of|declined)\s+(?:the\s+)?merg\w*|^\s*(?:please\s+)?(?:don['’]?t|do\s+not)\s+merge\s+.{0,40}\b(?:PR|pull request)\s*#?\d+|^\s*(?:please\s+)?keep\s+(?:the\s+)?(?:PR|pull request)\s*#?\d+\s+(?:open|unmerged))\b`,
  "i",
);
const SHIP_DIRECT_LEAVE_OPEN_RE =
  /^\s*(?:please\s+)?leave\s+(?:the\s+)?(?:PR|pull request)\s*#?\d+\s+(?:open|unmerged)\b/i;
const SHIP_FALSE_OPT_OUT_BEFORE_RE = new RegExp(
  String.raw`\b(?:i|we)\s+(?:didn['’]?t|did not|never)\s+(?:ask|tell|say|request)\b[^.!?\n]{0,100}\b${SHIP_OPT_OUT_TARGET}`,
  "i",
);
const SHIP_FALSE_OPT_OUT_AFTER_RE =
  /^(?:\s*[,;]?\s*(?:but|although|however|which)\s+)?(?:i|we)\s+(?:didn['’]?t|did not|never)(?:\s*$|\s*[.!?]\s*$|\s*[,;]\s*(?:because|since|as|i|we)\b)/i;
const SHIP_FALSE_OPT_OUT_CLAIM_RE =
  /\b(?:(?:that|this|it)\s+(?:is|was)\s+(?:false|wrong|untrue)|(?:i|we)\s+asked\s+for\s+(?:the\s+)?opposite)\b/i;
const SHIP_AGENT_ATTRIBUTED_OPT_OUT_RE = new RegExp(
  String.raw`\b(?:it|(?:the\s+)?(?:agent|assistant|model))\s+(?:(?:falsely|wrongly)\s+)?(?:claimed|thought|assumed|believed|asserted|reported|said)\s+(?:that\s+)?${SHIP_USER}\s+(?:(?:had|has)\s+)?(?:explicitly\s+)?(?:asked|told|said|requested)\b[^.!?\n]{0,100}\b${SHIP_OPT_OUT_TARGET}`,
  "i",
);
const SHIP_FALSE_OPT_OUT_FOLLOWUP_RE =
  /^\s*[,;]?\s*(?:(?:but|although|however|which)\s+)?(?:(?:i|we)\s+(?:didn['’]?t|did not|never)(?:\s+(?:ask|tell|say|request)\b|[.!?,;]?\s*$)|(?:i|we)\s+(?:never|didn['’]?t|did not)\s+(?:authoriz\w*|approv\w*)\s+(?:that|it)\b|(?:that|this|it)\s+(?:is|was)\s+(?:false|wrong|untrue)\b|(?:i|we)\s+(?:asked|told|requested)\s+(?:for\s+)?(?:the\s+)?opposite\b)/i;

const SHIP_STOPPED_BEFORE_MERGE_POSITIVE_RE = new RegExp(
  String.raw`(?:${[
    String.raw`\b(?:i|we)\b[^.!?\n]{0,30}\b(?:had|have)\s+to\s+tell\b[^.!?\n]{0,80}\b(?:the\s+)?(?:agent|you)\b[^.!?\n]{0,80}\b(?:keep|continue)\b[^.!?\n]{0,80}(?:\/ship\b|\[\$ship\])[^.!?\n]{0,60}\b(?:running|active)\b`,
    String.raw`\b(?:i|we)\b[^.!?\n]{0,40}\b(?:asked|told|instructed|requested)\b[^.!?\n]{0,60}(?:\/ship\b|\[\$ship\])[^.!?\n]{0,60}\bto\s+merge\b[^.!?\n]{0,60}\b(?:the\s+)?(?:PR|pull request)(?:\s*#?\d+)?\b[^.!?\n]{0,80}\bbut\b[^.!?\n]{0,80}\b(?:(?:it\s+)?(?:never\s+did|didn['’]?t\s+merge|did\s+not\s+merge|never\s+merged|didn['’]?t\s+finish|did\s+not\s+finish)|(?:(?:the\s+)?merge|it)\s+never\s+happened|never\s+happened)\b`,
    String.raw`(?:\/ship\b|\[\$ship\])[^.!?\n]{0,50}\b(?:stopp?ed|ended|quit|returned)\b[^.!?\n]{0,50}\bwithout\s+merg(?:e|ing)\b[^.!?\n]{0,40}\b(?:the\s+)?(?:PR|pull request)\s*#?\d+\b`,
    String.raw`\b(?:i|we)\b[^.!?\n]{0,40}\b(?:asked|told|instructed|requested)\b[^.!?\n]{0,60}(?:\/ship\b|\[\$ship\])[^.!?\n]{0,60}\bto\s+merge\b[^.!?\n]{0,40}\b(?:PR|pull request)\s*#?\d+\b[^.!?\n]{0,80}\bbut\b[^.!?\n]{0,80}\b(?:merely|only|just)\b[^.!?\n]{0,80}\b(?:open(?:ed)?|creat(?:ed)?|return(?:ed)?|finish(?:ed)?|stopp?ed|quit)\b`,
    String.raw`\b(?:these are all|all these|all the)\s+(?:threads?|PRs?)\b[^.!?\n]{0,80}\b(?:i|we)\b[^.!?\n]{0,40}\b(?:told|asked|instructed)\b[^.!?\n]{0,60}(?:\/ship\b|\[\$ship\])[^.!?\n]{0,100}\b(?:but|yet|still)\b[^.!?\n]{0,80}\b(?:i|we)\b[^.!?\n]{0,40}\b(?:have|had)\s+to\b[^.!?\n]{0,80}(?:\/|\[\$)?ship-watchdog\b`,
    String.raw`\b(?:i|we)\b[^.!?\n]{0,60}\b(?:have|had)\s+to\b[^.!?\n]{0,60}(?:\/|\[\$)?ship-watchdog\b[^.!?\n]{0,80}\b(?:because|since)\b[^.!?\n]{0,60}(?:\/ship\b|\[\$ship\])[^.!?\n]{0,60}\b(?:stopp?ed|ended|quit|left)\b`,
    String.raw`\b(?:had|have)\s+to\s+remind\b[^.!?\n]{0,80}\b(?:the\s+)?(?:agent|you)\b[^.!?\n]{0,80}\b(?:keep|continue)\b[^.!?\n]{0,80}(?:\/ship\b|\[\$ship\])[^.!?\n]{0,80}\b(?:until|through)\b[^.!?\n]{0,80}\b(?:merged|merge)\b`,
    String.raw`\b(?:the\s+)?(?:agent|you|they)\b[^.!?\n]{0,100}\b(?:stopp?ed|ended|quit|abandoned|returned|finished|completed)\b[^.!?\n]{0,80}(?:\/ship\b|\[\$ship\])[^.!?\n]{0,80}\b(?:before|without|while|although|but|yet)\b[^.!?\n]{0,80}\b(?:the\s+)?(?:PR|pull request)\b[^.!?\n]{0,60}\b(?:merge|merged|open|unmerged)\b`,
    String.raw`(?:\/ship\b|\[\$ship\])[^.!?\n]{0,80}\b(?:stopp?ed|ended|quit|abandoned|returned|finished|completed)\b[^.!?\n]{0,80}\b(?:before|without|while|although|but|yet)\b[^.!?\n]{0,80}\b(?:the\s+)?(?:PR|pull request)\b[^.!?\n]{0,60}\b(?:merge|merged|open|unmerged)\b`,
    String.raw`\bwhy\s+did\b[^.!?\n]{0,80}(?:\/ship\b|\[\$ship\])[^.!?\n]{0,60}\b(?:finish(?:ed)?|stopp?ed|ended|quit|abandoned)\b[^.!?\n]{0,80}\b(?:before|without)\b[^.!?\n]{0,60}\b(?:merg(?:e|ed|ing)|PR|pull request)\b`,
    String.raw`\b(?:the\s+)?(?:agent|you|they)\b[^.!?\n]{0,60}\b(?:reported|called|marked)\b[^.!?\n]{0,80}(?:\/ship\b|\[\$ship\])[^.!?\n]{0,40}\b(?:complete|done|finished)\b[^.!?\n]{0,80}\b(?:but|yet|while)\b[^.!?\n]{0,80}\b(?:the\s+)?(?:PR|pull request)\b[^.!?\n]{0,40}\b(?:open|unmerged|not merged)\b`,
    String.raw`\b(?:the\s+)?(?:agent|you|they)\b[^.!?\n]{0,60}\b(?:stopp?ed|ended|quit|abandoned)\b[^.!?\n]{0,40}(?:\/ship\b|\[\$ship\])[^.!?\n]{0,60}\b(?:with|while|although)\b[^.!?\n]{0,40}\b(?:the\s+)?(?:PR|pull request)\b[^.!?\n]{0,40}\b(?:unmerged|not merged|still open)\b`,
    String.raw`\b(?:they|you|agents?|the\s+agent)\b[^.!?\n]{0,60}\b(?:just\s+)?stop\b[^.!?\n]{0,80}\bafter\b[^.!?\n]{0,60}\b(?:opening|creating|pushing)\b[^.!?\n]{0,30}\b(?:the\s+)?(?:PR|pull request)\b[^.!?\n]{0,80}(?:\/ship\b|\[\$ship\])[^.!?\n]{0,80}\b(?:until|through)\b[^.!?\n]{0,60}\b(?:merge|merged)\b`,
    String.raw`\b(?:i|we)\b[^.!?\n]{0,50}\b(?:already|again|repeatedly|multiple times|more than once)\b[^.!?\n]{0,100}\b(?:asked|told|reminded|said)\b[^.!?\n]{0,100}\b(?:don['’]?t|do not|never)\s+stop\b[^.!?\n]{0,60}(?:\/ship\b|\[\$ship\])[^.!?\n]{0,80}\buntil\b[^.!?\n]{0,60}\b(?:the\s+)?(?:PR|pull request)\b[^.!?\n]{0,40}\bmerged\b`,
    String.raw`\b(?:i|we)\b[^.!?\n]{0,50}\b(?:told|asked|instructed)\b[^.!?\n]{0,80}(?:\/ship\b|\[\$ship\])[^.!?\n]{0,100}\b(?:but|yet|still)\b[^.!?\n]{0,100}\b(?:stopp?ed|ended|quit|abandoned|watchdog|babysit|left\s+(?:the\s+)?(?:PR|pull request)\s+open|unmerged)\b`,
  ].join("|")})`,
  "i",
);
const SHIP_STOPPED_BEFORE_MERGE_ALL_RE = new RegExp(
  SHIP_STOPPED_BEFORE_MERGE_POSITIVE_RE.source,
  "gi",
);

function sentenceBoundsAt(text, index) {
  const start =
    Math.max(
      text.lastIndexOf(".", index - 1),
      text.lastIndexOf("?", index - 1),
      text.lastIndexOf("!", index - 1),
      text.lastIndexOf("\n", index - 1),
    ) + 1;
  const end = [
    text.indexOf(".", index),
    text.indexOf("?", index),
    text.indexOf("!", index),
    text.indexOf("\n", index),
  ].filter((boundary) => boundary >= 0);
  return [start, end.length ? Math.min(...end) : text.length];
}

function prNumbers(text) {
  return new Set(
    [...text.matchAll(/\b(?:PR|pull request)\s*#?(\d+)\b/gi)].map(
      (match) => match[1],
    ),
  );
}

function prNumbersNearMatch(text, match) {
  const direct = prNumbers(match[0]);
  if (direct.size > 0) return direct;

  const start = match.index;
  const end = start + match[0].length;
  const references = [
    ...text.matchAll(/\b(?:PR|pull request)\s*#?(\d+)\b/gi),
  ].map((reference) => ({
    number: reference[1],
    distance:
      reference.index > end
        ? reference.index - end
        : start > reference.index + reference[0].length
          ? start - (reference.index + reference[0].length)
          : 0,
  }));
  const nearestDistance = Math.min(
    ...references.map(({ distance }) => distance),
  );
  return new Set(
    references
      .filter(({ distance }) => distance === nearestDistance && distance <= 100)
      .map(({ number }) => number),
  );
}

function sameShipment(leftPrs, rightPrs) {
  if (leftPrs.size === 0 || rightPrs.size === 0) {
    return leftPrs.size === 0 && rightPrs.size === 0;
  }
  return [...leftPrs].some((number) => rightPrs.has(number));
}

function shipStopPrNumbers(text, stopMatch) {
  const direct = prNumbers(stopMatch[0]);
  if (direct.size > 0) return direct;

  const stopEnd = stopMatch.index + stopMatch[0].length;
  const optOut = shipOptOutMatches(text)
    .map(({ match }) => match)
    .find((match) => match.index >= stopEnd);
  const stopContext = optOut === undefined ? text : text.slice(0, optOut.index);
  const beforeOptOut = prNumbersNearMatch(stopContext, stopMatch);
  if (beforeOptOut.size > 0 || optOut === undefined) return beforeOptOut;

  const afterOptOut = text.slice(optOut.index + optOut[0].length);
  return prNumbersNearMatch(afterOptOut, { 0: "", index: 0 });
}

function shipOptOutMatches(text, previousShipmentPrs = new Set()) {
  const matches = [
    ...text.matchAll(new RegExp(SHIP_AFFIRMATIVE_OPT_OUT_RE.source, "gi")),
    ...text.matchAll(new RegExp(SHIP_DIRECT_LEAVE_OPEN_RE.source, "gi")),
  ].sort((left, right) => left.index - right.index);
  return matches.map((match) => {
    const directPrs = prNumbers(match[0]);
    const afterOptOut = text.slice(match.index + match[0].length);
    const nearestPrs = prNumbersNearMatch(text, match);
    const correction = afterOptOut.match(
      /^\s*[,;—-]?\s*(?:no,\s*)?not\s+(?:the\s+)?(?:PR|pull request)\s*#?(\d+)\s*,?\s*(?:but|rather)\s+(?:the\s+)?(?:PR|pull request)\s*#?(\d+)\b/i,
    );
    const correctedPrs =
      correction && nearestPrs.has(correction[1])
        ? new Set([correction[2]])
        : undefined;
    const prs = correctedPrs ?? nearestPrs;
    const mentionsDifferentWork =
      /\b(?:separate|another|other|different)\s+(?:deploy(?:ment)?|PR|pull request|shipment|work|project)\b/i.test(
        match[0],
      ) ||
      /^\s+(?:(?:a|an|the)\s+)?(?:separate|another|other|different)\s+(?:deploy(?:ment)?|PR|pull request|shipment|work|project)\b/i.test(
        afterOptOut,
      ) ||
      /^\s+(?:for|to|about|regarding)\s+(?:(?:a|an|the)\s+)?(?:separate|another|other|different)\s+(?:deploy(?:ment)?|PR|pull request|shipment|work|project)\b/i.test(
        afterOptOut,
      );
    const refersBackToShipment =
      previousShipmentPrs.size === 1 &&
      directPrs.size === 0 &&
      correctedPrs === undefined &&
      !mentionsDifferentWork &&
      /(?:\bleave\s+it\s+(?:open|unmerged)\b|\b(?:don['’]?t|do not)\s+merge\s+it\b|\b(?:opted\s+out\s+of|declined)\s+(?:the\s+)?merg\w*)/i.test(
        match[0],
      );
    const attributedPrs =
      mentionsDifferentWork && directPrs.size === 0
        ? directPrs
        : refersBackToShipment
          ? previousShipmentPrs
          : prs;
    return {
      match,
      sentence: text,
      prs: attributedPrs,
    };
  });
}

function hasFalseOptOutDenial(optOut) {
  const { match: optOutMatch, sentence: optOutSentence } = optOut;
  if (SHIP_AGENT_ATTRIBUTED_OPT_OUT_RE.test(optOutSentence)) {
    return true;
  }

  const denials = [
    ...optOutSentence.matchAll(
      new RegExp(SHIP_FALSE_OPT_OUT_BEFORE_RE.source, "gi"),
    ),
  ];
  if (
    denials.some((denial) =>
      sameShipment(prNumbersNearMatch(optOutSentence, denial), optOut.prs),
    )
  ) {
    return true;
  }

  const denialTail = optOutSentence.slice(
    optOutMatch.index + optOutMatch[0].length,
  );
  const afterOptOut = optOut.afterSentence;
  const afterOptOutPrs = prNumbers(afterOptOut);
  return (
    SHIP_FALSE_OPT_OUT_AFTER_RE.test(denialTail) ||
    SHIP_FALSE_OPT_OUT_CLAIM_RE.test(denialTail) ||
    SHIP_FALSE_OPT_OUT_FOLLOWUP_RE.test(denialTail) ||
    ((sameShipment(afterOptOutPrs, optOut.prs) ||
      (afterOptOutPrs.size === 0 && optOut.prs.size === 1)) &&
      SHIP_FALSE_OPT_OUT_FOLLOWUP_RE.test(afterOptOut))
  );
}

function isShipStoppedBeforeMerge(text) {
  for (const match of text.matchAll(SHIP_STOPPED_BEFORE_MERGE_ALL_RE)) {
    const [start, end] = sentenceBoundsAt(text, match.index);
    const sentence = text.slice(start, end);
    const previousSentenceStart =
      start > 0 ? sentenceBoundsAt(text, start - 1)[0] : start;
    const previousSentence = text.slice(previousSentenceStart, start).trim();
    let nextStart = end < text.length ? end + 1 : end;
    while (/\s/.test(text[nextStart] ?? "")) nextStart++;
    const [nextSentenceStart, nextSentenceEnd] = sentenceBoundsAt(
      text,
      nextStart,
    );
    const nextSentence = text.slice(nextSentenceStart, nextSentenceEnd).trim();
    let followingStart =
      nextSentenceEnd < text.length ? nextSentenceEnd + 1 : nextSentenceEnd;
    while (/\s/.test(text[followingStart] ?? "")) followingStart++;
    const [, followingSentenceEnd] = sentenceBoundsAt(text, followingStart);
    const followingSentence = text
      .slice(followingStart, followingSentenceEnd)
      .trim();
    let fourthStart =
      followingSentenceEnd < text.length
        ? followingSentenceEnd + 1
        : followingSentenceEnd;
    while (/\s/.test(text[fourthStart] ?? "")) fourthStart++;
    const [, fourthSentenceEnd] = sentenceBoundsAt(text, fourthStart);
    const fourthSentence = text.slice(fourthStart, fourthSentenceEnd).trim();
    const stopMatch = {
      0: match[0],
      index: match.index - start,
    };
    const stopPrs = shipStopPrNumbers(sentence, stopMatch);

    const optOutMatch = [
      ...shipOptOutMatches(
        previousSentence,
        prNumbers(previousSentence).size === 0 ? stopPrs : new Set(),
      )
        .filter(
          (optOut) =>
            stopPrs.size > 0 &&
            optOut.prs.size > 0 &&
            sameShipment(stopPrs, optOut.prs),
        )
        .map((optOut) => ({ ...optOut, afterSentence: sentence })),
      ...shipOptOutMatches(sentence, stopPrs).map((optOut) => ({
        ...optOut,
        afterSentence: nextSentence,
      })),
      ...shipOptOutMatches(
        nextSentence,
        prNumbers(nextSentence).size === 0 ? stopPrs : new Set(),
      ).map((optOut) => ({ ...optOut, afterSentence: followingSentence })),
      ...shipOptOutMatches(followingSentence)
        .filter(
          (optOut) =>
            stopPrs.size > 0 &&
            optOut.prs.size > 0 &&
            sameShipment(stopPrs, optOut.prs),
        )
        .map((optOut) => ({ ...optOut, afterSentence: fourthSentence })),
    ].find((optOut) => sameShipment(stopPrs, optOut.prs));

    if (!optOutMatch) return true;
    if (hasFalseOptOutDenial(optOutMatch)) {
      return true;
    }
  }

  return false;
}

const SHIP_STOPPED_BEFORE_MERGE_RE = { test: isShipStoppedBeforeMerge };

const CREDENTIAL_NAMESPACE_SIGNAL = String.raw`(?:mismatched?[ -]pairs?|GOOGLE_SIGN_IN_[A-Z_]+)`;
const CREDENTIAL_CORRECTION_CONTEXT = String.raw`(?:wrong|incorrect|mistaken|mistake|not the (?:fix|pair)|changes? nothing|changed nothing|didn['’]?t (?:fix|change)|fixed the wrong|repair\w*|rotat\w*|regenerat\w*|replac\w*|don't|do not|stop|never|avoid)`;
// A bare namespace mention is routine documentation. Count it only when the
// same sentence also says the repair was wrong or describes a repair action.
const CREDENTIAL_NAMESPACE_RE = new RegExp(
  [
    String.raw`\b${CREDENTIAL_NAMESPACE_SIGNAL}\b[^.!?]{0,120}\b${CREDENTIAL_CORRECTION_CONTEXT}\b`,
    String.raw`\b${CREDENTIAL_CORRECTION_CONTEXT}\b[^.!?]{0,120}\b${CREDENTIAL_NAMESPACE_SIGNAL}\b`,
  ].join("|"),
  "i",
);

const CREDENTIAL_REGEX_CASES = [
  [
    true,
    "Do not rotate the key because the mismatched pairs identify different clients.",
  ],
  [
    true,
    "The GOOGLE_SIGN_IN_CLIENT_SECRET was repaired instead of the active provider pair.",
  ],
  [true, "The mismatched pair was the wrong fix and changed nothing."],
  [false, "Check mismatched pairs before changing credentials."],
  [false, "GOOGLE_SIGN_IN_CLIENT_ID identifies the sign-in client."],
  [false, "Mismatched pairs can be intentional on a host."],
];

const DESIGN_FEEDBACK_SCOPE_RE =
  /\b(?:design|visual|ui|ux)\b[^.!?\n]{0,80}\b(?:out of scope|not in scope|skip\w*|ignor\w*|rule|gate|blocked)\b|\b(?:out of scope|not in scope|skip\w*|ignor\w*|rule|gate|blocked)\b[^.!?\n]{0,80}\b(?:design|visual|ui|ux)\b/i;

const DESIGN_FEEDBACK_REGEX_CASES = [
  [true, "Remove that design rule. I want you fixing design things."],
  [true, "Why are these visual issues out of scope?"],
  [true, "Don't ignore the UI polish feedback."],
  [false, "Fix the Design gradient fill bug."],
  [false, "The design needs a little more contrast."],
];

const FEEDBACK_EYES_RE =
  /(?:\b(?:no|not|zero|without|missing)\b[^.!?]{0,80}(?:\beyes?\b|👀)|\b(?:put|add|place|react|mark)\b[^.!?]{0,80}(?:\beyes?\b|👀)|\b(?:remove|clear|take off)\b[^.!?]{0,80}(?:\beyes?\b|👀)[^.!?]{0,80}\b(?:confiden\w*|sure|fix\w*)\b)/i;

const FEEDBACK_EYES_REGEX_CASES = [
  [true, "There's not a single eye emoji on anything."],
  [true, "Put eye emoji on it and fix the bug."],
  [true, "Remove eye emoji if you're not confident you can fix it."],
  [false, "I like the eyes emoji."],
  [false, "One eye emoji is already on the bug."],
  [false, "Fixed, add a checkmark."],
];

const PR_REVIEW_HANDOFF_SUBJECTS = String.raw`(?:(?:your|our|this|my|the)\s+)?(?:handoff|recap|summary|report|output|review)`;
const PR_REVIEW_HANDOFF_DETAILS = [
  String.raw`which\s+(?:PRs?|pull\s+requests?)\s+(?:were|are)\s+ready(?:\s+to\s+merge)?`,
  String.raw`(?:(?:the|a|an)\s+)?merge[- ]readiness(?:\s+(?:recommendation|status))?`,
  String.raw`(?:(?:the|an?)\s+)?(?:(?:drafts?\s+)?(?:(?:author[- ]facing|author)\s+)?repl(?:y|ies)(?:\s+drafts?)?|drafts?\s+(?:(?:author[- ]facing)\s+)?comments?(?:\s+drafts?)?|author[- ]facing\s+comments?(?:\s+drafts?)?)`,
  String.raw`(?:the\s+)?(?:(?:UI|UX)\s+)?screenshots?(?:\s+(?:for|of|showing)\s+(?:(?:the\s+)?(?:changed\s+)?(?:UI|UX)|changes?|updated interface|changed interface))?`,
  String.raw`(?:whether|if)\s+(?:(?:the\s+)?(?:UI|UX)\s+|the\s+)?screenshots?\s+(?:were|are|was|is)\s+(?:present|available|attached|included)`,
  String.raw`(?:whether|if)\s+(?:(?:the|a|any|all|which|these|those)\s+)?(?:PRs?|pull\s+requests?)\s+(?:were|are|was|is)\s+ready(?:\s+to\s+merge)?`,
  String.raw`(?:the\s+)?review\s+(?:disposition|status)|(?:the\s+)?approval\s+status|(?:whether|if)\s+(?:(?:the|a)\s+)?(?:PRs?|pull\s+requests?)\s+(?:were|are|was|is)\s+(?:approved|not approved|skipped)`,
  String.raw`(?:the\s+)?screenshot(?:s)?\s+(?:availability|presence|status|disposition|evidence|available|present|attached|included)`,
].join("|");
const PR_REVIEW_HANDOFF_MISS_ACTIONS = [
  String.raw`(?:didn['’]?t|did not)\s+(?:say|state|report|mention|include|note)\s+(?:${PR_REVIEW_HANDOFF_DETAILS})`,
  String.raw`(?:didn['’]?t|did not)\s+(?:ask(?:\s+for)?|request|draft|write|prepare|provide)\s+(?:${PR_REVIEW_HANDOFF_DETAILS})`,
  String.raw`missed\s+(?:asking\s+for|saying|reporting|mentioning|including|requesting|drafting|writing|preparing|providing)\s+(?:${PR_REVIEW_HANDOFF_DETAILS})`,
  String.raw`(?:forgot|failed)\s+to\s+(?:say|state|report|mention|include|note|ask(?:\s+for)?|request|draft|write|prepare|provide)\s+(?:${PR_REVIEW_HANDOFF_DETAILS})`,
  String.raw`(?:left out|left off|omitted|(?:was|is|were|are)\s+missing)\s+(?:${PR_REVIEW_HANDOFF_DETAILS})`,
].join("|");
const PR_REVIEW_HANDOFF_RE = new RegExp(
  [
    String.raw`\b(?:you|we|${PR_REVIEW_HANDOFF_SUBJECTS})\b[^.!?]{0,80}\b(?:${PR_REVIEW_HANDOFF_MISS_ACTIONS})\b`,
    String.raw`\b(?:you|we)\s+missed\s*:\s*(?:\r?\n\s*[-*]\s*)+(?:${PR_REVIEW_HANDOFF_DETAILS})\b`,
    String.raw`\b(?:you|we)\s+(?:marked|called|classified)\s+(?:it|the\s+PR|the\s+pull\s+request)\s+(?:as\s+)?ready\b[^.!?]{0,80}\b(?:despite|although|without|ignoring)\b[^.!?]{0,40}\b(?:unresolved|active)\s+(?:human\s+)?(?:review|feedback|comments?|change requests?)\b`,
    String.raw`\b(?:you|we)\s+(?:sent|posted|drafted|added|left)\s+another\s+(?:author[- ]facing\s+)?(?:comment|reply|follow[- ]?up)[^.!?]{0,120}(?:prior|previous|earlier|last)\s+(?:Steve\s+)?(?:request|comment|ask)[^.!?]{0,80}(?:unanswered|unaddressed|still\s+outstanding|has(?:n['’]?t|\s+not)\s+been\s+addressed)`,
    String.raw`\b(?:you|we)\s+(?:commented|replied|followed\s+up)\s+again[^.!?]{0,120}(?:unanswered|unaddressed|still\s+outstanding)[^.!?]{0,80}(?:prior|previous|earlier|last)\s+(?:Steve\s+)?(?:request|comment|ask)`,
    String.raw`\b(?:you|we)\s+(?:commented|replied|followed\s+up)\s+again[^.!?]{0,80}(?:prior|previous|earlier|last)\s+(?:Steve\s+)?(?:request|comment|ask)[^.!?]{0,80}(?:unanswered|unaddressed|still\s+outstanding)`,
    String.raw`\b(?:do\s+not|don't|never|avoid)\s+(?:post|draft|send|leave)\s+(?:(?:another|additional|further)\s+(?:author[- ]facing\s+)?(?:comment|reply|follow[- ]?up)|a\s+follow[- ]?up)[^.!?]{0,120}(?:until|while)[^.!?]{0,100}(?:contributor|author|they)[^.!?]{0,80}(?:update|respond|reply|address)[^.!?]{0,80}(?:Steve['’]s?\s+)?(?:outstanding|prior|previous|unanswered)?\s*(?:request|comment|ask)`,
    String.raw`\b(?:you|we)\s+should\s+have\s+waited[^.!?]{0,120}(?:contributor|author|they)[^.!?]{0,80}(?:update|respond|reply|address)[^.!?]{0,80}(?:Steve['’]s?\s+)?(?:outstanding|prior|previous|unanswered)?\s*(?:request|comment|ask)[^.!?]{0,80}(?:before|for)\s+(?:a\s+)?follow[- ]?up`,
    String.raw`\b(?:the\s+)?(?:UI\s+)?screenshots?\s+(?:status|availability|presence|disposition)\s+(?:was|were|is|are)\s+(?:omitted|missing|not\s+(?:reported|included|mentioned))\b`,
    String.raw`\b(?:the\s+)?(?:${PR_REVIEW_HANDOFF_DETAILS})\s+(?:was|were|is|are)\s+(?:omitted|missing|not\s+(?:reported|included|mentioned))\b`,
  ].join("|"),
  "i",
);

const PR_REVIEW_HANDOFF_REGEX_CASES = [
  [
    true,
    "You didn't say which PRs were ready to merge or draft replies for the updates.",
  ],
  [true, "You missed asking for screenshots of the UI changes."],
  [true, "You left out screenshots of the UX."],
  [true, "The handoff forgot to say which PRs were ready to merge."],
  [true, "You didn't request screenshots for the UI changes."],
  [true, "You didn't draft an author reply."],
  [true, "You didn't draft author replies."],
  [true, "The handoff omitted the draft reply."],
  [true, "You forgot to draft a reply."],
  [true, "You didn't include a merge-readiness recommendation."],
  [true, "You failed to report a merge-readiness status."],
  [true, "You didn't include screenshots of the changed UI."],
  [true, "You failed to include screenshots of changed UX."],
  [true, "The recap omitted the review disposition."],
  [true, "You didn't report whether the PR was approved."],
  [true, "You didn't say which pull requests were ready to merge."],
  [true, "You did not say which PRs were ready to merge."],
  [true, "You didn't say whether the UI screenshots were present."],
  [true, "You omitted whether screenshots were present."],
  [true, "You left out screenshot availability."],
  [true, "You forgot to mention whether the screenshots were attached."],
  [true, "You left out the screenshot status."],
  [true, "You omitted the merge-readiness recommendation."],
  [true, "The handoff left out the screenshot disposition."],
  [true, "You marked it ready despite an unresolved human change request."],
  [true, "You sent another comment while my prior request was unanswered."],
  [
    true,
    "Do not post another author-facing reply until the contributor addresses Steve's outstanding request.",
  ],
  [
    true,
    "Do not post a follow-up until the contributor addresses Steve's outstanding request.",
  ],
  [
    true,
    "You should have waited for the author to address my previous request before a follow-up.",
  ],
  [true, "You commented again even though my prior ask was still unaddressed."],
  [true, "You forgot to include the UI screenshots."],
  [true, "You didn't ask for UI screenshots."],
  [true, "You didn't provide screenshots."],
  [true, "You forgot to say whether the PR was ready to merge."],
  [true, "You failed to report whether PRs were ready to merge."],
  [true, "You omitted the author-facing reply draft."],
  [true, "You failed to report screenshot availability."],
  [true, "The recap omitted the merge-readiness recommendation."],
  [true, "The recap did not say whether screenshots were present."],
  [true, "You didn't explain the blocker. The screenshot status was omitted."],
  [
    true,
    "You failed to wait for Steve's request. The handoff omitted screenshot status.",
  ],
  [
    true,
    "You failed to wait for Steve's request. The handoff was missing screenshot status.",
  ],
  [true, "Your recap omitted the merge-readiness recommendation."],
  [true, "The review failed to report screenshot availability."],
  [true, "The handoff was missing screenshot status."],
  [true, "The recap was missing the merge-readiness recommendation."],
  [true, "Handoff omitted which PRs were ready to merge."],
  [true, "Handoff was missing screenshot status."],
  [true, "Review omitted the merge-readiness status."],
  [
    true,
    "You missed:\n- which PRs were ready to merge\n- the author-facing reply draft",
  ],
  [false, "Please tell me which PRs are ready to merge and draft replies."],
  [false, "This PR updates the UI and includes screenshots."],
  [false, "Please provide screenshots with your PR."],
  [
    false,
    "You didn't include comments from the review thread in the issue summary.",
  ],
  [false, "I would like screenshots for new UX changes."],
  [
    false,
    "Don't draft author replies for internal PRs; include screenshot status in the recap.",
  ],
  [
    false,
    "You should draft a follow-up after the contributor addresses Steve's prior request and include screenshot status in the recap.",
  ],
  [
    false,
    "You need to draft a follow-up after the contributor addresses Steve's request. Include screenshot status in the recap.",
  ],
  [
    false,
    "You didn't fix the failing test. Please tell me which PRs are ready to merge.",
  ],
  [
    false,
    "You didn't fix the failing test, and please tell me which PRs are ready to merge.",
  ],
  [
    false,
    "You forgot the release note, but please provide screenshots with your PR.",
  ],
  [
    false,
    "Please wait for the contributor to update before drafting another comment.",
  ],
  [false, "The author addressed my prior request in a new commit."],
  [
    false,
    "You drafted another reply after Steve's prior request was addressed in the latest commit.",
  ],
  [
    false,
    "Do not post a follow-up after the contributor addressed Steve's request.",
  ],
  [
    false,
    "You classified the PR as ready to merge and included screenshot status.",
  ],
];

const SHIPPING_CHURN_REGEX_CASES = [
  [true, "don't merge main 100 times unless there is a clear conflict."],
  [true, "Stop merging main unless there is a real conflict."],
  [true, "only push up commits if there are clear CI errors or PR feedback."],
  [true, "Do not create or push a routine chore: publish branch work commit."],
  [true, "I don't want those chore commits unless absolutely necessary."],
  [true, "Do not run ship:push on a clean or merely behind branch."],
  [true, "Stop updating or syncing the branch from main unless conflicting."],
  [true, "Stop creating generic ship commits unless CI requires them."],
  [true, "Do not merge `main` into every PR unless there is a conflict."],
  [false, "Don't forget to merge main when everything is green."],
  [false, "The build completed successfully."],
  [false, "The branch contains a useful chore commit."],
  [false, "Only commit relevant changes."],
  [false, "Do not merge main when every required check passes."],
  [false, "Should we merge main after the checks pass?"],
  [
    false,
    "Do not commit or push changes unless they belong to this requested fix.",
  ],
  [false, "Do not merge main after CI passes."],
  [false, "Do not merge main. The branch contains a routine chore commit."],
  [true, "Do not push routine commits."],
  [true, "Do not push commits routinely."],
];

const BABYSIT_LEASE_BLOCKS_WORK_REGEX_CASES = [
  [true, "Codex couldn't renew the PR lease and then stopped working."],
  [true, "Codex couldn't renew the PR lease, so it stopped."],
  [true, "I told the threads to finish shipping and ignore the lease stuff."],
  [
    true,
    "I had to tell at the threads to finish shipping and ignore the lease stuff.",
  ],
  [
    false,
    "I did not ask the threads to finish shipping and ignore lease stuff.",
  ],
  [false, "Don't ask the threads to finish shipping and ignore lease stuff."],
  [
    true,
    "Codex sessions couldn't get leases or lease renewal so would just stop.",
  ],
  [false, "The PR lease coordinates durable watchers."],
  [false, "The lease failed, but this task continued in the foreground."],
  [false, "A file lock prevented the build from running."],
  [false, "Codex could not renew the lease, so it did not stop."],
  [
    false,
    "Codex couldn't renew the lease, so it stopped because GitHub was down.",
  ],
  [false, "Codex couldn't renew the lease; it stopped because CI failed."],
  [false, "If Codex could not renew the lease, then stop working."],
  [false, "Work stopped because GitHub was down after the lease expired."],
  [false, "The lease failed, so work stopped because GitHub was down."],
  [
    false,
    "The lease expired then the task stopped because CI was unavailable.",
  ],
  [
    false,
    "Work stopped because the lease expired, but GitHub was the actual cause.",
  ],
  [false, "The lease blocked no work."],
  [false, "No active lease prevented the task from continuing."],
  [false, "Work stopped, not because of the lease."],
  [false, "Work was not stopped because the lease expired."],
];

const STALE_PR_WATCHER_REGEX_CASES = [
  [true, "PR #6329 is merged; please stop this scheduled task."],
  [
    true,
    "These pointless scheduled tasks repeat the same status; remove them.",
  ],
  [true, "Stop the duplicate ship-watchdog heartbeat."],
  [true, "Please cancel the PR babysitter."],
  [true, "Please disable the babysitter for PR #6329."],
  [false, "Please check back every hour until deployment."],
  [false, "The merged PR has not deployed yet."],
  [false, "Run one scan of open PRs."],
  [false, "Disable the heartbeat for my weekly report."],
  [false, "Stop this scheduled dashboard refresh."],
  [false, "These scheduled tasks are pointless."],
];

const SHIP_STOPPED_BEFORE_MERGE_REGEX_CASES = [
  [
    true,
    "These are all threads I told to /ship, but I still have to run /ship-watchdog every morning.",
  ],
  [
    false,
    "They just stop after opening the PR; keep checking CI and review until merged.",
  ],
  [
    true,
    "They just stop after opening the PR; /ship should keep checking until merged.",
  ],
  [false, "Do not stop /ship until the PR is merged."],
  [true, "I had to tell the agent to keep /ship running."],
  [false, "Please tell the agent to keep /ship running until the checks pass."],
  [true, "I told /ship to merge the pull request, but it never did."],
  [true, "I asked /ship to merge PR #123, but the merge never happened."],
  [true, "I asked /ship to merge PR #123, but it never happened."],
  [true, "/ship stopped without merging PR #123."],
  [
    false,
    "/ship stopped without merging PR #123 because I asked to leave PR #123 open.",
  ],
  [
    true,
    "I asked /ship to merge PR #123, but it merely opened the PR and returned.",
  ],
  [
    false,
    "I asked /ship to merge PR #123, and it opened the PR while CI runs; it will merge after the checks pass.",
  ],
  [true, "I already asked: do not stop /ship until the PR is merged."],
  [true, "The agent ended /ship before the PR was merged."],
  [true, "Why did /ship finish before merging the pull request?"],
  [true, "The agent reported /ship complete but left the PR open."],
  [
    false,
    "The agent reported /ship complete but left the PR open because I asked to leave it open; ship_mode=ready-only.",
  ],
  [
    false,
    "The agent reported /ship complete but left the PR open because I asked for ship_mode=ready-only.",
  ],
  [
    true,
    "The agent set ship_mode=ready-only without my approval and stopped /ship while the PR was open.",
  ],
  [
    false,
    "The agent stopped /ship with the pull request unmerged because I explicitly opted out of merging.",
  ],
  [
    false,
    "The agent stopped /ship with PR #123 unmerged because I said don’t merge PR #123.",
  ],
  [
    false,
    "The agent stopped /ship with the pull request unmerged because I asked to leave it open while PR #123 waits for CI.",
  ],
  [
    false,
    "The agent stopped /ship with PR #123 unmerged. I explicitly opted out of merging.",
  ],
  [
    true,
    "The agent stopped /ship with the pull request unmerged because it claimed I asked it to leave the PR open, but I did not.",
  ],
  [
    true,
    "The agent stopped /ship with PR #123 unmerged because it claimed I told it to leave PR #123 open.",
  ],
  [
    true,
    "The agent stopped /ship with PR #123 unmerged because it thought I said don’t merge PR #123, but I had asked /ship to merge it.",
  ],
  [
    true,
    "The agent stopped /ship with the pull request unmerged because it claimed I asked it to leave the PR open, which I did not.",
  ],
  [
    true,
    "The agent stopped /ship with the pull request unmerged because it claimed I asked to leave the PR open. I did not.",
  ],
  [
    true,
    "The agent stopped /ship with the pull request unmerged because it falsely claimed I explicitly asked to leave the PR open, then explained that several checks were green, no reviewer had replied, the worktree was clean, no merge command had run, and the original instruction still asked the agent to watch until merge. That is false; I asked for the opposite.",
  ],
  [
    true,
    "Although I did not ask to leave the PR open, the agent stopped /ship with the pull request unmerged because it claimed I explicitly asked to leave the PR open.",
  ],
  [
    true,
    "The agent stopped /ship with the pull request unmerged because a reviewer asked to leave the PR open.",
  ],
  [
    true,
    "The agent stopped /ship with PR #123 unmerged. I explicitly asked to leave PR #456 open.",
  ],
  [
    true,
    "The agent stopped /ship with PR #123 unmerged. CI passed and no comments were pending. I explicitly asked to leave PR #456 open.",
  ],
  [
    true,
    "The agent stopped /ship with PR #123 unmerged. I asked to leave it open for the separate deploy.",
  ],
  [
    true,
    "The agent stopped /ship with PR #123 unmerged because I asked it not to merge a separate PR.",
  ],
  [
    true,
    "The agent stopped /ship with the PR unmerged. I explicitly asked to leave PR #456 open.",
  ],
  [
    false,
    "The agent stopped /ship with PR #123 unmerged. I explicitly asked to leave it open.",
  ],
  [
    false,
    "The agent stopped /ship with PR #123 unmerged. I explicitly said don’t merge it.",
  ],
  [
    false,
    "The agent stopped /ship with PR #123 unmerged. I explicitly asked to leave PR #123 open.",
  ],
  [
    true,
    "The agent stopped /ship with PR #123 unmerged because I explicitly asked to leave PR #123 open—not PR #123, but PR #456.",
  ],
  [
    false,
    "The agent stopped /ship with PR #123 unmerged because I explicitly asked to leave PR #123 open—not PR #456, but PR #123.",
  ],
  [
    false,
    "The agent stopped /ship with PR #123 unmerged because I explicitly asked to leave it open while I checked PR #456.",
  ],
  [
    false,
    "The agent stopped /ship with PR #123 unmerged because I explicitly asked to leave it open while I checked a separate PR #456.",
  ],
  [
    false,
    "The agent stopped /ship with PR #123 unmerged. Please leave PR #123 open.",
  ],
  [
    false,
    "The agent stopped /ship with PR #123 unmerged. CI passed and no comments were pending. I explicitly asked to leave PR #123 open.",
  ],
  [
    false,
    "I asked to leave PR #123 open. The agent stopped /ship with PR #123 unmerged.",
  ],
  [
    false,
    "I explicitly asked to leave it open. The agent stopped /ship with PR #123 unmerged.",
  ],
  [
    true,
    "I explicitly asked to leave it open while I checked PR #456. The agent stopped /ship with PR #123 unmerged.",
  ],
  [
    true,
    "The agent stopped /ship with PR #123 unmerged. I explicitly asked to leave it open—not PR #123, but PR #456.",
  ],
  [
    true,
    "I asked to leave PR #456 open. The agent stopped /ship with PR #123 unmerged.",
  ],
  [
    false,
    "The agent stopped /ship with PR #123 unmerged. I said to leave PR #123 open.",
  ],
  [
    false,
    "The agent stopped /ship with PR #123 unmerged. Please don’t merge PR #123.",
  ],
  [false, "The agent stopped /ship with PR 123 unmerged. Keep PR 123 open."],
  [
    true,
    "The agent stopped /ship with PR 123 unmerged. I explicitly asked to leave PR 456 open.",
  ],
  [
    true,
    "The agent stopped /ship with PR #123 unmerged. A reviewer said “Please don’t merge PR #123.”",
  ],
  [
    true,
    "The agent stopped /ship with PR #123 unmerged because I asked to leave the PR open for PR #456.",
  ],
  [
    true,
    "The agent stopped /ship with the pull request unmerged because I asked to leave PR #456 open while PR #123 waits for CI.",
  ],
  [
    true,
    "The agent stopped /ship with PR #123 unmerged. It claimed I asked to leave it open. That is false.",
  ],
  [
    false,
    "The agent stopped /ship with PR #123 unmerged because I explicitly asked to leave PR #123 open, but I did not expect the tests to fail.",
  ],
  [
    true,
    "The agent stopped /ship with PR #123 unmerged because it claimed I explicitly asked to leave PR #123 open, but that was false.",
  ],
  [
    true,
    "The agent stopped /ship with PR #123 unmerged because it claimed I asked to leave PR #123 open, but I never authorized that.",
  ],
  [
    true,
    "The agent stopped /ship with PR #456 unmerged because I explicitly asked to leave it open. The agent stopped /ship with PR #123 unmerged without my approval.",
  ],
  [false, "Ready-only shipment: the PR stayed open after checks passed."],
  [true, "The agent stopped /ship with the pull request unmerged."],
  [
    false,
    "The agent finished implementing the fix, but the PR is still open for review.",
  ],
  [false, "They stopped after opening the PR so I can review it."],
  [
    true,
    "I had to remind the agent to keep /ship running until the PR merged.",
  ],
  [true, "/ship stopped while the PR is still open."],
  [false, "I have to run /ship-watchdog every day."],
  [
    true,
    "I have to run /ship-watchdog because /ship stopped after opening the PR.",
  ],
  [
    true,
    "These are all threads I told to [$ship], yet I have to run [$ship-watchdog] every day.",
  ],
  [
    true,
    "I had to remind the agent to keep [$ship] running until the PR merged.",
  ],
  [false, "Please run /ship and merge once CI is green."],
  [false, "Please run [$ship] and merge once CI is green."],
  [false, "Run /ship on the remaining changes."],
  [false, "The pull request is still open while CI runs."],
  [false, "Ship the feature and stop when its tests pass."],
  [false, "/ship should merge the PR once all required checks pass."],
  [false, "The agent can stop after the PR has merged."],
  [
    false,
    "The PR is still open; I asked you to stop changing unrelated files.",
  ],
];

if (process.argv.includes("--self-test")) {
  const failures = FEEDBACK_REGEX_CASES.filter(
    ([expected, message]) =>
      UNANSWERED_FEEDBACK_FOLLOWUP_RE.test(message) !== expected,
  );
  failures.push(
    ...SHIPPING_CHURN_REGEX_CASES.filter(
      ([expected, message]) => SHIPPING_CHURN_RE.test(message) !== expected,
    ),
  );
  failures.push(
    ...BABYSIT_LEASE_BLOCKS_WORK_REGEX_CASES.filter(
      ([expected, message]) =>
        BABYSIT_LEASE_BLOCKS_WORK_RE.test(message) !== expected,
    ),
  );
  failures.push(
    ...STALE_PR_WATCHER_REGEX_CASES.filter(
      ([expected, message]) => STALE_PR_WATCHER_RE.test(message) !== expected,
    ),
  );
  failures.push(
    ...SHIP_STOPPED_BEFORE_MERGE_REGEX_CASES.filter(
      ([expected, message]) =>
        SHIP_STOPPED_BEFORE_MERGE_RE.test(message) !== expected,
    ),
  );
  failures.push(
    ...CREDENTIAL_REGEX_CASES.filter(
      ([expected, message]) =>
        CREDENTIAL_NAMESPACE_RE.test(message) !== expected,
    ),
  );
  failures.push(
    ...DESIGN_FEEDBACK_REGEX_CASES.filter(
      ([expected, message]) =>
        DESIGN_FEEDBACK_SCOPE_RE.test(message) !== expected,
    ),
  );
  failures.push(
    ...FEEDBACK_EYES_REGEX_CASES.filter(
      ([expected, message]) => FEEDBACK_EYES_RE.test(message) !== expected,
    ),
  );
  failures.push(
    ...PR_REVIEW_HANDOFF_REGEX_CASES.filter(
      ([expected, message]) => PR_REVIEW_HANDOFF_RE.test(message) !== expected,
    ),
  );
  if (failures.length > 0) {
    console.error("Feedback regex self-test failed:", failures);
    process.exitCode = 1;
  } else {
    console.log(
      `Friction regex self-test passed (${FEEDBACK_REGEX_CASES.length + SHIPPING_CHURN_REGEX_CASES.length + BABYSIT_LEASE_BLOCKS_WORK_REGEX_CASES.length + STALE_PR_WATCHER_REGEX_CASES.length + SHIP_STOPPED_BEFORE_MERGE_REGEX_CASES.length + CREDENTIAL_REGEX_CASES.length + DESIGN_FEEDBACK_REGEX_CASES.length + FEEDBACK_EYES_REGEX_CASES.length + PR_REVIEW_HANDOFF_REGEX_CASES.length} cases).`,
    );
  }
  process.exit(failures.length > 0 ? 1 : 0);
}

const PATTERNS = [
  {
    // Added 2026-09-02 after the Design E2E suite surfaced 63 failures that had
    // rotted for weeks: the suite ran post-merge only, so no fix ever had to
    // prove itself against a test that failed first.
    key: "no-failing-test-first",
    label: "Had to ask for a failing test before the fix",
    fixedBy:
      "guard:e2e-quarantine + templates/design/.agents/skills/design-editor-architecture (2026-09-02)",
    re: /\b(write|add).{0,24}(failing|red) test|test.{0,16}fail(s|ed)? first|where'?s the (failing )?test|no test for (this|that) (fix|bug)|prove it fails\b/i,
  },
  {
    // Added 2026-08-27 after the PR queue exposed routine main merges and
    // generic ship commits as a measurable source of CI churn.
    key: "shipping-churn",
    label: "Had to stop routine ship commits or main merges",
    fixedBy: ".agents/skills/ship + .agents/skills/babysit-pr (2026-08-27)",
    re: SHIPPING_CHURN_RE,
  },
  {
    key: "babysit-lease-blocks-work",
    label: "Had to ask for requested work to continue after a lease failure",
    fixedBy: ".agents/skills/babysit-pr foreground fallback (2026-09-25)",
    re: BABYSIT_LEASE_BLOCKS_WORK_RE,
  },
  {
    key: "stale-pr-watchers",
    label: "Had to stop a monitor after its PR was complete",
    fixedBy:
      ".agents/skills/babysit-pr + ship-watchdog (terminal-state and opt-in gates, 2026-09-23)",
    re: STALE_PR_WATCHER_RE,
  },
  {
    key: "branch-moves",
    label: "Unrequested branch creation / movement",
    fixedBy: ".agents/skills/new-branch (activation guard, 2026-07-28)",
    re: /\b(did you (make|create).*(new )?branch|don'?t (make|create).*branch|never.*(make|create).*branch|why.*new branch)\b/i,
  },
  {
    // Added 2026-09-11 after a user correction made clear the feedback scope
    // rule was treating concrete Design/UX feedback as out of scope.
    key: "design-feedback-scope",
    label: "Had to ask to act on design feedback",
    fixedBy:
      ".agents/skills/review-latest-feedback (design/UX scope, 2026-09-11)",
    re: DESIGN_FEEDBACK_SCOPE_RE,
  },
  {
    key: "false-done",
    label: "Reported done while still broken",
    fixedBy: ".agents/skills/verifying-changes (2026-07-31)",
    re: /\b(you (said|claimed) (you )?fixed|third time|still (broken|not working|happening)|didn'?t (actually )?(work|fix)|not (actually )?fixed)\b/i,
  },
  {
    key: "ssr-cache-regression",
    label: "Had to repeat the public SSR/SWR cache contract",
    fixedBy:
      "guard:ssr-cache-artifact + performance skill cache artifact contract (2026-08-20)",
    re: /\b(?:cache|caching|cache-control|stale-while-revalidate|SWR|CDN)\b[^.!?]{0,140}\b(?:wrong|broken|slow|again|regression|revert|reverted|no-cache|no-store|max-age=0|must-revalidate|fire|every few weeks)\b/i,
  },
  {
    key: "slow-list-query",
    label: "Reported a list/read that is slow in production",
    fixedBy:
      "guard:no-blob-column-predicate + performance skill heavy-column rule (2026-08-22)",
    // Anchored to a LIST/READ subject so an unrelated "the build is so slow"
    // does not inflate the count the guard is measured against.
    re: /\b(?:list|lists|query|queries|search|sidebar|dashboard|page|endpoint|request|chats?|threads?|results?|rows?|load(?:ing)?)\b[^.!?]{0,80}\b(?:takes? forever|so slow|insanely slow|really slow|super slow|\d+\s*(?:s|sec|seconds)\s*to\s*(?:load|populate|render))\b/i,
  },
  {
    key: "stopped-early",
    label: "Stopped mid-task / queued instead of doing",
    fixedBy: ".agents/skills/verifying-changes (2026-07-31)",
    re: /\b(stop stopping|keep stopping|why (did|do) you stop|don'?t stop|still queued|should be doing everything now)\b/i,
  },
  {
    key: "ship-stopped-before-merge",
    label: "Had to demand authorized /ship continue through merge",
    fixedBy:
      ".agents/skills/ship + babysit-pr (goal and blocking merge lifecycle, 2026-09-24)",
    re: SHIP_STOPPED_BEFORE_MERGE_RE,
  },
  {
    key: "cheap-model",
    label: "Told to delegate to a cheaper model",
    fixedBy: ".agents/skills/delegating-work (2026-07-31)",
    re: /\b(coding on the main thread|cheaper (sub ?agents?|models?)|use (sonnet|terra|luna|haiku)|not you,? the main thread|don'?t use (you|fable|opus))\b/i,
  },
  {
    key: "missed-siblings",
    label: "Had to ask whether sibling call sites were swept",
    fixedBy: ".agents/skills/fix-at-the-boundary (2026-07-31)",
    re: /\b(any other (apps?|providers?|templates?|places?)|other (apps?|templates?) (that )?do(es)? this|same (bug|issue|thing) (in|across)|sweep of other|fix that too)\b/i,
  },
  {
    key: "credential-wrong-namespace",
    label: "Had to stop a credential rotation that was the wrong fix",
    fixedBy:
      "pnpm check:google-redirect-uris (MISMATCHED-PAIRS remediation, 2026-08-29)",
    // The failure is repairing one namespace while the flow reads the other,
    // so the repair verifies clean and changes nothing.
    re: new RegExp(
      [
        String.raw`\b(?:don'?t|do not|stop|no need to|didn'?t need to)\b[^.!?]{0,60}\b(?:rotat\w+|regenerat\w+|new secret|another key|update the key)\b`,
        String.raw`\b(?:wrong|losing|stale) (?:key|secret|pair|namespace)\b`,
        CREDENTIAL_NAMESPACE_RE.source,
      ].join("|"),
      "i",
    ),
  },
  {
    key: "missed-localization",
    label: "Had to ask whether changed copy was translated",
    fixedBy: "guard:i18n-changed-copy + AGENTS.md review rule (2026-08-20)",
    re: /\b(?:forgot|missed|missing|stale|not updated|didn['’]?t update|update(?:d)?|add)\b[^.!?]{0,100}\b(?:translation|translations|locali[sz]ation|locale|i18n)\b|\b(?:translation|translations|locali[sz]ation|locale|i18n)\b[^.!?]{0,100}\b(?:forgot|missed|missing|stale|not updated|didn['’]?t update)\b/i,
  },
  {
    key: "unanswered-feedback-followup",
    label: "Had to ask whether unanswered feedback was rechecked",
    fixedBy: ".agents/skills/review-latest-feedback (2026-08-19)",
    // Keep this correction-specific: routine re-triage, answered-clarification,
    // eyes-only, and reporter-status text are not friction by themselves.
    re: UNANSWERED_FEEDBACK_FOLLOWUP_RE,
  },
  {
    key: "collision",
    label: "Agents clobbering each other in the shared checkout",
    fixedBy: ".agents/skills/concurrent-agents",
    re: /\b(collision|overwrit\w+|clobber\w*|reverted (my|our|their) work|lost (my|our) (work|edits)|another agent (is|was) (shipping|editing))\b/i,
  },
  {
    key: "repo-temp-files",
    label: "Had to clarify where repo-local temporary files belong",
    fixedBy: "AGENTS.md root .tmp/ rule (2026-08-25)",
    re: /\b(?:where|only|put|place|stop|don['’]t|do not)\b[^.!?]{0,80}\b(?:temp(?:orary)?|scratch)\b[^.!?]{0,80}\b(?:files?|artifacts?|output|folder|directory|repo|repository|gitignored)\b/i,
  },
  {
    key: "unpushed-work",
    label: "Had to demand local work be pushed",
    fixedBy: "pnpm ship:push (scripts/ship-push.mjs, 2026-08-12)",
    re: /\b(push (up|it up|them up|all|everything|shit up)|not pushed|never pushed|unpushed|files to push|tons of (local|files)|push the local)\b/i,
  },
  // Added 2026-08-20 after repeated confusion between automatic beta deploys
  // and the separate manual production promotion path. Watch whether the
  // shipping-skill split makes this correction disappear.
  {
    key: "beta-production-split",
    label: "Had to clarify beta auto-deploy vs manual production",
    fixedBy:
      ".agents/skills/ship + .agents/skills/ship-and-monitor (2026-08-20)",
    re: /\b(?:netlify\s+lock|(?:remove|clear|unlock).*\b(?:netlify|production)\s+lock|\b(?:main|merge|merged)\b[^.!?]{0,70}\b(?:auto[- ]?deploy|deploys?|go(?:es)? live)\b[^.!?]{0,50}\bproduction\b|\bproduction\b[^.!?]{0,70}\b(?:manual|not auto|doesn['’]t auto|isn['’]t auto)|\bbeta\b[^.!?]{0,70}\bproduction\b[^.!?]{0,40}\b(?:split|manual|not automatic)\b)/i,
  },
  {
    key: "no-progress",
    label: "Had to chase status on a long-running run",
    fixedBy: ".agents/skills/reporting-progress (2026-08-12)",
    re: /\b(hows? (it going|we looking)|what'?s the status|are we done|you done|did you finish|how close|still (going|running|working)|progress check|any update)\b/i,
  },
  {
    key: "feedback-reply-tone",
    label:
      "Reported duplicate feedback clarification or missing thank-first reply",
    fixedBy:
      ".agents/skills/address-feedback* + .agents/skills/review-prs (first-contact thanks, 2026-09-24)",
    re: /\b(?:ask(?:ed|ing)?|request(?:ed|ing)?)\b[^.!?]{0,100}\bclarif(?:ication|y)\b|\b(?:ask(?:ed|ing)?|request(?:ed|ing)?)\b[^.!?]{0,100}\b(?:again|repeat(?:ed|ing)?|restate|re-?provide)\b|\b(?:again|repeat(?:ed|ing)?|restate|re-?provide)\b[^.!?]{0,80}\b(?:url|link|details?|information|issue)\b|\bclarif(?:ication|y)\b[^.!?]{0,120}\b(?:already|thread|reply|fixed|fixing|solved|found|agent-native|someone|details?|not|unfriendly|robotic|tone|warm|harsh)\b|\bthank(?:s|ed|ing)?\b[^.!?]{0,80}\b(?:first|before|them|reporter)\b|\b(?:didn'?t|doesn'?t|without|skipped|forgot(?:ten)?)\b[^.!?]{0,80}\bthank(?:s|ed|ing)?\b/i,
  },
  {
    // Added 2026-09-24 to measure omissions in non-auto-approved PR handoffs.
    // Match corrective feedback only; ordinary first-time review requests are
    // not user friction.
    key: "pr-review-handoff",
    label:
      "Had to ask for PR handoff detail or stop repeated external follow-ups",
    fixedBy:
      ".agents/skills/review-prs (external replies and follow-up wait gate, 2026-09-24)",
    re: PR_REVIEW_HANDOFF_RE,
  },
  {
    key: "feedback-eyes-missed",
    label: "Had to demand correct 👀 ownership and release",
    fixedBy:
      ".agents/skills/review-latest-feedback + address-feedback-with-replies (active ownership lifecycle, 2026-09-23)",
    re: FEEDBACK_EYES_RE,
  },
  // Added 2026-09-01. `feedback-reply-tone` counts duplicate and unfriendly
  // questions but not their volume, so the 2026-09-01 sweep that posted 23
  // questions in one hour (4% answered, against 88% for the runs that asked
  // one or two) scored zero on every existing key. The cap in
  // review-latest-feedback is what this key has to move; if it stays at zero
  // while the user keeps saying the asks are odd, the key is wrong, not the
  // behavior. Watch it alongside `unanswered-feedback-followup`, which has
  // read zero since it landed because a per-run state file could not see the
  // previous run's questions at all.
  // Added 2026-09-02. Distinct from `repeat-issue` and `done-while-broken`:
  // this is specifically the sweep re-fixing a bug the channel already
  // reported and was already told was fixed. Measured because a repeat report
  // is the only falsification signal the workflow gets for its own Fixed
  // claims, and it was previously invisible - one Analytics outage drew three
  // separate investigations, and the same Zoom invalid_client was answered
  // twice 17 hours apart with neither reply linking the other.
  {
    key: "repeat-report-refix",
    label: "Told we keep re-fixing an already-reported bug",
    fixedBy:
      ".agents/skills/review-latest-feedback (2026-09-02 repeat-report gate)",
    re: /\b(?:same|identical)\b[^.!?\n]{0,60}\b(?:thing|bug|issue|problem|report|error|failure)\b[^.!?\n]{0,80}\b(?:again|over and over|on repeat|repeatedly|multiple times|keeps? (?:getting )?report\w*|twice|three times|third time)\b|\bkeep(?:s)?\b[^.!?\n]{0,40}\b(?:re-?)?(?:fix|investigat|report)\w*\b[^.!?\n]{0,60}\b(?:same|again|over and over|on repeat)\b|\b(?:already|previously)\b[^.!?\n]{0,50}\b(?:said|told|claimed|marked)\b[^.!?\n]{0,40}\bfixed\b[^.!?\n]{0,60}\b(?:still|again|not|isn['’]?t)\b|\b(?:report|answer|fix)(?:ed|s)?\b[^.!?\n]{0,60}\b(?:twice|three times|two|three|four)\b[^.!?\n]{0,40}\b(?:times?|separate|different)\b[^.!?\n]{0,40}\b(?:investigat\w*|report\w*|thread\w*|repl\w*)\b|\b(?:duplicate|dupe)\w*\b[^.!?\n]{0,50}\b(?:investigation|report|of the same|work)\b/i,
  },
  {
    key: "feedback-question-volume",
    label: "Told the feedback sweep asked too many or low-value questions",
    fixedBy:
      ".agents/skills/review-latest-feedback (2026-09-01 three-question budget)",
    re: /\b(?:too many|so many|stop asking|spam(?:ming|med)?|carpet|blast(?:ed|ing)?|barrage|flood(?:ed|ing)?)\b[^.!?\n]{0,80}\b(?:questions?|asks?|replies|messages?|threads?)\b|\b(?:questions?|asks?|replies|messages?)\b[^.!?\n]{0,60}\b(?:odd|weird|strange|pointless|useless|low[- ]value|generic|templated|robotic|noisy|annoying)\b|\b(?:don['’]?t|do not|stop|quit)\b[^.!?\n]{0,60}\b(?:ask(?:ing)?|reply(?:ing)?|post(?:ing)?)\b[^.!?\n]{0,60}\b(?:every|each|all)\b[^.!?\n]{0,40}\b(?:thread|report|message|item)\b/i,
  },
  {
    key: "cross-thread-interference",
    label: "Agent acted on other agents' threads or work uninvited",
    fixedBy: ".agents/skills/reporting-progress (2026-08-12)",
    re: /\b(other (chats?|threads?|agents?)|pause (their|other)|don'?t (tell|message) (other|the other)|didn'?t ask you to (touch|message))\b/i,
  },
  {
    key: "agent-tool-misuse",
    label:
      "Had to tell an agent which tool to call, or to author content itself instead of delegating to ask_app / the in-app agent",
    fixedBy:
      "external-agents skill + initialToolNames→MCP instructions (2026-09-05)",
    re: /\b(?:use|call) (?:the )?(?:right |correct |named )?tool\b|\bwrong tool\b|\bdon['’]t (?:use|call) ask_app\b|\b(?:write|author) (?:it|the (?:content|copy|text|deck|slide|design)) yourself\b|\bdon['’]t delegate (?:this|that|authoring)\b|\bstop waiting (?:on|for) the (?:in-app agent|app['’]s agent)\b/i,
  },
  // Measured for the first time on 2026-08-12, after three prose rewrites of the
  // same rule (c497c859fa, 061896a301, 44ac2c4acf) shipped with no key at all.
  // That is why the 2026-08-09 attempt could delete its own concrete rules nine
  // minutes after writing them and no number moved. Baseline the day the key
  // landed: 51 · 28 over the two weeks to 2026-08-12, total 79 — the largest row
  // in this table, and the only correction in it never previously counted.
  // Windowing is by file mtime, so read a sample of matches, not just the count:
  // a resumed session re-enters the window, a quiet fortnight cannot be told
  // apart from a vocabulary change, and roughly one match in ten is an untagged
  // subagent brief that `humanText` below does not recognize yet.
  {
    key: "text-heavy-ui",
    label: "Told the UI has too much text / chrome upfront",
    fixedBy:
      "guard:no-default-chrome + .agents/skills/frontend-design (2026-08-12)",
    re: /\b(too much (text|copy|chrome)|too many (words|titles|headers|labels|sections)|so much text|text[ -]?heavy|text overload|(less|fewer|way less|trim the|bloated with|unnecessary) (text|copy)|too (wordy|verbose)|too keen to add|descriptions? everywhere|remove (the|that) (descriptions?|titles?|headers?|breadcrumbs?|eyebrows?|subtitles?|blurb|subtext|copy|top bar|bottom row)|(we|i) don'?t need (the|these|those|that|all|an?)[^.!?]{0,50}\b(text|titles?|headers?|sections?|descriptions?|eyebrows?|labels?|rows?|blocks?|copy|line|about)|don'?t show the (sub ?text|description|title)|eyebrows?\b|overwhelming|clutter(ed)?\b|too busy|in your face|minimal u[ix]|less info upfront|progressive disclosure)/i,
  },
  // Measured for the first time on 2026-08-13, alongside the app-config schema
  // and the `configuration` skill. There was no key while core grew to 301
  // distinct environment variables, 253 of which are product behavior rather
  // than secrets — so the habit was never counted, only noticed once the total
  // was large enough to argue about. Baseline over the two weeks to 2026-08-13
  // is recorded in plans/core-configuration-attack-plan.md; the number to watch
  // is whether it stays flat while the schema absorbs domains, because a rising
  // count means declaring a field is still more expensive than reaching for
  // `process.env` and step 9 (generated docs and key sets) is the missing half.
  {
    key: "config-sprawl",
    label: "Told to stop adding environment variables / bespoke config",
    fixedBy:
      ".agents/skills/configuration + packages/core/src/app-config (2026-08-13)",
    re: /\b((another|a new|more|adding|stop adding|why (another|a new|an?))[^.!?]{0,40}\benv(ironment)? ?(vars?|variables?|keys?)|env(ironment)? ?(vars?|variables?) (should (only|just|not)|are (only|just)|only for)|shouldn'?t need (an? )?env|without (needing |requiring )?(an? )?env(ironment)? ?(var|variable|key)|no more env|too many env|why (is|does) this (an? )?env|hardcod\w+ (the )?(env|config)|second (way|namespace) to (set|configure))/i,
  },
  {
    // Added 2026-09-22 after a Builder Code agent "made a teammate admin" by
    // adding a hardcoded databaseHooks.user.create email check: it ran before
    // the lazily-created default org existed, never fired again for an
    // account that had already signed up, and wrote a role system nothing
    // gated on — so the teammate still wasn't admin after logging in.
    key: "admin-grant-hack",
    label: "Had to fix a hardcoded-email admin grant",
    fixedBy: ".agents/skills/sharing (make-me-admin recipe, 2026-09-22)",
    re: /\bmake me (?:an )?admin\b|\bmade me (?:an )?admin\b|\bhardcoded (?:my |the )?email\b|\bstill (?:not|no) admin\b/i,
  },
];

/**
 * Both harnesses replay machine-authored text through the user role. Two kinds
 * arrive, and conflating them is how a pattern count lies in both directions.
 *
 * AUTHORED — a subagent brief, delegation envelope, or watchdog transcript. No
 * human typed it. A brief that says "reduces text overload" is not the user
 * asking for anything, and counting it inflated this table by roughly a third
 * before these filters existed. Drop the whole message.
 *
 * ATTACHED — ambient UI state, a pasted screenshot, injected skill bodies:
 * wrappers around text the user really did type. The user's sharpest UI
 * corrections arrive with an `<image>` attached, so dropping these loses the
 * signal being measured. Strip the wrapper and keep the remainder.
 *
 * Never returns text a human did not type, and never returns "" — "machine
 * only" and "user said nothing" must stay the same answer, so a message that
 * strips to empty is not counted as friction.
 */
const AUTHORED_BY_AGENT =
  /<(subagent_notification|codex_delegation)\b|^\s*(The following is the Codex agent history|Claude here\s*[—-]\s*watchdog)/i;
const ATTACHED_BLOCK =
  /<(in-app-browser-context|user_message_metadata|environment_context|user_instructions|turn_aborted|task-notification|system-reminder|skill|image)\b[\s\S]*?(<\/\1>|\/>|$)/g;

const args = process.argv.slice(2);
const weeks = Number(valueOf("--weeks") ?? 8);
const only = valueOf("--pattern");
if (!Number.isInteger(weeks) || weeks < 1)
  fail(`--weeks must be a positive integer`);

const cutoff = Date.now() - weeks * 7 * 24 * 60 * 60 * 1000;
const selected = only ? PATTERNS.filter((p) => p.key === only) : PATTERNS;
if (selected.length === 0)
  fail(
    `unknown --pattern ${only}. Known: ${PATTERNS.map((p) => p.key).join(", ")}`,
  );

const sources = [
  {
    name: "Claude Code",
    root: path.join(os.homedir(), ".claude", "projects"),
    read: claudeMessage,
  },
  {
    name: "Codex",
    root: path.join(os.homedir(), ".codex", "sessions"),
    read: codexMessage,
  },
];

const counts = new Map(selected.map((p) => [p.key, new Map()]));
const lastSeen = new Map();
let scanned = 0;
let messages = 0;

for (const source of sources) {
  const files = walk(source.root).filter(
    (f) => f.endsWith(".jsonl") && mtime(f) >= cutoff,
  );
  // A source with no readable transcripts is not "no friction" — say so, or a
  // missing history directory reads as a clean report.
  if (files.length === 0) {
    process.stderr.write(
      `[friction] no ${source.name} transcripts newer than ${weeks}w under ${source.root}\n`,
    );
    continue;
  }
  scanned += files.length;
  for (const file of files) await scan(file, source.read);
}

if (scanned === 0)
  fail("no transcripts found for either harness — cannot report");

report();

async function scan(file, read) {
  let stream;
  try {
    stream = createReadStream(file, { encoding: "utf8" });
  } catch {
    process.stderr.write(`[friction] unreadable: ${file}\n`);
    return;
  }
  for await (const line of createInterface({
    input: stream,
    crlfDelay: Infinity,
  })) {
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    const found = read(entry);
    if (!found) continue;
    const { text, at } = found;
    if (!at || at < cutoff) continue;
    messages += 1;
    for (const pattern of selected) {
      if (!pattern.re.test(text)) continue;
      const week = weekOf(at);
      const bucket = counts.get(pattern.key);
      bucket.set(week, (bucket.get(week) ?? 0) + 1);
      const previous = lastSeen.get(pattern.key) ?? 0;
      if (at > previous) lastSeen.set(pattern.key, at);
    }
  }
}

function humanText(raw) {
  const raw_ = String(raw ?? "");
  if (AUTHORED_BY_AGENT.test(raw_)) return null;
  const text = raw_.replace(ATTACHED_BLOCK, " ").replace(/\s+/g, " ").trim();
  // A message that is still nothing but markup after stripping is machinery
  // whose wrapper this script does not know yet — not a quiet user.
  if (!text || text.startsWith("<")) return null;
  return text.length > 2 ? text : null;
}

function claudeMessage(entry) {
  const at = Date.parse(entry?.timestamp ?? "");
  if (entry?.type === "queue-operation" && entry.operation === "enqueue") {
    const text = humanText(entry.content);
    return text ? { text, at } : null;
  }
  if (entry?.type !== "user" || entry.isSidechain) return null;
  const content = entry?.message?.content;
  if (typeof content === "string") {
    const text = humanText(content);
    return text ? { text, at } : null;
  }
  if (!Array.isArray(content)) return null;
  const text = humanText(
    content
      .filter((part) => part?.type === "text")
      .map((part) => part.text ?? "")
      .join("\n"),
  );
  return text ? { text, at } : null;
}

function codexMessage(entry) {
  if (entry?.type !== "event_msg" || entry?.payload?.type !== "user_message")
    return null;
  const text = humanText(entry.payload.message);
  return text ? { text, at: Date.parse(entry?.timestamp ?? "") } : null;
}

function report() {
  const buckets = [];
  for (let index = weeks - 1; index >= 0; index -= 1) {
    buckets.push(weekOf(Date.now() - index * 7 * 24 * 60 * 60 * 1000));
  }
  const unique = [...new Set(buckets)];

  console.log(`\nAgent friction over the last ${weeks} weeks`);
  console.log(`${scanned} transcripts, ${messages} user messages\n`);
  const width = Math.max(...selected.map((p) => p.label.length));

  for (const pattern of selected) {
    const bucket = counts.get(pattern.key);
    const series = unique.map((week) => bucket.get(week) ?? 0);
    const total = series.reduce((sum, n) => sum + n, 0);
    const seen = lastSeen.get(pattern.key);
    console.log(
      `${pattern.label.padEnd(width)}  ${series.map((n) => String(n).padStart(3)).join("")}   total ${String(total).padStart(3)}   last ${seen ? new Date(seen).toISOString().slice(0, 10) : "never"}`,
    );
    console.log(`${" ".repeat(width)}  carried by ${pattern.fixedBy}\n`);
  }

  console.log(`weeks, oldest to newest: ${unique.join("  ")}`);
  console.log(
    `\nA pattern that keeps climbing after its guidance landed means the guidance is\n` +
      `not working — rewrite it to name the situation the agent is actually tempted\n` +
      `in. Reach for a mechanism only once guidance has measurably failed.\n`,
  );
}

function weekOf(ms) {
  const date = new Date(ms);
  const monday = new Date(date);
  monday.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  return monday.toISOString().slice(5, 10);
}

function walk(root) {
  const out = [];
  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop();
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else out.push(full);
    }
  }
  return out;
}

function mtime(file) {
  try {
    return statSync(file).mtimeMs;
  } catch {
    return 0;
  }
}

function valueOf(flag) {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

function fail(message) {
  process.stderr.write(`[friction] ${message}\n`);
  process.exit(1);
}
