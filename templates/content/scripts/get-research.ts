import fs from "fs";
import path from "path";
import {
  loadEnv,
  parseArgs,
  camelCaseArgs,
  isValidProjectPath,
  PROJECTS_DIR,
  fail,
} from "./_utils.js";

export default async function main(args: string[]) {
  loadEnv();
  const raw = parseArgs(args);
  const opts = camelCaseArgs(raw);

  if (raw["help"]) {
    console.log(`Usage: pnpm script get-research --project-slug <slug>

Options:
  --project-slug  Project slug to get research for (required)`);
    return;
  }

  const { projectSlug } = opts;
  if (!projectSlug) fail("--project-slug is required");
  if (!isValidProjectPath(projectSlug)) fail("Invalid project slug");

  const researchPath = path.join(
    PROJECTS_DIR,
    projectSlug,
    "resources",
    "research.json",
  );

  if (!fs.existsSync(researchPath)) {
    console.log(
      `No research data found for "${projectSlug}". Use: pnpm script save-research`,
    );
    return;
  }

  const data = JSON.parse(fs.readFileSync(researchPath, "utf-8"));
  let text = `# Research: ${data.topic || projectSlug}\n\n`;

  if (data.updatedAt) text += `Last updated: ${data.updatedAt}\n\n`;

  if (data.themes?.length) {
    text += "## Common Themes\n";
    for (const theme of data.themes) text += `- ${theme}\n`;
    text += "\n";
  }

  if (data.articles?.length) {
    text += `## Top Articles (${data.articles.length})\n\n`;
    for (const article of data.articles) {
      text += `### ${article.title}\n`;
      text += `Source: ${article.source} | Author: ${article.author}\n`;
      if (article.url) text += `URL: ${article.url}\n`;
      if (article.signals?.length) {
        text += `Signals: ${article.signals.map((s: any) => `${s.label}${s.value ? `: ${s.value}` : ""}`).join(", ")}\n`;
      }
      if (article.summary) text += `\n${article.summary}\n`;
      if (article.keyQuote) text += `\n> ${article.keyQuote}\n`;
      if (article.highlights?.length) {
        text += "\nHighlights:\n";
        for (const h of article.highlights) text += `- ${h}\n`;
      }
      text += "\n";
    }
  }

  console.log(text);
}
