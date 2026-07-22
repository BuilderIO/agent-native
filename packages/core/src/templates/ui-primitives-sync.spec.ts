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
  // popover.tsx — forms keeps a wider collision boundary so form-editor
  // controls remain within the viewport on narrow screens.
  [
    "popover.tsx",
    "forms",
    "viewport-safe collision padding for form-editor controls",
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
  ["tabs.tsx", "macros", "custom macros visual system"],

  // scroll-area.tsx — content keeps the local horizontal scrollbar and
  // viewport block override needed by editor/database surfaces.
  [
    "scroll-area.tsx",
    "content",
    "content editor needs horizontal scrollbar and viewport block override",
  ],

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

// Local implementations are exceptional. Most app-level UI files should be
// stable adapters that re-export the Toolkit primitive so ToolkitProvider can
// route framework-owned surfaces through the app's design system. Keep this
// list limited to primitives with app-specific behavior or intentionally
// distinct visuals; copied shadcn implementations pending migration belong in
// the test failure output, not here.
const LOCAL_IMPLEMENTATION_ALLOW_LIST: Array<
  [template: string, primitive: string, reason: string]
> = [
  ["assets", "textarea.tsx", "adds auto-grow behavior for asset forms"],
  [
    "brain",
    "dropdown-menu.tsx",
    "uses the newer shadcn data-slot implementation",
  ],
  [
    "content",
    "scroll-area.tsx",
    "supports the editor's horizontal scrollbar and viewport override",
  ],
  [
    "forms",
    "popover.tsx",
    "uses wider collision padding for form-editor controls",
  ],
  ["macros", "button.tsx", "part of the custom Macros visual system"],
  ["macros", "card.tsx", "part of the custom Macros visual system"],
  ["macros", "dialog.tsx", "part of the custom Macros visual system"],
  ["macros", "input.tsx", "part of the custom Macros visual system"],
  ["macros", "tabs.tsx", "part of the custom Macros visual system"],
  ["macros", "textarea.tsx", "part of the custom Macros visual system"],
  ["mail", "input.tsx", "uses compact sizing for Mail's dense interface"],
  ["mail", "sonner.tsx", "uses Mail-specific toast visuals and actions"],
  ["mail", "textarea.tsx", "preserves Mail's compact local field styling"],
  [
    "plan",
    "tabs.tsx",
    "adds a transparent border to preserve Plan trigger layout",
  ],
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
const EXPECTED_ACTIVE_TEMPLATES = [
  "analytics",
  "assets",
  "brain",
  "calendar",
  "chat",
  "clips",
  "content",
  "crm",
  "design",
  "dispatch",
  "forms",
  "macros",
  "mail",
  "plan",
  "slides",
  "tasks",
] as const;

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

function getActiveSourceTemplates(): string[] {
  return fs
    .readdirSync(path.join(ROOT, "templates"))
    .filter((template) => {
      const templateRoot = path.join(ROOT, "templates", template);
      return (
        !template.startsWith(".") &&
        fs.existsSync(path.join(templateRoot, "package.json")) &&
        fs.existsSync(path.join(templateRoot, "app", "root.tsx"))
      );
    })
    .sort();
}

function walkTypeScriptFiles(directory: string): string[] {
  if (!fs.existsSync(directory)) return [];

  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return walkTypeScriptFiles(entryPath);
    return /\.tsx?$/.test(entry.name) ? [entryPath] : [];
  });
}

function isToolkitPrimitiveReExport(content: string): boolean {
  return /^export\s+\*\s+from\s+["']@agent-native\/toolkit\/ui\/[^"']+["'];?\s*$/.test(
    content.trim(),
  );
}

function getPrimitives(template: string): string[] {
  const dir = path.join(ROOT, "templates", template, "app", "components", "ui");
  return fs.readdirSync(dir).filter((f) => f.endsWith(".tsx"));
}

