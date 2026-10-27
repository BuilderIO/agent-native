import type { useT } from "@agent-native/core/client/i18n";

import type { AgentKitLabels } from "../../agentkit/react/context.js";

type WorkStepLabelKey = Extract<
  keyof AgentKitLabels,
  `workStep${string}` | `showMoreWorkSteps${string}`
>;

/** Localized copy for the steps inside the Worked for disclosure. */
export function agentKitWorkStepLabels(
  t: ReturnType<typeof useT>,
): Pick<AgentKitLabels, WorkStepLabelKey> {
  const count = { count: "{{count}}" };
  return {
    showMoreWorkStepsOne: t("agentChat.workSteps.showMoreOne"),
    showMoreWorkStepsOther: t("agentChat.workSteps.showMoreOther", count),
    workStepMoreGroups: t("agentChat.workSteps.moreGroups", count),
    workStepMoreObjects: t("agentChat.workSteps.moreObjects", count),
    workStepSearchedOne: t("agentChat.workSteps.searchedOne"),
    workStepSearchedOther: t("agentChat.workSteps.searchedOther", count),
    workStepReadPagesOne: t("agentChat.workSteps.readPagesOne"),
    workStepReadPagesOther: t("agentChat.workSteps.readPagesOther", count),
    workStepFetchedOne: t("agentChat.workSteps.fetchedOne"),
    workStepFetchedOther: t("agentChat.workSteps.fetchedOther", count),
    workStepReadFilesOne: t("agentChat.workSteps.readFilesOne"),
    workStepReadFilesOther: t("agentChat.workSteps.readFilesOther", count),
    workStepEditedOne: t("agentChat.workSteps.editedOne"),
    workStepEditedOther: t("agentChat.workSteps.editedOther", count),
    workStepRanCommandsOne: t("agentChat.workSteps.ranCommandsOne"),
    workStepRanCommandsOther: t("agentChat.workSteps.ranCommandsOther", count),
    workStepRanActionsOne: t("agentChat.workSteps.ranActionsOne"),
    workStepRanActionsOther: t("agentChat.workSteps.ranActionsOther", count),
    workStepUsedTool: t("agentChat.workSteps.usedTool", { tool: "{{tool}}" }),
    workStepFailedCount: t("agentChat.workSteps.failedCount", count),
    workStepSearching: t("agentChat.workSteps.searching"),
    workStepReadingPages: t("agentChat.workSteps.readingPages"),
    workStepFetching: t("agentChat.workSteps.fetching"),
    workStepReadingFiles: t("agentChat.workSteps.readingFiles"),
    workStepEditing: t("agentChat.workSteps.editing"),
    workStepRunningCommands: t("agentChat.workSteps.runningCommands"),
    workStepRunningActions: t("agentChat.workSteps.runningActions"),
  };
}
