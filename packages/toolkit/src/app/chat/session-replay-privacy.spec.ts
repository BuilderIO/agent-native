import * as core from "@agent-native/core/client/session-replay-privacy";
import { describe, expect, it } from "vitest";

import {
  SESSION_REPLAY_BLOCK_PROPS,
  SESSION_REPLAY_MASK_PROPS,
} from "./session-replay-privacy.js";

describe("toolkit session replay markers", () => {
  it("match the markers core's recorder honors", () => {
    expect(SESSION_REPLAY_MASK_PROPS).toEqual(core.SESSION_REPLAY_MASK_PROPS);
    expect(SESSION_REPLAY_BLOCK_PROPS).toEqual(core.SESSION_REPLAY_BLOCK_PROPS);
  });
});
