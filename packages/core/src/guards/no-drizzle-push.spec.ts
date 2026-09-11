import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { scanDrizzlePush } from "./no-drizzle-push.js";

const tmpRoots: string[] = [];

afterEach(() => {
  for (const root of tmpRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function makeTempAppRoot(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "an-doctor-"));
  tmpRoots.push(root);
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  return root;
}

describe("scanDrizzlePush", () => {
  it("flags drizzle-kit push wired into a build script", () => {
    const root = makeTempAppRoot({
      "package.json": JSON.stringify({
        name: "app",
        scripts: { build: "pnpm exec drizzle-kit push --force && vite build" },
      }),
    });
    const result = scanDrizzlePush({ root });
    expect(result.name).toBe("no-drizzle-push");
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].file).toBe("package.json");
    expect(result.findings[0].message).toMatch(/drizzle-kit push/);
  });

  it("does not flag a standalone db:push script (explicit human-invoked command)", () => {
    const root = makeTempAppRoot({
      "package.json": JSON.stringify({
        name: "app",
        scripts: {
          "db:push": "drizzle-kit push",
          build: "vite build",
        },
      }),
    });
    const result = scanDrizzlePush({ root });
    expect(result.findings).toHaveLength(0);
  });

  it("passes clean when no drizzle-kit push appears anywhere", () => {
    const root = makeTempAppRoot({
      "package.json": JSON.stringify({
        name: "app",
        scripts: { build: "vite build", typecheck: "tsc --noEmit" },
      }),
      "netlify.toml": '[build]\n  command = "pnpm build"\n',
    });
    const result = scanDrizzlePush({ root });
    expect(result.findings).toHaveLength(0);
  });
});
