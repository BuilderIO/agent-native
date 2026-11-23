import { resolveDeployEnvironment } from "@agent-native/core/server";

export const phase1AskFixtureKey = Symbol.for("analytics-2.phase1.ask-fixture");

export type AskFixtureBridge = {
  failUpload(filename: string): boolean;
  modelUnavailable(prompt: string): boolean;
};

export function phase1AskFixture() {
  const fixture = (globalThis as { [phase1AskFixtureKey]?: AskFixtureBridge })[
    phase1AskFixtureKey
  ];
  if (fixture && resolveDeployEnvironment() !== "local")
    throw new Error(
      "The Phase 1 Ask fixture requires the local deployment profile",
    );
  return fixture;
}
