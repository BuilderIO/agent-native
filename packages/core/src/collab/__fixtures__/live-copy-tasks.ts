import * as Y from "yjs";

import { defineLiveCopyTasks } from "../live-copy-tasks.js";

// A tiny live-copy task module for the live-copy spec: a body is a list of
// paragraphs, and anything else is refused rather than dropped. Paragraphs
// and seed sources starting with "!" drive the failure cases.

function paragraph(text: string): Y.XmlElement {
  const element = new Y.XmlElement("paragraph");
  const content = new Y.XmlText();
  content.insert(0, text);
  element.insert(0, [content]);
  return element;
}

/** An update whose base this document never had. */
function orphanUpdate(): Uint8Array {
  const elsewhere = new Y.Doc();
  elsewhere.getXmlFragment("default").insert(0, [paragraph("unknown base")]);
  const before = Y.encodeStateVector(elsewhere);
  const fragment = elsewhere.getXmlFragment("default");
  fragment.insert(1, [paragraph("orphan")]);
  return Y.encodeStateAsUpdate(elsewhere, before);
}

export const tasks = defineLiveCopyTasks({
  derive(doc, field) {
    const lines: string[] = [];
    for (const node of doc.getXmlFragment(field).toArray()) {
      if (!(node instanceof Y.XmlElement) || node.nodeName !== "paragraph") {
        return {
          kind: "refused",
          reason: "unsupported_node",
          detail: node instanceof Y.XmlElement ? node.nodeName : "text",
        };
      }
      const text = node
        .toArray()
        .map((child) => child.toString())
        .join("");
      if (text === "!spin") {
        for (;;) {
          // never returns
        }
      }
      if (text === "!html") return { kind: "html" } as never;
      if (text === "!edit")
        doc.getXmlFragment(field).insert(0, [paragraph("")]);
      lines.push(text);
    }
    return lines.join("\n");
  },
  seed(doc, field, source) {
    if (source === "!refuse") return { kind: "refused", reason: "too_complex" };
    if (source === "!empty") return;
    if (source === "!junk") return { kind: "update" } as never;
    if (source === "!stray") doc.getText("other").insert(0, "hidden");
    doc.getXmlFragment(field).insert(0, source.split("\n").map(paragraph));
  },
  edits: {
    append(doc, field, input) {
      const fragment = doc.getXmlFragment(field);
      const text = (input as { text?: string } | undefined)?.text ?? "";
      fragment.insert(fragment.length, [paragraph(text)]);
    },
    clear(doc, field) {
      const fragment = doc.getXmlFragment(field);
      fragment.delete(0, fragment.length);
    },
    stray(doc) {
      doc.getText("other").insert(0, "hidden");
    },
    unchanged() {},
    refuse() {
      return { kind: "refused", reason: "too_complex" };
    },
    junk() {
      return { kind: "update" } as never;
    },
    dependent(doc) {
      Y.applyUpdate(doc, orphanUpdate());
    },
    dependentAndValid(doc, field) {
      Y.applyUpdate(doc, orphanUpdate());
      const fragment = doc.getXmlFragment(field);
      fragment.insert(fragment.length, [paragraph("valid")]);
    },
  },
});
