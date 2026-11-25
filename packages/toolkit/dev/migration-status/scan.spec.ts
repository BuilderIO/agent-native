import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { scanMigration } from "./scan.js";

const repos: string[] = [];

function fixture(files: Record<string, string>) {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "migration-status-"));
  repos.push(repo);
  for (const [file, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(repo, file)), { recursive: true });
    fs.writeFileSync(path.join(repo, file), text);
  }
  return repo;
}

afterEach(() => {
  for (const repo of repos.splice(0)) {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

const TOOLKIT = {
  "packages/toolkit/src/index.ts": 'export * from "./ui/index.js";\n',
  "packages/toolkit/src/ui/index.ts":
    'export * from "./tabs.js";\nexport * from "./button.js";\n',
  "packages/toolkit/src/ui/base-ui/tabs.tsx": "export function Tabs() {}\n",
  "packages/toolkit/src/ui/base-ui/select.tsx": "export function Select() {}\n",
  "packages/toolkit/src/ui/tabs.tsx": 'export * from "./base-ui/tabs.js";\n',
  "packages/toolkit/src/ui/button.tsx":
    'import { cva } from "class-variance-authority";\nexport function Button() {}\n',
};

const APP = "templates/demo/app";

function scan(repo: string) {
  return scanMigration(repo, { cacheFile: null }).cells.demo ?? {};
}

describe("scanMigration", () => {
  it("tells a system part from an old source, through local wrappers", () => {
    const repo = fixture({
      ...TOOLKIT,
      [`${APP}/components/ui/button.tsx`]:
        'export * from "@agent-native/toolkit/ui/button";\n',
      [`${APP}/page.tsx`]: [
        'import { Button } from "@/components/ui/button";',
        'import { Tabs } from "@agent-native/toolkit/ui/tabs";',
        'import { toast } from "sonner";',
        'import * as Dialog from "@radix-ui/react-dialog";',
        "export const Page = () => <Tabs />;",
      ].join("\n"),
    });
    const cells = scan(repo);
    expect(cells.tabs?.native.map((site) => site.file)).toEqual([
      `${APP}/page.tsx`,
    ]);
    expect(cells.button?.legacy).toHaveLength(1);
    expect(cells.button?.native).toHaveLength(0);
    expect(cells.toast?.legacy[0]?.detail).toBe("sonner");
    expect(cells.dialog?.legacy[0]?.detail).toBe("@radix-ui/react-dialog");
  });

  it("counts a wrapper with its own code over a part as not yet migrated", () => {
    const repo = fixture({
      ...TOOLKIT,
      [`${APP}/components/ui/select.tsx`]: [
        'import { Select as Part } from "@agent-native/toolkit/ui/base-ui/select";',
        "export function Select() { return <Part />; }",
      ].join("\n"),
      [`${APP}/page.tsx`]:
        'import { Select } from "@/components/ui/select";\nexport const Page = Select;\n',
    });
    const select = scan(repo).select;
    expect(select?.native).toHaveLength(0);
    expect(select?.legacy[0]?.detail).toContain("wraps");
  });

  it("attributes a barrel import to the part each name comes from", () => {
    const repo = fixture({
      ...TOOLKIT,
      [`${APP}/page.tsx`]:
        'import { Tabs, Button } from "@agent-native/toolkit";\nexport { Tabs, Button };\n',
    });
    const cells = scan(repo);
    expect(cells.tabs?.native).toHaveLength(1);
    expect(cells.button?.legacy).toHaveLength(1);
  });

  it("reports a name it can't find instead of dropping it", () => {
    const repo = fixture({
      ...TOOLKIT,
      [`${APP}/page.tsx`]:
        'import { Missing } from "@agent-native/toolkit/ui";\nexport { Missing };\n',
    });
    expect(scanMigration(repo, { cacheFile: null }).unresolved).toEqual([
      {
        app: "demo",
        file: `${APP}/page.tsx`,
        specifier: "@agent-native/toolkit/ui { Missing }",
      },
    ]);
  });

  it("finds hand-built controls from raw elements and roles", () => {
    const repo = fixture({
      ...TOOLKIT,
      [`${APP}/page.tsx`]: [
        "export const Page = () => (",
        "  <>",
        "    <button aria-pressed={true} />",
        '    <input type="number" />',
        '    <input type="file" />',
        '    <div role="slider" />',
        '    <div role="slider" />',
        "    <button />",
        "  </>",
        ");",
      ].join("\n"),
    });
    const cells = scan(repo);
    expect(cells.toggle?.custom[0]?.detail).toBe("<button aria-pressed>");
    expect(cells["number-field"]?.custom).toHaveLength(1);
    expect(cells.slider?.custom[0]?.detail).toBe('<div role="slider"> ×2');
    expect(cells.button?.custom[0]?.detail).toBe("<button>");
    expect(cells.input).toBeUndefined();
  });

  it("rescans an edited file, from memory and from the cache on disk", () => {
    const page = `${APP}/page.tsx`;
    const repo = fixture({
      ...TOOLKIT,
      [page]: 'import { toast } from "sonner";\nexport const notify = toast;\n',
    });
    const cacheFile = path.join(repo, ".tmp", "cache.json");
    expect(
      scanMigration(repo, { cacheFile }).cells.demo?.toast?.legacy,
    ).toHaveLength(1);
    expect(fs.existsSync(cacheFile)).toBe(true);
    fs.writeFileSync(path.join(repo, page), "export const notify = null;\n");
    expect(
      scanMigration(repo, { cacheFile }).cells.demo?.toast,
    ).toBeUndefined();
  });
});
