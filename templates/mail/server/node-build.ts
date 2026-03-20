import {
  createProductionServer,
  createProductionAgentHandler,
} from "@agent-native/core/server";
import { createAppServer } from "./index.js";
import { scriptRegistry } from "../scripts/registry.js";
import { readFileSync } from "fs";
import path from "path";

const systemPrompt = readFileSync(
  path.join(process.cwd(), "agents/production-system-prompt.md"),
  "utf-8",
);

const agentHandler = createProductionAgentHandler({
  scripts: scriptRegistry,
  systemPrompt,
});

createProductionServer(createAppServer(), {
  agent: agentHandler,
  accessToken: process.env.ACCESS_TOKEN,
});
