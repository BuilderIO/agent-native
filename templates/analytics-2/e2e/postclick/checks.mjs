// Assertions for the dashboard chart cell's post-click states.
//
// Pure: `evaluate(observation)` takes what a collector saw and returns real
// checks with a status per check and an overall verdict, so the same code runs
// over a live observation, a fabricated one, and a second app's page.
//
// Contract (ArtCraft trial 3):
//   PASS       every required transition was observed and held
//   FAIL       a trusted observation contradicts the expectation
//   INCOMPLETE a required transition was not observed, so it cannot be decided
//   BLOCKED    the surface needed to observe it is not reachable in this run
// A run may only be PASS when nothing required is left undecided, so a missing
// observation can never be reported as a pass.

/**
 * @typedef {object} Observation
 * @property {boolean} [triggerFound] whether the collector found the control at all
 * @property {boolean} [trustedInput] whether the collector could send trusted input
 * @property {{ hasTable: boolean, chartSurface: number, rows: number }} chart
 * @property {{ open: boolean, items: string[], dividers: number, rightEdge: number, triggerRight: number, focusOnFirstItem: boolean, ownerLabel?: string | null }} menuOpen
 * @property {{ open: boolean, activeLabel: string | null, focusedInMenu: boolean }} afterClose
 * @property {{ open: boolean, items: string[] }} reopened
 * @property {{ triggerBox?: { top: number, bottom: number, left: number, right: number } | null, viewport?: { width: number, height: number } | null, hitIsTrigger?: boolean | null, triggerEntity?: string | null }} visibility
 */

const NAMES = {
  "surface-reachable":
    "the control this journey starts from is present on the page",
  "chart-cell-renders-a-chart":
    "a cell whose kind is Chart renders a chart surface, not only a data table",
  "trigger-is-on-screen-and-unobstructed":
    "the trigger is inside the viewport and the point a click lands on belongs to it",
  "menu-opens-on-its-trigger":
    "the menu opens on the trigger with focus on its first item",
  "open-changed-the-page-state":
    "opening the menu actually changed the page state (a no-op click is not an effect)",
  "menu-belongs-to-the-triggered-entity":
    "the menu describes the entity whose control was clicked",
  "menu-anchors-to-the-trigger": "the menu's end edge follows the trigger",
  "trigger-click-closes-the-menu":
    "the same control that opened the menu closes it",
  "close-returns-focus-to-trigger": "closing puts focus back on the trigger",
  "reopen-keeps-the-same-items":
    "re-opening offers exactly the same items in the same order",
  "menu-has-no-empty-separator": "a separator is only rendered between items",
  "menu-separates-its-destructive-item":
    "the destructive item is preceded by a separator",
};

const REQUIRED = [
  "surface-reachable",
  "menu-opens-on-its-trigger",
  "open-changed-the-page-state",
  "menu-belongs-to-the-triggered-entity",
  "trigger-is-on-screen-and-unobstructed",
  "trigger-click-closes-the-menu",
  "close-returns-focus-to-trigger",
  "reopen-keeps-the-same-items",
];

const strip = (items) =>
  (Array.isArray(items) ? items : [])
    .map((item) => item.trim())
    .filter(Boolean);

const inside = (box, viewport) =>
  Boolean(
    box &&
    viewport &&
    box.top >= 0 &&
    box.left >= 0 &&
    box.bottom <= viewport.height &&
    box.right <= viewport.width &&
    box.bottom > box.top,
  );

