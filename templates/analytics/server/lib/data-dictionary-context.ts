type DictionaryEntry = Record<string, unknown>;

function compact(value: unknown, max = 240): string {
  const text = String(value ?? "")
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
    String(a.metric ?? "").localeCompare(String(b.metric ?? "")),
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
  const columns = compact(entry.columnsUsed, 360);
  if (columns) lines.push(`  - columns: ${columns}`);
  const template = compact(entry.queryTemplate, 240);
  if (template) lines.push(`  - query: ${template}`);
  const gotchas = compact(entry.knownGotchas, 360);
  if (gotchas) lines.push(`  - gotchas: ${gotchas}`);

  return lines;
}

/**
 * Render data-dictionary entries as compact prompt context.
 *
 * Trust tiers:
 * - approved entries are canonical and should be used verbatim.
 * - human-authored entries without approval still stay visible so an org with
 *   no review workflow does not lose its dictionary.
 * - AI-generated unapproved entries are suggestions; they are only injected in
 *   full when there is no human-authored dictionary context at all.
 */
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

  const lines: string[] = [
    "<data-dictionary>",
    "Canonical metric/table/column definitions for this organization.",
    "Trust tiers: approved entries are canonical and should be used verbatim; unreviewed human entries are usable but should be verified for high-stakes numbers; AI-generated unapproved entries are suggestions only.",
    "If the metric you need is not here, call `list-data-dictionary`, inspect configured schemas with `search-bigquery-schema`, or ask the user before guessing.",
    "",
  ];

  if (approved.length) {
    lines.push("## Approved canonical entries");
    for (const entry of approved) {
      lines.push(...renderEntry(entry, "approved/canonical"));
    }
    lines.push("");
  }

  if (humanUnreviewed.length) {
    lines.push("## Unreviewed human-authored entries");
    for (const entry of humanUnreviewed) {
      lines.push(...renderEntry(entry, "unreviewed/human"));
    }
    lines.push("");
  }

  if (includeAiSuggestions && aiSuggestions.length) {
    lines.push("## AI-generated suggestions");
    for (const entry of aiSuggestions) {
      lines.push(...renderEntry(entry, "ai-suggestion"));
    }
    lines.push("");
  } else if (aiSuggestions.length) {
    lines.push(
      `${aiSuggestions.length} AI-generated unapproved suggestion${
        aiSuggestions.length === 1 ? "" : "s"
      } available via \`list-data-dictionary\`; do not treat them as canonical without verification.`,
      "",
    );
  }

  lines.push("</data-dictionary>");
  return lines.join("\n");
}
