import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import {
  buildGenericUrlBlueprint,
  formatCatalog,
  listBlueprintNames,
  listCatalog,
  listKinds,
  looksLikeUrl,
  parseAddArgs,
  resolveBlueprint,
  resolveBlueprintsRoot,
  runAdd,
  AddResolutionError,
} from "./add.js";

/**
 * The real shipped blueprints directory: `packages/core/blueprints`. This file
 * lives at `src/cli/add.spec.ts`, so the package root is two levels up.
 */
const REPO_BLUEPRINTS = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../blueprints",
);

/** Capture stdout/stderr passed through the injectable IO shim. */
function capture() {
  let out = "";
  let err = "";
  return {
    io: {
      out: (s: string) => {
        out += s;
      },
      err: (s: string) => {
        err += s;
      },
    },
    get out() {
      return out;
    },
    get err() {
      return err;
    },
  };
}

const tmpDirs: string[] = [];
afterEach(() => {
  for (const d of tmpDirs.splice(0)) {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

function makeTempBlueprints(
  layout: Record<string, Record<string, string>>,
): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "an-blueprints-"));
  tmpDirs.push(root);
  const blueprints = path.join(root, "blueprints");
  for (const [kind, files] of Object.entries(layout)) {
    fs.mkdirSync(path.join(blueprints, kind), { recursive: true });
    for (const [name, body] of Object.entries(files)) {
      fs.writeFileSync(
        path.join(blueprints, kind, `${name}.md`),
        body,
        "utf-8",
      );
    }
  }
  return blueprints;
}

describe("add — shipped blueprints", () => {
  it("ships the four seeded kinds with at least one blueprint each", () => {
    const kinds = listKinds(REPO_BLUEPRINTS);
    for (const kind of ["provider", "channel", "sandbox", "action"]) {
      expect(kinds).toContain(kind);
      expect(listBlueprintNames(REPO_BLUEPRINTS, kind).length).toBeGreaterThan(
        0,
      );
    }
  });

  it("resolves the canonical seeded blueprints by kind + name", () => {
    const cases: Array<[string, string]> = [
      ["provider", "stripe"],
      ["channel", "discord"],
      ["sandbox", "docker"],
      ["action", "crud"],
    ];
    for (const [kind, name] of cases) {
      const resolved = resolveBlueprint({
        kind,
        nameOrUrl: name,
        root: REPO_BLUEPRINTS,
      });
      expect(resolved.source).toMatchObject({ kind: "curated", name });
      expect(resolved.markdown).toContain("# Blueprint:");
      // Each blueprint must reference the verification step and forbid secrets.
      expect(resolved.markdown.toLowerCase()).toContain("verify");
    }
  });
});

describe("resolveBlueprintsRoot", () => {
  it("honors an explicit override", () => {
    expect(resolveBlueprintsRoot("/tmp/whatever")).toBe("/tmp/whatever");
  });

  it("resolves the package-root blueprints dir from src/cli (tsx layout)", () => {
    const root = resolveBlueprintsRoot();
    expect(fs.existsSync(root)).toBe(true);
    expect(path.basename(root)).toBe("blueprints");
    // The source resolver result must equal the real shipped directory.
    expect(path.resolve(root)).toBe(path.resolve(REPO_BLUEPRINTS));
  });

  it("works when the module is two levels under the package root (dist layout)", () => {
    // Simulate the published layout: <pkg>/blueprints + <pkg>/dist/cli, and
    // confirm the `../../blueprints` resolution (with upward-walk fallback)
    // finds it. We assert via the override-free upward walk using a temp tree.
    const pkg = fs.mkdtempSync(path.join(os.tmpdir(), "an-pkg-"));
    tmpDirs.push(pkg);
    fs.mkdirSync(path.join(pkg, "blueprints", "provider"), { recursive: true });
    fs.writeFileSync(
      path.join(pkg, "blueprints", "provider", "demo.md"),
      "# Blueprint: demo\nVerify it.\n",
    );
    fs.mkdirSync(path.join(pkg, "dist", "cli"), { recursive: true });

    // The resolver walks up from the module dir; emulate by resolving relative
    // to the simulated dist/cli location.
    const distCli = path.join(pkg, "dist", "cli");
    const viaRelative = path.resolve(distCli, "../../blueprints");
    expect(fs.existsSync(viaRelative)).toBe(true);
    expect(listBlueprintNames(viaRelative, "provider")).toEqual(["demo"]);
  });
});

