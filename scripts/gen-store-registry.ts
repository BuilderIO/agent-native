import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

import {
  STORE_MIGRATIONS_LOCK_FILE,
  buildStoreMigrationsLock,
  renderStoreMigrationsLock,
} from "../packages/core/src/guards/store-migrations-lock.js";
import {
  STORE_REGISTRY_FILE,
  discoverStores,
  findDuplicateStoreIds,
  renderStoreRegistry,
} from "../packages/core/src/guards/store-registry-codegen.js";

const coreDir = path.join(process.cwd(), "packages", "core");
const stores = discoverStores(coreDir);
const duplicates = findDuplicateStoreIds(stores);
if (duplicates.length > 0) {
  console.error(`Duplicate defineStore ids: ${duplicates.join(", ")}`);
  process.exit(1);
}

fs.writeFileSync(
  path.join(coreDir, STORE_REGISTRY_FILE),
  renderStoreRegistry(stores),
  "utf8",
);

const loaded = await Promise.all(
  stores.map(async (store) => {
    const mod = await import(
      pathToFileURL(path.join(coreDir, store.file)).href
    );
    return mod[store.exportName];
  }),
);
fs.writeFileSync(
  path.join(coreDir, STORE_MIGRATIONS_LOCK_FILE),
  renderStoreMigrationsLock(buildStoreMigrationsLock(loaded)),
  "utf8",
);
console.log(
  `Wrote ${STORE_REGISTRY_FILE} and ${STORE_MIGRATIONS_LOCK_FILE} (${stores.length} stores).`,
);
