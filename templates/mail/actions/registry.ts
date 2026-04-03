/**
 * Registry of all mail actions available to the production agent.
 * Each entry has a `tool` definition and a `run()` function.
 */

import { tool as archiveTool, run as archiveRun } from "./archive-email.js";
import { tool as trashTool, run as trashRun } from "./trash-email.js";
import { tool as markReadTool, run as markReadRun } from "./mark-read.js";
import { tool as starTool, run as starRun } from "./star-email.js";
import { tool as sendTool, run as sendRun } from "./send-email.js";
import { tool as listTool, run as listRun } from "./list-emails.js";
import { tool as searchTool, run as searchRun } from "./search-emails.js";
import { tool as getEmailTool, run as getEmailRun } from "./get-email.js";
import { tool as getThreadTool, run as getThreadRun } from "./get-thread.js";
import { tool as navigateTool, run as navigateRun } from "./navigate.js";
import {
  tool as manageDraftTool,
  run as manageDraftRun,
} from "./manage-draft.js";
import { tool as viewScreenTool, run as viewScreenRun } from "./view-screen.js";
import {
  tool as viewComposerTool,
  run as viewComposerRun,
} from "./view-composer.js";
import {
  tool as refreshListTool,
  run as refreshListRun,
} from "./refresh-list.js";
import {
  tool as bulkArchiveTool,
  run as bulkArchiveRun,
} from "./bulk-archive.js";
import {
  tool as requestCodeChangeTool,
  run as requestCodeChangeRun,
} from "./request-code-change.js";
import {
  tool as manageAutomationsTool,
  run as manageAutomationsRun,
} from "./manage-automations.js";
import {
  tool as triggerAutomationsTool,
  run as triggerAutomationsRun,
} from "./trigger-automations.js";
import type { ActionEntry } from "@agent-native/core";

export const actionRegistry: Record<string, ActionEntry> = {
  "archive-email": { tool: archiveTool, run: archiveRun },
  "trash-email": { tool: trashTool, run: trashRun },
  "mark-read": { tool: markReadTool, run: markReadRun },
  "star-email": { tool: starTool, run: starRun },
  "send-email": { tool: sendTool, run: sendRun },
  "list-emails": { tool: listTool, run: listRun },
  "search-emails": { tool: searchTool, run: searchRun },
  "get-email": { tool: getEmailTool, run: getEmailRun },
  "get-thread": { tool: getThreadTool, run: getThreadRun },
  navigate: { tool: navigateTool, run: navigateRun },
  "manage-draft": { tool: manageDraftTool, run: manageDraftRun },
  "view-screen": { tool: viewScreenTool, run: viewScreenRun },
  "view-composer": { tool: viewComposerTool, run: viewComposerRun },
  "refresh-list": { tool: refreshListTool, run: refreshListRun },
  "bulk-archive": { tool: bulkArchiveTool, run: bulkArchiveRun },
  "request-code-change": {
    tool: requestCodeChangeTool,
    run: requestCodeChangeRun,
  },
  "manage-automations": {
    tool: manageAutomationsTool,
    run: manageAutomationsRun,
  },
  "trigger-automations": {
    tool: triggerAutomationsTool,
    run: triggerAutomationsRun,
  },
};
