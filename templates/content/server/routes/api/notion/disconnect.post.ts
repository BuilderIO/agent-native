import { defineEventHandler } from "h3";
import {
  disconnectNotionForOwner,
  getDocumentOwnerEmail,
} from "../../../lib/notion.js";

export default defineEventHandler(async (event) => {
  const owner = await getDocumentOwnerEmail(event);
  const deleted = await disconnectNotionForOwner(owner);
  return { success: true, deleted };
});
