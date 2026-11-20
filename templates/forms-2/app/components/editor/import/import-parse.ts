import {
  QUESTION_TYPES,
  blockListSchema,
  blockText,
  createBlock,
  questionBlocks,
  type Block,
  type QuestionSpec,
  type QuestionType,
} from "@shared/form-model";

export type ParsedImport = { title: string; blocks: Block[] };

/** An import that produced nothing usable: the caller shows `reason` as copy. */
export type ImportFailure = "unreadable" | "noQuestions";

export class ImportError extends Error {
  constructor(readonly reason: ImportFailure) {
    super(reason);
  }
}

type Row = {
  title: string;
  type?: QuestionType;
  options: string[];
  required: boolean;
};

const TYPE_ALIASES: Record<string, QuestionType> = {
  short: "INPUT_TEXT",
  text: "INPUT_TEXT",
  short_answer: "INPUT_TEXT",
  long: "TEXTAREA",
  long_answer: "TEXTAREA",
  paragraph: "TEXTAREA",
  email: "INPUT_EMAIL",
  number: "INPUT_NUMBER",
  phone: "INPUT_PHONE_NUMBER",
  link: "INPUT_LINK",
  url: "INPUT_LINK",
  date: "INPUT_DATE",
  time: "INPUT_TIME",
  choice: "MULTIPLE_CHOICE",
  multiple_choice: "MULTIPLE_CHOICE",
  checkbox: "CHECKBOXES",
  checkboxes: "CHECKBOXES",
  dropdown: "DROPDOWN",
  select: "DROPDOWN",
  multi_select: "MULTI_SELECT",
  rating: "RATING",
  scale: "LINEAR_SCALE",
  linear_scale: "LINEAR_SCALE",
};

function typeFromName(name: string | undefined): QuestionType | undefined {
  const key = (name ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  const exact = QUESTION_TYPES.find((type) => type.toLowerCase() === key);
  return exact ?? TYPE_ALIASES[key];
}

/** The question type a title suggests when the source names none. */
export function inferType(title: string, options: string[]): QuestionType {
  if (options.length > 0)
    return /select all|all that apply|check all|multiple/i.test(title)
      ? "CHECKBOXES"
      : "MULTIPLE_CHOICE";
  const lower = title.toLowerCase();
  if (/e-?mail/.test(lower)) return "INPUT_EMAIL";
  if (/phone|mobile|telephone/.test(lower)) return "INPUT_PHONE_NUMBER";
  if (/website|url|\blink\b/.test(lower)) return "INPUT_LINK";
  if (/\bdate\b|birthday|when (is|was|will)/.test(lower)) return "INPUT_DATE";
  if (/\btime\b|what time/.test(lower)) return "INPUT_TIME";
  if (/rate |rating|how satisfied|stars/.test(lower)) return "RATING";
  if (/how many|\bage\b|\bnumber of\b|quantity|\bamount\b/.test(lower))
    return "INPUT_NUMBER";
  if (
    /describe|explain|comments?|feedback|tell us|message|why |details/.test(
      lower,
    )
  )
    return "TEXTAREA";
  return "INPUT_TEXT";
}

function specOf(row: Row): QuestionSpec {
  const type = row.type ?? inferType(row.title, row.options);
  return {
    type,
    title: row.title,
    isRequired: row.required,
    options: row.options.length > 0 ? row.options : undefined,
    ...(type === "LINEAR_SCALE"
      ? { settings: { start: 1, end: 5, step: 1 } }
      : {}),
  };
}

function withFallbackOptions(spec: QuestionSpec): QuestionSpec {
  const isChoice = [
    "MULTIPLE_CHOICE",
    "CHECKBOXES",
    "DROPDOWN",
    "MULTI_SELECT",
  ].includes(spec.type);
  return isChoice && !spec.options?.length
    ? { ...spec, options: ["Option 1", "Option 2"] }
    : spec;
}

function blocksOf(rows: Row[]): Block[] {
  return rows.flatMap((row) =>
    questionBlocks(withFallbackOptions(specOf(row))),
  );
}

function requiredMark(title: string): { title: string; required: boolean } {
  const trimmed = title.trim();
  return trimmed.endsWith("*")
    ? { title: trimmed.slice(0, -1).trim(), required: true }
    : { title: trimmed, required: false };
}

function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < line.length; index++) {
    const char = line[index];
    if (quoted) {
      if (char === '"' && line[index + 1] === '"') {
        cell += '"';
        index++;
      } else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") {
      cells.push(cell);
      cell = "";
    } else cell += char;
  }
  cells.push(cell);
  return cells.map((value) => value.trim());
}

const splitOptions = (value: string | undefined) =>
  (value ?? "")
    .split(/[|;]/)
    .map((option) => option.trim())
    .filter(Boolean);

