import { createHash } from "node:crypto";

export {
  workspaceWarehouseEditFormInput,
  workspaceWarehouseEditFormSchema,
} from "../../shared/workspace-warehouse-edit-form.js";

export function warehouseEditOperation(
  scope: { orgId: string; ownerEmail: string },
  requestId: string,
): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        scope.orgId,
        scope.ownerEmail.trim().toLowerCase(),
        requestId,
      ]),
    )
    .digest("hex");
}
