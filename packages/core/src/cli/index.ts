#!/usr/bin/env node

import { createApp } from "./create.js";

const command = process.argv[2];
const args = process.argv.slice(3);

switch (command) {
  case "create":
    createApp(args[0]);
    break;
  case "--help":
  case "-h":
  case undefined:
    console.log(`agent-native CLI

Usage:
  agent-native create <app-name>   Scaffold a new agent-native app
  agent-native --help              Show this help message

Examples:
  npx @agent-native/core create my-app
  agent-native create my-analytics-app`);
    break;
  default:
    console.error(`Unknown command: ${command}`);
    console.error(`Run "agent-native --help" for usage.`);
    process.exit(1);
}
