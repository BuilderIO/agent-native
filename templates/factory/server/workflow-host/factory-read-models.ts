import { getDb } from "../db/index.js";
import {
  createWorkflowReadModels,
  type WorkflowReadModels,
} from "./read-models.js";

let models: WorkflowReadModels | undefined;

/** The workflow read models on Factory's database. */
export function getWorkflowReadModels(): WorkflowReadModels {
  models ??= createWorkflowReadModels({ getDatabase: () => getDb() });
  return models;
}
