import { describe, expect, it } from "vitest";

import {
  planLocalJsxVisualEdit,
  readLiteralJsxPropsAtAnchor,
} from "./local-jsx-visual-edit.js";

const anchor = {
  line: 3,
  column: 5,
  positionPrecision: "authored" as const,
  scope: "single-instance" as const,
};

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

  it("adds and replaces literal JSX component props", () => {
    const content = [
      "export function App() {",
      "  return (",
      '    <Button variant="primary" />',
      "  );",
      "}",
    ].join("\n");
    const planned = planLocalJsxVisualEdit({
      content,
      anchor,
      intent: { kind: "attribute", name: "variant", value: "secondary" },
    });
    expect(planned.result).toMatchObject({ status: "applied", changed: true });
    expect(planned.content).toContain('<Button variant="secondary" />');

    const annotated = planLocalJsxVisualEdit({
      content: planned.content,
      anchor,
      intent: {
        kind: "attributes",
        values: {
          "data-agent-native-component": "PrimaryButton",
          "data-agent-native-layer-name": "CTA",
        },
      },
    });
    expect(annotated.result.status).toBe("applied");
    expect(annotated.content).toContain(
      'data-agent-native-component="PrimaryButton"',
    );
    expect(annotated.content).toContain('data-agent-native-layer-name="CTA"');

    const withRuntimeAnnotation = planLocalJsxVisualEdit({
      content:
        '<Button variant="primary" data-agent-native-prop-variant="primary" />',
      anchor: { line: 1, column: 1, positionPrecision: "authored" },
      intent: {
        kind: "attributes",
        values: {
          variant: "secondary",
          "data-agent-native-prop-variant": "secondary",
        },
        expectedValues: { variant: "primary" },
      },
    });
    expect(withRuntimeAnnotation.result.status).toBe("applied");
    expect(withRuntimeAnnotation.content).toContain(
      'variant="secondary" data-agent-native-prop-variant="secondary"',
    );

    const literalDollarValue = "$& $1 $` $'";
    const withLiteralDollarValue = planLocalJsxVisualEdit({
      content,
      anchor,
      intent: {
        kind: "attribute",
        name: "variant",
        value: literalDollarValue,
      },
    });
    expect(withLiteralDollarValue.result.status).toBe("applied");
    expect(withLiteralDollarValue.content).toContain(
      '<Button variant="$&amp; $1 $` $\'" />',
    );
  });

  it("reads only quoted invocation props and ignores defaulted runtime values", () => {
    const content = 'const view = <Button variant="primary" />;';
    const sourceAnchor = {
      line: 1,
      column: content.indexOf("<Button") + 1,
      positionPrecision: "authored" as const,
    };
    expect(
      readLiteralJsxPropsAtAnchor({ content, anchor: sourceAnchor }),
    ).toEqual([{ name: "variant", value: "primary" }]);
    const defaultedContent = "const view = <Button />;";
    expect(
      readLiteralJsxPropsAtAnchor({
        content: defaultedContent,
        anchor: {
          ...sourceAnchor,
          column: defaultedContent.indexOf("<Button") + 1,
        },
      }),
    ).toEqual([]);
    const dynamicContent = "const view = <Button variant={kind} />;";
    expect(
      readLiteralJsxPropsAtAnchor({
        content: dynamicContent,
        anchor: {
          ...sourceAnchor,
          column: dynamicContent.indexOf("<Button") + 1,
        },
      }),
    ).toBeUndefined();
    const dashedContent = 'const view = <Button aria-pressed="true" />;';
    expect(
      readLiteralJsxPropsAtAnchor({
        content: dashedContent,
        anchor: {
          ...sourceAnchor,
          column: dashedContent.indexOf("<Button") + 1,
        },
      }),
    ).toEqual([{ name: "aria-pressed", value: "true" }]);
    const shorthandContent = "const view = <Button disabled />;";
    expect(
      readLiteralJsxPropsAtAnchor({
        content: shorthandContent,
        anchor: {
          ...sourceAnchor,
          column: shorthandContent.indexOf("<Button") + 1,
        },
      }),
    ).toBeUndefined();
  });

  it("replaces a quoted JSX attribute with escaped quotes intact", () => {
    const content = String.raw`const view = <Button title="She said \"hello\"" />;`;
    const planned = planLocalJsxVisualEdit({
      content,
      anchor: {
        line: 1,
        column: content.indexOf("<Button") + 1,
        positionPrecision: "authored",
      },
      intent: { kind: "attribute", name: "title", value: "Updated" },
    });
    expect(planned.result.status).toBe("applied");
    expect(planned.content).toBe('const view = <Button title="Updated" />;');
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

    const dynamicProp = dynamicText.replace(
      "<h2>",
      "<Button variant={kind} />",
    );
    expect(
      planLocalJsxVisualEdit({
        content: dynamicProp,
        anchor,
        intent: { kind: "attribute", name: "variant", value: "secondary" },
      }).result.status,
    ).toBe("needsAgent");
  });

  it("fails closed when source precision is absent or transformed", () => {
    const content = 'export const Card = () => <Button variant="primary" />;';
    for (const positionPrecision of [
      undefined,
      "unknown",
      "transformed",
    ] as const) {
      expect(
        planLocalJsxVisualEdit({
          content,
          anchor: {
            line: 1,
            column: 28,
            ...(positionPrecision ? { positionPrecision } : {}),
          },
          intent: {
            kind: "attribute",
            name: "variant",
            value: "secondary",
          },
        }).result.status,
      ).toBe("needsAgent");
    }
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
