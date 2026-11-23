import { projectDocumentSchema } from "../app/lib/model/contracts.js";
import { appDocumentSchema } from "./app-layout.js";
import {
  draftHeadSchema,
  revisionSchema,
} from "./notebook-snapshot-contract.js";

export const projectDocumentWithLayoutSchema = projectDocumentSchema.extend({
  appLayout: appDocumentSchema.optional(),
  draftHead: draftHeadSchema.optional(),
  publishedHead: draftHeadSchema.nullable().optional(),
  orderRevision: revisionSchema.optional(),
});
