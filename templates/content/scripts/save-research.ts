import fs from "fs";
import path from "path";
import {
  loadEnv,
  parseArgs,
  camelCaseArgs,
  isValidProjectPath,
  ensureDir,
  PROJECTS_DIR,
  fail,
} from "./_utils.js";

export default async function main(args: string[]) {
  loadEnv();
  const raw = parseArgs(args);
  const opts = camelCaseArgs(raw);

  if (raw["help"]) {
    console.log(`Usage: pnpm script save-research --project-slug <slug> --data '<json>'

Options:
  --project-slug  Project slug to save research to (required)
  --data          JSON string with research data (must include "topic") (required)`);
    return;
  }

  const { projectSlug, data: dataJson } = opts;
  if (!projectSlug) fail("--project-slug is required");
  if (!dataJson) fail("--data is required (JSON string)");
  if (!isValidProjectPath(projectSlug)) fail("Invalid project slug");

  const projectDir = path.join(PROJECTS_DIR, projectSlug);
  if (!fs.existsSync(projectDir)) fail("Project not found");

  let parsed: any;
  try {
    parsed = JSON.parse(dataJson);
  } catch {
    fail("Invalid JSON data");
  }
  if (!parsed.topic) fail("Research data must include a 'topic' field");

  parsed.updatedAt = new Date().toISOString();

  const resourcesDir = path.join(projectDir, "resources");
  ensureDir(resourcesDir);

  const researchPath = path.join(resourcesDir, "research.json");
  fs.writeFileSync(researchPath, JSON.stringify(parsed, null, 2), "utf-8");

  console.log(`Research saved to ${projectSlug}/resources/research.json`);
  console.log(`Topic: ${parsed.topic}`);
  console.log(`Articles: ${parsed.articles?.length || 0}`);
  console.log(`Themes: ${parsed.themes?.length || 0}`);
}
