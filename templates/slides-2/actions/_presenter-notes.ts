import type { ShareRole } from "@agent-native/core/sharing";
import * as t from "@babel/types";

import { parseSource } from "../server/lib/slide-source-editing/babel-walk.js";
import { hashSlideSource } from "../server/lib/slide-source.js";

export type DeckReadAccessRole = "owner" | ShareRole;

export function canReadPresenterNotes(role: DeckReadAccessRole): boolean {
  return role === "owner" || role === "admin" || role === "editor";
}

export function redactPresenterNotes(slide: unknown): unknown {
  if (!slide || typeof slide !== "object" || Array.isArray(slide)) {
    return slide;
  }
  const { notes: _notes, ...visibleSlide } = slide as Record<string, unknown>;
  if (typeof visibleSlide.sourceTsx === "string") {
    const sourceTsx = stripPresenterNotesExport(visibleSlide.sourceTsx);
    if (sourceTsx === null) {
      delete visibleSlide.sourceTsx;
      delete visibleSlide.sourceHash;
    } else if (sourceTsx !== visibleSlide.sourceTsx) {
      visibleSlide.sourceTsx = sourceTsx;
      if (typeof visibleSlide.sourceHash === "string") {
        visibleSlide.sourceHash = hashSlideSource(sourceTsx);
      }
    }
  }
  return visibleSlide;
}

function stripPresenterNotesExport(source: string): string | null {
  if (!/\bnotes\b/.test(source)) return source;
  const ast = parseSource(source);
  if (!ast) return null;

  const edits: Array<{ start: number; end: number; replacement: string }> = [];
  for (const statement of ast.program.body) {
    if (
      !t.isExportNamedDeclaration(statement) ||
      !t.isVariableDeclaration(statement.declaration)
    ) {
      continue;
    }
    const declaration = statement.declaration;
    const remaining = declaration.declarations.filter(
      (entry) => !t.isIdentifier(entry.id, { name: "notes" }),
    );
    if (remaining.length === declaration.declarations.length) continue;
    if (statement.start == null || statement.end == null) return null;

    if (remaining.length === 0) {
      edits.push({
        start: statement.start,
        end: statement.end,
        replacement: "",
      });
      continue;
    }
    if (declaration.start == null || declaration.end == null) return null;
    if (remaining.some((entry) => entry.start == null || entry.end == null)) {
      return null;
    }
    edits.push({
      start: statement.start,
      end: statement.end,
      replacement: `${source.slice(statement.start, declaration.start)}${declaration.kind} ${remaining
        .map((entry) => source.slice(entry.start ?? 0, entry.end ?? 0))
        .join(", ")}${source.slice(declaration.end, statement.end)}`,
    });
  }
  if (edits.length === 0) return source;

  let redacted = source;
  for (const edit of edits.sort((a, b) => b.start - a.start)) {
    redacted =
      redacted.slice(0, edit.start) +
      edit.replacement +
      redacted.slice(edit.end);
  }
  return parseSource(redacted) ? redacted : null;
}
