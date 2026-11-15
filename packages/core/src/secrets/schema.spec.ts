import { getTableColumns } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { appSecrets } from "./schema.js";

describe("app_secrets schema", () => {
  it("maps the Vault metadata columns, each optional", () => {
    const columns = getTableColumns(appSecrets);

    expect(columns.label).toMatchObject({ name: "label", notNull: false });
    expect(columns.provider).toMatchObject({
      name: "provider",
      notNull: false,
    });
    expect(columns.createdBy).toMatchObject({
      name: "created_by",
      notNull: false,
    });
  });

  it("keeps the key, scope and encrypted value required", () => {
    const columns = getTableColumns(appSecrets);

    expect(columns.key).toMatchObject({ name: "key", notNull: true });
    expect(columns.scope).toMatchObject({ name: "scope", notNull: true });
    expect(columns.encryptedValue).toMatchObject({
      name: "encrypted_value",
      notNull: true,
    });
  });
});
