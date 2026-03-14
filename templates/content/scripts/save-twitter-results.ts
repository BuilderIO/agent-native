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
    console.log(`Usage: pnpm script save-twitter-results --project-slug <slug> --query "..." --tweets '<json>'

Options:
  --project-slug  Project to save results to (required)
  --query         The search query that was used (required)
  --tweets        JSON string of tweets array (required)`);
    return;
  }

  const { projectSlug, query, tweets: tweetsJson } = opts;
  if (!projectSlug) fail("--project-slug is required");
  if (!query) fail("--query is required");
  if (!tweetsJson) fail("--tweets is required (JSON string)");
  if (!isValidProjectPath(projectSlug)) fail("Invalid project slug");

  const projectDir = path.join(PROJECTS_DIR, projectSlug);
  if (!fs.existsSync(projectDir)) fail("Project not found");

  let parsedTweets: any[];
  try {
    parsedTweets = JSON.parse(tweetsJson);
  } catch {
    fail("Invalid tweets JSON");
  }

  const resourcesDir = path.join(projectDir, "resources");
  ensureDir(resourcesDir);

  const filePath = path.join(resourcesDir, "twitter-research.json");
  let existing: { searches: any[] } = { searches: [] };
  if (fs.existsSync(filePath)) {
    try {
      existing = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    } catch {}
  }

  existing.searches.push({
    query,
    savedAt: new Date().toISOString(),
    tweetCount: parsedTweets.length,
    tweets: parsedTweets,
  });

  fs.writeFileSync(filePath, JSON.stringify(existing, null, 2), "utf-8");
  console.log(
    `Saved ${parsedTweets.length} tweets to ${projectSlug}/resources/twitter-research.json`,
  );
}
