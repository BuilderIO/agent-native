import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

// Guard: all templates/<name>/app/components/ui/*.tsx files that share the
// same primitive name must be byte-identical, OR must be listed in the
// ALLOW_LIST below with a documented reason.
//
// If you update a primitive, update it in EVERY template that holds it (or
// use the canonical template as the source and copy with:
//
//   cp templates/analytics/app/components/ui/<file>.tsx \
//      templates/<other>/app/components/ui/<file>.tsx
//
// If a template genuinely needs a behaviorally different variant, add it here
// with a comment explaining why the deviation is intentional.

// Each entry: [primitive filename, template name, reason for deviation]
const ALLOW_LIST: Array<[string, string, string]> = [
  // calendar.tsx — DayPicker v9 class-name API split across templates.
  // The majority (7 templates) use the older v9 API (caption, nav_button, …).
  // Forms/mail are ahead with the newest shadcn API:
  // getDefaultClassNames + DayButton + captionLayout.
  // Unifying these requires a coordinated DayPicker API migration; defer until
  // the 7-template group catches up.
  [
    "calendar.tsx",
    "forms",
    "newest shadcn: getDefaultClassNames + DayButton + captionLayout",
  ],
  [
    "calendar.tsx",
    "mail",
    "newest shadcn: getDefaultClassNames + DayButton + captionLayout",
  ],

  // chart.tsx — analytics adds the useChartTooltipFlip hook (which only exists
  // in the analytics template's hooks/ dir) and uses `[_, config]`
  // destructuring. The canonical template has no analytics-specific hook.
  [
    "chart.tsx",
    "analytics",
    "analytics-specific: useChartTooltipFlip hook (only exists in analytics hooks/)",
  ],

  // command.tsx — forms/mail still carry the local cmdk dialog wrapper while
  // the canonical templates re-export the toolkit primitive.
  ["command.tsx", "forms", "local cmdk dialog wrapper pending toolkit sync"],
  ["command.tsx", "mail", "local cmdk dialog wrapper pending toolkit sync"],

  // context-menu.tsx — forms/mail still carry the local Radix implementation
  // while the canonical group re-exports the toolkit primitive.
  [
    "context-menu.tsx",
    "forms",
    "local Radix context-menu implementation pending toolkit sync",
  ],
  [
    "context-menu.tsx",
    "mail",
    "local Radix context-menu implementation pending toolkit sync",
  ],

  // dropdown-menu.tsx — brain uses the newer shadcn data-slot implementation.
  [
    "dropdown-menu.tsx",
    "brain",
    "newer shadcn data-slot dropdown implementation",
  ],

  // input.tsx — mail uses h-9 instead of h-10 for intentional compact sizing
  // in its dense UI.
  ["input.tsx", "mail", "intentional compact sizing: h-9 vs canonical h-10"],

  // macros.tsx primitives — macros has a distinct visual system while the
  // shared canonical primitives re-export toolkit UI.
  ["button.tsx", "macros", "custom macros visual system"],
  ["card.tsx", "macros", "custom macros visual system"],
  ["dialog.tsx", "macros", "custom macros visual system"],
  ["input.tsx", "macros", "custom macros visual system"],
  // menubar.tsx — macros uses a different trigger style.
  ["menubar.tsx", "macros", "custom-themed trigger style"],
  ["progress.tsx", "macros", "custom macros visual system"],
  ["tabs.tsx", "macros", "custom macros visual system"],

  // scroll-area.tsx — content keeps the local horizontal scrollbar and
  // viewport block override needed by editor/database surfaces.
  [
    "scroll-area.tsx",
    "content",
    "content editor needs horizontal scrollbar and viewport block override",
  ],

  // sonner.tsx — calendar uses responsive wide toast layout classes.
  ["sonner.tsx", "calendar", "responsive wide toast layout classes"],

  // sonner.tsx — mail has heavily custom-styled toasts (bg-card, rounded-lg,
  // text-13px, custom action/cancel button styles).
  [
    "sonner.tsx",
    "mail",
    "heavily custom-styled toasts (bg-card, 13px, custom action styles)",
  ],

  // tabs.tsx — plan adds border border-transparent to TabsTrigger for layout
  // stability.
  [
    "tabs.tsx",
    "plan",
    "border border-transparent on trigger for layout stability",
  ],

  // textarea.tsx — two intentional variants beyond the canonical version:
  //   • assets: adds autoGrow behavior for asset prompt/editing forms
  //   • macros: adds transition-all hover:border-ring/50 custom visual polish
  //   • mail: minor whitespace/style difference; same functional behaviour
  ["textarea.tsx", "assets", "autoGrow behavior for asset forms"],
  [
    "textarea.tsx",
    "macros",
    "custom: transition-all hover:border-ring/50 animation",
  ],
  ["textarea.tsx", "mail", "minor whitespace/style difference from canonical"],
];

function workspaceRoot(): string {
  let current = process.cwd();
  while (current !== path.dirname(current)) {
    if (fs.existsSync(path.join(current, "pnpm-workspace.yaml"))) {
      return current;
    }
    current = path.dirname(current);
  }
  throw new Error("Could not locate workspace root.");
}

const ROOT = workspaceRoot();

