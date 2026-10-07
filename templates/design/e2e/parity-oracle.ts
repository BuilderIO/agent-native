import { createHash } from "node:crypto";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";

const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");
const ORACLE_DIR = "templates/design/parity/oracle";
const ORACLE_ID = /^fig\.[a-z0-9]+(?:-[a-z0-9]+)*\.[a-z0-9]+(?:-[a-z0-9]+)*$/;

export type ParityOracle = {
  id: string;
  basis: "measured";
  date: string;
  claim: string;
  values: Record<string, unknown>;
  title: string;
};

type OracleArtifact = {
  path: string;
  sha256: string;
};

type OracleRecord = {
  schemaVersion: number;
  id: string;
  basis: "measured" | "chosen";
  status: string;
  date: string;
  claim: string;
  values?: Record<string, unknown>;
  artifacts: OracleArtifact[];
};

/** Resolve a current ledger record and verify its committed evidence bytes. */
export function oracle(id: string, repoRoot = REPO_ROOT): ParityOracle {
  if (!ORACLE_ID.test(id)) throw new Error(`invalid Design oracle id: ${id}`);
  const entryPath = path.join(repoRoot, ORACLE_DIR, `${id}.json`);
  let record: OracleRecord;
  try {
    record = JSON.parse(readFileSync(entryPath, "utf8")) as OracleRecord;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`cannot read Design oracle ${id}: ${detail}`, {
      cause: error,
    });
  }
  if (record.schemaVersion !== 1 || record.id !== id) {
    throw new Error(`Design oracle ${id} has an invalid schema or id`);
  }
  if (record.status !== "current") {
    throw new Error(
      `Design oracle ${id} is ${record.status}; only current records may be cited`,
    );
  }
  if (record.basis !== "measured") {
    throw new Error(
      `Design oracle ${id} is not measured; only measured records may be cited`,
    );
  }
  if (!Array.isArray(record.artifacts)) {
    throw new Error(`Design oracle ${id} has no artifact list`);
  }
  const entryDir = path.resolve(repoRoot, ORACLE_DIR, id);
  for (const artifact of record.artifacts) {
    if (
      !artifact ||
      typeof artifact.path !== "string" ||
      typeof artifact.sha256 !== "string" ||
      artifact.path.includes("\\") ||
      path.posix.isAbsolute(artifact.path) ||
      artifact.path
        .split("/")
        .some((segment) => segment === "." || segment === "..") ||
      !artifact.path.startsWith(`${ORACLE_DIR}/${id}/`)
    ) {
      throw new Error(`Design oracle ${id} has an unsafe artifact path`);
    }
    const artifactPath = path.resolve(repoRoot, artifact.path);
    const relative = path.relative(entryDir, artifactPath);
    if (
      !relative ||
      relative === ".." ||
      relative.startsWith(`..${path.sep}`)
    ) {
      throw new Error(
        `Design oracle ${id} artifact escapes its record directory`,
      );
    }
    try {
      const actualPath = realpathSync(artifactPath);
      const actualRelative = path.relative(entryDir, actualPath);
      const stat = lstatSync(artifactPath);
      if (
        stat.isSymbolicLink() ||
        !stat.isFile() ||
        actualRelative === ".." ||
        actualRelative.startsWith(`..${path.sep}`)
      ) {
        throw new Error(
          "artifact is not a regular file inside its record directory",
        );
      }
      const digest = createHash("sha256")
        .update(readFileSync(actualPath))
        .digest("hex");
      if (digest !== artifact.sha256) {
        throw new Error(`sha256 mismatch for ${artifact.path}`);
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`Design oracle ${id} artifact check failed: ${detail}`, {
        cause: error,
      });
    }
  }
  if (
    !record.values ||
    typeof record.values !== "object" ||
    Array.isArray(record.values)
  ) {
    throw new Error(`Design oracle ${id} has no values object`);
  }
  return {
    id,
    basis: record.basis,
    date: record.date,
    claim: record.claim,
    values: record.values,
    title: `[oracle ${id} ${record.basis}]`,
  };
}
