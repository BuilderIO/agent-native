/**
 * Registry of all recruiting scripts available to the production agent.
 * Each entry has a `tool` definition and a `run()` function.
 */

import { tool as viewScreenTool, run as viewScreenRun } from "./view-screen.js";
import { tool as navigateTool, run as navigateRun } from "./navigate.js";
import { tool as listJobsTool, run as listJobsRun } from "./list-jobs.js";
import { tool as getJobTool, run as getJobRun } from "./get-job.js";
import {
  tool as listCandidatesTool,
  run as listCandidatesRun,
} from "./list-candidates.js";
import {
  tool as getCandidateTool,
  run as getCandidateRun,
} from "./get-candidate.js";
import {
  tool as getPipelineTool,
  run as getPipelineRun,
} from "./get-pipeline.js";
import {
  tool as advanceCandidateTool,
  run as advanceCandidateRun,
} from "./advance-candidate.js";
import {
  tool as moveCandidateTool,
  run as moveCandidateRun,
} from "./move-candidate.js";
import {
  tool as rejectCandidateTool,
  run as rejectCandidateRun,
} from "./reject-candidate.js";
import {
  tool as createCandidateTool,
  run as createCandidateRun,
} from "./create-candidate.js";
import {
  tool as listInterviewsTool,
  run as listInterviewsRun,
} from "./list-interviews.js";
import {
  tool as dashboardSummaryTool,
  run as dashboardSummaryRun,
} from "./dashboard-summary.js";
import {
  tool as manageNotesTool,
  run as manageNotesRun,
} from "./manage-notes.js";
import {
  tool as refreshDataTool,
  run as refreshDataRun,
} from "./refresh-data.js";
import {
  tool as checkScorecardsTool,
  run as checkScorecardsRun,
} from "./check-scorecards.js";
import {
  tool as pipelineHealthTool,
  run as pipelineHealthRun,
} from "./pipeline-health.js";
import {
  tool as sendRecruiterUpdateTool,
  run as sendRecruiterUpdateRun,
} from "./send-recruiter-update.js";
import { tool as manageOrgTool, run as manageOrgRun } from "./manage-org.js";
import {
  tool as filterCandidatesTool,
  run as filterCandidatesRun,
} from "./filter-candidates.js";

import type { ActionEntry } from "@agent-native/core";

export const actionRegistry: Record<string, ActionEntry> = {
  "view-screen": { tool: viewScreenTool, run: viewScreenRun },
  navigate: { tool: navigateTool, run: navigateRun },
  "list-jobs": { tool: listJobsTool, run: listJobsRun },
  "get-job": { tool: getJobTool, run: getJobRun },
  "list-candidates": { tool: listCandidatesTool, run: listCandidatesRun },
  "get-candidate": { tool: getCandidateTool, run: getCandidateRun },
  "get-pipeline": { tool: getPipelineTool, run: getPipelineRun },
  "advance-candidate": {
    tool: advanceCandidateTool,
    run: advanceCandidateRun,
  },
  "move-candidate": { tool: moveCandidateTool, run: moveCandidateRun },
  "reject-candidate": {
    tool: rejectCandidateTool,
    run: rejectCandidateRun,
  },
  "create-candidate": {
    tool: createCandidateTool,
    run: createCandidateRun,
  },
  "list-interviews": { tool: listInterviewsTool, run: listInterviewsRun },
  "dashboard-summary": {
    tool: dashboardSummaryTool,
    run: dashboardSummaryRun,
  },
  "manage-notes": { tool: manageNotesTool, run: manageNotesRun },
  "refresh-data": { tool: refreshDataTool, run: refreshDataRun },
  "check-scorecards": { tool: checkScorecardsTool, run: checkScorecardsRun },
  "pipeline-health": { tool: pipelineHealthTool, run: pipelineHealthRun },
  "send-recruiter-update": {
    tool: sendRecruiterUpdateTool,
    run: sendRecruiterUpdateRun,
  },
  "manage-org": { tool: manageOrgTool, run: manageOrgRun },
  "filter-candidates": {
    tool: filterCandidatesTool,
    run: filterCandidatesRun,
  },
};
