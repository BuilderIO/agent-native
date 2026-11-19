import { describe, expect, it } from "vitest";

import * as embedAuth from "../embed-auth.js";
import * as host from "./index.js";

describe("client host entry", () => {
  it("re-exports the embed credential reset used after a board claim", () => {
    expect(host.clearEmbedAuthToken).toBe(embedAuth.clearEmbedAuthToken);
  });
});
