import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

// Text-preserving edits to pnpm-workspace.yaml, shared by `create` and `upgrade`.

/**
 * Merge key-value entries into named sections of a pnpm-workspace.yaml string
 * without creating duplicate section headers. For each section:
 *   - If the section already exists, new entries are injected after its header.
 *   - If the section is absent, a new block is appended at the end.
 * Entries already present (by key) are skipped.
 */
export function mergeWorkspaceYamlSections(
  yaml: string,
  sections: Record<string, Record<string, string>>,
): string {
  let result = yaml;
  for (const [section, entries] of Object.entries(sections)) {
    for (const [key, value] of Object.entries(entries)) {
      const existingSection = findWorkspaceYamlSection(result, section);
      if (existingSection?.kind === "flow") {
        if (workspaceYamlFlowMappingHasEntry(existingSection, section, key)) {
          continue;
        }
        result = appendWorkspaceYamlFlowEntry(
          result,
          existingSection,
          `${formatWorkspaceYamlString(normalizeYamlScalar(key))}: ${formatWorkspaceYamlScalar(value)}`,
        );
      } else if (existingSection?.kind === "scalar") {
        throw unsupportedWorkspaceYamlSection(section, "mapping");
      } else if (existingSection) {
        if (workspaceYamlSectionHasEntry(existingSection, key)) continue;
        result =
          result.slice(0, existingSection.insertAt) +
          `\n${existingSection.indent}${key}: ${value}` +
          result.slice(existingSection.insertAt);
      } else {
        result =
          result.trimEnd() +
          (result ? "\n" : "") +
          `\n${section}:\n  ${key}: ${value}\n`;
      }
    }
  }
  return result;
}

function workspaceYamlSectionHasEntry(
  existingSection: Extract<WorkspaceYamlSection, { kind: "block" }>,
  key: string,
): boolean {
  return existingSection.body.split(/\r?\n/).some((line) => {
    const entry = parseYamlMappingKey(line, existingSection.indent);
    return (
      entry !== undefined &&
      normalizeYamlScalar(entry) === normalizeYamlScalar(key)
    );
  });
}

type WorkspaceYamlSection =
  | { kind: "block"; body: string; indent: string; insertAt: number }
  | {
      kind: "flow";
      collection: "mapping" | "sequence";
      value: Record<string, unknown> | unknown[];
      start: number;
      end: number;
    }
  | { kind: "scalar" };

