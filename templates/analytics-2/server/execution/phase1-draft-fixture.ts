import { resolveDeployEnvironment } from "@agent-native/core/server";

import {
  phase1DraftFixtureKey,
  type DraftFixtureBridge,
} from "../../shared/phase1-draft-fixture.js";

export function phase1DraftFixture() {
  const fixture = (
    globalThis as { [phase1DraftFixtureKey]?: DraftFixtureBridge }
  )[phase1DraftFixtureKey];
  if (fixture && resolveDeployEnvironment() !== "local")
    throw new Error(
      "The Phase 1 draft fixture requires the local deployment profile",
    );
  return fixture;
}
