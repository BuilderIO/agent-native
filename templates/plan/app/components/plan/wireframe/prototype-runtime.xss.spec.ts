// @vitest-environment happy-dom

import { sanitizeWireframeHtml } from "@agent-native/core/blocks";
import { describe, expect, it } from "vitest";

import { mountPrototypeRuntime } from "./prototype-runtime";

const flush = async () => {
  await Promise.resolve();
  await new Promise((resolve) => window.setTimeout(resolve, 0));
  await Promise.resolve();
};

function mount(html: string) {
  document.body.innerHTML = `<div id="root">${html}</div>`;
  const root = document.getElementById("root") as HTMLElement;
  const cleanup = mountPrototypeRuntime(root);
  return { root, cleanup };
}

describe("prototype runtime — attribute-binding XSS (CRITICAL)", () => {
  it("does NOT materialize a real onclick handler from a :onclick binding", async () => {
    const screen = `<div x-data='{ "payload": "window.__pwn = 1" }'><button :onclick="payload">Run</button></div>`;
    expect(sanitizeWireframeHtml(screen)).toContain(":onclick");

    const { root, cleanup } = mount(screen);
    await flush();
    const button = root.querySelector("button") as HTMLButtonElement;

    expect(button.getAttribute("onclick")).toBeNull();
    expect(button.onclick).toBeNull();
    cleanup();
  });

  it("does NOT materialize an onmouseover handler from an x-bind:on* binding", async () => {
    const screen = `<div x-data='{ "p": "document.title = String(document.cookie)" }'><span x-bind:onmouseover="p">hover me</span></div>`;
    const { root, cleanup } = mount(screen);
    await flush();
    const span = root.querySelector("span") as HTMLElement;
    expect(span.getAttribute("onmouseover")).toBeNull();
    cleanup();
  });

  it("does NOT materialize a javascript: href from a :href binding", async () => {
    const screen = `<div x-data='{ "u": "javascript:fetch(String(document.cookie))" }'><a :href="u">Continue</a></div>`;
    const { root, cleanup } = mount(screen);
    await flush();
    const anchor = root.querySelector("a") as HTMLAnchorElement;
    const href = anchor.getAttribute("href") ?? "";
    expect(href.replace(/\s+/g, "").toLowerCase()).not.toContain("javascript:");
    cleanup();
  });

  it("does NOT materialize an unchecked src from a :src binding", async () => {
    const screen = `<div x-data='{ "u": "javascript:alert(1)" }'><img :src="u" alt="x"></div>`;
    const { root, cleanup } = mount(screen);
    await flush();
    const img = root.querySelector("img") as HTMLImageElement;
    const src = img.getAttribute("src") ?? "";
    expect(src.replace(/\s+/g, "").toLowerCase()).not.toContain("javascript:");
    cleanup();
  });
});
