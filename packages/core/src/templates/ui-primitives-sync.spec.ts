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
  // scroll-area.tsx — content always renders a horizontal ScrollBar so deeply
  // nested page rows in the document sidebar stay reachable; guarded by
  // templates/content/app/components/sidebar/DocumentSidebar.layout.test.ts.
  [
    "scroll-area.tsx",
    "content",
    "always renders horizontal ScrollBar for nested sidebar rows",
  ],

  // button.tsx — macros has a fully custom design theme (bg-foreground primary,
  // rounded-2xl, active:scale press feedback, custom ghost/link palette).
  // The canonical 13-template version uses standard bg-primary, rounded-md.
  [
    "button.tsx",
    "macros",
    "custom-themed: bg-foreground, rounded-lg, active:scale",
  ],

  // calendar.tsx — DayPicker v9 class-name API split across templates.
  // The majority (7 templates) use the older v9 API (caption, nav_button, …).
  // Two templates are ahead of this:
  //   • analytics: new v9 renamed API (month_caption, button_previous, day_button)
  //   • forms/mail: newest shadcn with getDefaultClassNames + DayButton + captionLayout
  // Unifying these requires a coordinated DayPicker API migration; defer until
  // the 7-template group catches up.
  [
    "calendar.tsx",
    "analytics",
    "ahead of majority: new v9 renamed classname API (month_caption, button_previous)",
  ],
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

  // card.tsx — macros uses rounded-2xl, border-border/40, and a custom
  // transition. The canonical 12-template version uses rounded-lg, border.
  [
    "card.tsx",
    "macros",
    "custom-themed: rounded-2xl, border-border/40, custom transition",
  ],

  // chart.tsx — analytics adds the useChartTooltipFlip hook (which only exists
  // in the analytics template's hooks/ dir) and uses `[_, config]` destructuring.
  // forms/mail have a shared variant without that hook and with `[, config]`.
  // The canonical 8-template version (calendar/chat/clips/design/macros/plan/
  // slides/videos) has neither analytics-specific hook nor forms/mail style.
  [
    "chart.tsx",
    "analytics",
    "analytics-specific: useChartTooltipFlip hook (only exists in analytics hooks/)",
  ],
  [
    "chart.tsx",
    "forms",
    "no useChartTooltipFlip hook (analytics-specific); minor style differences",
  ],
  [
    "chart.tsx",
    "mail",
    "no useChartTooltipFlip hook (analytics-specific); minor style differences",
  ],

  // command.tsx — forms/mail were scaffolded with "use client" (Next.js artifact)
  // and use `const CommandDialog = ({ children, ...props }: DialogProps)` instead
  // of the interface-wrapped variant. Behaviorally equivalent; clean up on next
  // major template refresh.
  [
    "command.tsx",
    "forms",
    '"use client" artifact + inline type (no interface wrapper)',
  ],
  [
    "command.tsx",
    "mail",
    '"use client" artifact + inline type (no interface wrapper)',
  ],

  // context-menu.tsx — forms/mail add origin-[--radix-context-menu-content-
  // transform-origin] and max-h CSS variables from a newer shadcn snapshot.
  // Not harmful but haven't been audited for all usage sites yet.
  [
    "context-menu.tsx",
    "forms",
    "newer shadcn: origin CSS var + max-h constraint on sub-content",
  ],
  [
    "context-menu.tsx",
    "mail",
    "newer shadcn: origin CSS var + max-h constraint on sub-content",
  ],

  // dialog.tsx — macros has a mobile-optimized layout: top-4 positioned (not
  // centered), max-h with overflow-y-auto for tall forms, backdrop-blur-sm overlay.
  [
    "dialog.tsx",
    "macros",
    "mobile-optimized: top-positioned, scrollable, backdrop-blur overlay",
  ],

  // dropdown-menu.tsx — brain was rewritten with the new shadcn v2 function-
  // component API (data-slot attributes, variant prop on MenuItem, gap-2 layout,
  // overflow-x-hidden content). The canonical 13-template version uses the older
  // React.forwardRef style.
  [
    "dropdown-menu.tsx",
    "brain",
    "shadcn v2 function-component API with data-slot + variant prop",
  ],

  // input.tsx — three intentional variants beyond the canonical 11-template version:
  //   • macros: adds transition-all hover:border-ring/50 (custom visual polish)
  //   • mail: uses h-9 instead of h-10 (intentional compact sizing for dense UI)
  //   • videos: adds text-foreground class (explicit foreground color)
  [
    "input.tsx",
    "macros",
    "custom: transition-all hover:border-ring/50 animation",
  ],
  ["input.tsx", "mail", "intentional compact sizing: h-9 vs canonical h-10"],
  ["input.tsx", "videos", "adds explicit text-foreground class"],

  // menubar.tsx — macros uses a different trigger style. forms/mail use a newer
  // shadcn snapshot with improved data-[state=open] focus/hover handling and
  // function-component wrappers for MenubarMenu.
  ["menubar.tsx", "macros", "custom-themed trigger style"],
  [
    "menubar.tsx",
    "forms",
    "newer shadcn: improved data-[state=open] states + function-component wrappers",
  ],
  [
    "menubar.tsx",
    "mail",
    "newer shadcn: improved data-[state=open] states + function-component wrappers",
  ],

  // progress.tsx — macros uses h-1.5 (slim) instead of h-4 and bg-foreground/80
  // instead of bg-primary. Custom design language for the macros app.
  ["progress.tsx", "macros", "custom-themed: h-1.5 slim bar, bg-foreground/80"],

  // sonner.tsx — two intentional variants:
  //   • mail: heavily custom-styled toasts (bg-card, rounded-lg, text-13px,
  //     custom action/cancel button styles)
  //   • calendar: uses w-fit instead of w-[var(--width)] for a compact toast
  [
    "sonner.tsx",
    "mail",
    "heavily custom-styled toasts (bg-card, 13px, custom action styles)",
  ],
  ["sonner.tsx", "calendar", "compact variant: w-fit instead of fixed-width"],

  // tabs.tsx — two intentional variants:
  //   • plan: adds border border-transparent to TabsTrigger for layout stability
  //   • macros: adds duration-200 transition and hover:text-foreground
  [
    "tabs.tsx",
    "plan",
    "border border-transparent on trigger for layout stability",
  ],
  [
    "tabs.tsx",
    "macros",
    "adds duration-200 transition + hover:text-foreground",
  ],

  // textarea.tsx — three intentional variants beyond the canonical 10-template version:
  //   • assets: adds autoGrow prop for auto-expanding textareas (used at call sites)
  //   • macros: adds transition-all hover:border-ring/50 (custom visual polish)
  //   • mail: minor whitespace/style difference; same functional behaviour
  [
    "textarea.tsx",
    "assets",
    "autoGrow prop: auto-expanding textarea, used at call sites",
  ],
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
