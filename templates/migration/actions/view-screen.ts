import { defineAction } from "@agent-native/core";
import { readAppState } from "@agent-native/core/application-state";
import { z } from "zod";
import { getRunRow, loadTasks } from "./_utils.js";

export default defineAction({
  description:
    "See the current Migration Workbench screen, including selected run context when available.",
  schema: z.object({}),
  http: false,
  run: async () => {
    const navigation = (await readAppState("navigation")) as {
      runId?: string;
      view?: string;
    } | null;

    const screen: Record<string, unknown> = {};
    if (navigation) screen.navigation = navigation;
    if (navigation?.runId) {
      try {
        const row = await getRunRow(navigation.runId);
        screen.run = {
          id: row.id,
          name: row.name,
          phase: row.phase,
          approved: row.approved,
          sourceRoot: row.sourceRoot,
          outputRoot: row.outputRoot,
          assessmentPath: row.assessmentPath,
          planPath: row.planPath,
          reportPath: row.reportPath,
        };
        screen.tasks = await loadTasks(row.id);
      } catch (error) {
        screen.runError =
          error instanceof Error ? error.message : "Unable to load run";
      }
    }

    if (Object.keys(screen).length === 0) {
      return "No Migration Workbench application state found. Is the app running?";
    }
    return screen;
  },
});
