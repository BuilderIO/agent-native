import { expect, it } from "vitest";

import { defineAppConfig } from "../app-config/store.js";
import { deriveAppManifest } from "./index.js";
import {
  getAppManifest,
  getManifestActions,
  registerManifestActionDenials,
  registerManifestActions,
} from "./server.js";

it("derives a fallback from the configured app and its allowed actions", () => {
  const app = {};
  registerManifestActions(app, ["list-items", "delete-item", "internal-task"]);
  registerManifestActionDenials(app, [" delete-item "]);
  registerManifestActionDenials(app, ["internal-task"]);
  const reset = defineAppConfig({
    app: { id: "items", name: "Items", homePath: "/items" },
  });
  try {
    expect(
      getAppManifest(getManifestActions(app), {
        id: "fallback",
        name: "Fallback",
      }),
    ).toEqual(
      deriveAppManifest({ id: "items", name: "Items", homePath: "/items" }, [
        "list-items",
      ]),
    );
    expect(getManifestActions({})).toEqual([]);
  } finally {
    reset();
  }
});

it("prefers a declared manifest over fallback metadata", () => {
  const manifest = deriveAppManifest({ id: "items", name: "Items" }, [
    "show-item",
  ]);
  const reset = defineAppConfig({ manifest });
  try {
    expect(getAppManifest(["other-action"], { id: "fallback" })).toEqual(
      manifest,
    );
  } finally {
    reset();
  }
});
