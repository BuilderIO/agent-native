// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";

import { mountPrototypeRuntime } from "./prototype-runtime";
import { sanitizeWireframeHtml } from "./sanitize-html";

/**
 * ADVERSARIAL — prototype runtime attribute-binding XSS.
 *
 * The PROTOTYPE feature renders a reviewer-facing screen via
 * `dangerouslySetInnerHTML` into the LIVE page DOM (Wireframe.tsx -> HtmlArtboard),
 * then calls `mountPrototypeRuntime` to power the "safe Alpine-like" directives.
 *
 * The two sanitizers that gate the stored screen html — `sanitizeWireframeHtml`
 * (client render layer) and `sanitizeCustomHtml` (server store layer) — both
 * strip literal `on*=` event handlers and unsafe URL literals. NEITHER strips
 * Alpine-style ATTRIBUTE BINDINGS (`:onclick`, `x-bind:onmouseover`, `:href`,
 * `:src`, `:style`), because those attribute NAMES start with `:` / `x-bind:`,
 * not `on`, and their VALUES are bare state paths with no `javascript:` literal.
 *
 * `mountPrototypeRuntime`'s `applyBindings` then does, for every `:name`/
 * `x-bind:name` attribute:
 *
 *     element.setAttribute(bindName, String(value));
 *
 * with NO allowlist of `bindName` and NO URL-safety check on the value. So a
 * shared/malicious prototype screen can smuggle a binding that the runtime
 * MATERIALIZES into a real, executable `onclick`/`onmouseover` inline handler or
 * an unchecked `javascript:` href — i.e. arbitrary JS that runs when a reviewer
 * opens the shared prototype. This is a stored XSS (CRITICAL).
 *
 * These tests assert the SECURE behavior (the runtime must refuse to create
 * event-handler attributes / javascript: urls from bindings). They FAIL today,
 * pinning the bug. Do not "fix" by editing the spec — the runtime must restrict
 * `:`/`x-bind:` targets to a safe attribute subset (and re-validate url values).
 */

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
    // Survives both sanitizers (binding name is `:onclick`, value is a state path).
    const screen = `<div x-data='{ "payload": "window.__pwn = 1" }'><button :onclick="payload">Run</button></div>`;
    // Confirm the render-layer sanitizer leaves the binding intact (it does).
    expect(sanitizeWireframeHtml(screen)).toContain(":onclick");

    const { root, cleanup } = mount(screen);
    await flush();
    const button = root.querySelector("button") as HTMLButtonElement;

    // SECURE expectation: the runtime must never create an executable inline
    // event handler from a binding. Currently it sets onclick="window.__pwn = 1".
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
    // Note: the literal `javascript:` lives only in the x-data JSON value, which
    // the static sanitizers do not relate to the href. The runtime copies it
    // verbatim onto a real href. SECURE: a bound href must never resolve to an
    // executable scheme.
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
