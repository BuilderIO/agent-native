// The editor validates against the same operation catalog the server saves
// against. The catalog is plain data that only imports zod and the workflow
// contract, so it is safe in the client bundle. Vite has no alias for
// `server/`, so the import is relative and this is the only place that spells
// the path.
import type { WorkflowCatalog } from "@/lib/workflow-editor";

import { OPERATION_CATALOG } from "../../../server/workflow/catalog/index.js";

export const WORKFLOW_CATALOG: WorkflowCatalog = OPERATION_CATALOG;
