// @ts-expect-error — nitro/runtime is a virtual module resolved by Nitro at build time
import { defineTask } from "nitro/runtime";
import { processAutomationRules } from "./process.js";

export default defineTask({
  meta: {
    name: "automations:process",
    description: "Process automation rules against new inbox emails",
  },
  async run() {
    return processAutomationRules();
  },
});
