import { defineAction } from "@agent-native/core";
import { z } from "zod";

import {
  nativeV2DashboardManifests,
  NATIVE_V2_DASHBOARD_VERSION,
} from "../server/lib/native-v2-dashboards";

export default defineAction({
  description:
    "List the source-controlled native Analytics v2 dashboard manifests, including required Data Program binding keys and output columns. These provider-free manifests are compiled into org dashboards by ensure-native-v2-dashboards.",
  schema: z.object({}),
  http: { method: "GET" },
  readOnly: true,
  publicAgent: { expose: true, readOnly: true, requiresAuth: true },
  run: async () => ({
    version: NATIVE_V2_DASHBOARD_VERSION,
    templates: nativeV2DashboardManifests.map((manifest) => ({
      id: manifest.id,
      name: manifest.name,
      description: manifest.description,
      category: manifest.category,
      tags: manifest.tags,
      requiredBindings: manifest.requiredBindings,
      panels: manifest.panels.map((panel) => ({
        id: panel.id,
        title: panel.title,
        chartType: panel.chartType,
        bindingKey: panel.bindingKey ?? null,
        requiredColumns: panel.requiredColumns ?? [],
      })),
    })),
  }),
});
