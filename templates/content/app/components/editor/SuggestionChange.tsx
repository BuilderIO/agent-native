import { useT } from "@agent-native/core/client/i18n";
import type { ResourceSuggestion } from "@agent-native/core/review";
import { mostlyRewritten, suggestionDiffParts } from "@shared/suggestion-diff";
import { WORD_CHARACTER } from "@shared/suggestion-placement";
import {
  clipSuggestionPresentation,
  suggestionPresentationLength,
  suggestionTextForDisplay,
  type SuggestionPresentationContext,
  type SuggestionPresentationNode,
} from "@shared/suggestion-text";
import { Fragment, type ReactNode } from "react";

import { cn } from "@/lib/utils";

import { SuggestionText, suggestionTextNodes } from "./SuggestionText";
import { reviewUnitDiffParts } from "./thread-suggestions";

type Operations = ResourceSuggestion["operations"];
type Clip = { head: number; tail: number };
type DiffPart = { type: "equal" | "delete" | "insert"; text: string };

const WHOLE_CLIP: Clip = { head: 72, tail: 24 };
const CHANGED_CLIP: Clip = { head: 48, tail: 16 };
const KEPT_CLIP: Clip = { head: 16, tail: 16 };

const SENTENCE_KEYS = {
  add: ["comments.suggestionAddText", "comments.suggestionAddParagraph"],
  remove: [
    "comments.suggestionRemoveText",
    "comments.suggestionRemoveParagraph",
  ],
} as const;

const OLD = "\uE000";
const NEW = "\uE001";

interface Run {
  text: string;
  changed: boolean;
  formatted: boolean;
  context?: SuggestionPresentationContext | undefined;
  clip: Clip;
}

type Change =
  | {
      kind: "replace";
      removed: Run[];
      inserted: Run[];
      keepsWords: boolean;
    }
  | {
      kind: "add" | "remove";
      runs: Run[];
      paragraph: boolean;
    };

