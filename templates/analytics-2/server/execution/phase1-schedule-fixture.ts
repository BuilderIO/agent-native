import { resolveDeployEnvironment } from "@agent-native/core/server";

import {
  phase1ScheduleFixtureKey,
  type ScheduleFixtureBridge,
} from "../../shared/phase1-schedule-fixture.js";

export function phase1ScheduleFixture() {
  const fixture = (
    globalThis as { [phase1ScheduleFixtureKey]?: ScheduleFixtureBridge }
  )[phase1ScheduleFixtureKey];
  if (fixture && resolveDeployEnvironment() !== "local")
    throw new Error(
      "The Phase 1 schedule fixture requires the local deployment profile",
    );
  return fixture;
}
