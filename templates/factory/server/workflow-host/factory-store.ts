import { getDb } from "../db/index.js";
import type { WorkflowStore } from "../workflow/adapter.js";
import { createDrizzleWorkflowStore } from "./store.js";

let store: WorkflowStore | undefined;

/** The workflow store on Factory's database. */
export function getWorkflowStore(): WorkflowStore {
  store ??= createDrizzleWorkflowStore({ getDatabase: () => getDb() });
  return store;
}