function parseCsv(source: string): ParsedImport {
  const lines = source.split(/\r?\n/).filter((line) => line.trim() !== "");
  const [first, ...rest] = lines;
  if (!first) throw new ImportError("noQuestions");
  const header = parseCsvLine(first).map((cell) => cell.toLowerCase());
  const column = (names: string[]) =>
    header.findIndex((cell) => names.includes(cell));
  const titleAt = column(["question", "title", "label", "name"]);
  const hasHeader = titleAt >= 0;
  const typeAt = column(["type", "kind"]);
  const optionsAt = column(["options", "choices"]);
  const requiredAt = column(["required", "mandatory"]);
  const rows = (hasHeader ? rest : lines).map((line): Row | null => {
    const cells = parseCsvLine(line);
    const marked = requiredMark(cells[hasHeader ? titleAt : 0] ?? "");
    if (!marked.title) return null;
    if (hasHeader) {
      const type = typeFromName(cells[typeAt]);
      return {
        title: marked.title,
        ...(type ? { type } : {}),
        options: splitOptions(cells[optionsAt]),
        required:
          marked.required ||
          /^(true|yes|y|1|required)$/i.test(cells[requiredAt] ?? ""),
      };
    }
    const others = cells.slice(1).filter(Boolean);
    const type = typeFromName(others[0]);
    return {
      title: marked.title,
      ...(type ? { type } : {}),
      options: (type ? others.slice(1) : others).flatMap(splitOptions),
      required: marked.required,
    };
  });
  const parsed = rows.filter((row): row is Row => row !== null);
  if (parsed.length === 0) throw new ImportError("noQuestions");
  return { title: "", blocks: blocksOf(parsed) };
}

const LIST_ITEM = /^\s*(?:[-*+•]|\d+[.)]|[a-zA-Z][.)])\s+(.*)$/;

function parseLines(source: string): ParsedImport {
  const blocks: Block[] = [];
  let title = "";
  let pending: Row | null = null;
  const flush = () => {
    if (pending) blocks.push(...blocksOf([pending]));
    pending = null;
  };
  for (const raw of source.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const headingMatch = /^(#{1,3})\s+(.*)$/.exec(line);
    if (headingMatch) {
      flush();
      const text = (headingMatch[2] ?? "").trim();
      if (headingMatch[1] === "#" && !title && blocks.length === 0)
        title = text;
      else
        blocks.push(
          createBlock(
            `HEADING_${Math.min(3, (headingMatch[1] ?? "#").length + 1)}` as "HEADING_2",
            {
              text,
            },
          ),
        );
      continue;
    }
    const item = LIST_ITEM.exec(raw);
    if (item && pending) {
      const option = (item[1] ?? "").trim();
      if (option) pending.options.push(option);
      continue;
    }
    flush();
    const marked = requiredMark(line.replace(LIST_ITEM, "$1"));
    if (marked.title)
      pending = { title: marked.title, options: [], required: marked.required };
  }
  flush();
  if (blocks.length === 0) throw new ImportError("noQuestions");
  return { title, blocks };
}

function parseJson(source: string): ParsedImport {
  let data: unknown;
  try {
    data = JSON.parse(source);
  } catch {
    // coercion-ok: invalid JSON is reported as an unreadable file.
    throw new ImportError("unreadable");
  }
  const asBlocks = blockListSchema.safeParse(data);
  if (asBlocks.success) {
    const [first, ...rest] = asBlocks.data;
    const hasTitle = first?.type === "FORM_TITLE";
    const content = hasTitle ? rest : asBlocks.data;
    if (content.length === 0) throw new ImportError("noQuestions");
    return {
      title: hasTitle ? blockText(first) : "",
      blocks: content,
    };
  }
  const record = (data ?? {}) as { title?: unknown; questions?: unknown };
  const list = Array.isArray(data) ? data : record.questions;
  if (!Array.isArray(list)) throw new ImportError("noQuestions");
  const rows = list.flatMap((entry): Row[] => {
    const item = (entry ?? {}) as Record<string, unknown>;
    const raw =
      typeof entry === "string" ? entry : (item.title ?? item.question);
    if (typeof raw !== "string" || !raw.trim()) return [];
    const marked = requiredMark(raw);
    const options = Array.isArray(item.options)
      ? item.options.filter(
          (o): o is string => typeof o === "string" && o !== "",
        )
      : [];
    const type = typeFromName(
      typeof item.type === "string" ? item.type : undefined,
    );
    return [
      {
        title: marked.title,
        ...(type ? { type } : {}),
        options,
        required: marked.required || item.required === true,
      },
    ];
  });
  if (rows.length === 0) throw new ImportError("noQuestions");
  return {
    title: typeof record.title === "string" ? record.title : "",
    blocks: blocksOf(rows),
  };
}

export const MAX_TEXT_IMPORT_BYTES = 1_000_000;

/** Parses a text, CSV, Markdown or JSON file the way the editor imports it. */
export function parseImportText(name: string, source: string): ParsedImport {
  if (source.includes("\u0000")) throw new ImportError("unreadable");
  const extension = name.toLowerCase().split(".").pop();
  if (extension === "json") return parseJson(source);
  if (extension === "csv") return parseCsv(source);
  return parseLines(source);
}

export type ImportKind = "text" | "agent";

const TEXT_EXTENSIONS = ["csv", "md", "markdown", "txt", "json"];

/** Text-like files are parsed in the browser; PDF, Word and images go to the agent. */
export function importKindOf(
  name: string,
  mediaType: string,
): ImportKind | null {
  const extension = name.toLowerCase().split(".").pop() ?? "";
  if (TEXT_EXTENSIONS.includes(extension) || mediaType.startsWith("text/"))
    return "text";
  if (
    ["pdf", "doc", "docx"].includes(extension) ||
    mediaType.startsWith("image/") ||
    mediaType === "application/pdf"
  )
    return "agent";
  return null;
}
