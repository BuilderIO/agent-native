import { expect, it } from "vitest";
import * as Y from "yjs";

import { applyAuthoritativeInitialSeed } from "./useCollabReconcile.js";

function paragraph(text: string): Y.XmlElement {
  const element = new Y.XmlElement("paragraph");
  if (text) {
    const content = new Y.XmlText();
    content.insert(0, text);
    element.insert(0, [content]);
  }
  return element;
}

it("replaces an independently initialized empty client paragraph with the authoritative seed", () => {
  const local = new Y.Doc();
  const seed = new Y.Doc();
  try {
    const fragment = local.getXmlFragment("default");
    fragment.insert(0, [paragraph("")]);
    const initialNodes = fragment.toArray().map((node) => ({
      node,
      serialized: node.toString(),
    }));
    seed.getXmlFragment("default").insert(0, [paragraph("saved")]);

    applyAuthoritativeInitialSeed(
      local,
      Y.encodeStateAsUpdate(seed),
      initialNodes,
    );

    expect(fragment.toString()).toBe("<paragraph>saved</paragraph>");
  } finally {
    local.destroy();
    seed.destroy();
  }
});

it("preserves a local placeholder that gained peer content while the seed was pending", () => {
  const local = new Y.Doc();
  const seed = new Y.Doc();
  try {
    const fragment = local.getXmlFragment("default");
    const placeholder = paragraph("");
    fragment.insert(0, [placeholder]);
    const initialNodes = [
      { node: placeholder, serialized: placeholder.toString() },
    ];
    const content = new Y.XmlText();
    content.insert(0, "peer");
    placeholder.insert(0, [content]);
    seed.getXmlFragment("default").insert(0, [paragraph("saved")]);

    applyAuthoritativeInitialSeed(
      local,
      Y.encodeStateAsUpdate(seed),
      initialNodes,
    );

    expect(fragment.toString()).toContain("<paragraph>peer</paragraph>");
    expect(fragment.toString()).toContain("<paragraph>saved</paragraph>");
  } finally {
    local.destroy();
    seed.destroy();
  }
});
