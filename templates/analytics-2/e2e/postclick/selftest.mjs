// Offline controls for the post-click checks: no browser, no app, no network.
//
// One clean observation must pass; each mutant must fail the check it breaks;
// and a required transition with no observation must come back INCOMPLETE (or
// BLOCKED) rather than a pass. A check that cannot fail is not a check, so this
// is the evidence that a live verdict means something.
import { evaluate } from "./checks.mjs";

const clean = {
  triggerFound: true,
  trustedInput: true,
  chart: { hasTable: false, chartSurface: 1, rows: 0 },
  visibility: {
    triggerBox: { top: 100, bottom: 120, left: 200, right: 220 },
    viewport: { width: 1440, height: 900 },
    hitIsTrigger: true,
    triggerEntity: "Chart 1",
  },
  menuOpen: {
    open: true,
    items: ["Open", "Delete"],
    dividers: 1,
    rightEdge: 220,
    triggerRight: 220,
    focusOnFirstItem: true,
    ownerLabel: "Actions for Chart 1",
    dangerIndex: 1,
    dividersBefore: 1,
  },
  afterClose: { open: false, activeLabel: "trigger", focusedInMenu: false },
  reopened: { open: true, items: ["Open", "Delete"] },
};

const cases = [];
const push = (id, patch, expectVerdict, mustStatus) => {
  const obs = structuredClone(clean);
  patch(obs);
  cases.push({ id, obs, expectVerdict, mustStatus });
};

push("clean", () => {}, "PASS", null);
// no-op: the click changed nothing
push(
  "control: no-op click",
  (o) => {
    o.menuOpen.open = false;
    o.menuOpen.items = [];
    o.reopened = { open: false, items: [] };
  },
  "FAIL",
  "open-changed-the-page-state",
);
// wrong effect: the menu belongs to a different entity
push(
  "control: wrong-effect (menu for another entity)",
  (o) => {
    o.menuOpen.ownerLabel = "Actions for Table 1";
  },
  "FAIL",
  "menu-belongs-to-the-triggered-entity",
);
// offscreen: the trigger is below the viewport
push(
  "control: offscreen trigger",
  (o) => {
    o.visibility.triggerBox = { top: 1200, bottom: 1220, left: 10, right: 30 };
  },
  "FAIL",
  "trigger-is-on-screen-and-unobstructed",
);
// offscreen by overlay: the hit point lands elsewhere
push(
  "control: covered trigger",
  (o) => {
    o.visibility.hitIsTrigger = false;
  },
  "FAIL",
  "trigger-is-on-screen-and-unobstructed",
);
// required-unknown: no trusted input, so dismissal cannot be decided
push(
  "control: required-unknown (no trusted input)",
  (o) => {
    o.trustedInput = false;
  },
  "INCOMPLETE",
  "trigger-click-closes-the-menu",
);
// required-unknown: no observation at all
push(
  "control: required-unknown (no observation)",
  (o) => {
    o.trustedInput = false;
    o.afterClose = { open: null, activeLabel: null, focusedInMenu: null };
  },
  "INCOMPLETE",
  "close-returns-focus-to-trigger",
);
// blocked: the surface is not on the page (a second app whose seam differs)
push(
  "control: blocked surface",
  (o) => {
    o.triggerFound = false;
  },
  "BLOCKED",
  "surface-reachable",
);
// trusted failures still fail, not incomplete
push(
  "control: trusted no-close",
  (o) => {
    o.afterClose.open = true;
  },
  "FAIL",
  "trigger-click-closes-the-menu",
);
push(
  "control: destructive item with no separator",
  (o) => {
    o.menuOpen.dividersBefore = 0;
  },
  "FAIL",
  "menu-separates-its-destructive-item",
);
push(
  "control: reopen reordered",
  (o) => {
    o.reopened.items = ["Delete", "Open"];
  },
  "FAIL",
  "reopen-keeps-the-same-items",
);

const rows = cases.map((entry) => {
  const result = evaluate(entry.obs);
  const statuses = result.checks.map((c) => c.status);
  const expected =
    entry.expectVerdict === "INCOMPLETE" || entry.expectVerdict === "BLOCKED"
      ? ["INCOMPLETE", "BLOCKED"]
      : [entry.expectVerdict];
  const verdictOk = expected.includes(result.verdict);
  const mustStatusOk =
    entry.mustStatus === null ||
    result.checks.find((c) => c.id === entry.mustStatus)?.status ===
      (entry.expectVerdict === "INCOMPLETE"
        ? "INCOMPLETE"
        : entry.expectVerdict === "BLOCKED"
          ? "BLOCKED"
          : "FAIL");
  return {
    case: entry.id,
    expectedVerdict: entry.expectVerdict,
    verdict: result.verdict,
    mustStatus: entry.mustStatus,
    failed: result.failed,
    incomplete: result.incomplete,
    blocked: result.blocked,
    statuses,
    status: verdictOk && mustStatusOk ? "PASS" : "FAIL",
  };
});

const failures = rows.filter((row) => row.status !== "PASS");
const report = {
  kind: "offline-controls",
  verdict: failures.length === 0 ? "PASS" : "FAIL",
  cases: rows,
};
console.log(JSON.stringify(report, null, 2));
process.exit(report.verdict === "PASS" ? 0 : 1);
