// @vitest-environment jsdom

import { getSchema } from "@tiptap/core";
import { Fragment } from "@tiptap/pm/model";
import { describe, expect, it } from "vitest";

import { schemaSafePasteContent } from "./markdown-paste-content";
import { createVisualEditorExtensions } from "./VisualEditor";

const schema = getSchema(createVisualEditorExtensions({}));

/** What `insertContent` does to every top-level node before it dispatches. */
function insertContentWouldAccept(fragment: Fragment): boolean {
  try {
    fragment.forEach((node) => node.check());
    return true;
  } catch {
    return false;
  }
}

function parse(html: string) {
  return schemaSafePasteContent(html, schema);
}

function readyContent(html: string): Fragment {
  const result = parse(html);
  expect(result.status).toBe("ready");
  const content = result.status === "ready" ? result.content : Fragment.empty;
  expect(insertContentWouldAccept(content)).toBe(true);
  return content;
}

function textOf(fragment: Fragment): string {
  return fragment.textBetween(0, fragment.size, "\n");
}

describe("schemaSafePasteContent", () => {
  it("returns ProseMirror content, so the markdown parser cannot run a second time", () => {
    const content = readyContent("<h1>Title</h1><p>Body copy.</p>");
    expect(content).toBeInstanceOf(Fragment);
    expect(textOf(content)).toContain("Title");
  });

  it("keeps ordinary markdown HTML intact", () => {
    const content = readyContent(
      "<h2>Section</h2><p>Body <strong>copy</strong>.</p><ul><li>one</li><li>two</li></ul>",
    );
    expect(textOf(content)).toContain("Section");
    expect(textOf(content)).toContain("one");
  });

  it("preserves a fenced code block that contains a blank line", () => {
    const content = readyContent(
      '<pre><code class="language-ts">const a = 1;\n\nexport default a;</code></pre>',
    );
    expect(content.childCount).toBe(1);
    expect(content.child(0).type.name).toBe("codeBlock");
    expect(content.child(0).textContent).toBe(
      "const a = 1;\n\nexport default a;",
    );
  });

  it("reports no repair for content the schema already accepts", () => {
    const result = parse("<p>Plain paragraph.</p>");
    expect(result).toMatchObject({ status: "ready", repairedFrom: null });
  });

  // Each of these parses to a childless container, which `Node.check()` rejects.
  it.each([
    ["table", "<table></table>"],
    ["table with only whitespace", "<table>\n</table>"],
    ["table with an empty body", "<table><tbody></tbody></table>"],
    ["bullet list", "<ul></ul>"],
    ["ordered list", "<ol></ol>"],
    ["blockquote", "<blockquote></blockquote>"],
    ["table nested in a div", "<div><table></table></div>"],
  ])("never hands insertContent an empty %s", (_label, html) => {
    const result = parse(html);
    if (result.status === "unusable") {
      expect(result.reason).not.toBe("");
      return;
    }
    expect(insertContentWouldAccept(result.content)).toBe(true);
  });

  it("keeps the surrounding prose when one container in the payload is empty", () => {
    const result = parse(
      "<h1>Title</h1><p>Before the table.</p><table></table><p>After the table.</p>",
    );
    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect(insertContentWouldAccept(result.content)).toBe(true);
    const text = textOf(result.content);
    expect(text).toContain("Title");
    expect(text).toContain("Before the table.");
    expect(text).toContain("After the table.");
  });

  it("reports nothing insertable as unusable with a reason, not as an empty paste", () => {
    const result = parse("");
    expect(result.status).toBe("unusable");
    if (result.status !== "unusable") return;
    expect(result.reason).toBe("markdown produced no editor content");
  });
});
