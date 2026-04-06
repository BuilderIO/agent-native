import { defineTask } from "nitro/runtime";
import { processAutomationRules } from "../server/tasks/automations/process.js";

export default defineTask({
  meta: {
    name: "automations:process",
    description: "Process automation rules against new inbox emails",
  },
  async run() {
    return processAutomationRules();
  },
});
