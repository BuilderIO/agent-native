import { editorBlockIdsOf } from "@shared/block-identity-ids";
import {
  BLOCKS_FIELD_BLOCK_KINDS,
  blocksFieldTreeShape,
} from "@shared/blocks-field-identity";
import { docToNfm, nfmToDoc, type PMNode } from "@shared/nfm";
import {
  livePageCheckAnswers,
  pageCheckHeadingsIn,
  pageCheckPlacesIn,
  readPageCheckBody,
  type PageCheckAnswer,
  type PageCheckHeading,
  type PageCheckPlaceAnswer,
  type PageCheckScope,
  type PageCheckView,
} from "@shared/page-checks";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";

const BLOCK_KINDS = new Set<string>(BLOCKS_FIELD_BLOCK_KINDS);

export type LivePageCheckAnswer = PageCheckPlaceAnswer & { writing: boolean };

/** One check's answer at one place, where the margin can point at it. */
export interface PageCheckMark {
  check: PageCheckView;
  answer: LivePageCheckAnswer;
  /** Where the place's first block starts in the editor. */
  from: number;
  /** Where the place ends, for quoting it in a comment. */
  to: number;
}

/** What the checks find in the text the editor holds now. */
export interface LivePageChecks {
  markdown: string;
  idsByPath: Readonly<Record<string, string>>;
  headings: PageCheckHeading[];
  answers: ReadonlyMap<string, LivePageCheckAnswer[]>;
  marks: PageCheckMark[];
}

/** The answers that leave a dot: what doesn't pass and what can't be told. */
export function isShownPageCheckAnswer(
  answer: Pick<LivePageCheckAnswer, "answer" | "writing">,
): boolean {
  if (answer.answer === "changed") return !answer.writing;
  return answer.answer === "not_fine" || answer.answer === "couldnt";
}

export function shownPageCheckAnswers<
  T extends Pick<LivePageCheckAnswer, "answer"> & { writing?: boolean },
>(check: Pick<PageCheckView, "paused">, answers: readonly T[]): T[] {
  if (check.paused) return [];
  return answers.filter((answer) =>
    isShownPageCheckAnswer({
      answer: answer.answer,
      writing: !!answer.writing,
    }),
  );
}

/** Where each block of the body starts, by the path a check's place names. */
export function blockPositionsByPath(
  doc: ProseMirrorNode,
): Map<string, number> {
  const positions = new Map<string, number>();
  const visit = (
    node: ProseMirrorNode,
    start: number,
    parentPath: string | null,
  ) => {
    let index = 0;
    node.forEach((child, offset) => {
      if (!BLOCK_KINDS.has(child.type.name)) return;
      const path = parentPath === null ? `${index}` : `${parentPath}.${index}`;
      positions.set(path, start + offset);
      visit(child, start + offset + 1, path);
      index++;
    });
  };
  visit(doc, 0, null);
  return positions;
}

/** Where a place that starts at `from` ends, by the same rules as its scope. */
function placeEnd(
  doc: ProseMirrorNode,
  scope: PageCheckScope,
  from: number,
): number {
  const end = doc.content.size;
  // A comment on the whole page quotes where it starts.
  if (scope.kind === "page" || scope.kind === "each_paragraph") {
    return from + (doc.nodeAt(from)?.nodeSize ?? 0);
  }
  // The intro runs to the first heading; a section to the next heading at
  // its level or above.
  const level =
    scope.kind === "section"
      ? Number(doc.nodeAt(from)?.attrs.level) || 1
      : Number.POSITIVE_INFINITY;
  let stop = end;
  doc.forEach((child, offset) => {
    if (stop !== end || child.type.name !== "heading") return;
    if (scope.kind === "section" && offset <= from) return;
    if ((Number(child.attrs.level) || 1) <= level) stop = offset;
  });
  return stop;
}

/**
 * The checks' answers in the editor's text now, and the dots they leave. Paths
 * name the same blocks in the editor and in its Markdown only when both have
 * the same blocks; otherwise the answers stand without dots.
 */
export function readLivePageChecks(
  doc: ProseMirrorNode,
  checks: readonly PageCheckView[],
): LivePageChecks {
  const json = doc.toJSON() as PMNode;
  const markdown = docToNfm(json);
  const parsed = nfmToDoc(markdown) as PMNode;
  const editorIds = editorBlockIdsOf(json);
  const aligned = blocksFieldTreeShape(parsed) === editorIds.shape;
  const idsByPath = aligned ? editorIds.idsByPath : {};
  const body = readPageCheckBody(markdown, idsByPath, parsed);
  const positions = aligned ? blockPositionsByPath(doc) : null;
  const answers = new Map<string, LivePageCheckAnswer[]>();
  const marks: PageCheckMark[] = [];
  for (const check of checks) {
    const live = livePageCheckAnswers(
      check,
      pageCheckPlacesIn(body, check.scope),
    );
    answers.set(check.id, live);
    if (!positions) continue;
    for (const answer of shownPageCheckAnswers(check, live)) {
      const from = answer.place ? positions.get(answer.place.path) : undefined;
      if (from === undefined) continue;
      marks.push({
        check,
        answer,
        from,
        to: placeEnd(doc, check.scope, from),
      });
    }
  }
  return {
    markdown,
    idsByPath,
    headings: pageCheckHeadingsIn(body),
    answers,
    marks,
  };
}

/** The section a position is in, or the intro above the first heading. */
export function pageCheckScopeAt(
  doc: ProseMirrorNode,
  pos: number,
  headings: readonly PageCheckHeading[],
): PageCheckScope {
  const positions = blockPositionsByPath(doc);
  let found: PageCheckHeading | null = null;
  for (const heading of headings) {
    const start = positions.get(heading.path);
    if (start !== undefined && start <= pos) found = heading;
  }
  return found
    ? {
        kind: "section",
        headingId: found.headingId,
        heading: found.heading,
        level: found.level,
      }
    : { kind: "intro" };
}

/** How a dot looks: never by color alone. */
export function pageCheckMarkShape(
  answer: PageCheckAnswer,
): "filled" | "hollow" | "ring" {
  if (answer === "not_fine") return "filled";
  if (answer === "couldnt") return "ring";
  return "hollow";
}