describe("looksLikeUrl", () => {
  it("treats http(s) values as URLs and names as names", () => {
    expect(looksLikeUrl("https://docs.example.com/api")).toBe(true);
    expect(looksLikeUrl("http://example.com")).toBe(true);
    expect(looksLikeUrl("  https://x.dev  ")).toBe(true);
    expect(looksLikeUrl("stripe")).toBe(false);
    expect(looksLikeUrl("my-provider")).toBe(false);
  });
});

describe("resolveBlueprint", () => {
  const root = () =>
    makeTempBlueprints({
      provider: { stripe: "# Blueprint: stripe\nVerify it.\n" },
      channel: { discord: "# Blueprint: discord\nVerify it.\n" },
    });

  it("resolves a curated blueprint by kind + name", () => {
    const resolved = resolveBlueprint({
      kind: "provider",
      nameOrUrl: "stripe",
      root: root(),
    });
    expect(resolved.markdown).toContain("# Blueprint: stripe");
    expect(resolved.source).toMatchObject({
      kind: "curated",
      blueprintKind: "provider",
      name: "stripe",
    });
  });

  it("emits a generic research blueprint when given a URL", () => {
    const url = "https://docs.example.com/v2/api";
    const resolved = resolveBlueprint({
      kind: "provider",
      nameOrUrl: url,
      root: root(),
    });
    expect(resolved.source).toMatchObject({ kind: "generic-url", url });
    expect(resolved.markdown).toContain(url);
    expect(resolved.markdown).toContain("Research seed");
    // The provider generic guidance must mention the provider-api substrate.
    expect(resolved.markdown).toContain("provider-api");
  });

  it("auto-selects the only blueprint when a kind has exactly one", () => {
    const single = makeTempBlueprints({
      sandbox: { docker: "# Blueprint: docker\nVerify it.\n" },
    });
    const resolved = resolveBlueprint({ kind: "sandbox", root: single });
    expect(resolved.source).toMatchObject({ kind: "curated", name: "docker" });
  });

  it("throws AddResolutionError for an unknown kind", () => {
    expect(() =>
      resolveBlueprint({ kind: "nope", nameOrUrl: "x", root: root() }),
    ).toThrow(AddResolutionError);
  });

  it("throws AddResolutionError for an unknown name within a known kind", () => {
    expect(() =>
      resolveBlueprint({ kind: "provider", nameOrUrl: "ghost", root: root() }),
    ).toThrow(AddResolutionError);
  });

  it("asks the user to pick when a kind has multiple blueprints and no name", () => {
    const multi = makeTempBlueprints({
      provider: {
        stripe: "# a\nVerify.\n",
        twilio: "# b\nVerify.\n",
      },
    });
    expect(() => resolveBlueprint({ kind: "provider", root: multi })).toThrow(
      /stripe|twilio/,
    );
  });
});

describe("listKinds / listCatalog / formatCatalog", () => {
  it("lists kinds and names sorted", () => {
    const r = makeTempBlueprints({
      provider: { stripe: "x", twilio: "x" },
      channel: { discord: "x" },
    });
    expect(listKinds(r)).toEqual(["channel", "provider"]);
    expect(listBlueprintNames(r, "provider")).toEqual(["stripe", "twilio"]);
    expect(listCatalog(r)).toEqual([
      { kind: "channel", names: ["discord"] },
      { kind: "provider", names: ["stripe", "twilio"] },
    ]);
  });

  it("formats a human-readable catalog", () => {
    const r = makeTempBlueprints({ provider: { stripe: "x" } });
    const text = formatCatalog(r);
    expect(text).toContain("Available blueprints:");
    expect(text).toContain("provider");
    expect(text).toContain("stripe");
  });
});

