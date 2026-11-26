import { visitBlocksFieldBlocks } from "./blocks-field-identity.js";
import {
  docToNfm,
  isEditorTerminalFiller,
  nfmToDoc,
  type PMNode,
} from "./nfm.js";
import { countWords } from "./properties.js";
import { countSentences } from "./suggestion-units.js";

export const PAGE_CHECK_LIMIT = 20;
export const PAGE_CHECK_SENTENCE_MAX_LENGTH = 300;
export const PAGE_CHECK_MAX_PARTS = 3;
export const PAGE_CHECK_TYPING_PAUSE_MS = 3_000;
const PAGE_CHECK_COUNT_MAX = 1_000_000;

export type PageCheckUnit = "words" | "sentences" | "paragraphs";

export interface PageCheckCountPart {
  kind: "count";
  text: string;
  unit: PageCheckUnit;
  min: number | null;
  max: number | null;
}

export type PageCheckPart = PageCheckCountPart;

export interface PageCheckUnreadPart {
  kind: "unread";
  text: string;
}

export type PageCheckScope =
  | { kind: "page" }
  | { kind: "intro" }
  | {
      kind: "section";
      headingId: string | null;
      heading: string;
      level: number;
    }
  | { kind: "each_paragraph" };

export type PageCheckScopeKind = PageCheckScope["kind"];

export type PageCheckFinding = "fine" | "not_fine" | "couldnt";

export type PageCheckAnswer =
  | "fine"
  | "not_fine"
  | "skipped"
  | "changed"
  | "couldnt";

export type PageCheckCouldntReason = "section_deleted";

export interface PageCheckPartResult {
  finding: PageCheckFinding;
  count?: number;
  reason?: PageCheckCouldntReason;
}

export interface PageCheckPlace {
  key: string;
  path: string;
  blockId: string | null;
  textHash: string;
  excerpt: string;
  markdown: string;
}

export type PageCheckPlaces =
  | { status: "ok"; places: PageCheckPlace[] }
  | { status: "section_deleted" };

const UNIT_WORDS: Record<PageCheckUnit, readonly string[]> = {
  paragraphs: [
    "paragraph",
    "paragraphs",
    "absatz",
    "absätze",
    "absätzen",
    "párrafo",
    "párrafos",
    "paragraphe",
    "paragraphes",
    "parágrafo",
    "parágrafos",
    "فقرة",
    "فقرات",
    "अनुच्छेद",
    "अनुच्छेदों",
    "पैराग्राफ",
    "段落",
    "단락",
    "문단",
  ],
  sentences: [
    "sentence",
    "sentences",
    "satz",
    "sätze",
    "sätzen",
    "oración",
    "oraciones",
    "frase",
    "frases",
    "phrase",
    "phrases",
    "جملة",
    "جمل",
    "वाक्य",
    "वाक्यों",
    "句子",
    "文",
    "문장",
    "句",
  ],
  words: [
    "word",
    "words",
    "wort",
    "wörter",
    "worte",
    "wörtern",
    "palabra",
    "palabras",
    "mot",
    "mots",
    "palavra",
    "palavras",
    "كلمة",
    "كلمات",
    "शब्द",
    "शब्दों",
    "単語",
    "語",
    "ワード",
    "단어",
    "词",
    "詞",
    "字",
  ],
};

const AT_MOST_WORDS = [
  "under",
  "below",
  "at most",
  "no more than",
  "not more than",
  "no longer than",
  "max",
  "maximum",
  "up to",
  "fewer than",
  "less than",
  "or fewer",
  "or less",
  "within",
  "unter",
  "höchstens",
  "maximal",
  "bis zu",
  "weniger als",
  "nicht mehr als",
  "menos de",
  "como máximo",
  "máximo",
  "hasta",
  "no más de",
  "moins de",
  "au plus",
  "au maximum",
  "jusqu'à",
  "pas plus de",
  "no máximo",
  "até",
  "não mais que",
  "não mais de",
  "أقل من",
  "على الأكثر",
  "لا يزيد عن",
  "بحد أقصى",
  "से कम",
  "अधिकतम",
  "ज़्यादा से ज़्यादा",
  "以内",
  "以內",
  "以下",
  "未満",
  "まで",
  "最大",
  "이하",
  "이내",
  "미만",
  "최대",
  "不超过",
  "不超過",
  "最多",
  "少于",
  "少於",
  "至多",
  "≤",
  "<=",
  "<",
];

