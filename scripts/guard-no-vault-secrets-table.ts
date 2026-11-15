/**
 * guard-no-vault-secrets-table.ts
 *
 * The Dispatch Vault keeps its keys in `app_secrets`, the encrypted store, and
 * its grants, requests and audit log in their own tables. The old
 * `vault_secrets` table stays in existing databases only until it is dropped:
 * no source may read or write it. A second table for keys is how a plaintext
 * copy comes back, and a column nobody references is the only kind that can
 * be dropped by hand.
 *
 * This guard scans every non-test source file for the table's name
 * (`vault_secrets`) and for its Drizzle export (`vaultSecrets`). A reference
 * is allowed only where ALLOWED_REFERENCES documents why. An allowlist entry
 * that matches nothing fails too, so the list only shrinks.
 *
 * Exit codes follow the other guards: 0 clean, 1 findings, 2 could not run (an
 * unreadable file, or a tree with no source files at all: a scan that inspected
 * nothing must not read as a clean one).
 */

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const GUARD_NAME = "guard:no-vault-secrets-table";
const GUARD_EXIT_COULD_NOT_RUN = 2;
const REPO_ROOT = path.resolve(import.meta.dirname, "..");

const SKIP_DIRS = new Set([
  ".cache",
  ".claude",
  ".git",
  ".netlify",
  ".next",
  ".nuxt",
  ".output",
  ".tmp",
  ".turbo",
  ".vercel",
  ".wrangler",
  "build",
  "coverage",
  "dist",
  "node_modules",
]);
// Repo-relative directories that hold generated copies of tracked source: a
// reference there is the same reference, reported once at its origin.
const SKIP_PATHS = new Set(["packages/core-corpus/corpus"]);
const SOURCE_FILE = /\.(?:[cm]?[jt]sx?|sql)$/;
const TEST_FILE =
  /(?:\.spec\.|\.test\.|\.test-helpers\.|(?:^|\/)__tests__\/|(?:^|\/)__fixtures__\/|(?:^|\/)e2e\/)/;

const TOKENS = {
  vault_secrets: /\bvault_secrets\b/i,
  vaultSecrets: /\bvaultSecrets\b/,
} as const;
export type VaultSecretsToken = keyof typeof TOKENS;

export interface AllowedReference {
  /** Repo-relative path, forward slashes. */
  file: string;
  /** Only these spellings are allowed in the file. Omitted means both. */
  tokens?: readonly VaultSecretsToken[];
  reason: string;
}

export const ALLOWED_REFERENCES: readonly AllowedReference[] = [
  {
    file: "packages/dispatch/src/db/migrations.ts",
    tokens: ["vault_secrets"],
    reason:
      "Migrations are append-only: version 2 created the table and version 6 widened its timestamp columns.",
  },
  {
    file: "packages/dispatch/src/server/plugins/db.ts",
    tokens: ["vault_secrets"],
    reason:
      "The table's `created_by` stays in existing databases until it is dropped, and identity migrations refuse an identity-shaped column with no policy.",
  },
  {
    file: "packages/core/src/scripts/db/safety.ts",
    tokens: ["vault_secrets"],
    reason:
      "SQL deny-list for the agent's database tools: databases that still hold the table keep it unreachable.",
  },
  {
    file: "packages/core/src/extensions/routes.ts",
    tokens: ["vault_secrets"],
    reason:
      "SQL deny-list for extension queries: databases that still hold the table keep it unreachable.",
  },
  {
    file: "packages/dispatch/src/actions/view-screen.ts",
    tokens: ["vaultSecrets"],
    reason:
      "The name of a field in what the agent sees on the Vault screen, not the table.",
  },
  {
    file: "templates/dispatch/actions/view-screen.ts",
    tokens: ["vaultSecrets"],
    reason:
      "The name of a field in what the agent sees on the Vault screen, not the table.",
  },
  {
    file: "scripts/guard-no-vault-secrets-table.ts",
    reason: "This guard names what it forbids.",
  },
];