function md5(content: string): string {
  return crypto.createHash("md5").update(content).digest("hex");
}

function readUiFile(template: string, filename: string): string {
  return fs.readFileSync(
    path.join(ROOT, "templates", template, "app", "components", "ui", filename),
    "utf-8",
  );
}

function getTemplates(): string[] {
  return fs
    .readdirSync(path.join(ROOT, "templates"))
    .filter((t) =>
      fs.existsSync(path.join(ROOT, "templates", t, "app", "components", "ui")),
    );
}

function getPrimitives(template: string): string[] {
  const dir = path.join(ROOT, "templates", template, "app", "components", "ui");
  return fs.readdirSync(dir).filter((f) => f.endsWith(".tsx"));
}

describe("ui-primitives sync guard", () => {
  it("keeps shared ui primitives byte-identical across templates, except documented allow-list", () => {
    const templates = getTemplates();

    // Build map: primitive → (hash → [templates])
    const hashes = new Map<string, Map<string, string[]>>();

    for (const template of templates) {
      for (const primitive of getPrimitives(template)) {
        const content = readUiFile(template, primitive);
        const h = md5(content);

        if (!hashes.has(primitive)) hashes.set(primitive, new Map());
        const byHash = hashes.get(primitive)!;
        if (!byHash.has(h)) byHash.set(h, []);
        byHash.get(h)!.push(template);
      }
    }

    // Build allow-list set for fast lookup: "primitive:template"
    const allowed = new Set(ALLOW_LIST.map(([p, t]) => `${p}:${t}`));

    const violations: string[] = [];

    for (const [primitive, byHash] of hashes) {
      if (byHash.size <= 1) continue; // all identical — fine

      // Determine the canonical hash: the one held by the most templates.
      let canonicalHash = "";
      let canonicalCount = 0;
      for (const [h, templates] of byHash) {
        if (templates.length > canonicalCount) {
          canonicalCount = templates.length;
          canonicalHash = h;
        }
      }

      for (const [h, templates] of byHash) {
        if (h === canonicalHash) continue;
        for (const template of templates) {
          const key = `${primitive}:${template}`;
          if (!allowed.has(key)) {
            violations.push(
              `${primitive} in "${template}" differs from canonical (held by ${canonicalCount} templates) and is not in ALLOW_LIST`,
            );
          }
        }
      }
    }

    expect(
      violations,
      [
        "Some ui primitives have drifted from the canonical version.",
        "Either update the drifted template(s) to match the canonical,",
        "or add an entry to ALLOW_LIST in ui-primitives-sync.spec.ts",
        "with a comment explaining why the deviation is intentional.",
        "",
        ...violations,
      ].join("\n"),
    ).toEqual([]);
  });

  it("every allow-list entry references an existing template+primitive pair", () => {
    const templates = getTemplates();
    const templateSet = new Set(templates);

    for (const [primitive, template, reason] of ALLOW_LIST) {
      expect(
        reason,
        `ALLOW_LIST entry ${primitive}:${template} has no reason`,
      ).toBeTruthy();
      expect(
        templateSet.has(template),
        `ALLOW_LIST entry ${primitive}:${template} — template "${template}" does not exist`,
      ).toBe(true);

      const primitiveExists = fs.existsSync(
        path.join(
          ROOT,
          "templates",
          template,
          "app",
          "components",
          "ui",
          primitive,
        ),
      );
      expect(
        primitiveExists,
        `ALLOW_LIST entry ${primitive}:${template} — file does not exist; remove stale entry`,
      ).toBe(true);
    }
  });

  it("every allow-listed template actually diverges from canonical (no stale allow-list entries)", () => {
    const templates = getTemplates();

    // Compute hashes for all primitives
    const hashes = new Map<string, Map<string, string[]>>();
    for (const template of templates) {
      for (const primitive of getPrimitives(template)) {
        const content = readUiFile(template, primitive);
        const h = md5(content);
        if (!hashes.has(primitive)) hashes.set(primitive, new Map());
        const byHash = hashes.get(primitive)!;
        if (!byHash.has(h)) byHash.set(h, []);
        byHash.get(h)!.push(template);
      }
    }

    const stale: string[] = [];
    for (const [primitive, template] of ALLOW_LIST) {
      const byHash = hashes.get(primitive);
      if (!byHash) continue; // file doesn't exist, caught by other test

      // Find canonical hash (most templates)
      let canonicalHash = "";
      let canonicalCount = 0;
      for (const [h, ts] of byHash) {
        if (ts.length > canonicalCount) {
          canonicalCount = ts.length;
          canonicalHash = h;
        }
      }

      // Find this template's hash
      let templateHash = "";
      for (const [h, ts] of byHash) {
        if (ts.includes(template)) {
          templateHash = h;
          break;
        }
      }

      if (templateHash === canonicalHash) {
        stale.push(
          `${primitive}:${template} is in ALLOW_LIST but is now identical to canonical; remove the stale entry`,
        );
      }
    }

    expect(
      stale,
      [
        "Stale ALLOW_LIST entries detected (template now matches canonical).",
        "Remove them from ui-primitives-sync.spec.ts:",
        ...stale,
      ].join("\n"),
    ).toEqual([]);
  });
});
