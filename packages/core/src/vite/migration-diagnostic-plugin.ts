import path from "node:path";

import type { Plugin } from "vite";

import { scanDeprecatedImports } from "../package-lifecycle/deprecated-imports.js";
import {
  loadMigrationManifestsForProject,
  resolveMigrationSymbolMove,
} from "../package-lifecycle/migration-manifest.js";
import {
  AGENT_NATIVE_MIGRATION_GUIDE_URL,
  AGENT_NATIVE_UPGRADE_CODEMOD_COMMAND,
} from "../package-lifecycle/migration-message.js";

function formatImportDiagnostic(
  root: string,
  finding: ReturnType<typeof scanDeprecatedImports>[number],
  moves: ReturnType<typeof loadMigrationManifestsForProject>[number]["moves"],
): string {
  const source =
    path.relative(root, finding.file) || path.basename(finding.file);
  const guides = [finding.migrationGuide, AGENT_NATIVE_MIGRATION_GUIDE_URL]
    .filter(
      (guide, index, all): guide is string =>
        Boolean(guide) && all.indexOf(guide) === index,
    )
    .join(", ");
  const oldImport = finding.symbols.length
    ? `${finding.from} (${finding.symbols.join(", ")})`
    : finding.from;
  const move = moves[finding.from];
  const destinations = finding.symbols.length
    ? finding.symbols.map((symbol) => {
        const resolved = move ? resolveMigrationSymbolMove(move, symbol) : null;
        return `${symbol} → ${resolved?.to ?? (finding.to.join(", ") || "removed from Core")}`;
      })
    : finding.to.length
      ? finding.to.join(", ")
      : "removed from Core";

  return `  ${source}:${finding.line}\n    Old import: ${oldImport}\n    New home: ${destinations}\n    Migration guides: ${guides}`;
}

export function migrationDiagnosticPlugin(): Plugin {
  let projectRoot = "";
  let manifests = loadMigrationManifestsForProject(process.cwd());

  const diagnosticMessage = (files?: string[]): string | null => {
    const findings = scanDeprecatedImports({
      root: projectRoot,
      files,
      manifests,
    }).filter((finding) => finding.status !== "planned");

    if (findings.length === 0) return null;

    const moves = Object.assign({}, ...manifests.map((item) => item.moves));
    const details = findings
      .map((finding) => formatImportDiagnostic(projectRoot, finding, moves))
      .join("\n\n");
    const actions = [
      findings.some((finding) => finding.status === "active")
        ? `Run \`${AGENT_NATIVE_UPGRADE_CODEMOD_COMMAND}\` to update supported moved imports.`
        : "",
      findings.some((finding) => finding.status === "removed")
        ? "Removed exports need app-level changes; follow the migration guide."
        : "",
    ].filter(Boolean);
    return `Agent-Native found imports moved from Core:\n\n${details}\n\n${actions.join("\n")}\nSee the 0.198 migration runbook: ${AGENT_NATIVE_MIGRATION_GUIDE_URL}`;
  };

  return {
    name: "agent-native-migration-diagnostic",
    enforce: "pre",
    configResolved(config) {
      projectRoot = config.root;
      manifests = loadMigrationManifestsForProject(projectRoot);
      const message = diagnosticMessage();
      if (message) throw new Error(message);
    },
    handleHotUpdate(context) {
      const message = diagnosticMessage([context.file]);
      if (message) this.error(message);
    },
  };
}
