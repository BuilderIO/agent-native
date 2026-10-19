import {
  isSlideTransition,
  type SlideTransition,
} from "@shared/open-slide-transition";

import { MAX_RENDERED_SLIDE_HTML_LENGTH } from "./constants";
import { buildSlideFontFaceCss, isSlideFontAssetList } from "./protocol";
import type { SandboxedSlideRenderResult } from "./SandboxedSlide";

export type SlideTransitionFrameInput = {
  outgoing: SandboxedSlideRenderResult;
  incoming: SandboxedSlideRenderResult;
  transition: SlideTransition;
  direction: "forward" | "backward";
};

export type SlideTransitionFrameMessage =
  | { type: "transition-complete"; nonce: string; slideId: string }
  | { type: "transition-error"; nonce: string; slideId: string };

const FRAME_STYLE_LIMIT = 128 * 1024;
const BLOCKED_FRAME_TAGS = new Set([
  "base",
  "embed",
  "form",
  "frame",
  "iframe",
  "input",
  "link",
  "meta",
  "object",
  "script",
  "style",
]);

export function buildSlideTransitionSrcDoc(
  input: SlideTransitionFrameInput,
  appOrigin = window.location.origin,
): { srcDoc: string; nonce: string } {
  if (
    !isSlideTransition(input.transition) ||
    (input.direction !== "forward" && input.direction !== "backward") ||
    input.outgoing.deckId !== input.incoming.deckId ||
    input.outgoing.slideId === input.incoming.slideId ||
    input.outgoing.width !== 1920 ||
    input.outgoing.height !== 1080 ||
    input.incoming.width !== 1920 ||
    input.incoming.height !== 1080 ||
    !isSafeTransitionSnapshot(input.outgoing, appOrigin) ||
    !isSafeTransitionSnapshot(input.incoming, appOrigin)
  ) {
    throw new Error("invalid-slide-transition-snapshot");
  }
  const nonce = createNonce();
  if (!nonce) throw new Error("secure-slide-transition-unavailable");

  const assetOrigins = [
    ...new Set([
      ...input.outgoing.assetOrigins,
      ...input.incoming.assetOrigins,
    ]),
  ];
  const fontOrigins = [
    ...new Set([
      ...(input.outgoing.fontOrigins ?? []),
      ...(input.incoming.fontOrigins ?? []),
    ]),
  ];
  const fontAssets = [
    ...(input.outgoing.fontAssets ?? []),
    ...(input.incoming.fontAssets ?? []),
  ];
  const mediaOrigins = assetOrigins.length ? assetOrigins.join(" ") : "'none'";
  const fontSources = fontOrigins.length ? fontOrigins.join(" ") : "'none'";
  const csp = [
    "default-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    `img-src ${mediaOrigins}`,
    `media-src ${mediaOrigins}`,
    "style-src 'unsafe-inline'",
    `script-src 'nonce-${nonce}'`,
    `font-src ${fontSources}`,
    "connect-src 'none'",
    "object-src 'none'",
  ].join("; ");
  const config = encodeScriptJson({
    outgoing: input.outgoing,
    incoming: input.incoming,
    transition: input.transition,
    direction: input.direction,
    nonce,
    appOrigin,
  });
  const styles = [
    ...input.outgoing.styles.map((css) =>
      css.replaceAll("#slide-root", "#osd-out-root"),
    ),
    ...input.incoming.styles.map((css) =>
      css.replaceAll("#slide-root", "#osd-in-root"),
    ),
    buildSlideFontFaceCss(fontAssets),
  ].join("\n");
  if (styles.length > FRAME_STYLE_LIMIT * 2) {
    throw new Error("slide-transition-style-limit");
  }

  const script = [
    "(() => {",
    `  const config = JSON.parse(${JSON.stringify(config)});`,
    "  const stage = document.getElementById('osd-stage');",
    "  const outgoingLayer = document.getElementById('osd-out');",
    "  const incomingLayer = document.getElementById('osd-in');",
    "  const roots = [document.getElementById('osd-out-root'), document.getElementById('osd-in-root')];",
    "  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;",
    "  const report = (type) => parent.postMessage({ type, nonce: config.nonce, slideId: config.incoming.slideId }, '*');",
    `  const isAllowedAssetUrl = (${isAllowedTransitionAssetUrl.toString()});`,
    "  const validHtml = (html) => {",
    "    if (typeof html !== 'string' || html.length > 2000000) throw new Error('Slide HTML is too large.');",
    "    const template = document.createElement('template');",
    "    template.innerHTML = html;",
    "    for (const element of template.content.querySelectorAll('*')) {",
    "      if (['base','embed','form','frame','iframe','input','link','meta','object','script','style'].includes(element.tagName.toLowerCase())) throw new Error('Unsupported slide element.');",
    "      for (const attribute of Array.from(element.attributes)) {",
    "        const name = attribute.name.toLowerCase();",
    "        if (name.startsWith('on') || name === 'srcdoc' || name === 'srcset') throw new Error('Executable or network-capable slide attribute.');",
    "        if (name === 'poster' && element.tagName.toLowerCase() !== 'video') throw new Error('Video posters are only allowed on video elements.');",
    "        if (name === 'src' || name === 'poster') {",
    "          if (!isAllowedAssetUrl(attribute.value, config.assetOrigins, config.appOrigin)) throw new Error('Unlisted slide asset URL.');",
    "        }",
    "        if (name === 'style' && /(?:url|expression)\\s*\\(|javascript:|[<>]/i.test(attribute.value)) throw new Error('Unsafe slide style.');",
    "      }",
    "    }",
    "    return template;",
    "  };",
    "  const applyDesign = (root, result) => {",
    "    const tokens = result.designTokens;",
    "    if (tokens) {",
    "      root.style.setProperty('--deck-bg', tokens.background);",
    "      root.style.setProperty('--deck-ink', tokens.text);",
    "      root.style.setProperty('--deck-accent', tokens.accent);",
    "      root.style.setProperty('--deck-heading-font', tokens.displayFont);",
    "      root.style.setProperty('--deck-body-font', tokens.bodyFont);",
    "      root.style.setProperty('--deck-hero-scale', String(tokens.heroScale));",
    "      root.style.setProperty('--deck-body-scale', String(tokens.bodyScale));",
    "      root.style.setProperty('--deck-radius', tokens.radius + 'px');",
    "      root.style.backgroundColor = tokens.background;",
    "      root.style.color = tokens.text;",
    "    }",
    "    const design = result.design;",
    "    if (design) {",
    "      root.style.setProperty('--osd-bg', design.palette.bg);",
    "      root.style.setProperty('--osd-text', design.palette.text);",
    "      root.style.setProperty('--osd-accent', design.palette.accent);",
    "      root.style.setProperty('--osd-font-display', design.fonts.display);",
    "      root.style.setProperty('--osd-font-body', design.fonts.body);",
    "      root.style.setProperty('--osd-size-hero', design.typeScale.hero + 'px');",
    "      root.style.setProperty('--osd-size-body', design.typeScale.body + 'px');",
    "      root.style.setProperty('--osd-radius', design.radius + 'px');",
    "      root.style.backgroundColor = design.palette.bg;",
    "      root.style.color = design.palette.text;",
    "      root.style.fontFamily = design.fonts.body;",
    "    }",
    "  };",
    "  const holdOpacity = (phase) => {",
    "    if (!phase) return phase;",
    "    if (Array.isArray(phase.keyframes)) return { ...phase, keyframes: phase.keyframes.map(({ opacity, ...frame }) => frame) };",
    "    const { opacity, ...keyframes } = phase.keyframes;",
    "    return { ...phase, keyframes };",
    "  };",
    "  const runPhase = (element, phase, fallbackDuration, fallbackEasing) => {",
    "    if (!phase) return null;",
    "    return element.animate(phase.keyframes, { duration: phase.duration ?? fallbackDuration, easing: phase.easing ?? fallbackEasing, delay: phase.delay ?? 0, fill: 'both' });",
    "  };",
    "  const morphElements = (root) => {",
    "    const elements = new Map();",
    "    for (const element of root.querySelectorAll('[data-osd-morph]')) {",
    "      const id = element.getAttribute('data-osd-morph');",
    "      if (id && !elements.has(id)) elements.set(id, element);",
    "    }",
    "    return elements;",
    "  };",
    "  const clearCloneIds = (root) => {",
    "    for (const element of [root, ...root.querySelectorAll('*')]) { element.removeAttribute('id'); element.removeAttribute('data-osd-morph'); }",
    "  };",
    "  const copyComputedStyles = (source, clone) => {",
    "    const sourceChildren = source.querySelectorAll('*');",
    "    const cloneChildren = clone.querySelectorAll('*');",
    "    const pairs = [[source, clone], ...Array.from(sourceChildren).map((element, index) => [element, cloneChildren[index]])];",
    "    for (const [from, to] of pairs) {",
    "      if (!to) continue;",
    "      const computed = getComputedStyle(from);",
    "      for (const property of computed) to.style.setProperty(property, computed.getPropertyValue(property));",
    "    }",
    "  };",
    "  const resolveMorph = (morph, duration, easing) => {",
    "    if (!morph) return null;",
    "    if (morph === true) return { duration, easing, delay: 0 };",
    "    return { duration: morph.duration ?? duration, easing: morph.easing ?? easing, delay: morph.delay ?? 0 };",
    "  };",
    "  const prepareMorph = (phase) => {",
    "    if (!phase) return { animations: [], cleanup: () => {} };",
    "    const fromElements = morphElements(roots[0]);",
    "    const toElements = morphElements(roots[1]);",
    "    const overlay = document.createElement('div');",
    "    overlay.setAttribute('aria-hidden', 'true');",
    "    Object.assign(overlay.style, { position: 'absolute', inset: '0', overflow: 'hidden', pointerEvents: 'none', zIndex: '4' });",
    "    stage.append(overlay);",
    "    const animations = [];",
    "    const hidden = [];",
    "    for (const [id, from] of fromElements) {",
    "      const to = toElements.get(id);",
    "      if (!to) continue;",
    "      const fromRect = from.getBoundingClientRect();",
    "      const toRect = to.getBoundingClientRect();",
    "      if (fromRect.width <= 0 || fromRect.height <= 0 || toRect.width <= 0 || toRect.height <= 0) continue;",
    "      const start = { x: fromRect.left - stage.getBoundingClientRect().left, y: fromRect.top - stage.getBoundingClientRect().top, width: fromRect.width, height: fromRect.height };",
    "      const end = { x: toRect.left - stage.getBoundingClientRect().left, y: toRect.top - stage.getBoundingClientRect().top, width: toRect.width, height: toRect.height };",
    "      const clone = from.cloneNode(true);",
    "      copyComputedStyles(from, clone);",
    "      clearCloneIds(clone);",
    "      Object.assign(clone.style, { position: 'absolute', left: start.x + 'px', top: start.y + 'px', width: start.width + 'px', height: start.height + 'px', margin: '0', transformOrigin: 'top left', zIndex: '1' });",
    "      overlay.append(clone);",
    "      const fromVisibility = from.style.visibility;",
    "      const toVisibility = to.style.visibility;",
    "      from.style.visibility = 'hidden';",
    "      to.style.visibility = 'hidden';",
    "      hidden.push(() => { from.style.visibility = fromVisibility; to.style.visibility = toVisibility; });",
    "      const scaleX = end.width / start.width;",
    "      const scaleY = end.height / start.height;",
    "      const dx = end.x - start.x;",
    "      const dy = end.y - start.y;",
    "      const before = getComputedStyle(from);",
    "      const after = getComputedStyle(to);",
    "      const first = { transform: 'translate(0px, 0px) scale(1, 1)', opacity: before.opacity, color: before.color, backgroundColor: before.backgroundColor, borderColor: before.borderColor };",
    "      const last = { transform: 'translate(' + dx + 'px, ' + dy + 'px) scale(' + scaleX + ', ' + scaleY + ')', opacity: after.opacity, color: after.color, backgroundColor: after.backgroundColor, borderColor: after.borderColor };",
    "      animations.push(clone.animate([first, last], { duration: phase.duration, easing: phase.easing, delay: phase.delay, fill: 'both' }));",
    "    }",
    "    return { animations, cleanup: () => { overlay.remove(); for (const restore of hidden) restore(); } };",
    "  };",
    "  const fail = () => report('transition-error');",
    "  try {",
    "    stage.dataset.osdDir = config.direction;",
    "    stage.style.setProperty('--osd-dir', config.direction === 'forward' ? '1' : '-1');",
    "    stage.style.backgroundColor = config.incoming.designTokens?.background ?? config.incoming.design?.palette.bg ?? config.outgoing.designTokens?.background ?? config.outgoing.design?.palette.bg ?? 'transparent';",
    "    config.assetOrigins = [...new Set([...config.outgoing.assetOrigins, ...config.incoming.assetOrigins])];",
    "    roots[0].append(validHtml(config.outgoing.html).content);",
    "    roots[1].append(validHtml(config.incoming.html).content);",
    "    applyDesign(roots[0], config.outgoing);",
    "    applyDesign(roots[1], config.incoming);",
    "    const easing = config.transition.easing ?? 'cubic-bezier(.4, 0, .2, 1)';",
    "    const duration = config.transition.duration;",
    "    const images = Array.from(document.images).map((image) => image.decode().catch(() => {}));",
    "    Promise.all([document.fonts?.ready ?? Promise.resolve(), ...images]).then(() => {",
    "      if (reducedMotion) { report('transition-complete'); return; }",
    "      const morphPhase = resolveMorph(config.transition.morph, duration, easing);",
    "      const morphRun = prepareMorph(morphPhase);",
    "      const exitPhase = config.transition.throughBackground ? config.transition.exit : holdOpacity(config.transition.exit);",
    "      const animations = [...morphRun.animations];",
    "      const exitAnimation = runPhase(outgoingLayer, exitPhase, duration, easing);",
    "      const enterAnimation = runPhase(incomingLayer, config.transition.enter, duration, easing);",
    "      if (exitAnimation) animations.push(exitAnimation);",
    "      if (enterAnimation) animations.push(enterAnimation);",
    "      if (!exitAnimation && morphRun.animations.length) outgoingLayer.style.visibility = 'hidden';",
    "      if (!animations.length) { morphRun.cleanup(); report('transition-complete'); return; }",
    "      Promise.all(animations.map((animation) => animation.finished)).then(() => { morphRun.cleanup(); report('transition-complete'); }).catch(fail);",
    "    }).catch(fail);",
    "  } catch { fail(); }",
    "})();",
  ].join("\n");

  return {
    nonce,
    srcDoc: `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${escapeAttribute(csp)}"><meta name="referrer" content="no-referrer"><style nonce="${nonce}">${styles}\nhtml,body,#osd-stage{margin:0;width:1920px;height:1080px;overflow:hidden}body{background:transparent}#osd-stage{position:relative;isolation:isolate}#osd-out,#osd-in{position:absolute;inset:0;width:100%;height:100%;overflow:hidden}#osd-out{z-index:1}#osd-in{z-index:2}#osd-out-root,#osd-in-root{position:relative;width:100%;height:100%}</style></head><body><div id="osd-stage"><div id="osd-out"><div id="osd-out-root"></div></div><div id="osd-in"><div id="osd-in-root"></div></div></div><script nonce="${nonce}">${script}</script></body></html>`,
  };
}

