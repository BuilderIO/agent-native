import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const source = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "SlideEditor.tsx"),
  "utf8",
);
describe("SlideEditor render-phase safety", () => {
  it("never passes an updater function to setEditingEl", () => {
    const updaterCalls = source.match(
      /setEditingEl\(\s*(?:\(|function\b|[A-Za-z_$][\w$]*\s*=>)/g,
    );
    expect(updaterCalls).toBeNull();
  });

  it("never flushes onUpdateSlide from inside a setState updater", () => {
    const offenders = [
      ...source.matchAll(
        /set[A-Z][\w$]*\(\s*(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/g,
      ),
    ].filter((match) => {
      const body = source.slice(match.index, match.index + 600);
      return /onUpdateSlideRef/i.test(body);
    });
    expect(offenders.map((m) => m[0])).toEqual([]);
  });

  it("flushes an active inline draft before browser teardown", () => {
    expect(source).toContain("flushPendingSaves");
    expect(source).toContain(
      'window.addEventListener("beforeunload", flushInlineEditDraft',
    );
    expect(source).toContain(
      'window.addEventListener("pagehide", flushInlineEditDraft',
    );
    expect(source).toContain(
      'document.addEventListener("visibilitychange", flushWhenHidden',
    );
  });

  it("keeps the live draft ref across lifecycle flushes", () => {
    const start = source.indexOf("const flushInlineEditDraft");
    const end = source.indexOf("const flushWhenHidden", start);
    const flushBody = source.slice(start, end);
    expect(flushBody).toContain("flushPendingSaves();");
    expect(flushBody).not.toContain("inlineEditDraftRef.current = null");
    expect(flushBody).not.toContain("onUpdateSlideRef.current");
  });

  it("queues the latest draft before ending the text session", () => {
    const start = source.indexOf("const endTextSession");
    const end = source.indexOf("const flushInlineEditDraft", start);
    const endBody = source.slice(start, end);

    expect(endBody).toContain("session.text.end();");
    expect(endBody).toContain(
      "persistInlineEditDraft(session.slideId, content)",
    );
    expect(endBody.indexOf("session.text.end();")).toBeLessThan(
      endBody.indexOf("persistInlineEditDraft"),
    );
  });

  it("saves raw slides by merging into the stored source, never the rendered DOM", () => {
    const serializeStart = source.indexOf("const serializeSlideContentHtml");
    const serializeEnd = source.indexOf(
      "const readCurrentSlideContentHtml",
      serializeStart,
    );
    const serializeBody = source.slice(serializeStart, serializeEnd);
    const mergeAt = serializeBody.indexOf("mergeRenderedEdits(");
    const domAt = serializeBody.indexOf("stripBuilderIds(clone.innerHTML)");

    expect(mergeAt).toBeGreaterThan(-1);
    expect(
      serializeBody.slice(serializeBody.lastIndexOf("if (", domAt), domAt),
    ).toContain('hasAttribute("data-slide-autofit-root")');
    const markdownBranchStart = serializeBody.indexOf(
      'if (slideContent.hasAttribute("data-slide-autofit-root"))',
    );
    const markdownBranchEnd = serializeBody.indexOf(
      "return stripBuilderIds(clone.innerHTML)",
      markdownBranchStart,
    );
    expect(
      serializeBody.slice(markdownBranchStart, markdownBranchEnd),
    ).toContain("prepareSerializationRoot(clone)");
    expect(serializeBody).toContain("return null;");
    expect(source).toContain("stampSource\n");
  });

  it("writes nothing for a click in and out", () => {
    const enterStart = source.indexOf("const enterInlineEdit");
    const enterEnd = source.indexOf("// Exit edit mode", enterStart);
    const enterBody = source.slice(enterStart, enterEnd);

    expect(enterBody).not.toContain("captureInlineEditDraft(");
    const baselineAt = enterBody.indexOf(
      "const entryContent = readCurrentSlideContentHtml();",
    );
    expect(baselineAt).toBeGreaterThan(-1);
    expect(enterBody.indexOf("startInPlaceTextSession(")).toBeGreaterThan(
      baselineAt,
    );

    const exitStart = source.indexOf("const exitInlineEdit = useCallback");
    const exitEnd = source.indexOf("const commitInlineEditForAgent", exitStart);
    const exitBody = source.slice(exitStart, exitEnd);
    const gateAt = exitBody.indexOf(
      "if (shouldPersistInlineEditContent(initial, current)) {",
    );
    expect(gateAt).toBeGreaterThan(-1);
    const writes = [...exitBody.matchAll(/OnUpdateSlideRef\.current\(/g)];
    expect(writes).toHaveLength(1);
    expect(writes[0].index).toBeGreaterThan(gateAt);

    const captureStart = source.indexOf("const captureInlineEditDraft");
    const captureEnd = source.indexOf(
      "const scheduleInlineEditDraftCapture",
      captureStart,
    );
    expect(source.slice(captureStart, captureEnd)).toContain(
      "!textSessionRef.current.text.changed",
    );
  });

  it("commits an open edit before any other content write or slide swap", () => {
    expect(source).toContain(
      "if (textSessionRef.current) exitInlineEditRef.current();",
    );
    const persistStart = source.indexOf("const persistInlineEditDraft");
    const persistEnd = source.indexOf(
      "const captureInlineEditDraft",
      persistStart,
    );
    expect(source.slice(persistStart, persistEnd)).toContain(
      "rawOnUpdateSlideRef.current({ content }, slideId, {",
    );
  });

  it("cancels stale draft capture before a slide switch can read the new DOM", () => {
    expect(source).toContain("const currentSlideIdRef = useRef(slide.id);");
    expect(source).toContain("currentSlideIdRef.current = slide.id;");
    expect(source).toContain("currentSlideIdRef.current !== slideId");
    expect(source).toContain("session?.slideId !== slideId");
  });
});
