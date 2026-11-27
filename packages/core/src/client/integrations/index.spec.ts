import { expect, it } from "vitest";

import * as integrations from "./index.js";
import {
  WORKSPACE_CONNECTION_COMPLETION_RETURN,
  watchWorkspaceConnectionCompletion,
} from "./workspace-provider-oauth.js";

it("lets an app watch a connection popup finish", () => {
  expect(integrations.watchWorkspaceConnectionCompletion).toBe(
    watchWorkspaceConnectionCompletion,
  );
  expect(integrations.WORKSPACE_CONNECTION_COMPLETION_RETURN).toBe(
    WORKSPACE_CONNECTION_COMPLETION_RETURN,
  );
});