const BLOCK_SYNTAX = /^(?:#{1,6}\s|[-*+]\s|\d+[.)]\s|>|```|\||<)/;

function letterDiff(removed: string, inserted: string) {
  const parts = suggestionDiffParts(removed, inserted);
  if (!parts) return null;
  const splitsWord = (["delete", "insert"] as const).some((side) => {
    let previous: (typeof parts)[number] | undefined;
    for (const part of parts) {
      if (part.type !== "equal" && part.type !== side) continue;
      if (
        previous &&
        (previous.type === "equal") !== (part.type === "equal") &&
        WORD_CHARACTER.test(previous.text.slice(-1)) &&
        WORD_CHARACTER.test(part.text.charAt(0))
      )
        return true;
      previous = part;
    }
    return false;
  });
  if (!splitsWord) return parts;
  if (/\s/.test(removed.trim() + inserted.trim())) return null;
  const kept = parts
    .filter((part) => part.type === "equal")
    .reduce((length, part) => length + part.text.length, 0);
  return kept * 2 > Math.max(removed.length, inserted.length) ? parts : null;
}

const isWord = (character: string | undefined) =>
  !!character && WORD_CHARACTER.test(character);

function wholeWordSpan(
  source: string,
  from: number,
  to: number,
  removed: string,
  inserted: string,
) {
  const lexical = WORD_CHARACTER.test(removed + inserted);
  const joins = (edge: (text: string) => string) =>
    !lexical ||
    isWord(edge(removed)) ||
    isWord(edge(inserted)) ||
    (!!removed && !!inserted && edge(removed) !== edge(inserted));
  let start = from;
  if (isWord(source[from - 1]) && joins((text) => text.charAt(0)))
    while (start > 0 && isWord(source[start - 1])) start -= 1;
  let end = to;
  if (isWord(source[to]) && joins((text) => text.slice(-1)))
    while (end < source.length && isWord(source[end])) end += 1;
  return { start, end };
}

function wordsAround(
  removed: string,
  inserted: string,
  before: SuggestionPresentationContext,
  after: SuggestionPresentationContext,
) {
  const { source, from, to } = before;
  const { start, end } = wholeWordSpan(source, from, to, removed, inserted);
  if (start === from && end === to) return null;
  const lead = source.slice(start, from);
  const trail = source.slice(to, end);
  if (
    after.source.slice(start, after.from) !== lead ||
    after.source.slice(after.to, after.to + trail.length) !== trail
  )
    return null;
  return {
    removed: lead + removed + trail,
    inserted: lead + inserted + trail,
    before: { source, from: start, to: end },
    after: { source: after.source, from: start, to: after.to + trail.length },
  };
}

function sharedEnds(removed: string, inserted: string, markdown: boolean) {
  const shorter = Math.min(removed.length, inserted.length);
  let lead = 0;
  while (lead < shorter && removed[lead] === inserted[lead]) lead += 1;
  let trail = 0;
  while (
    trail < shorter - lead &&
    removed[removed.length - 1 - trail] ===
      inserted[inserted.length - 1 - trail]
  )
    trail += 1;
  let { start, end } = wholeWordSpan(
    removed,
    lead,
    removed.length - trail,
    removed.slice(lead, removed.length - trail),
    inserted.slice(lead, inserted.length - trail),
  );
  if (markdown) {
    while (start > 0 && !/\s/.test(removed.charAt(start - 1))) start -= 1;
    while (end < removed.length && !/\s/.test(removed.charAt(end))) end += 1;
  }
  return { lead: start, trail: removed.length - end };
}

function runsBetween(runs: readonly Run[], from: number, to: number): Run[] {
  let offset = 0;
  return runs.flatMap((run) => {
    const start = offset;
    offset += run.text.length;
    const cutStart = Math.max(from, start) - start;
    const cutEnd = Math.min(to, offset) - start;
    if (cutEnd <= cutStart) return [];
    return [
      {
        ...run,
        text: run.text.slice(cutStart, cutEnd),
        context: run.context && {
          ...run.context,
          from: run.context.from + cutStart,
          to: run.context.from + cutEnd,
        },
      },
    ];
  });
}

const presentable = (runs: readonly Run[]) =>
  runs.length > 0 &&
  runs.every(
    (run) => !run.formatted || suggestionTextNodes(run.text, run.context),
  );

function edgeChip(
  nodes: readonly SuggestionPresentationNode[],
  end: boolean,
): boolean {
  return (end ? nodes.slice(-1) : nodes.slice(0, 1)).some(
    (node) =>
      node.type === "code" ||
      node.type === "link" ||
      ("children" in node && edgeChip(node.children, end)),
  );
}

function readsInPieces(runs: readonly Run[]) {
  let previous: SuggestionPresentationNode[] | null = null;
  for (const run of runs) {
    const nodes = run.context
      ? suggestionTextNodes(run.text, run.context)
      : null;
    if (!nodes) return false;
    if (run.changed && suggestionPresentationLength(nodes) === 0) return false;
    if (previous && edgeChip(previous, true) && edgeChip(nodes, false))
      return false;
    previous = nodes;
  }
  return true;
}

function styledIn(
  text: string,
  context: SuggestionPresentationContext | undefined,
) {
  return (
    !!context &&
    !!suggestionTextNodes(text, context)?.some((node) => "children" in node)
  );
}

function changedStretches(runs: readonly Run[]) {
  let stretches = 0;
  let changing = false;
  for (const run of runs) {
    if (run.changed && !changing) stretches += 1;
    changing = run.changed;
  }
  return stretches;
}

function operationChange(
  operation: Operations[number],
  { wordLevel, whole }: { wordLevel: boolean; whole: boolean },
): { change: Change; narrowed: boolean } | null {
  const before = operation.before as
    | { markdown?: string; changedText?: string }
    | undefined;
  const after = operation.after as
    | { markdown?: string; changedText?: string }
    | undefined;
  const previousText = before?.changedText;
  const nextText =
    operation.kind === "delete_text" && after?.changedText === "<empty-block/>"
      ? ""
      : after?.changedText;
  const anchor = operation.anchor as
    | { from?: unknown; to?: unknown }
    | undefined;
  const previousPresentation =
    previousText !== undefined &&
    before?.markdown !== undefined &&
    typeof anchor?.from === "number" &&
    typeof anchor.to === "number"
      ? { source: before.markdown, from: anchor.from, to: anchor.to }
      : undefined;
  const nextPresentation =
    nextText !== undefined &&
    after?.markdown !== undefined &&
    typeof anchor?.from === "number"
      ? {
          source: after.markdown,
          from: anchor.from,
          to: anchor.from + nextText.length,
        }
      : undefined;
  const widened =
    previousPresentation && nextPresentation && (previousText || nextText)
      ? wordsAround(
          previousText ?? "",
          nextText ?? "",
          previousPresentation,
          nextPresentation,
        )
      : null;
  const removedText = widened?.removed ?? previousText;
  const insertedText = widened?.inserted ?? nextText;
  const removedContext = widened?.before ?? previousPresentation;
  const insertedContext = widened?.after ?? nextPresentation;
  const said = (
    text: string,
    context: SuggestionPresentationContext | undefined,
  ): Run[] => [
    { text, changed: true, formatted: true, context, clip: WHOLE_CLIP },
  ];

  if (removedText && insertedText) {
    const markdown = /[<>*_~`\[\]]/.test(removedText + insertedText);
    const formatted =
      markdown ||
      styledIn(removedText, removedContext) ||
      styledIn(insertedText, insertedContext);
    const { lead, trail } = sharedEnds(removedText, insertedText, markdown);
    const kept = (
      text: string,
      context: SuggestionPresentationContext | undefined,
    ) => runsBetween(said(text, context), lead, text.length - trail);
    if (lead >= removedText.length - trail) {
      const added = addedOrRemoved("add", kept(insertedText, insertedContext));
      if (presentable(added.change.runs)) return added;
    }
    if (lead >= insertedText.length - trail) {
      const removed = addedOrRemoved(
        "remove",
        kept(removedText, removedContext),
      );
      if (presentable(removed.change.runs)) return removed;
    }
    const diff: readonly DiffPart[] | null =
      operation.kind !== "replace_text" && !widened
        ? null
        : (!wordLevel && letterDiff(removedText, insertedText)) ||
          (markdown ? null : reviewUnitDiffParts(removedText, insertedText));
    const marked = diff?.some((part) => part.type === "equal") ? diff : null;
    const pieces = (
      type: "delete" | "insert",
      presentation: SuggestionPresentationContext | undefined,
    ): Run[] => {
      let offset = 0;
      return (marked ?? []).flatMap((part): Run[] => {
        if (part.type !== "equal" && part.type !== type) return [];
        const from = (presentation?.from ?? 0) + offset;
        offset += part.text.length;
        return [
          {
            text: part.text,
            changed: part.type !== "equal",
            formatted,
            context: presentation && {
              source: presentation.source,
              from,
              to: from + part.text.length,
            },
            clip: WHOLE_CLIP,
          },
        ];
      });
    };
    const markedRemoved = pieces("delete", removedContext);
    const markedInserted = pieces("insert", insertedContext);
    const rewritten =
      (changedStretches(markedRemoved) > 1 ||
        changedStretches(markedInserted) > 1) &&
      mostlyRewritten(removedText, insertedText);
    const piecewise =
      !!marked &&
      !rewritten &&
      (!formatted ||
        (readsInPieces(markedRemoved) && readsInPieces(markedInserted)));
    let removed = piecewise ? markedRemoved : said(removedText, removedContext);
    let inserted = piecewise
      ? markedInserted
      : said(insertedText, insertedContext);
    let narrowed = false;
    if (!whole) {
      const cutRemoved = runsBetween(removed, lead, removedText.length - trail);
      const cutInserted = runsBetween(
        inserted,
        lead,
        insertedText.length - trail,
      );
      if (
        (lead || trail) &&
        presentable(cutRemoved) &&
        presentable(cutInserted)
      ) {
        removed = cutRemoved;
        inserted = cutInserted;
        narrowed = true;
      }
    }
    const keepsWords = [...removed, ...inserted].some((run) => !run.changed);
    const clipped = (runs: Run[]) =>
      runs.map((run) => ({
        ...run,
        clip: !keepsWords ? WHOLE_CLIP : run.changed ? CHANGED_CLIP : KEPT_CLIP,
      }));
    return {
      change: {
        kind: "replace",
        removed: clipped(removed),
        inserted: clipped(inserted),
        keepsWords,
      },
      narrowed,
    };
  }
  if (removedText)
    return addedOrRemoved("remove", said(removedText, removedContext));
  if (insertedText)
    return addedOrRemoved("add", said(insertedText, insertedContext));
  return null;
}

function addedOrRemoved(
  kind: "add" | "remove",
  runs: Run[],
): { change: Extract<Change, { kind: "add" | "remove" }>; narrowed: boolean } {
  const text = runs.map((run) => run.text).join("");
  const lead = text.slice(0, text.length - text.trimStart().length);
  const trail = text.slice(text.trimEnd().length);
  const inner = text.slice(lead.length, text.length - trail.length);
  const trimmed = runsBetween(runs, lead.length, text.length - trail.length);
  const trims = !!inner && presentable(trimmed);
  return {
    change: {
      kind,
      runs: trims ? trimmed : runs,
      paragraph:
        trims &&
        /\n/.test(lead + trail) &&
        !inner.includes("\n") &&
        !BLOCK_SYNTAX.test(inner),
    },
    narrowed: false,
  };
}

function plainRunText(run: Run) {
  return run.changed && /^\s+$/.test(run.text)
    ? suggestionTextForDisplay(run.text)
    : run.text;
}

function runClips(run: Run) {
  const nodes = run.formatted
    ? suggestionTextNodes(run.text, run.context)
    : [{ type: "text" as const, value: plainRunText(run) }];
  return !!nodes && clipSuggestionPresentation(nodes, run.clip) !== nodes;
}

export function suggestionChangeHasMore(
  operations: Operations,
  wordLevel = false,
): boolean {
  return operations.some((operation) => {
    const said = operationChange(operation, { wordLevel, whole: false });
    if (!said) return false;
    const runs =
      said.change.kind === "replace"
        ? [...said.change.removed, ...said.change.inserted]
        : said.change.runs;
    return said.narrowed || runs.some(runClips);
  });
}

function Runs({
  runs,
  side,
  whole,
  keepsWords = false,
}: {
  runs: Run[];
  side: "removed" | "inserted";
  whole: boolean;
  keepsWords?: boolean;
}) {
  return (
    <span
      className={
        side === "removed"
          ? "text-muted-foreground"
          : "text-[hsl(var(--suggestion))]"
      }
      data-suggestion-change-text={side}
    >
      {runs.map((run, index) => (
        <span
          key={index}
          className={cn(
            run.changed &&
              (side === "removed"
                ? "line-through decoration-muted-foreground/60"
                : keepsWords &&
                  "underline decoration-[hsl(var(--suggestion))] underline-offset-2"),
          )}
        >
          {run.formatted ? (
            <SuggestionText
              content={run.text}
              context={run.context}
              clip={whole ? undefined : run.clip}
            />
          ) : whole ? (
            plainRunText(run)
          ) : (
            clipSuggestionPresentation(
              [{ type: "text", value: plainRunText(run) }],
              run.clip,
            )
              .map((node) => ("value" in node ? node.value : ""))
              .join("")
          )}
        </span>
      ))}
    </span>
  );
}

function fillSentence(
  sentence: string,
  slots: ReadonlyArray<readonly [marker: string, node: ReactNode]>,
): ReactNode[] {
  const placed = new Set<string>();
  const filled: ReactNode[] = sentence
    .split(new RegExp(`(${OLD}|${NEW})`, "u"))
    .map((piece, index) => {
      const slot = slots.find(([marker]) => marker === piece);
      if (slot) placed.add(slot[0]);
      return <Fragment key={index}>{slot ? slot[1] : piece}</Fragment>;
    });
  for (const [marker, node] of slots)
    if (!placed.has(marker))
      filled.push(<Fragment key={marker}> {node}</Fragment>);
  return filled;
}

export function SuggestionChange({
  operations,
  whole = false,
  wordLevel = false,
  className,
}: {
  operations: Operations;
  whole?: boolean;
  wordLevel?: boolean;
  className?: string;
}) {
  const t = useT();
  const changes = operations.flatMap((operation, index) => {
    const said = operationChange(operation, { wordLevel, whole });
    return said ? [{ key: operation.id ?? index, change: said.change }] : [];
  });
  if (!changes.length) return null;
  return (
    <div
      role="group"
      aria-label={t("comments.suggestedChange")}
      className={cn("grid grid-cols-1 gap-0.5", className)}
    >
      {changes.map(({ key, change }) => (
        <p
          key={key}
          className="break-words"
          data-suggestion-change={change.kind}
        >
          {change.kind === "replace"
            ? fillSentence(
                t("comments.suggestionReplaceWith", { old: OLD, new: NEW }),
                [
                  [
                    OLD,
                    <Runs runs={change.removed} side="removed" whole={whole} />,
                  ],
                  [
                    NEW,
                    <Runs
                      runs={change.inserted}
                      side="inserted"
                      whole={whole}
                      keepsWords={change.keepsWords}
                    />,
                  ],
                ],
              )
            : fillSentence(
                t(SENTENCE_KEYS[change.kind][change.paragraph ? 1 : 0], {
                  text: change.kind === "add" ? NEW : OLD,
                }),
                [
                  [
                    change.kind === "add" ? NEW : OLD,
                    <Runs
                      runs={change.runs}
                      side={change.kind === "add" ? "inserted" : "removed"}
                      whole={whole}
                    />,
                  ],
                ],
              )}
        </p>
      ))}
    </div>
  );
}