export function isSlideTransitionFrameMessage(
  value: unknown,
  nonce: string,
  slideId: string,
): value is SlideTransitionFrameMessage {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const message = value as Record<string, unknown>;
  return (
    (message.type === "transition-complete" ||
      message.type === "transition-error") &&
    message.nonce === nonce &&
    message.slideId === slideId
  );
}

function isSafeTransitionSnapshot(
  snapshot: SandboxedSlideRenderResult,
  appOrigin: string,
): boolean {
  if (
    typeof snapshot.html !== "string" ||
    snapshot.html.length > MAX_RENDERED_SLIDE_HTML_LENGTH ||
    !/^[a-f0-9]{64}$/.test(snapshot.sourceHash) ||
    !Array.isArray(snapshot.assetOrigins) ||
    snapshot.assetOrigins.length > 20 ||
    (snapshot.fontOrigins !== undefined &&
      !Array.isArray(snapshot.fontOrigins)) ||
    (snapshot.fontAssets !== undefined &&
      !Array.isArray(snapshot.fontAssets)) ||
    !isSlideFontAssetList(
      snapshot.fontAssets ?? [],
      snapshot.fontOrigins ?? [],
      snapshot.designTokens,
      appOrigin,
    ) ||
    !Array.isArray(snapshot.styles) ||
    snapshot.styles.length > 20 ||
    !snapshot.assetUrls ||
    Object.keys(snapshot.assetUrls).length > 100
  ) {
    return false;
  }
  const allowedOrigins = new Set<string>();
  for (const origin of snapshot.assetOrigins) {
    if (typeof origin !== "string" || origin.length > 2048) return false;
    try {
      const parsed = new URL(origin);
      if (
        parsed.origin !== origin ||
        (parsed.protocol !== "https:" && parsed.origin !== appOrigin)
      ) {
        return false;
      }
      allowedOrigins.add(origin);
    } catch {
      // coercion-ok: malformed origins fail the transition snapshot safety check.
      return false;
    }
  }
  let styleLength = 0;
  for (const css of snapshot.styles) {
    if (typeof css !== "string" || !isSafeStyle(css)) return false;
    styleLength += css.length;
  }
  if (styleLength > FRAME_STYLE_LIMIT) return false;
  for (const value of Object.values(snapshot.assetUrls)) {
    if (typeof value !== "string" || value.length > 4096) return false;
    try {
      const url = new URL(value);
      if (
        url.href !== value ||
        url.username ||
        url.password ||
        (url.protocol !== "https:" && url.origin !== appOrigin) ||
        !allowedOrigins.has(url.origin)
      ) {
        return false;
      }
    } catch {
      // coercion-ok: malformed asset URLs fail the transition snapshot safety check.
      return false;
    }
  }
  const template = document.createElement("template");
  template.innerHTML = snapshot.html;
  const allowedAssetOrigins = [...allowedOrigins];
  for (const element of template.content.querySelectorAll("*")) {
    if (BLOCKED_FRAME_TAGS.has(element.tagName.toLowerCase())) return false;
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase();
      if (name.startsWith("on") || name === "srcdoc" || name === "srcset")
        return false;
      if (name === "poster" && element.tagName.toLowerCase() !== "video") {
        return false;
      }
      if (
        (name === "src" || name === "poster") &&
        !isAllowedTransitionAssetUrl(
          attribute.value,
          allowedAssetOrigins,
          appOrigin,
        )
      ) {
        return false;
      }
      if (name === "style" && !isSafeStyle(attribute.value)) return false;
    }
  }
  return true;
}

function isAllowedTransitionAssetUrl(
  value: string,
  allowedOrigins: readonly string[],
  appOrigin: string,
): boolean {
  if (value.length > 4096) return false;
  try {
    const url = new URL(value);
    return (
      url.href === value &&
      !url.username &&
      !url.password &&
      (url.protocol === "https:" || url.origin === appOrigin) &&
      allowedOrigins.includes(url.origin)
    );
  } catch {
    // coercion-ok: malformed URLs are rejected by transition asset validation.
    return false;
  }
}

function isSafeStyle(css: string): boolean {
  return (
    css.length <= 65_536 &&
    !/[\\\u0000-\u001f\u007f<>]|\/\*|\*\/|(?:url|expression)\s*\(|javascript:/i.test(
      css,
    )
  );
}

function createNonce(): string | null {
  if (typeof crypto === "undefined" || !crypto.getRandomValues) return null;
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

function encodeScriptJson(value: unknown): string {
  return JSON.stringify(value)
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e")
    .replaceAll("&", "\\u0026")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
}

function escapeAttribute(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;");
}