export interface VaultSecretsFinding {
  file: string;
  line: number;
  token: VaultSecretsToken;
  text: string;
}

export interface VaultSecretsScan {
  filesScanned: number;
  findings: VaultSecretsFinding[];
  /** Allowlist entries that matched no reference in their file. */
  unusedAllowances: AllowedReference[];
}

function* walk(root: string, dir = root): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const relative = path.relative(root, file).split(path.sep).join("/");
      if (!SKIP_DIRS.has(entry.name) && !SKIP_PATHS.has(relative)) {
        yield* walk(root, file);
      }
    } else if (entry.isFile()) {
      yield file;
    }
  }
}

export function scanForVaultSecretsTable(
  root: string,
  allowed: readonly AllowedReference[] = ALLOWED_REFERENCES,
): VaultSecretsScan {
  const used = new Set<AllowedReference>();
  const findings: VaultSecretsFinding[] = [];
  let filesScanned = 0;

  for (const absolute of walk(root)) {
    const file = path.relative(root, absolute).split(path.sep).join("/");
    if (!SOURCE_FILE.test(file) || TEST_FILE.test(file)) continue;
    filesScanned += 1;
    const lines = readFileSync(absolute, "utf8").split(/\r?\n/);
    for (const [index, text] of lines.entries()) {
      for (const [token, pattern] of Object.entries(TOKENS) as Array<
        [VaultSecretsToken, RegExp]
      >) {
        if (!pattern.test(text)) continue;
        const allowance = allowed.find(
          (entry) =>
            entry.file === file && (entry.tokens ?? [token]).includes(token),
        );
        if (allowance) {
          used.add(allowance);
          continue;
        }
        findings.push({ file, line: index + 1, token, text: text.trim() });
      }
    }
  }

  findings.sort((a, b) =>
    a.file === b.file ? a.line - b.line : a.file.localeCompare(b.file),
  );
  return {
    filesScanned,
    findings,
    unusedAllowances: allowed.filter((entry) => !used.has(entry)),
  };
}

function main() {
  let scan: VaultSecretsScan;
  try {
    scan = scanForVaultSecretsTable(REPO_ROOT);
  } catch (error) {
    console.error(`${GUARD_NAME}: could not scan: ${(error as Error).message}`);
    process.exit(GUARD_EXIT_COULD_NOT_RUN);
  }
  if (scan.filesScanned === 0) {
    console.error(`${GUARD_NAME}: found no source files to scan.`);
    process.exit(GUARD_EXIT_COULD_NOT_RUN);
  }

  if (scan.findings.length === 0 && scan.unusedAllowances.length === 0) {
    console.log(`${GUARD_NAME}: OK (${scan.filesScanned} source file(s))`);
    return;
  }

  if (scan.findings.length > 0) {
    console.error(
      `${GUARD_NAME}: ${scan.findings.length} reference(s) to the retired vault_secrets table.\n\n` +
        "Vault keys live in `app_secrets`; grants, requests and the audit log\n" +
        "are the only Vault tables. Use the vault store (`vault-store.ts`) or the\n" +
        "credential store (`@agent-native/core/secrets`) instead of the table.\n",
    );
    for (const finding of scan.findings) {
      console.error(
        `  ${finding.file}:${finding.line} — ${finding.token}: ${finding.text}`,
      );
    }
  }
  if (scan.unusedAllowances.length > 0) {
    console.error(
      `\n${scan.unusedAllowances.length} allowlist entr${scan.unusedAllowances.length === 1 ? "y" : "ies"} in scripts/guard-no-vault-secrets-table.ts no longer match anything. Remove ${scan.unusedAllowances.length === 1 ? "it" : "them"}:\n`,
    );
    for (const entry of scan.unusedAllowances) {
      console.error(`  ${entry.file}`);
    }
  }
  process.exit(1);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main();
}