describe("ui-primitives sync guard", () => {
  it("tracks every active source template explicitly", () => {
    expect(getActiveSourceTemplates()).toEqual(EXPECTED_ACTIVE_TEMPLATES);
  });

  it("keeps the design-system seam wired in every active source template", () => {
    const violations: string[] = [];

    for (const template of getActiveSourceTemplates()) {
      const appRoot = path.join(ROOT, "templates", template, "app");
      const designSystemPath = path.join(appRoot, "design-system.ts");
      const providerPath = path.join(
        appRoot,
        "components",
        "ui",
        "toolkit-provider.tsx",
      );
      const rootPath = path.join(appRoot, "root.tsx");
      const packagePath = path.join(
        ROOT,
        "templates",
        template,
        "package.json",
      );

      if (!fs.existsSync(designSystemPath)) {
        violations.push(`${template}: missing app/design-system.ts`);
      }
      if (!fs.existsSync(providerPath)) {
        violations.push(
          `${template}: missing app/components/ui/toolkit-provider.tsx`,
        );
      }

      if (fs.existsSync(designSystemPath)) {
        const designSystem = fs.readFileSync(designSystemPath, "utf-8");
        if (!designSystem.includes("defineDesignSystem")) {
          violations.push(
            `${template}: app/design-system.ts does not define the design system`,
          );
        }
      }
      if (fs.existsSync(providerPath)) {
        const provider = fs.readFileSync(providerPath, "utf-8");
        if (!provider.includes("designSystem={designSystem}")) {
          violations.push(
            `${template}: toolkit-provider does not register designSystem`,
          );
        }
      }

      const packageJson = JSON.parse(fs.readFileSync(packagePath, "utf-8"));
      if (!packageJson.dependencies?.["@agent-native/toolkit"]) {
        violations.push(
          `${template}: missing @agent-native/toolkit dependency`,
        );
      }

      const root = fs.readFileSync(rootPath, "utf-8");
      if (!/from\s+["'][^"']*components\/ui\/toolkit-provider["']/.test(root)) {
        violations.push(
          `${template}: root.tsx does not import toolkit-provider`,
        );
      }
      if (!/<AppToolkitProvider(?:\s|>)/.test(root)) {
        violations.push(
          `${template}: root.tsx does not render AppToolkitProvider`,
        );
      }
    }

    expect(
      violations,
      [
        "Active source templates must expose the app design-system seam.",
        ...violations,
      ].join("\n"),
    ).toEqual([]);
  });

  it("routes app UI imports through local adapters", () => {
    const violations: string[] = [];

    for (const template of getActiveSourceTemplates()) {
      const appRoot = path.join(ROOT, "templates", template, "app");
      const uiRoot = path.join(appRoot, "components", "ui");

      for (const file of walkTypeScriptFiles(appRoot)) {
        if (file.startsWith(`${uiRoot}${path.sep}`)) continue;
        const content = fs.readFileSync(file, "utf-8");
        if (!content.includes("@agent-native/toolkit/ui/")) continue;
        violations.push(path.relative(ROOT, file));
      }
    }

    expect(
      violations,
      [
        "App code must import UI through app/components/ui adapters.",
        "Direct @agent-native/toolkit/ui imports found in:",
        ...violations,
      ].join("\n"),
    ).toEqual([]);
  });

  it("keeps local primitive implementations explicit and documented", () => {
    const allowed = new Map(
      LOCAL_IMPLEMENTATION_ALLOW_LIST.map(([template, primitive, reason]) => [
        `${template}:${primitive}`,
        reason,
      ]),
    );
    const violations: string[] = [];

    for (const template of getActiveSourceTemplates()) {
      const uiRoot = path.join(
        ROOT,
        "templates",
        template,
        "app",
        "components",
        "ui",
      );
      if (!fs.existsSync(uiRoot)) continue;

      for (const primitive of fs
        .readdirSync(uiRoot)
        .filter(
          (file) => file.endsWith(".tsx") && file !== "toolkit-provider.tsx",
        )) {
        const content = fs.readFileSync(path.join(uiRoot, primitive), "utf-8");
        if (isToolkitPrimitiveReExport(content)) continue;
        if (allowed.has(`${template}:${primitive}`)) continue;
        violations.push(
          `${template}/${primitive}: use a Toolkit re-export or document the app-specific behavior`,
        );
      }
    }

    expect(
      violations,
      [
        "Undocumented local UI implementations bypass the shared adapter path.",
        ...violations,
      ].join("\n"),
    ).toEqual([]);
  });

  it("keeps local-implementation allow-list entries valid", () => {
    for (const [
      template,
      primitive,
      reason,
    ] of LOCAL_IMPLEMENTATION_ALLOW_LIST) {
      const file = path.join(
        ROOT,
        "templates",
        template,
        "app",
        "components",
        "ui",
        primitive,
      );
      expect(
        reason,
        `LOCAL_IMPLEMENTATION_ALLOW_LIST entry ${template}:${primitive} has no reason`,
      ).toBeTruthy();
      expect(
        fs.existsSync(file),
        `LOCAL_IMPLEMENTATION_ALLOW_LIST entry ${template}:${primitive} does not exist`,
      ).toBe(true);
      if (fs.existsSync(file)) {
        expect(
          isToolkitPrimitiveReExport(fs.readFileSync(file, "utf-8")),
          `LOCAL_IMPLEMENTATION_ALLOW_LIST entry ${template}:${primitive} is now a Toolkit re-export; remove it`,
        ).toBe(false);
      }
    }
  });

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