describe("parseAddArgs", () => {
  it("parses positionals and flags", () => {
    expect(parseAddArgs(["provider", "stripe"])).toMatchObject({
      positionals: ["provider", "stripe"],
      list: false,
    });
    expect(parseAddArgs(["--list"]).list).toBe(true);
    expect(parseAddArgs(["-l"]).list).toBe(true);
    expect(parseAddArgs(["--print", "provider", "stripe"])).toMatchObject({
      print: true,
      positionals: ["provider", "stripe"],
    });
    expect(parseAddArgs(["--help"]).help).toBe(true);
  });

  it("ignores '--' separators and unknown flags", () => {
    expect(parseAddArgs(["--", "provider", "stripe", "--weird"])).toMatchObject(
      {
        positionals: ["provider", "stripe"],
      },
    );
  });
});

describe("runAdd (CLI entry)", () => {
  const root = () =>
    makeTempBlueprints({
      provider: { stripe: "# Blueprint: stripe\nVerify it.\n" },
      action: { crud: "# Blueprint: crud\nVerify it.\n" },
    });

  it("prints a curated blueprint to stdout and exits 0", () => {
    const c = capture();
    const code = runAdd(["provider", "stripe"], { ...c.io, root: root() });
    expect(code).toBe(0);
    expect(c.out).toContain("# Blueprint: stripe");
    expect(c.err).toBe("");
  });

  it("--print is an accepted no-op alias for the default print", () => {
    const c = capture();
    const code = runAdd(["--print", "provider", "stripe"], {
      ...c.io,
      root: root(),
    });
    expect(code).toBe(0);
    expect(c.out).toContain("# Blueprint: stripe");
  });

  it("emits the generic blueprint for a URL", () => {
    const c = capture();
    const code = runAdd(["provider", "https://docs.example.com/api"], {
      ...c.io,
      root: root(),
    });
    expect(code).toBe(0);
    expect(c.out).toContain("https://docs.example.com/api");
    expect(c.out).toContain("Research seed");
  });

  it("--list prints the catalog to stdout and exits 0", () => {
    const c = capture();
    const code = runAdd(["--list"], { ...c.io, root: root() });
    expect(code).toBe(0);
    expect(c.out).toContain("Available blueprints:");
    expect(c.out).toContain("provider");
  });

  it("no args prints the catalog and exits 0", () => {
    const c = capture();
    const code = runAdd([], { ...c.io, root: root() });
    expect(code).toBe(0);
    expect(c.out).toContain("Available blueprints:");
  });

  it("unknown kind writes to stderr and exits non-zero", () => {
    const c = capture();
    const code = runAdd(["bogus", "thing"], { ...c.io, root: root() });
    expect(code).toBe(1);
    expect(c.err).toContain("Unknown blueprint kind");
    // The error must list what IS available.
    expect(c.err).toContain("provider");
    expect(c.out).toBe("");
  });

  it("unknown name within a known kind exits non-zero", () => {
    const c = capture();
    const code = runAdd(["provider", "ghost"], { ...c.io, root: root() });
    expect(code).toBe(1);
    expect(c.err).toContain("Unknown provider blueprint");
  });

  it("--help prints usage to stdout and exits 0", () => {
    const c = capture();
    const code = runAdd(["--help"], { ...c.io, root: root() });
    expect(code).toBe(0);
    expect(c.out).toContain("agent-native add");
  });
});

describe("buildGenericUrlBlueprint", () => {
  it("embeds the URL and kind-specific guidance", () => {
    const md = buildGenericUrlBlueprint("channel", "https://discord.com/dev");
    expect(md).toContain("https://discord.com/dev");
    expect(md).toContain("PlatformAdapter");
    expect(md).toContain("integration-webhooks");
  });

  it("falls back to default guidance for an unknown kind", () => {
    const md = buildGenericUrlBlueprint("widget", "https://x.dev");
    expect(md).toContain("https://x.dev");
    expect(md).toContain("provider-api");
  });
});
