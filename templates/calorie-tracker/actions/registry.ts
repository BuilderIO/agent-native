import { tool as viewScreenTool, run as viewScreenRun } from "./view-screen.js";
import { tool as navigateTool, run as navigateRun } from "./navigate.js";
import { tool as logMealTool, run as logMealRun } from "./log-meal.js";
import {
  tool as logExerciseTool,
  run as logExerciseRun,
} from "./log-exercise.js";
import { tool as logWeightTool, run as logWeightRun } from "./log-weight.js";
import { tool as listMealsTool, run as listMealsRun } from "./list-meals.js";
import {
  tool as listExercisesTool,
  run as listExercisesRun,
} from "./list-exercises.js";
import { tool as deleteItemTool, run as deleteItemRun } from "./delete-item.js";
import { tool as editItemTool, run as editItemRun } from "./edit-item.js";
import {
  tool as getAnalyticsTool,
  run as getAnalyticsRun,
} from "./get-analytics.js";

export const actionRegistry: Record<
  string,
  { tool: any; run: (args: Record<string, string>) => Promise<string> }
> = {
  "view-screen": { tool: viewScreenTool, run: viewScreenRun },
  navigate: { tool: navigateTool, run: navigateRun },
  "log-meal": { tool: logMealTool, run: logMealRun },
  "log-exercise": { tool: logExerciseTool, run: logExerciseRun },
  "log-weight": { tool: logWeightTool, run: logWeightRun },
  "list-meals": { tool: listMealsTool, run: listMealsRun },
  "list-exercises": { tool: listExercisesTool, run: listExercisesRun },
  "delete-item": { tool: deleteItemTool, run: deleteItemRun },
  "edit-item": { tool: editItemTool, run: editItemRun },
  "get-analytics": { tool: getAnalyticsTool, run: getAnalyticsRun },
};
