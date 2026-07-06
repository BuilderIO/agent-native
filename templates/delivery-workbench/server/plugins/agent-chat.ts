import { createAgentChatPlugin } from "@agent-native/core/server";

import getWorkItem from "../../actions/get-work-item.js";
import ingestWorkItems from "../../actions/ingest-work-items.js";
import listRoutingRules from "../../actions/list-routing-rules.js";
import listWorkItems from "../../actions/list-work-items.js";
import navigate from "../../actions/navigate.js";
import updateWorkItem from "../../actions/update-work-item.js";
import upsertRoutingRule from "../../actions/upsert-routing-rule.js";
import viewScreen from "../../actions/view-screen.js";

export default createAgentChatPlugin({
  appId: "delivery-workbench",
  leanPrompt: true,
  initialToolNames: [
    "list-work-items",
    "get-work-item",
    "update-work-item",
    "view-screen",
    "navigate",
  ],
  actions: {
    "get-work-item": getWorkItem,
    "ingest-work-items": ingestWorkItems,
    "list-routing-rules": listRoutingRules,
    "list-work-items": listWorkItems,
    navigate,
    "update-work-item": updateWorkItem,
    "upsert-routing-rule": upsertRoutingRule,
    "view-screen": viewScreen,
  },
  systemPrompt: `You are the Delivery Workbench agent. Use actions as the single source of truth for queue, detail, routing, and source context. Read current screen context before acting. Use list-work-items and get-work-item for reads, update-work-item for status, assignee, priority, tags, due date, title, body, and metadata changes, and navigate to open queue or detail views for the user. Do not expose raw source payloads; preserve source system, source display id, source URL, snapshot hashes, and concise work item summaries.`,
});
