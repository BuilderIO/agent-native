import type { ScriptEntry } from "@agent-native/core";

import { tool as listImportsTool, run as listImportsRun } from "./list-imports.js";
import { tool as listEnrichmentsTool, run as listEnrichmentsRun } from "./list-enrichments.js";
import { tool as exportCsvTool, run as exportCsvRun } from "./export-csv.js";
import { tool as checkWebsetTool, run as checkWebsetRun } from "./check-webset.js";
import { tool as createWebsetTool, run as createWebsetRun } from "./create-webset.js";
import { tool as getResultsTool, run as getResultsRun } from "./get-results.js";

export const scriptRegistry: Record<string, ScriptEntry> = {
  "list-imports": { tool: listImportsTool, run: listImportsRun },
  "list-enrichments": { tool: listEnrichmentsTool, run: listEnrichmentsRun },
  "export-csv": { tool: exportCsvTool, run: exportCsvRun },
  "check-webset": { tool: checkWebsetTool, run: checkWebsetRun },
  "create-webset": { tool: createWebsetTool, run: createWebsetRun },
  "get-results": { tool: getResultsTool, run: getResultsRun },
};