const AT_LEAST_WORDS = [
  "at least",
  "over",
  "above",
  "more than",
  "no fewer than",
  "no less than",
  "min",
  "minimum",
  "or more",
  "mindestens",
  "über",
  "mehr als",
  "wenigstens",
  "al menos",
  "más de",
  "como mínimo",
  "mínimo",
  "au moins",
  "plus de",
  "pelo menos",
  "mais de",
  "no mínimo",
  "على الأقل",
  "أكثر من",
  "कम से कम",
  "से अधिक",
  "से ज़्यादा",
  "以上",
  "少なくとも",
  "最低",
  "이상",
  "최소",
  "적어도",
  "至少",
  "不少于",
  "不少於",
  "超过",
  "超過",
  "≥",
  ">=",
  ">",
];

const EXACTLY_WORDS = [
  "exactly",
  "genau",
  "exactamente",
  "exactement",
  "exatamente",
  "بالضبط",
  "ठीक",
  "ちょうど",
  "정확히",
  "正好",
  "恰好",
];

const NUMBER_WORDS: Readonly<Partial<Record<string, number>>> = {
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  hundred: 100,
};

const LATIN = /[a-zà-ÿ]/;

function wordPattern(word: string): RegExp {
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return LATIN.test(word)
    ? new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}])`, "u")
    : new RegExp(escaped, "u");
}

const patternCache = new Map<string, RegExp>();
function contains(text: string, word: string): boolean {
  let pattern = patternCache.get(word);
  if (!pattern) {
    pattern = wordPattern(word);
    patternCache.set(word, pattern);
  }
  return pattern.test(text);
}

function longestFound(text: string, words: readonly string[]): string | null {
  let found: string | null = null;
  for (const word of words) {
    if ((!found || word.length > found.length) && contains(text, word)) {
      found = word;
    }
  }
  return found;
}

function numbersIn(text: string): number[] {
  const numbers: number[] = [];
  for (const match of text.matchAll(/\d{1,3}(?:[,.   ]\d{3})+(?!\d)|\d+/g)) {
    numbers.push(Number(match[0].replace(/[^\d]/g, "")));
  }
  if (numbers.length) return numbers;
  for (const match of text.matchAll(/\p{L}+/gu)) {
    const value = NUMBER_WORDS[match[0]];
    if (value !== undefined) numbers.push(value);
  }
  return numbers;
}

export function readPageCheckPart(
  text: string,
): PageCheckCountPart | PageCheckUnreadPart {
  const unread = { kind: "unread" as const, text };
  const normalized = text.normalize("NFKC").toLowerCase();
  const units = (Object.keys(UNIT_WORDS) as PageCheckUnit[]).filter((unit) =>
    UNIT_WORDS[unit].some((word) => contains(normalized, word)),
  );
  const unit = units.pop();
  if (!unit || units.length > 0) return unread;
  const numbers = numbersIn(normalized);
  if (numbers.length === 0 || numbers.length > 2) return unread;
  if (numbers.some((value) => value > PAGE_CHECK_COUNT_MAX)) return unread;
  if (numbers.length === 2) {
    const [first = 0, second = 0] = numbers;
    return {
      kind: "count",
      text,
      unit,
      min: Math.min(first, second),
      max: Math.max(first, second),
    };
  }
  const [value = 0] = numbers;
  const most = longestFound(normalized, AT_MOST_WORDS);
  const least = longestFound(normalized, AT_LEAST_WORDS);
  const exactly = longestFound(normalized, EXACTLY_WORDS);
  if (exactly && !most && !least) {
    return { kind: "count", text, unit, min: value, max: value };
  }
  if (most && (!least || most.length > least.length)) {
    return { kind: "count", text, unit, min: null, max: value };
  }
  if (least && (!most || least.length > most.length)) {
    return { kind: "count", text, unit, min: value, max: null };
  }
  return unread;
}

export function splitPageCheckSentence(sentence: string): string[] {
  return sentence
    .split(/[.;!?]+(?=\s|$)|[。！？；，、]+|,\s+|\n+/u)
    .map((part) => part.trim())
    .filter((part) => /[\p{L}\p{N}]/u.test(part));
}

export interface PageCheckReading {
  parts: Array<PageCheckPart | PageCheckUnreadPart>;
  tooManyParts: boolean;
}

export function readPageCheckSentence(sentence: string): PageCheckReading {
  const pieces = splitPageCheckSentence(sentence);
  return {
    parts: pieces.slice(0, PAGE_CHECK_MAX_PARTS).map(readPageCheckPart),
    tooManyParts: pieces.length > PAGE_CHECK_MAX_PARTS,
  };
}

export function readablePageCheckParts(
  sentence: string,
): PageCheckPart[] | null {
  const reading = readPageCheckSentence(sentence);
  if (reading.tooManyParts || reading.parts.length === 0) return null;
  const parts: PageCheckPart[] = [];
  for (const part of reading.parts) {
    if (part.kind === "unread") return null;
    parts.push(part);
  }
  return parts;
}

export function hashPageCheckText(value: string): string {
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    first ^= code;
    first = Math.imul(first, 0x01000193);
    second ^= code + index;
    second = Math.imul(second, 0x85ebca6b);
  }
  return (
    (first >>> 0).toString(16).padStart(8, "0") +
    (second >>> 0).toString(16).padStart(8, "0")
  );
}

export function pageCheckWordingHash(check: {
  parts: readonly PageCheckPart[];
  scope: PageCheckScope;
}): string {
  const scope =
    check.scope.kind === "section"
      ? {
          kind: "section",
          at: check.scope.headingId ?? [check.scope.heading, check.scope.level],
        }
      : { kind: check.scope.kind };
  const parts = check.parts.map((part) => [
    part.kind,
    part.unit,
    part.min,
    part.max,
  ]);
  return hashPageCheckText(JSON.stringify({ parts, scope }));
}

function plainText(node: PMNode): string {
  if (node.type === "text") return node.text ?? "";
  if (node.type === "hardBreak") return "\n";
  return (node.content ?? []).map(plainText).join("");
}

function proseBlocks(nodes: readonly PMNode[]): string[] {
  const blocks: string[] = [];
  const visit = (node: PMNode) => {
    if (node.type === "heading" || node.type === "codeBlock") return;
    if (node.type === "paragraph") {
      blocks.push(plainText(node));
      return;
    }
    for (const child of node.content ?? []) visit(child);
  };
  nodes.forEach(visit);
  return blocks;
}

const NO_PARAGRAPHS_INSIDE = new Set([
  "bulletList",
  "orderedList",
  "taskList",
  "listItem",
  "taskItem",
  "table",
  "tableRow",
  "tableHeader",
  "tableCell",
]);

export interface PageCheckBodyBlock {
  node: PMNode;
  path: string;
  paragraph: boolean;
}

function bodyBlocks(doc: PMNode): {
  top: PageCheckBodyBlock[];
  paragraphs: PageCheckBodyBlock[];
} {
  const content = doc.content ?? [];
  const trimmed = isEditorTerminalFiller(
    content[content.length - 1],
    content[content.length - 2],
  )
    ? { ...doc, content: content.slice(0, -1) }
    : doc;
  const top: PageCheckBodyBlock[] = [];
  const paragraphs: PageCheckBodyBlock[] = [];
  const kinds = new Map<string, string>();
  visitBlocksFieldBlocks(trimmed, (node, { path, parentPath }) => {
    kinds.set(path, node.type);
    let inList = false;
    for (
      let parent = parentPath;
      parent !== null;
      parent = parent.includes(".")
        ? parent.slice(0, parent.lastIndexOf("."))
        : null
    ) {
      if (NO_PARAGRAPHS_INSIDE.has(kinds.get(parent) ?? "")) inList = true;
    }
    const block = {
      node,
      path,
      paragraph:
        node.type === "paragraph" && !inList && plainText(node).trim() !== "",
    };
    if (parentPath === null) top.push(block);
    if (block.paragraph) paragraphs.push(block);
  });
  return { top, paragraphs };
}

function excerptOf(nodes: readonly PMNode[]): string {
  for (const node of nodes) {
    const text = plainText(node).replace(/\s+/g, " ").trim();
    if (text) return text.length > 160 ? `${text.slice(0, 159)}…` : text;
  }
  return "";
}

function placeOf(
  key: string,
  blocks: readonly PageCheckBodyBlock[],
  idsByPath: Readonly<Partial<Record<string, string>>>,
  markdown?: string,
): PageCheckPlace {
  const nodes = blocks.map((block) => block.node);
  const text = docToNfm({ type: "doc", content: nodes });
  const first = blocks.length > 0 ? blocks[0] : undefined;
  return {
    key,
    path: first?.path ?? "0",
    blockId: first ? (idsByPath[first.path] ?? null) : null,
    textHash: hashPageCheckText(text.trim()),
    excerpt: excerptOf(nodes),
    markdown: markdown ?? text,
  };
}

function headingOf(
  block: PageCheckBodyBlock,
): { text: string; level: number } | null {
  if (block.node.type !== "heading") return null;
  return {
    text: plainText(block.node).replace(/\s+/g, " ").trim(),
    level: Number(block.node.attrs?.level) || 1,
  };
}

export function pageCheckHeadings(
  markdown: string,
  idsByPath: Readonly<Record<string, string>> = {},
): PageCheckHeading[] {
  return pageCheckHeadingsIn(readPageCheckBody(markdown, idsByPath));
}

export interface PageCheckHeading {
  path: string;
  headingId: string | null;
  heading: string;
  level: number;
}

export function pageCheckHeadingsIn(body: PageCheckBody): PageCheckHeading[] {
  const { top, idsByPath } = body;
  return top.flatMap((block) => {
    const heading = headingOf(block);
    return heading
      ? [
          {
            path: block.path,
            headingId: idsByPath[block.path] ?? null,
            heading: heading.text,
            level: heading.level,
          },
        ]
      : [];
  });
}

export function pageCheckPlaces(
  markdown: string,
  scope: PageCheckScope,
  idsByPath: Readonly<Record<string, string>> = {},
): PageCheckPlaces {
  return pageCheckPlacesIn(readPageCheckBody(markdown, idsByPath), scope);
}

export interface PageCheckBody {
  markdown: string;
  idsByPath: Readonly<Record<string, string>>;
  top: readonly PageCheckBodyBlock[];
  paragraphs: readonly PageCheckBodyBlock[];
  found: Map<string, PageCheckPlaces>;
}

export function readPageCheckBody(
  markdown: string,
  idsByPath: Readonly<Record<string, string>> = {},
  doc: PMNode = nfmToDoc(markdown) as PMNode,
): PageCheckBody {
  return { markdown, idsByPath, ...bodyBlocks(doc), found: new Map() };
}

export function pageCheckPlacesIn(
  body: PageCheckBody,
  scope: PageCheckScope,
): PageCheckPlaces {
  const key = JSON.stringify(scope);
  const found = body.found.get(key) ?? findPageCheckPlaces(body, scope);
  body.found.set(key, found);
  return found;
}

function findPageCheckPlaces(
  body: PageCheckBody,
  scope: PageCheckScope,
): PageCheckPlaces {
  const { markdown, idsByPath, top, paragraphs } = body;
  switch (scope.kind) {
    case "page":
      return {
        status: "ok",
        places: [placeOf("page", top, idsByPath, markdown)],
      };
    case "intro": {
      const end = top.findIndex((block) => block.node.type === "heading");
      const intro = end < 0 ? top : top.slice(0, end);
      return { status: "ok", places: [placeOf("intro", intro, idsByPath)] };
    }
    case "section": {
      const start = top.findIndex((block) => {
        if (scope.headingId) return idsByPath[block.path] === scope.headingId;
        const heading = headingOf(block);
        return (
          heading !== null &&
          heading.text === scope.heading &&
          heading.level === scope.level
        );
      });
      const heading = start < 0 ? undefined : top[start];
      const level = heading ? headingOf(heading)?.level : undefined;
      if (!heading || level === undefined) return { status: "section_deleted" };
      let end = start + 1;
      for (const block of top.slice(start + 1)) {
        const next = headingOf(block);
        if (next && next.level <= level) break;
        end++;
      }
      return {
        status: "ok",
        places: [placeOf("section", top.slice(start, end), idsByPath)],
      };
    }
    case "each_paragraph": {
      const seen = new Map<string, number>();
      return {
        status: "ok",
        places: paragraphs.map((block) => {
          const id = idsByPath[block.path];
          const place = placeOf("", [block], idsByPath);
          const occurrence = seen.get(place.textHash) ?? 0;
          seen.set(place.textHash, occurrence + 1);
          return {
            ...place,
            key: id ? `block:${id}` : `text:${place.textHash}:${occurrence}`,
          };
        }),
      };
    }
  }
}

export function countPageCheckUnit(
  unit: PageCheckUnit,
  markdown: string,
): number {
  if (unit === "words") return countWords(markdown);
  const nodes = (nfmToDoc(markdown) as PMNode).content ?? [];
  if (unit === "sentences") {
    return proseBlocks(nodes).reduce(
      (total, text) => total + countSentences(text),
      0,
    );
  }
  return bodyBlocks({ type: "doc", content: nodes }).paragraphs.length;
}

export function evaluatePageCheckPart(
  part: PageCheckPart,
  place: Pick<PageCheckPlace, "markdown">,
): PageCheckPartResult {
  const count = countPageCheckUnit(part.unit, place.markdown);
  const fine =
    (part.min === null || count >= part.min) &&
    (part.max === null || count <= part.max);
  return { finding: fine ? "fine" : "not_fine", count };
}

export function combinePageCheckFindings(
  results: readonly Pick<PageCheckPartResult, "finding">[],
): PageCheckFinding {
  if (results.some((result) => result.finding === "not_fine"))
    return "not_fine";
  if (results.some((result) => result.finding === "couldnt")) return "couldnt";
  return "fine";
}

export function pageCheckCountDistance(
  part: Pick<PageCheckCountPart, "min" | "max">,
  count: number,
): number {
  if (part.max !== null && count > part.max) return count - part.max;
  if (part.min !== null && count < part.min) return count - part.min;
  return 0;
}

export interface PageCheck {
  id: string;
  documentId: string;
  sentence: string;
  parts: PageCheckPart[];
  scope: PageCheckScope;
  wordingHash: string;
  paused: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface PageCheckResult {
  placeKey: string;
  wordingHash: string;
  textHash: string;
  finding: PageCheckFinding;
  parts: PageCheckPartResult[];
  checkedBy: string;
  checkedAt: string;
}

export interface PageCheckSkip {
  placeKey: string;
  textHash: string;
  skippedBy: string;
}

export interface PageCheckView extends PageCheck {
  answers: PageCheckPlaceAnswer[];
  skips: Pick<PageCheckSkip, "placeKey" | "textHash">[];
}

export interface PageCheckList {
  documentId: string;
  canEdit: boolean;
  checks: PageCheckView[];
}

export interface PageCheckPlaceAnswer {
  key: string;
  place: Omit<PageCheckPlace, "markdown"> | null;
  answer: PageCheckAnswer;
  result: PageCheckResult | null;
  reason?: PageCheckCouldntReason;
}

export function isFreshPageCheckResult(
  result: Pick<PageCheckResult, "wordingHash" | "textHash"> | undefined,
  check: Pick<PageCheck, "wordingHash">,
  place: Pick<PageCheckPlace, "textHash">,
): boolean {
  return (
    result !== undefined &&
    result.wordingHash === check.wordingHash &&
    result.textHash === place.textHash
  );
}

export function pageCheckAnswers(
  check: Pick<PageCheck, "wordingHash">,
  places: PageCheckPlaces,
  results: readonly PageCheckResult[],
  skips: readonly Pick<PageCheckSkip, "placeKey" | "textHash">[],
): PageCheckPlaceAnswer[] {
  if (places.status === "section_deleted") {
    return [
      {
        key: "section",
        place: null,
        answer: "couldnt",
        result: null,
        reason: "section_deleted",
      },
    ];
  }
  const resultsByKey = new Map(
    results.map((result) => [result.placeKey, result]),
  );
  return places.places.map(({ markdown: _markdown, ...place }) => {
    const result = resultsByKey.get(place.key) ?? null;
    const skipped = skips.some(
      (skip) => skip.placeKey === place.key && skip.textHash === place.textHash,
    );
    return {
      key: place.key,
      place,
      answer: skipped
        ? "skipped"
        : result && isFreshPageCheckResult(result, check, place)
          ? result.finding
          : "changed",
      result,
    };
  });
}

export function livePageCheckAnswers(
  check: PageCheckView,
  places: PageCheckPlaces,
): Array<PageCheckPlaceAnswer & { writing: boolean }> {
  const results = check.answers.flatMap((answer) =>
    answer.result ? [answer.result] : [],
  );
  const listed = new Map(check.answers.map((answer) => [answer.key, answer]));
  return pageCheckAnswers(check, places, results, check.skips).map((answer) => {
    const before = listed.get(answer.key);
    const writing =
      answer.answer === "changed" &&
      answer.place !== null &&
      before?.place?.textHash !== answer.place.textHash;
    return writing && answer.result
      ? { ...answer, answer: answer.result.finding, writing }
      : { ...answer, writing };
  });
}

export function checkPageCheckPlace(
  parts: readonly PageCheckPart[],
  place: Pick<PageCheckPlace, "markdown">,
): { finding: PageCheckFinding; parts: PageCheckPartResult[] } {
  const results = parts.map((part) => evaluatePageCheckPart(part, place));
  return { finding: combinePageCheckFindings(results), parts: results };
}
