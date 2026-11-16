/**
 * Interact tweaks bridge — carried by every Interact markup preview. The
 * document is built with the current tweak values baked into a
 * `<style data-agent-native-interact-tweaks>` element; later knob changes
 * arrive here as a message and replace that element's `:root` declarations,
 * so the frame never reloads.
 *
 * A read-only preview is sandboxed to an opaque origin, so the editor cannot
 * reach into its document. A message is the only path that works for every
 * Interact frame.
 *
 * Protocol (parent → iframe):
 *
 *   { type: 'tweak-values', values: Record<string, string> }
 *     The complete set of resolved CSS custom properties. Properties missing
 *     from a later message are removed.
 *
 * Protocol (iframe → parent), sent by `window.__anInteract.setTweak`:
 *
 *   { type: 'tweak-set', id: string, value } or { type: 'tweak-set', cssVar, value }
 *     An on-figure control asks the editor to save a tweak. The editor checks
 *     the tweak is scoped to this screen, clamps the value, saves it, and
 *     answers with the usual `tweak-values` message.
 *
 * Rules:
 *   • No import/require of any module (DOM globals only).
 *   • No references to outer/module scope (the code runs inside an iframe).
 *   • Wrap everything in a self-executing IIFE.
 */
(function () {
  if ((window as { __anInteractTweaks?: unknown }).__anInteractTweaks) return;
  (window as { __anInteractTweaks?: unknown }).__anInteractTweaks = true;

  var ATTRIBUTE = "data-agent-native-interact-tweaks";
  var NAME = /^--[-_a-zA-Z0-9]+$/;

  function rootRule(): CSSStyleRule | null {
    var style = document.querySelector<HTMLStyleElement>(
      "style[" + ATTRIBUTE + "]",
    );
    if (!style) {
      style = document.createElement("style");
      style.setAttribute(ATTRIBUTE, "");
      // Last in the document, after the design's own :root rules.
      document.documentElement.appendChild(style);
    }
    var sheet = style.sheet;
    if (!sheet) return null;
    var first = sheet.cssRules[0];
    if (sheet.cssRules.length !== 1 || !(first instanceof CSSStyleRule)) {
      // Edit the live sheet: setting textContent replaces it, so `sheet` would
      // go stale and this message would be dropped.
      while (sheet.cssRules.length) sheet.deleteRule(0);
      sheet.insertRule(":root {}", 0);
      first = sheet.cssRules[0];
    }
    return first instanceof CSSStyleRule ? first : null;
  }

  var w = window as {
    __anInteract?: {
      setTweak: (idOrCssVar: string, value: unknown) => void;
    };
  };
  w.__anInteract = {
    setTweak: function (idOrCssVar: string, value: unknown) {
      if (typeof idOrCssVar !== "string" || window.parent === window) return;
      var message: Record<string, unknown> = {
        type: "tweak-set",
        value: value,
      };
      if (NAME.test(idOrCssVar)) message.cssVar = idOrCssVar;
      else message.id = idOrCssVar;
      // The frame is an opaque origin, so the editor checks the message source.
      window.parent.postMessage(message, "*");
    },
  };

  window.addEventListener("message", function (e: MessageEvent) {
    if (e.source !== window.parent) return;
    var data = e.data as { type?: unknown; values?: unknown } | null;
    if (!data || data.type !== "tweak-values") return;
    var values = data.values;
    if (!values || typeof values !== "object") return;
    var found = rootRule();
    if (!found) return;
    var rule: CSSStyleRule = found;
    // The CSSOM parses each value on its own, so a value cannot add rules.
    rule.style.cssText = "";
    var entries = values as Record<string, unknown>;
    Object.keys(entries).forEach(function (name: string) {
      var value = entries[name];
      if (!NAME.test(name) || typeof value !== "string") return;
      rule.style.setProperty(name, value);
    });
  });
})();
