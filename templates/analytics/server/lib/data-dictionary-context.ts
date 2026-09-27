type DictionaryEntry = Record<string, unknown>;

const MAX_INJECTED_ENTRIES = 40;
const MAX_DICTIONARY_CONTEXT_CHARS = 10_000;

function compact(value: unknown, max = 240): string {
  const text = (
    typeof value === "string" ? value : (JSON.stringify(value) ?? "")
  )
    .replace(/\s+/g, " ")
    .trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max)}...`;
}

function boolValue(value: unknown): boolean {
  if (value === true) return true;
  if (typeof value === "string") return value.toLowerCase() === "true";
  return false;
}

function sortByMetric(entries: DictionaryEntry[]): DictionaryEntry[] {
  return [...entries].sort((a, b) =>
    (typeof a.metric === "string"
      ? a.metric
      : (JSON.stringify(a.metric) ?? "")
    ).localeCompare(
      typeof b.metric === "string"
        ? b.metric
        : (JSON.stringify(b.metric) ?? ""),
    ),
  );
}

function renderEntry(
  entry: DictionaryEntry,
  trustLabel: "approved/canonical" | "unreviewed/human" | "ai-suggestion",
): string[] {
  const metric = compact(entry.metric, 120);
  const definition = compact(entry.definition, 360);
  const lines = [
    `- **${metric}** (${trustLabel})${definition ? ` - ${definition}` : ""}`,
  ];

  if (trustLabel === "unreviewed/human") {
    lines.push(
      "  - trust: human-authored but not marked approved; use with light verification when stakes are high",
    );
  }
  if (trustLabel === "ai-suggestion") {
    lines.push(
      "  - trust: AI-generated suggestion only; verify table, columns, and meaning before using as truth",
    );
  }

  const table = compact(entry.table, 240);
  if (table) lines.push(`  - table: ${table}`);
  const source = compact(entry.source, 240);
  if (source) lines.push(`  - source: ${source}`);
  const action = compact(entry.action, 160);
  if (action) lines.push(`  - query action: ${action}`);
  const columns = compact(entry.columnsUsed, 360);
  if (columns) lines.push(`  - columns: ${columns}`);
  const cuts = compact(entry.cuts, 240);
  if (cuts) lines.push(`  - standard cuts: ${cuts}`);
  const template = compact(entry.queryTemplate, 240);
  if (template) lines.push(`  - query: ${template}`);
  const joinPattern = compact(entry.joinPattern, 360);
  if (joinPattern) lines.push(`  - joins: ${joinPattern}`);
  const freshness = compact(
    [entry.updateFrequency, entry.dataLag]
      .filter((value) => compact(value, 120))
      .join("; "),
    240,
  );
  if (freshness) lines.push(`  - freshness: ${freshness}`);
  const dependencies = compact(entry.dependencies, 240);
  if (dependencies) lines.push(`  - dependencies: ${dependencies}`);
  const validDateRange = compact(entry.validDateRange, 180);
  if (validDateRange) lines.push(`  - valid range: ${validDateRange}`);
  const owner = compact(entry.owner, 160);
  if (owner) lines.push(`  - owner: ${owner}`);
  const commonQuestions = compact(entry.commonQuestions, 300);
  if (commonQuestions) lines.push(`  - common questions: ${commonQuestions}`);
  const gotchas = compact(entry.knownGotchas, 360);
  if (gotchas) lines.push(`  - gotchas: ${gotchas}`);

  return lines;
}

function takeWithinBudget<T>(
  entries: T[],
  renderedCount: number,
): { entries: T[]; renderedCount: number; omitted: number } {
  const remaining = Math.max(0, MAX_INJECTED_ENTRIES - renderedCount);
  const selected = entries.slice(0, remaining);
  return {
    entries: selected,
    renderedCount: renderedCount + selected.length,
    omitted: entries.length - selected.length,
  };
}

function renderOmittedDictionaryEntries(omitted: number): string[] {
  if (omitted <= 0) return [];
  return [
    `${omitted} additional data-dictionary entr${
      omitted === 1 ? "y was" : "ies were"
    } omitted from prompt context for efficiency. Call \`list-data-dictionary\` with a focused \`search\` or \`department\` filter before writing SQL or making claims that may depend on omitted definitions.`,
    "",
  ];
}

