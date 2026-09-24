import { fail } from "@agent-native/core/action";
import {
  assertBuilderDsiAccess,
  BuilderDsiAccessError,
  getBuilderDsiAccess,
} from "@agent-native/core/server/builder-dsi-access";
import {
  assertAccess,
  resolveAccess,
  type ShareRole,
} from "@agent-native/core/sharing";

export function isBuilderDsiSystemData(data: unknown): boolean {
  if (data == null || data === "") return false;
  let value: unknown = data;
  if (typeof data === "string") {
    try {
      value = JSON.parse(data);
    } catch {
      fail("Design-system data could not be read.", {
        errorCode: "design_system_data_invalid",
        statusCode: 409,
      });
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return record.source === "builder" || record.authoring != null;
}

export async function assertDesignSystemDsiAccess(
  data: unknown,
): Promise<void> {
  if (isBuilderDsiSystemData(data)) await assertBuilderDsiAccess();
}

export async function resolveDesignSystemAccess(id: string) {
  const access = await resolveAccess("design-system", id);
  if (access) await assertDesignSystemDsiAccess(access.resource.data);
  return access;
}

export async function assertDesignSystemAccess(id: string, role: ShareRole) {
  const access = await assertAccess("design-system", id, role);
  await assertDesignSystemDsiAccess(access.resource.data);
  return access;
}

export async function filterAccessibleDesignSystems<
  T extends { data?: unknown },
>(rows: T[]): Promise<T[]> {
  if (!rows.some((row) => isBuilderDsiSystemData(row.data))) return rows;
  const access = await getBuilderDsiAccess();
  if (access.status === "ready") {
    await assertBuilderDsiAccess();
    return rows;
  }
  if (access.status === "unavailable") throw new BuilderDsiAccessError(access);
  return rows.filter((row) => !isBuilderDsiSystemData(row.data));
}
