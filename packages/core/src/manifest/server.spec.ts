import { afterEach, expect, it } from "vitest";

import {
  defineAppConfig,
  resetAppConfigForTests,
} from "../app-config/store.js";
import { deriveAppManifest } from "./index.js";
import {
  getAppManifest,
  getManifestActions,
  registerManifestActionDenials,
  registerManifestActions,
} from "./server.js";

afterEach(resetAppConfigForTests);

it("derives a fallback from the configured app and its allowed actions", () => {
  const app = {};
  registerManifestActions(app, ["list-items", "delete-item", "internal-task"]);
  registerManifestActionDenials(app, [" delete-item "]);
  registerManifestActionDenials(app, ["internal-task"]);
  defineAppConfig({
    app: { id: "items", name: "Items", homePath: "/items" },
  });
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
});

it("prefers a declared manifest over fallback metadata", () => {
  const manifest = deriveAppManifest({ id: "items", name: "Items" }, [
    "show-item",
  ]);
  defineAppConfig({ manifest });
  expect(getAppManifest(["other-action"], { id: "fallback" })).toEqual(
    manifest,
  );
});

it("uses the workspace app's landing route as the fallback screen", () => {
  defineAppConfig({
    app: { workspaceId: "items" },
    workspace: {
      appsJson: JSON.stringify([{ id: "items", homePath: "/inbox" }]),
    },
  });
  const manifest = getAppManifest();
  expect(manifest.id).toBe("items");
  expect(manifest.screens.definitions.home.show.route).toBe("/inbox");
});
