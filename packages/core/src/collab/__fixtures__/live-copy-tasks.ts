import * as Y from "yjs";

// A tiny live-copy task module for the live-copy spec: a body is a list of
// paragraphs, and anything else is refused rather than dropped.

interface StateInput {
  state: Uint8Array;
  field: string;
  input?: { text?: string };
}

function load(state: Uint8Array): Y.Doc {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, state);
  return doc;
}

function paragraph(text: string): Y.XmlElement {
  const element = new Y.XmlElement("paragraph");
  const content = new Y.XmlText();
  content.insert(0, text);
  element.insert(0, [content]);
  return element;
}

function edit(state: Uint8Array, change: (doc: Y.Doc) => void) {
  const doc = load(state);
  const before = Y.encodeStateVector(doc);
  change(doc);
  return { kind: "update", update: Y.encodeStateAsUpdate(doc, before) };
}

export const tasks = {
  derive({ state, field }: StateInput) {
    const lines: string[] = [];
    for (const node of load(state).getXmlFragment(field).toArray()) {
      if (!(node instanceof Y.XmlElement) || node.nodeName !== "paragraph") {
        return {
          kind: "refused",
          reason: "unsupported_node",
          detail: node instanceof Y.XmlElement ? node.nodeName : "text",
        };
      }
      lines.push(
        node
          .toArray()
          .map((child) => child.toString())
          .join(""),
      );
    }
    return { kind: "text", text: lines.join("\n") };
  },
  seed({ source, field }: { source: string; field: string }) {
    const doc = new Y.Doc();
    doc.getXmlFragment(field).insert(0, source.split("\n").map(paragraph));
    return { kind: "update", update: Y.encodeStateAsUpdate(doc) };
  },
  emptySeed() {
    return { kind: "update", update: Y.encodeStateAsUpdate(new Y.Doc()) };
  },
  append({ state, field, input }: StateInput) {
    return edit(state, (doc) => {
      const fragment = doc.getXmlFragment(field);
      fragment.insert(fragment.length, [paragraph(input?.text ?? "")]);
    });
  },
  clear({ state, field }: StateInput) {
    return edit(state, (doc) => {
      const fragment = doc.getXmlFragment(field);
      fragment.delete(0, fragment.length);
    });
  },
  stray({ state }: StateInput) {
    return edit(state, (doc) => doc.getText("other").insert(0, "hidden"));
  },
  unchanged() {
    return { kind: "unchanged" };
  },
  refuse() {
    return { kind: "refused", reason: "too_complex" };
  },
  notAnUpdate() {
    return { kind: "update", update: new Uint8Array([255, 255, 255]) };
  },
  neitherTextNorRefusal() {
    return { kind: "html", html: "<p></p>" };
  },
  spin() {
    for (;;) {
      // never returns
    }
  },
};
