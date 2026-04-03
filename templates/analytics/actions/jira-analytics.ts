#!/usr/bin/env tsx
import { parseArgs, output } from "./helpers";
import { getAnalytics } from "../server/lib/jira";

const args = parseArgs();
const projects = args.projects
  ? args.projects.split(",").map((p) => p.trim())
  : [];
const days = parseInt(args.days ?? "30");

const analytics = await getAnalytics(projects, days);

output(analytics);
