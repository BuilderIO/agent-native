import { expect, it } from "vitest";

import { useBrowserTabUse as fromModule } from "../browser-tab-use.js";
import { useBrowserTabUse } from "./index.js";

it("offers the tab-use hook to apps that sync navigation themselves", () => {
  expect(useBrowserTabUse).toBe(fromModule);
});
