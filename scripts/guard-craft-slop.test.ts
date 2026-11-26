import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { scanCraftSlopPaths, scanCraftSlopSource } from "./guard-craft-slop.ts";

describe("guard-craft-slop", () => {
  it("detects unprompted purple/indigo/cyan gradients in TSX and CSS", () => {
    const tsxFindings = scanCraftSlopSource(
      "app/Hero.tsx",
      `export function Hero() {
        return <div className="bg-gradient-to-r from-indigo-500 via-purple-500 to-cyan-400">Hi</div>;
      }`,
    );
    assert.equal(tsxFindings.length, 1);
    assert.equal(tsxFindings[0]?.rule, "slop/unprompted-ai-gradient");

    const cssFindings = scanCraftSlopSource(
      "app/hero.css",
      `.hero { background: linear-gradient(135deg, #6366f1, #06b6d4); }`,
    );
    assert.equal(cssFindings.length, 1);
    assert.equal(cssFindings[0]?.rule, "slop/unprompted-ai-gradient");

    const cleanFindings = scanCraftSlopSource(
      "app/Clean.tsx",
      `export function Clean() {
        return <div className="bg-card text-foreground border border-border">Hi</div>;
      }`,
    );
    assert.equal(cleanFindings.length, 0);
  });

  it("detects bare Loading... JSX text and return strings while ignoring skeletons", () => {
    const findings = scanCraftSlopSource(
      "app/List.tsx",
      `export function List({ loading }: { loading: boolean }) {
        if (loading) return "Loading...";
        return <div>Loading…</div>;
      }`,
    );
    assert.equal(findings.length, 2);
    assert.equal(findings[0]?.rule, "slop/bare-loading-text");
    assert.equal(findings[1]?.rule, "slop/bare-loading-text");

    const clean = scanCraftSlopSource(
      "app/List.tsx",
      `export function List({ loading }: { loading: boolean }) {
        if (loading) return <div aria-label="Loading"><Skeleton className="h-8 w-full" /></div>;
        return <div>Ready</div>;
      }`,
    );
    assert.equal(clean.length, 0);
  });

  it("detects native window.confirm, alert, and prompt calls without flagging custom methods", () => {
    const findings = scanCraftSlopSource(
      "app/DeleteRow.tsx",
      `export function removeItem() {
        if (window.confirm("Delete?")) {
          alert("Deleted");
          prompt("Reason?");
        }
      }`,
    );
    assert.equal(findings.length, 3);
    assert.ok(
      findings.every((item) => item.rule === "slop/native-browser-dialog"),
    );

    const clean = scanCraftSlopSource(
      "app/DeleteRow.tsx",
      `export function removeItem(dialog: { confirm: () => void }) {
        dialog.confirm();
      }`,
    );
    assert.equal(clean.length, 0);
  });

  it("detects Mac-only metaKey shortcuts without a companion ctrlKey check", () => {
    const macOnly = scanCraftSlopSource(
      "app/Shortcuts.tsx",
      `export function onKeyDown(e: KeyboardEvent) {
        if (e.metaKey && e.key === "k") {
          e.preventDefault();
        }
      }`,
    );
    assert.equal(macOnly.length, 1);
    assert.equal(macOnly[0]?.rule, "slop/mac-only-shortcut");

    const portable = scanCraftSlopSource(
      "app/Shortcuts.tsx",
      `export function onKeyDown(e: KeyboardEvent) {
        if ((e.metaKey || e.ctrlKey) && e.key === "k") {
          e.preventDefault();
        }
      }`,
    );
    assert.equal(portable.length, 0);

    const separateIfs = scanCraftSlopSource(
      "app/Shortcuts.tsx",
      `export function matches(e: KeyboardEvent, needMeta: boolean, needCtrl: boolean) {
        if (e.metaKey !== needMeta) return false;
        if (e.ctrlKey !== needCtrl) return false;
        return true;
      }`,
    );
    assert.equal(separateIfs.length, 0);
  });

  it("detects dead-end empty-state JSX branches without an interactive CTA", () => {
    const deadEnd = scanCraftSlopSource(
      "app/Inbox.tsx",
      `export function Inbox({ items }: { items: string[] }) {
        if (items.length === 0) {
          return <div className="p-6"><p>No messages found</p></div>;
        }
        return <ul>{items.map((item) => <li key={item}>{item}</li>)}</ul>;
      }`,
    );
    assert.equal(deadEnd.length, 1);
    assert.equal(deadEnd[0]?.rule, "slop/dead-end-empty-state");

    const actionable = scanCraftSlopSource(
      "app/Inbox.tsx",
      `export function Inbox({ items, onCreate }: { items: string[]; onCreate: () => void }) {
        return items.length === 0 ? (
          <div className="p-6">
            <p>No messages yet</p>
            <Button onClick={onCreate}>Compose message</Button>
          </div>
        ) : (
          <ul>{items.map((item) => <li key={item}>{item}</li>)}</ul>
        );
      }`,
    );
    assert.equal(actionable.length, 0);
  });

  it("detects god-component files with more than 25 useState calls", () => {
    const states = Array.from(
      { length: 26 },
      (_, index) => `const [s${index}, setS${index}] = useState(0);`,
    ).join("\n");
    const findings = scanCraftSlopSource(
      "app/GodPage.tsx",
      `import { useState } from "react";
      export function GodPage() {
        ${states}
        return <div>{s0}</div>;
      }`,
    );
    assert.equal(findings.length, 1);
    assert.equal(findings[0]?.rule, "slop/god-component-state");
    assert.match(findings[0]?.snippet ?? "", /26 useState calls/);

    const okStates = Array.from(
      { length: 25 },
      (_, index) => `const [s${index}, setS${index}] = useState(0);`,
    ).join("\n");
    const okFindings = scanCraftSlopSource(
      "app/NormalPage.tsx",
      `import { useState } from "react";
      export function NormalPage() {
        ${okStates}
        return <div>{s0}</div>;
      }`,
    );
    assert.equal(okFindings.length, 0);
  });

  it("scans directories recursively while skipping tests and supports CLI --advisory and --json", () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), "craft-slop-test-"));
    try {
      mkdirSync(path.join(tempDir, "components"), { recursive: true });
      writeFileSync(
        path.join(tempDir, "components", "Sloppy.tsx"),
        `export function Sloppy() { return <div>Loading...</div>; }\n`,
      );
      writeFileSync(
        path.join(tempDir, "components", "Sloppy.test.tsx"),
        `export function SloppyTest() { window.confirm("ignored in tests"); return <div>Loading...</div>; }\n`,
      );

      const scan = scanCraftSlopPaths([tempDir], tempDir);
      assert.equal(scan.filesScanned, 1);
      assert.equal(scan.findings.length, 1);
      assert.equal(scan.findings[0]?.rule, "slop/bare-loading-text");

      const scriptPath = path.resolve(
        import.meta.dirname,
        "guard-craft-slop.ts",
      );
      const strictRun = spawnSync(
        process.execPath,
        ["--experimental-strip-types", scriptPath, "--json", tempDir],
        { encoding: "utf8" },
      );
      assert.equal(strictRun.status, 1);
      const parsed = JSON.parse(strictRun.stdout) as {
        filesScanned: number;
        findings: { rule: string }[];
      };
      assert.equal(parsed.filesScanned, 1);
      assert.equal(parsed.findings[0]?.rule, "slop/bare-loading-text");

      const advisoryRun = spawnSync(
        process.execPath,
        ["--experimental-strip-types", scriptPath, "--advisory", tempDir],
        { encoding: "utf8" },
      );
      assert.equal(advisoryRun.status, 0);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
