import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const EXT = process.platform === "win32" ? ".exe" : "";
const FAST_GUARDS_BIN = path.join(
  REPO_ROOT,
  "tools/fast-guards/target/release",
  `fast-guards${EXT}`,
);

type Report = {
  name: string;
  passed: boolean;
  elapsed_ms: number;
  summary: string;
  violations: string[];
};

function runFastGuards(
  root: string,
  guards: string[],
): {
  status: number;
  reports: Report[];
} {
  try {
    const out = execFileSync(
      FAST_GUARDS_BIN,
      ["--root", root, "--guards", guards.join(","), "--json"],
      { encoding: "utf8" },
    );
    return { status: 0, reports: JSON.parse(out) as Report[] };
  } catch (error) {
    const err = error as { status?: number; stdout?: string };
    return {
      status: err.status ?? 1,
      reports: JSON.parse(String(err.stdout ?? "[]")) as Report[],
    };
  }
}

function makeTempGitRepo(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fast-guards-test-"));
  execFileSync("git", ["init", "-q"], { cwd: dir });
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  execFileSync("git", ["add", "-A"], { cwd: dir });
  return dir;
}

test("fast-guards detects real violations and respects opt-out pragmas", () => {
  assert.equal(
    fs.existsSync(FAST_GUARDS_BIN),
    true,
    `Expected compiled binary at ${FAST_GUARDS_BIN}`,
  );

  const secretLike = `sk-ant-${"AbCdEfGhIj1234567890XyZ"}`;
  const registerFn = `${"registerShareable"}${"Resource"}`;
  const dir = makeTempGitRepo({
    "README.md": `Use ${"Agent"} ${"Native"} here.\n`,
    "docs/ok.md": `// agent-native-brand-ok: test\n${"Agent"} ${"Native"} allowed.\n`,
    "src/leak.ts": `export const token = "${secretLike}";\n`,
    "src/ok-secret.ts": `// guard:allow-secret-literal — test fixture\nexport const token = "${secretLike}";\n`,
    "packages/app/src/bad.ts": `import { foo } from "@agent-native/core/client";\nexport const x = foo;\n`,
    "packages/app/src/ok-string.spec.ts": `const sample = 'import { foo } from "@agent-native/core/client"';\nexport const y = sample;\n`,
    "packages/app/src/env-bad.ts": `process.env.AGENT_USER_EMAIL = "a@b.com";\n`,
    "packages/app/src/env-ok.ts": `// guard:allow-env-mutation — fixture\nprocess.env.AGENT_USER_EMAIL = "a@b.com";\n`,
    "packages/core/src/extensions/bad-ext.ts": `${registerFn}({ type: "extension", allowPublic: true });\nconst x = { visibility: "public" };\n`,
    "packages/app/src/HelpBad.tsx": `export const A = () => <IconHelpCircle className="size-4" />;\n`,
    "packages/app/src/HelpOk.tsx": `{/* guard:allow-large-help-icon - heading */}\nexport const B = () => <IconHelpCircle className="size-4" />;\n`,
    "packages/app/src/fallback-bad.ts": `export const who = (x?: string) => x ?? "local@localhost";\nexport const amb = (x?: string) => x ?? process.env.AGENT_USER_EMAIL;\n`,
    "packages/app/src/fallback-ok.ts": `// guard:allow-localhost-fallback — fixture\nexport const who = (x?: string) => x ?? "local@localhost";\n`,
  });

  try {
    const { status, reports } = runFastGuards(dir, [
      "guard:agent-native-brand",
      "guard:no-secret-literals",
      "guard:no-core-client-barrel-imports",
      "guard:no-env-mutation",
      "guard:extension-no-public",
      "guard:help-icon-scale",
      "guard:no-localhost-fallback",
    ]);
    assert.equal(status, 1);

    const byName = new Map(reports.map((r) => [r.name, r]));

    const brand = byName.get("guard:agent-native-brand");
    assert.ok(brand);
    assert.equal(brand.passed, false);
    assert.deepEqual(brand.violations, ["README.md:1"]);

    const secrets = byName.get("guard:no-secret-literals");
    assert.ok(secrets);
    assert.equal(secrets.passed, false);
    assert.equal(secrets.violations.length, 1);
    assert.ok(secrets.violations[0]?.startsWith("src/leak.ts:1"));
    assert.equal(secrets.violations[0]?.includes(secretLike), false);

    const barrel = byName.get("guard:no-core-client-barrel-imports");
    assert.ok(barrel);
    assert.equal(barrel.passed, false);
    assert.equal(barrel.violations.length, 1);
    assert.ok(barrel.violations[0]?.startsWith("packages/app/src/bad.ts:1"));

    const envMut = byName.get("guard:no-env-mutation");
    assert.ok(envMut);
    assert.equal(envMut.passed, false);
    assert.equal(envMut.violations.length, 1);
    assert.ok(
      envMut.violations[0]?.startsWith("packages/app/src/env-bad.ts:1"),
    );

    const extPub = byName.get("guard:extension-no-public");
    assert.ok(extPub);
    assert.equal(extPub.passed, false);
    assert.equal(extPub.violations.length, 2);

    const helpIcon = byName.get("guard:help-icon-scale");
    assert.ok(helpIcon);
    assert.equal(helpIcon.passed, false);
    assert.equal(helpIcon.violations.length, 1);
    assert.ok(
      helpIcon.violations[0]?.startsWith("packages/app/src/HelpBad.tsx:1"),
    );

    const localhost = byName.get("guard:no-localhost-fallback");
    assert.ok(localhost);
    assert.equal(localhost.passed, false);
    assert.equal(localhost.violations.length, 2);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
