import { z } from "zod";

import {
  defineAppConfig,
  getAppConfig,
  type AppConfig,
} from "../server/index.js";

const exampleTypeTestSection = z.object({
  suggestionsKey: z.string().optional(),
  limit: z.number().default(5),
});

// Apps augment the interface through the public server entry point, which
// re-exports it; the augmentation must reach the declaring module.
declare module "../server/index.js" {
  interface AppConfigSections {
    exampleTypeTest: typeof exampleTypeTestSection;
  }
}

const limit: number = getAppConfig().exampleTypeTest.limit;
const key: string | undefined = getAppConfig().exampleTypeTest.suggestionsKey;
void limit;
void key;

defineAppConfig({ exampleTypeTest: { limit: 3 } });
defineAppConfig({ exampleTypeTest: {} });
// @ts-expect-error a section field keeps its declared type
defineAppConfig({ exampleTypeTest: { limit: "3" } });

// Framework fields stay typed alongside the section.
const homePath: string | undefined = ({} as AppConfig).app.homePath;
void homePath;
