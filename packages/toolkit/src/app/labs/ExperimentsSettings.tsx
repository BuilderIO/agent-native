import type { LabDefinition } from "@agent-native/core/labs/registry";

import { LabsSettings } from "../labs/LabsSettings.js";

/** @deprecated Use LabsSettings instead. */
export interface ExperimentsSettingsProps {
  experiments: readonly LabDefinition[];
  title?: string;
  intro?: string;
}

export function ExperimentsSettings({
  experiments,
  title = "Experiments",
  intro,
}: ExperimentsSettingsProps) {
  return <LabsSettings labs={experiments} title={title} intro={intro} />;
}
