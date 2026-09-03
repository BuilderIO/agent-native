import { describe, expect, it } from "vitest";

import { planLocalJsxVisualEdit } from "./local-jsx-visual-edit.js";

const anchor = { line: 3, column: 5, scope: "single-instance" as const };

describe("planLocalJsxVisualEdit", () => {
  it("previews a leaf text edit without changing surrounding JSX", () => {
    const content = [
      "export function Card() {",
      "  return (",
      '    <h2 className="title">Old title</h2>',
      "  );",
      "}",
    ].join("\n");
    const planned = planLocalJsxVisualEdit({
      content,
      anchor,
      intent: { kind: "textContent", value: "New title" },
    });
    expect(planned.result).toMatchObject({ status: "applied", changed: true });
    expect(planned.content).toContain(">New title</h2>");
    expect(planned.proposedDiff).toBeDefined();
  });

  it("escapes JSX expression delimiters in literal text", () => {
    const content = [
      "export function Card() {",
      "  return (",
      "    <h2>Old title</h2>",
      "  );",
      "}",
    ].join("\n");
    const planned = planLocalJsxVisualEdit({
      content,
      anchor,
      intent: { kind: "textContent", value: "Use {value} <today>" },
    });
    expect(planned.result.status).toBe("applied");
    expect(planned.content).toContain(
      ">Use &#123;value&#125; &lt;today&gt;</h2>",
    );
    expect(planned.content).not.toContain("Use {value}");
  });

  it("updates only a literal class list", () => {
    const content = [
      "export function Card() {",
      "  return (",
      '    <div className="p-4 text-sm">Body</div>',
      "  );",
      "}",
    ].join("\n");
    const planned = planLocalJsxVisualEdit({
      content,
      anchor,
      intent: {
        kind: "class",
        operation: "replace",
        from: "text-sm",
        to: "text-lg",
      },
    });
    expect(planned.result.status).toBe("applied");
    expect(planned.content).toContain('className="p-4 text-lg"');
  });

  it("adds or replaces one property in a flat literal style object", () => {
    const content = [
      "export function Card() {",
      "  return (",
      '    <div style={{ color: "red" }}>Body</div>',
      "  );",
      "}",
    ].join("\n");
    const planned = planLocalJsxVisualEdit({
      content,
      anchor,
      intent: { kind: "style", property: "color", value: "blue" },
    });
    expect(planned.result.status).toBe("applied");
    expect(planned.content).toContain('style={{ color: "blue" }}');
  });

  it("rejects a dynamic value in an otherwise flat style object", () => {
    const content = [
      "export function Card() {",
      "  return (",
      "    <div style={{ color: theme.color }}>Body</div>",
      "  );",
      "}",
    ].join("\n");
    const planned = planLocalJsxVisualEdit({
      content,
      anchor,
      intent: { kind: "style", property: "color", value: "blue" },
    });
    expect(planned.result.status).toBe("needsAgent");
    expect(planned.content).toBe(content);
  });

  it("fails closed for expression text, dynamic attributes, and repeated renders", () => {
    const dynamicText = [
      "export function Card() {",
      "  return (",
      "    <h2>{title}</h2>",
      "  );",
      "}",
    ].join("\n");
    expect(
      planLocalJsxVisualEdit({
        content: dynamicText,
        anchor,
        intent: { kind: "textContent", value: "New" },
      }).result.status,
    ).toBe("needsAgent");

    const dynamicClass = dynamicText.replace(
      "<h2>",
      "<h2 className={classes}>",
    );
    expect(
      planLocalJsxVisualEdit({
        content: dynamicClass,
        anchor,
        intent: { kind: "class", operation: "add", className: "font-bold" },
      }).result.status,
    ).toBe("needsAgent");

    expect(
      planLocalJsxVisualEdit({
        content: dynamicText,
        anchor: { ...anchor, runtimeMultiplicity: 2 },
        intent: { kind: "textContent", value: "New" },
      }).result.status,
    ).toBe("needsAgent");
  });

  it.each(['bad"token', "bad{token}", "bad=value", "<script>"])(
    "rejects a class token containing JSX delimiters (%s)",
    (className) => {
      const content = [
        "export function Card() {",
        "  return (",
        '    <div className="p-4">Body</div>',
        "  );",
        "}",
      ].join("\n");
      const planned = planLocalJsxVisualEdit({
        content,
        anchor,
        intent: { kind: "class", operation: "add", className },
      });
      expect(planned.result.status).toBe("unsupported");
      expect(planned.content).toBe(content);
    },
  );

  it("rejects stale or non-exact source coordinates", () => {
    const content = "export const Card = () => <div>Body</div>;";
    const planned = planLocalJsxVisualEdit({
      content,
      anchor,
      intent: { kind: "textContent", value: "New" },
    });
    expect(planned.result).toMatchObject({
      status: "conflict",
      changed: false,
    });
    expect(planned.content).toBe(content);
  });
});