function findWorkspaceYamlSection(
  yaml: string,
  section: string,
): WorkspaceYamlSection | undefined {
  const name = escapeRegExp(section);
  const sectionHeader = new RegExp(
    `^(?:${name}|"${name}"|'${name}'):[ \\t]*`,
    "m",
  );
  const match = sectionHeader.exec(yaml);
  if (!match) return undefined;

  const valueStart = match.index + match[0].length;
  const remainingValue = yaml.slice(valueStart);
  if (remainingValue.startsWith("{") || remainingValue.startsWith("[")) {
    let end: number;
    try {
      end = findFlowCollectionEnd(remainingValue);
    } catch (error) {
      throw new Error(
        `Cannot update flow-style ${section} in pnpm-workspace.yaml. Convert it to block style before scaffolding.`,
        { cause: error },
      );
    }
    const source = remainingValue.slice(0, end + 1);
    let parsed: unknown;
    try {
      parsed = parseYaml(source);
    } catch (error) {
      throw new Error(
        `Cannot update flow-style ${section} in pnpm-workspace.yaml. Convert it to block style before scaffolding.`,
        { cause: error },
      );
    }
    if (source.startsWith("{") && isPlainRecord(parsed)) {
      return {
        kind: "flow",
        collection: "mapping",
        value: parsed,
        start: valueStart,
        end: valueStart + end + 1,
      };
    }
    if (source.startsWith("[") && Array.isArray(parsed)) {
      return {
        kind: "flow",
        collection: "sequence",
        value: parsed,
        start: valueStart,
        end: valueStart + end + 1,
      };
    }
    throw unsupportedWorkspaceYamlSection(section, "mapping or sequence");
  }
  const lineEnd = yaml.indexOf("\n", valueStart);
  const scalar = yaml
    .slice(valueStart, lineEnd === -1 ? yaml.length : lineEnd)
    .trim();
  if (scalar && !scalar.startsWith("#")) {
    return { kind: "scalar" };
  }

  const insertAt = lineEnd === -1 ? yaml.length : lineEnd;
  const remaining = yaml.slice(insertAt);
  const nextSection = /^(?!#)\S[^:\n]*:[^\n]*$/m.exec(remaining);
  const body = remaining.slice(0, nextSection?.index ?? remaining.length);
  // A block sequence may sit at the key's column (`key:` then `- item`).
  const indent = body
    .split(/\r?\n/)
    .filter((line) => line.trim() && !line.trimStart().startsWith("#"))
    .map((line) =>
      /^-(?:[ \t]|$)/.test(line) ? "" : line.match(/^[ \t]+/)?.[0],
    )
    .filter((value): value is string => value !== undefined)
    .sort((a, b) => a.length - b.length)[0];
  return {
    kind: "block",
    body,
    indent: indent ?? "  ",
    insertAt,
  };
}

function findFlowCollectionEnd(source: string): number {
  const closingFor: Record<string, string> = { "{": "}", "[": "]" };
  const first = source[0];
  const firstClose = first ? closingFor[first] : undefined;
  if (!firstClose) throw new Error("Expected a flow-style YAML collection.");

  const stack = [firstClose];
  let quote: "'" | '"' | undefined;
  let escaped = false;
  for (let index = 1; index < source.length; index++) {
    const char = source[index]!;
    if (quote === '"' && char === "\\" && !escaped) {
      escaped = true;
      continue;
    }
    if (quote && char === quote) {
      if (quote === "'" && source[index + 1] === "'") {
        index++;
        continue;
      }
      if (!escaped) quote = undefined;
    } else if (!quote && (char === "'" || char === '"')) {
      quote = char;
    } else if (!quote && (char === "{" || char === "[")) {
      stack.push(closingFor[char]!);
    } else if (!quote && (char === "}" || char === "]")) {
      if (stack.pop() !== char) {
        throw new Error("Cannot update an invalid flow-style YAML collection.");
      }
      if (stack.length === 0) return index;
    } else if (
      !quote &&
      char === "#" &&
      (index === 0 || /[ \t\r\n]/.test(source[index - 1]!))
    ) {
      const newline = source.indexOf("\n", index);
      if (newline < 0) break;
      index = newline;
    }
    escaped = false;
  }
  throw new Error("Cannot update an unterminated flow-style YAML collection.");
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function unsupportedWorkspaceYamlSection(
  section: string,
  expected: string,
): Error {
  return new Error(
    `Cannot merge ${section} in pnpm-workspace.yaml because its value is not a supported flow-style ${expected}. Convert it to block style before scaffolding.`,
  );
}

function workspaceYamlFlowMappingHasEntry(
  section: Extract<WorkspaceYamlSection, { kind: "flow" }>,
  sectionName: string,
  key: string,
): boolean {
  if (section.collection !== "mapping" || Array.isArray(section.value)) {
    throw unsupportedWorkspaceYamlSection(sectionName, "mapping");
  }
  return Object.keys(section.value).some(
    (existingKey) =>
      normalizeYamlScalar(existingKey) === normalizeYamlScalar(key),
  );
}

function appendWorkspaceYamlFlowEntry(
  yaml: string,
  section: Extract<WorkspaceYamlSection, { kind: "flow" }>,
  entry: string,
): string {
  const collection = yaml.slice(section.start, section.end);
  const inner = collection.slice(1, -1);
  if (hasUnquotedFlowComment(inner)) {
    throw new Error(
      "Cannot update a flow-style YAML collection with comments. Convert it to block style before scaffolding.",
    );
  }
  const content = inner.trimEnd();
  const trailing = inner.slice(content.length);
  const separator = !content.trim()
    ? ""
    : content.endsWith(",")
      ? " "
      : inner.includes("\n")
        ? `,\n${inner.match(/(?:^|\r?\n)([ \t]*)\S/)?.[1] ?? "  "}`
        : ", ";
  const nextCollection = `${collection[0]}${content}${separator}${entry}${trailing}${collection.at(-1)}`;
  return (
    yaml.slice(0, section.start) + nextCollection + yaml.slice(section.end)
  );
}

function hasUnquotedFlowComment(source: string): boolean {
  let quote: "'" | '"' | undefined;
  let escaped = false;
  for (let index = 0; index < source.length; index++) {
    const char = source[index]!;
    if (quote === '"' && char === "\\" && !escaped) {
      escaped = true;
      continue;
    }
    if (quote && char === quote) {
      if (quote === "'" && source[index + 1] === "'") {
        index++;
        continue;
      }
      if (!escaped) quote = undefined;
    } else if (!quote && (char === "'" || char === '"')) {
      quote = char;
    } else if (
      !quote &&
      char === "#" &&
      (index === 0 || /[ \t\r\n]/.test(source[index - 1]!))
    ) {
      return true;
    }
    escaped = false;
  }
  return false;
}

function formatWorkspaceYamlScalar(value: string): string {
  let parsed: unknown;
  try {
    parsed = parseYaml(value);
  } catch (error) {
    throw new Error(
      "Cannot merge an invalid YAML scalar into pnpm-workspace.yaml.",
      {
        cause: error,
      },
    );
  }
  if (parsed !== null && typeof parsed === "object") {
    throw new Error(
      "Cannot merge a non-scalar value into pnpm-workspace.yaml.",
    );
  }
  return stringifyYaml(parsed).trim();
}

function formatWorkspaceYamlString(value: string): string {
  return stringifyYaml(value).trim();
}

function parseYamlMappingKey(line: string, indent: string): string | undefined {
  if (!line.startsWith(indent)) return undefined;
  const content = line.slice(indent.length);
  let quote: "'" | '"' | undefined;
  let escaped = false;
  for (let index = 0; index < content.length; index++) {
    const char = content[index];
    if (quote === '"' && char === "\\" && !escaped) {
      escaped = true;
      continue;
    }
    if (quote && char === quote) {
      if (quote === "'" && content[index + 1] === "'") {
        index++;
        continue;
      }
      if (!escaped) quote = undefined;
    } else if (!quote && (char === "'" || char === '"')) {
      quote = char;
    } else if (
      !quote &&
      char === ":" &&
      (index === content.length - 1 || /[ \t]/.test(content[index + 1]!))
    ) {
      return content.slice(0, index).trim();
    }
    escaped = false;
  }
  return undefined;
}

function normalizeYamlScalar(value: string): string {
  let scalar = value.trim();
  let quote: "'" | '"' | undefined;
  for (let index = 0; index < scalar.length; index++) {
    const char = scalar[index];
    if (quote === '"' && char === "\\") {
      index++;
      continue;
    }
    if (quote && char === quote) quote = undefined;
    else if (!quote && (char === "'" || char === '"')) quote = char;
    else if (
      !quote &&
      char === "#" &&
      (index === 0 || /[ \t]/.test(scalar[index - 1]!))
    ) {
      scalar = scalar.slice(0, index).trimEnd();
      break;
    }
  }
  if (scalar.startsWith('"') && scalar.endsWith('"')) {
    try {
      return JSON.parse(scalar);
    } catch {
      return scalar.slice(1, -1);
    }
  }
  if (scalar.startsWith("'") && scalar.endsWith("'")) {
    return scalar.slice(1, -1).replace(/''/g, "'");
  }
  return scalar;
}

export function mergeWorkspaceYamlListItems(
  yaml: string,
  section: string,
  items: string[],
): string {
  let result = yaml;
  for (const item of items) {
    const existingSection = findWorkspaceYamlSection(result, section);
    if (existingSection?.kind === "flow") {
      if (
        existingSection.collection !== "sequence" ||
        !Array.isArray(existingSection.value)
      ) {
        throw unsupportedWorkspaceYamlSection(section, "sequence");
      }
      const normalizedItem = normalizeYamlScalar(item);
      const isPresent = existingSection.value.some(
        (value) => normalizeYamlScalar(String(value)) === normalizedItem,
      );
      if (isPresent) continue;
      result = appendWorkspaceYamlFlowEntry(
        result,
        existingSection,
        formatWorkspaceYamlString(normalizedItem),
      );
      continue;
    }
    if (existingSection?.kind === "scalar") {
      throw unsupportedWorkspaceYamlSection(section, "sequence");
    }
    const isPresent = existingSection?.body.split(/\r?\n/).some((line) => {
      if (!line.startsWith(existingSection.indent)) return false;
      const entry = line
        .slice(existingSection.indent.length)
        .match(/^-[ \t]+(.+)$/);
      return (
        entry !== null &&
        normalizeYamlScalar(entry[1]!) === normalizeYamlScalar(item)
      );
    });
    if (isPresent) continue;
    if (existingSection) {
      result =
        result.slice(0, existingSection.insertAt) +
        `\n${existingSection.indent}- ${item}` +
        result.slice(existingSection.insertAt);
    } else {
      result =
        result.trimEnd() +
        (result ? "\n" : "") +
        `\n${section}:\n  - ${item}\n`;
    }
  }
  return result;
}

/**
 * Add `item` to `minimumReleaseAgeExclude` when the workspace turns on pnpm's
 * `minimumReleaseAge` gate. Returns the input unchanged when the gate is off
 * or the item is already listed; throws when the YAML cannot be parsed, the
 * section is not a list, or the edited text would not parse to a list that
 * holds the item.
 */
export function addMinimumReleaseAgeExclude(
  yaml: string,
  item: string,
): string {
  const parsed: unknown = parseYaml(yaml);
  if (!isPlainRecord(parsed) || !parsed.minimumReleaseAge) return yaml;
  const value = normalizeYamlScalar(item);
  if (listsReleaseAgeExclude(parsed, value)) return yaml;
  const updated = mergeWorkspaceYamlListItems(
    yaml,
    "minimumReleaseAgeExclude",
    [item],
  );
  let reparsed: unknown;
  try {
    reparsed = parseYaml(updated);
  } catch (error) {
    throw new Error(
      `Adding ${item} to minimumReleaseAgeExclude would leave pnpm-workspace.yaml invalid.`,
      { cause: error },
    );
  }
  if (!listsReleaseAgeExclude(reparsed, value)) {
    throw new Error(
      `Could not add ${item} to minimumReleaseAgeExclude in pnpm-workspace.yaml.`,
    );
  }
  return updated;
}

function listsReleaseAgeExclude(parsed: unknown, value: string): boolean {
  if (!isPlainRecord(parsed)) return false;
  const exclude = parsed.minimumReleaseAgeExclude;
  return Array.isArray(exclude) && exclude.includes(value);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
