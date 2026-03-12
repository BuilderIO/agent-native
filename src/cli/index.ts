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
    console.log(`agentnative CLI

Usage:
  agentnative create <app-name>   Scaffold a new agentnative app
  agentnative --help              Show this help message

Examples:
  npx agentnative create my-app
  agentnative create fusion-analytics`);
    break;
  default:
    console.error(`Unknown command: ${command}`);
    console.error(`Run "agentnative --help" for usage.`);
    process.exit(1);
}
