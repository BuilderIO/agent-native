import type {
  ContrastAuditBrowserResult,
  ContrastAuditRequest,
  ContrastAuditSlideInput,
  ContrastAuditSlideTarget,
  ContrastFailure,
  ContrastSkipped,
  ContrastUnverified,
} from "@shared/contrast-audit";
import {
  contrastSlideRenderFingerprint,
  deckContrastRenderKey,
} from "@shared/contrast-audit";
import type { AxeResults, NodeResult, RunOptions } from "axe-core";

const MAX_TEXT_CHARS = 80;
const RENDER_WAIT_MS = 4_000;
const RENDER_POLL_MS = 150;

const CONTRAST_RUN_OPTIONS: RunOptions = {
  runOnly: { type: "rule", values: ["color-contrast"] },
  resultTypes: ["violations", "incomplete"],
  iframes: false,
  elementRef: true,
};

type ContrastResults = Pick<AxeResults, "violations" | "incomplete" | "passes">;

export interface AuditableDeck {
  id: string;
  designSystemId?: string | null;
  /** Raw JSON of the linked design system's data, if resolved. */
  designSystemData?: string | null;
  tweaks?: unknown;
  aspectRatio?: string | null;
  slides: Array<ContrastAuditSlideInput & { skipped?: boolean }>;
}

type ContrastCheckData = {
  fgColor?: string;
  bgColor?: string;
  contrastRatio?: number;
  fontSize?: string;
  fontWeight?: string;
  expectedContrastRatio?: string;
  messageKey?: string;
};

function checkData(node: NodeResult): ContrastCheckData {
  const data = node.any[0]?.data;
  return data && typeof data === "object" ? (data as ContrastCheckData) : {};
}

function describeElement(element: Element | undefined): {
  objectId?: string;
  text: string;
} {
  const text = (element?.textContent ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_TEXT_CHARS);
  const objectId =
    element
      ?.closest("[data-slide-object-id]")
      ?.getAttribute("data-slide-object-id") ?? undefined;
  return objectId ? { objectId, text } : { text };
}