/** @param {Observation} obs */
export function evaluate(obs) {
  const trusted = obs.trustedInput === true;
  // Legacy fixtures omit `triggerFound` (they were written before the collector
  // reported it), so absence means "not reported"; a collector that reports it
  // must report it truthfully.
  const found =
    obs.triggerFound === undefined ? true : obs.triggerFound === true;
  const checks = [];
  const add = (id, status, expect, actual) =>
    checks.push({ id, name: NAMES[id], status, expect, actual });
  const decide = (id, ok, expect, actual) =>
    add(id, ok ? "PASS" : "FAIL", expect, actual);
  // A check that needs an input the collector could not send is undecided.
  const needsInput = (id, ok, expect, actual) =>
    add(id, trusted ? (ok ? "PASS" : "FAIL") : "INCOMPLETE", expect, actual);

  const vis = obs.visibility ?? {};
  const menu = obs.menuOpen ?? { open: false, items: [], dividers: 0 };
  const after = obs.afterClose ?? { open: null, activeLabel: null };
  const reopened = obs.reopened ?? { open: false, items: [] };

  if (!found) {
    add("surface-reachable", "BLOCKED", "the trigger is on the page", {
      triggerFound: false,
    });
    for (const id of REQUIRED.slice(1))
      add(id, "BLOCKED", NAMES[id], { reason: "the surface is not reachable" });
    const blocked = checks.filter((c) => c.status !== "PASS").map((c) => c.id);
    return { verdict: "BLOCKED", failed: [], incomplete: [], blocked, checks };
  }
  decide("surface-reachable", true, "the trigger is on the page", {
    triggerFound: true,
  });

  decide(
    "chart-cell-renders-a-chart",
    (obs.chart?.chartSurface ?? 0) > 0,
    "a chart surface (svg/canvas element) inside the cell output",
    {
      chartSurface: obs.chart?.chartSurface ?? 0,
      hasTable: obs.chart?.hasTable ?? null,
      rows: obs.chart?.rows ?? null,
    },
  );

  // Required evidence, refused rather than passed: without the geometry AND a
  // positive hit observation (hit === true, not merely "not false") the claim
  // that the control is reachable cannot be made, so the check is INCOMPLETE.
  const hasGeometry = vis.triggerBox != null && vis.viewport != null;
  const hasHit = vis.hitIsTrigger === true || vis.hitIsTrigger === false;
  const onScreen =
    hasGeometry &&
    hasHit &&
    inside(vis.triggerBox, vis.viewport) &&
    vis.hitIsTrigger === true;
  add(
    "trigger-is-on-screen-and-unobstructed",
    !hasGeometry || !hasHit ? "INCOMPLETE" : onScreen ? "PASS" : "FAIL",
    "trigger box inside the viewport and the hit point on the trigger (hit === true)",
    {
      triggerBox: vis.triggerBox ?? null,
      viewport: vis.viewport ?? null,
      hitIsTrigger: vis.hitIsTrigger ?? null,
    },
  );

  decide(
    "menu-opens-on-its-trigger",
    menu.open === true && menu.focusOnFirstItem === true,
    { open: true, focusOnFirstItem: true },
    {
      open: menu.open === true,
      focusOnFirstItem: menu.focusOnFirstItem === true,
    },
  );

  // A click that opened nothing is a no-op, not a clean interaction.
  decide(
    "open-changed-the-page-state",
    menu.open === true && strip(menu.items).length > 0,
    "menu open with at least one item",
    {
      open: menu.open === true,
      items: strip(menu.items).length,
    },
  );

  // Identity is anchored to the target, not to a label fragment: an explicit
  // target id on both sides wins, and without ids the two labels must name the
  // same entity exactly ("Chart 1" never matches "Chart 10"). A missing or empty
  // witness is refused (INCOMPLETE), never compared loosely.
  const triggerTarget =
    typeof vis.triggerTargetId === "string" && vis.triggerTargetId.trim() !== ""
      ? vis.triggerTargetId.trim()
      : typeof vis.triggerEntity === "string" && vis.triggerEntity.trim() !== ""
        ? vis.triggerEntity.trim()
        : null;
  const menuTargetRaw =
    typeof menu.ownerTargetId === "string" && menu.ownerTargetId.trim() !== ""
      ? menu.ownerTargetId.trim()
      : typeof menu.ownerLabel === "string" && menu.ownerLabel.trim() !== ""
        ? menu.ownerLabel.trim().replace(/^actions for\s+/i, "")
        : null;
  const entityBound = triggerTarget !== null && menuTargetRaw !== null;
  add(
    "menu-belongs-to-the-triggered-entity",
    !entityBound
      ? "INCOMPLETE"
      : triggerTarget === menuTargetRaw
        ? "PASS"
        : "FAIL",
    "the menu names the exact target the trigger belongs to",
    {
      menuOwner: menu.ownerLabel ?? null,
      menuTargetId: menu.ownerTargetId ?? null,
      triggerEntity: vis.triggerEntity ?? null,
      triggerTargetId: vis.triggerTargetId ?? null,
      anchoredOn: { triggerTarget, menuTargetRaw },
    },
  );

  decide(
    "menu-anchors-to-the-trigger",
    Math.abs((menu.rightEdge ?? 0) - (menu.triggerRight ?? 0)) <= 4,
    "menu end edge within 4px of the trigger's end edge",
    {
      rightEdge: menu.rightEdge ?? null,
      triggerRight: menu.triggerRight ?? null,
    },
  );

  needsInput(
    "trigger-click-closes-the-menu",
    after.open === false,
    { open: false },
    { open: after.open ?? null },
  );
  needsInput(
    "close-returns-focus-to-trigger",
    after.activeLabel === "trigger",
    { activeLabel: "trigger" },
    { activeLabel: after.activeLabel ?? null },
  );

  const before = strip(menu.items);
  const afterItems = strip(reopened.items);
  decide(
    "reopen-keeps-the-same-items",
    reopened.open === true &&
      before.length > 0 &&
      before.length === afterItems.length &&
      before.every((item, index) => item === afterItems[index]),
    before,
    afterItems,
  );

  if (
    typeof menu.dangerIndex === "number" &&
    typeof menu.dividersBefore === "number"
  ) {
    decide(
      "menu-separates-its-destructive-item",
      menu.dividersBefore >= 1,
      "at least one separator before the destructive item",
      { dangerIndex: menu.dangerIndex, dividersBefore: menu.dividersBefore },
    );
  } else {
    add(
      "menu-separates-its-destructive-item",
      "INCOMPLETE",
      "the menu's destructive item was not located",
      {},
    );
  }

  decide(
    "menu-has-no-empty-separator",
    before.length === 0 || (menu.dividers ?? 0) <= before.length - 1,
    "dividers <= items - 1",
    {
      dividers: menu.dividers ?? 0,
      items: before.length,
    },
  );

  const failed = checks.filter((c) => c.status === "FAIL").map((c) => c.id);
  const incomplete = checks
    .filter((c) => c.status === "INCOMPLETE")
    .map((c) => c.id);
  const blocked = checks.filter((c) => c.status === "BLOCKED").map((c) => c.id);
  const unrequired = checks
    .filter((c) => REQUIRED.includes(c.id) && c.status !== "PASS")
    .map((c) => c.id);
  const verdict =
    failed.length > 0
      ? "FAIL"
      : blocked.length > 0
        ? "BLOCKED"
        : incomplete.length > 0 || unrequired.length > 0
          ? "INCOMPLETE"
          : "PASS";
  return { verdict, failed, incomplete, blocked, unrequired, checks };
}

export default evaluate;
