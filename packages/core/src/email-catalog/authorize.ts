import { currentRequestUserIsOrgAdmin } from "../server/org-admin.js";
import { getTransactionalEmail } from "./registry.js";
import { registerCoreSystemEmails } from "./system-emails.js";

export async function authorizeTransactionalEmailRead(
  templateIds: string[] = [],
): Promise<boolean> {
  if (!(await currentRequestUserIsOrgAdmin())) return false;
  registerCoreSystemEmails();
  return templateIds.every((id) => Boolean(getTransactionalEmail(id)));
}
