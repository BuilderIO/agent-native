import { fileURLToPath } from "node:url";

import { PARTS } from "@agent-native/design-system/catalog";
import { expect, it } from "vitest";

import { withImportTags } from "../../.storybook/manifest-imports.js";

it("publishes the Switch input names, fallback values and descriptions from its catalog entry", () => {
  const project = fileURLToPath(new URL("../../", import.meta.url));
  const part = PARTS.find((entry) => entry.name === "switch");
  const result = withImportTags(
    {
      components: {
        v: 0,
        components: {
          "components-switch": {
            id: "components-switch",
            path: "dev/stories/components/switch.stories.tsx",
            name: "Switch",
            jsDocTags: {},
            stories: [],
          },
        },
      },
    },
    [],
    "@agent-native/toolkit",
    project,
  );
  expect(part?.cssInputs?.["--switch-width"]).toMatchObject({
    fallback: expect.stringMatching(/\S/),
    description: expect.stringMatching(/\S/),
  });
  expect(result.components?.components["components-switch"]).toMatchObject({
    cssInputs: part?.cssInputs,
  });
});
