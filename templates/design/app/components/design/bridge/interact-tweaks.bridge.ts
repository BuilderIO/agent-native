/**
 * Interact tweaks bridge — carried by every Interact markup preview. The
 * document is built with the current tweak values baked into a
 * `<style data-agent-native-interact-tweaks>` element; later inspector changes
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
 *     from a later message are removed. A property whose value changed also
 *     drops this frame's inline `:root` override of it, so an inspector change
 *     wins over a knob the user dragged here; the frame then gets an
 *     `agent-native:tweak-values` event so its panel can show the new values.
 *
 * In-frame knobs are local. `window.__anInteract.setTweak` exists so a
 * screen's panel shows in Interact, and it sends nothing: a knob change never
 * leaves the frame, never saves, and is gone on reload.
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

  (
    window as {
      __anInteract?: { setTweak: (idOrCssVar: string, value: unknown) => void };
    }
  ).__anInteract = { setTweak: function () {} };

  window.addEventListener("message", function (e: MessageEvent) {
    if (e.source !== window.parent) return;
    var data = e.data as { type?: unknown; values?: unknown } | null;
    if (!data || data.type !== "tweak-values") return;
    var values = data.values;
    if (!values || typeof values !== "object") return;
    var found = rootRule();
    if (!found) return;
    var rule: CSSStyleRule = found;
    var previous: Record<string, string> = {};
    for (var i = 0; i < rule.style.length; i++) {
      var declared = rule.style.item(i);
      previous[declared] = rule.style.getPropertyValue(declared).trim();
    }
    // The CSSOM parses each value on its own, so a value cannot add rules.
    rule.style.cssText = "";
    var entries = values as Record<string, unknown>;
    var applied: Record<string, string> = {};
    Object.keys(entries).forEach(function (name: string) {
      var value = entries[name];
      if (!NAME.test(name) || typeof value !== "string") return;
      rule.style.setProperty(name, value);
      applied[name] = rule.style.getPropertyValue(name).trim();
    });
    var rootStyle = document.documentElement.style;
    var changed = Object.keys(previous)
      .concat(Object.keys(applied))
      .filter(function (name: string) {
        return previous[name] !== applied[name];
      });
    changed.forEach(function (name: string) {
      rootStyle.removeProperty(name);
    });
    if (changed.length > 0) {
      window.dispatchEvent(
        new CustomEvent("agent-native:tweak-values", { detail: applied }),
      );
    }
  });
})();