function parseRequiredRatio(value: string | undefined): number {
  const parsed = Number.parseFloat(value ?? "");
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

export function mapAxeContrastResults(
  results: ContrastResults,
  slideId: string,
): {
  failures: ContrastFailure[];
  unverified: ContrastUnverified[];
  checkedNodeCount: number;
} {
  const nodesFor = (group: AxeResults["violations"]) =>
    group
      .filter((rule) => rule.id === "color-contrast")
      .flatMap((rule) => rule.nodes);

  const violations = nodesFor(results.violations);
  const incomplete = nodesFor(results.incomplete);
  const passes = nodesFor(results.passes);

  const failures = violations.map((node): ContrastFailure => {
    const data = checkData(node);
    return {
      slideId,
      ...describeElement(node.element),
      foreground: data.fgColor ?? "unknown",
      background: data.bgColor ?? "unknown",
      ratio: typeof data.contrastRatio === "number" ? data.contrastRatio : 0,
      requiredRatio: parseRequiredRatio(data.expectedContrastRatio),
      fontSize: data.fontSize ?? "unknown",
      fontWeight: data.fontWeight ?? "unknown",
    };
  });
  const unverified = incomplete.map(
    (node): ContrastUnverified => ({
      slideId,
      ...describeElement(node.element),
      reason: checkData(node).messageKey ?? "unknown",
    }),
  );

  return {
    failures,
    unverified,
    checkedNodeCount: violations.length + incomplete.length + passes.length,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

async function loadAxe() {
  return (await import("axe-core")).default;
}

// axe reports text as pseudoContent when any ancestor has an absolutely
// positioned ::before/::after with a background, ignoring opacity — so the
// thumbnail list's scroll shadow blocks every slide. It reports the nearest
// such ancestor, so one outside the canvas means nothing in the slide covers
// the text, and it is safe to re-check with pseudo detection off.
async function auditCanvas(
  axe: Awaited<ReturnType<typeof loadAxe>>,
  canvas: HTMLElement,
): Promise<ContrastResults> {
  const results = await axe.run(canvas, CONTRAST_RUN_OPTIONS);
  const chromeBlocked = new Set(
    results.incomplete
      .filter((rule) => rule.id === "color-contrast")
      .flatMap((rule) => rule.nodes)
      .filter((node) => {
        if (checkData(node).messageKey !== "pseudoContent") return false;
        const owner = node.any[0]?.relatedNodes?.[0]?.element;
        return !!owner && !canvas.contains(owner);
      }),
  );
  if (chromeBlocked.size === 0) return results;

  // axe accepts per-check options at run time; its typings omit them.
  const ignorePseudo: RunOptions & {
    checks: Record<string, { options: Record<string, unknown> }>;
  } = {
    ...CONTRAST_RUN_OPTIONS,
    checks: { "color-contrast": { options: { ignorePseudo: true } } },
  };
  const recheck = await axe.run(
    { include: [...chromeBlocked].map((node) => node.element!) },
    ignorePseudo,
  );
  return {
    violations: [...results.violations, ...recheck.violations],
    incomplete: [
      ...results.incomplete.map((rule) => ({
        ...rule,
        nodes: rule.nodes.filter((node) => !chromeBlocked.has(node)),
      })),
      ...recheck.incomplete,
    ],
    passes: [...results.passes, ...recheck.passes],
  };
}

/**
 * Waits for the open deck to reach the version the server asked about. The
 * server's write reaches this tab through sync, so an audit started the moment
 * the agent finishes an edit would otherwise check the previous HTML.
 */
async function waitForRequestedVersion(
  request: ContrastAuditRequest,
  getDeck: () => AuditableDeck | null,
): Promise<AuditableDeck | null> {
  const deadline = Date.now() + RENDER_WAIT_MS;
  for (;;) {
    const deck = getDeck();
    if (deck && deck.id === request.deckId) {
      const current = new Map(
        deck.slides.map((slide) => [
          slide.id,
          contrastSlideRenderFingerprint(slide),
        ]),
      );
      const caughtUp =
        deckContrastRenderKey(deck) === request.renderKey &&
        request.slides.every(
          (slide) => current.get(slide.id) === slide.contentHash,
        );
      if (caughtUp || Date.now() >= deadline) return deck;
    } else if (Date.now() >= deadline) {
      return deck;
    }
    await sleep(RENDER_POLL_MS);
  }
}

export async function runContrastAudit(
  request: ContrastAuditRequest,
  getDeck: () => AuditableDeck | null,
): Promise<ContrastAuditBrowserResult> {
  const openDeck = getDeck();
  if (!openDeck || openDeck.id !== request.deckId) {
    throw new Error(
      `This tab has ${openDeck ? `deck ${openDeck.id}` : "no deck"} open, not ${request.deckId}.`,
    );
  }

  const deck = await waitForRequestedVersion(request, getDeck);
  if (!deck || deck.id !== request.deckId) {
    throw new Error(`Deck ${request.deckId} was closed during the audit.`);
  }
  const renderKey = deckContrastRenderKey(deck);
  const audited: ContrastAuditSlideTarget[] = [];
  const failures: ContrastFailure[] = [];
  const unverified: ContrastUnverified[] = [];
  const skipped: ContrastSkipped[] = [];

  if (renderKey !== request.renderKey) {
    return {
      deckId: deck.id,
      renderKey,
      audited,
      failures,
      unverified,
      skipped: request.slides.map((slide) => ({
        slideId: slide.id,
        reason: "stale-render",
      })),
    };
  }

  // Let React commit the version the loop above observed in state.
  await nextFrame();
  await nextFrame();

  const axe = await loadAxe();
  const slidesById = new Map(deck.slides.map((slide) => [slide.id, slide]));

  for (const target of request.slides) {
    const slide = slidesById.get(target.id);
    const contentHash = slide ? contrastSlideRenderFingerprint(slide) : null;
    if (!slide || contentHash !== target.contentHash) {
      skipped.push({ slideId: target.id, reason: "stale-render" });
      continue;
    }
    // A hidden slide's thumbnail is dimmed under a scrim, which axe would
    // fold into every ratio and report as a failure the slide doesn't have.
    if (slide.skipped) {
      skipped.push({ slideId: target.id, reason: "hidden-from-presentation" });
      continue;
    }

    const id = CSS.escape(target.id);
    const thumbnail = document.querySelector(
      `[data-slide-thumbnail-id="${id}"]`,
    );
    const canvas = thumbnail?.querySelector<HTMLElement>(
      `[data-slide-canvas="${id}"]`,
    );
    if (!thumbnail || !canvas) {
      skipped.push({ slideId: target.id, reason: "not-rendered" });
      continue;
    }
    if (thumbnail.querySelector(".slide-thumbnail-ai-shimmer")) {
      skipped.push({ slideId: target.id, reason: "generating" });
      continue;
    }

    const mapped = mapAxeContrastResults(
      await auditCanvas(axe, canvas),
      target.id,
    );
    // A thumbnail scrolled out of the sidebar comes back as per-text
    // "outsideViewport". That describes the slide's position, not its text,
    // so the slide was not checked rather than full of unverifiable text.
    if (mapped.unverified.some((entry) => entry.reason === "outsideViewport")) {
      skipped.push({ slideId: target.id, reason: "not-in-view" });
      continue;
    }
    // axe drops text it considers off screen instead of reporting it, so a
    // slide with text and zero checked nodes was not checked — not clean.
    if (mapped.checkedNodeCount === 0 && canvas.textContent?.trim()) {
      skipped.push({ slideId: target.id, reason: "not-checked" });
      continue;
    }
    // axe.run() is async; sync or a user edit can change this slide (or the
    // design system it inherits colors from) before it resolves. Re-read the
    // live deck rather than trust the snapshot captured before the await.
    const liveDeck = getDeck();
    const liveSlide = liveDeck?.slides.find((entry) => entry.id === target.id);
    const stillCurrent =
      liveDeck &&
      liveDeck.id === request.deckId &&
      deckContrastRenderKey(liveDeck) === request.renderKey &&
      liveSlide &&
      contrastSlideRenderFingerprint(liveSlide) === target.contentHash;
    if (!stillCurrent) {
      skipped.push({ slideId: target.id, reason: "stale-render" });
      continue;
    }
    audited.push({ id: target.id, contentHash });
    failures.push(...mapped.failures);
    unverified.push(...mapped.unverified);
  }

  return { deckId: deck.id, renderKey, audited, failures, unverified, skipped };
}