function renderedTextLength(lines: string[]): number {
  return lines.reduce((total, line) => total + line.length + 1, 0);
}

type TrustLabel = "approved/canonical" | "unreviewed/human" | "ai-suggestion";

function renderGroupWithinBudget(
  lines: string[],
  title: string,
  groupEntries: DictionaryEntry[],
  trustLabel: TrustLabel,
  renderedCount: number,
  state: { charBudgetExceeded: boolean; anyEntryRendered: boolean },
): { renderedCount: number; omitted: number } {
  if (!groupEntries.length) return { renderedCount, omitted: 0 };

  const budgeted = takeWithinBudget(groupEntries, renderedCount);
  let omitted = budgeted.omitted;
  const bodyLines: string[] = [];
  let includedFromGroup = 0;

  for (const entry of budgeted.entries) {
    if (state.charBudgetExceeded) {
      omitted += 1;
      continue;
    }

    const entryLines = renderEntry(entry, trustLabel);
    const headerAddition = includedFromGroup === 0 ? title.length + 1 : 0;
    const prospectiveTotal =
      renderedTextLength(lines) +
      headerAddition +
      renderedTextLength(bodyLines) +
      renderedTextLength(entryLines);

    if (
      prospectiveTotal > MAX_DICTIONARY_CONTEXT_CHARS &&
      state.anyEntryRendered
    ) {
      state.charBudgetExceeded = true;
      omitted += 1;
      continue;
    }

    bodyLines.push(...entryLines);
    includedFromGroup += 1;
    state.anyEntryRendered = true;
  }

  if (includedFromGroup > 0) {
    lines.push(title, ...bodyLines, "");
  }

  return { renderedCount: budgeted.renderedCount, omitted };
}

export function renderDataDictionary(entries: DictionaryEntry[]): string {
  const usable = entries.filter((entry) => compact(entry.metric, 120));
  if (!usable.length) return "";

  const approved = sortByMetric(
    usable.filter((entry) => boolValue(entry.approved)),
  );
  const humanUnreviewed = sortByMetric(
    usable.filter(
      (entry) => !boolValue(entry.approved) && !boolValue(entry.aiGenerated),
    ),
  );
  const aiSuggestions = sortByMetric(
    usable.filter(
      (entry) => !boolValue(entry.approved) && boolValue(entry.aiGenerated),
    ),
  );
  const includeAiSuggestions = approved.length + humanUnreviewed.length === 0;
  let renderedCount = 0;
  let omittedEntries = 0;
  const budgetState = { charBudgetExceeded: false, anyEntryRendered: false };

  const lines: string[] = [
    "<data-dictionary>",
    "Canonical metric/table/column definitions for this organization.",
    "Trust tiers: approved entries are canonical and should be used verbatim; unreviewed human entries are usable but should be verified for high-stakes numbers; AI-generated unapproved entries are suggestions only.",
    "If the metric you need is not here, call `list-data-dictionary`, inspect configured schemas with `search-bigquery-schema`, or ask the user before guessing.",
    "",
  ];

  const approvedResult = renderGroupWithinBudget(
    lines,
    "## Approved canonical entries",
    approved,
    "approved/canonical",
    renderedCount,
    budgetState,
  );
  renderedCount = approvedResult.renderedCount;
  omittedEntries += approvedResult.omitted;

  const humanResult = renderGroupWithinBudget(
    lines,
    "## Unreviewed human-authored entries",
    humanUnreviewed,
    "unreviewed/human",
    renderedCount,
    budgetState,
  );
  renderedCount = humanResult.renderedCount;
  omittedEntries += humanResult.omitted;

  if (includeAiSuggestions && aiSuggestions.length) {
    const aiResult = renderGroupWithinBudget(
      lines,
      "## AI-generated suggestions",
      aiSuggestions,
      "ai-suggestion",
      renderedCount,
      budgetState,
    );
    renderedCount = aiResult.renderedCount;
    omittedEntries += aiResult.omitted;
  } else if (aiSuggestions.length) {
    lines.push(
      `${aiSuggestions.length} AI-generated unapproved suggestion${
        aiSuggestions.length === 1 ? "" : "s"
      } available via \`list-data-dictionary\`; do not treat them as canonical without verification.`,
      "",
    );
  }

  lines.push(...renderOmittedDictionaryEntries(omittedEntries));
  lines.push("</data-dictionary>");
  return lines.join("\n");
}
