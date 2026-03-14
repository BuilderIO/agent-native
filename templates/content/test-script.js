import fs from "fs";
import yaml from "yaml";

const FRONTMATTER_REGEX = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n)*/;

function parseFrontmatter(markdown) {
  if (!markdown) return { content: "", data: {}, original: "" };
  const match = markdown.match(FRONTMATTER_REGEX);
  if (!match) return { content: markdown, data: {}, original: markdown };
  const data = yaml.parse(match[1]) || {};
  const content = markdown.slice(match[0].length).replace(/^\r?\n+/, "");
  return { content, data, original: markdown };
}

function updateFrontmatter(markdown, updates) {
  const parsed = parseFrontmatter(markdown);
  const newData = JSON.parse(JSON.stringify(parsed.data));
  for (const [k, v] of Object.entries(updates)) {
    if (v === undefined) delete newData[k];
    else newData[k] = v;
  }
  const yamlStr = yaml.stringify(newData);
  return `---\n${yamlStr}---\n\n${parsed.content}`;
}

const original = fs.readFileSync(
  "content/projects/alice/how-to-run-claude-code-on-mobile/draft.md",
  "utf8",
);

const updated = updateFrontmatter(original, {});

if (original !== updated) {
  console.log("Original and updated differ!");
  console.log("Original length:", original.length);
  console.log("Updated length:", updated.length);
  for (let i = 0; i < Math.max(original.length, updated.length); i++) {
    if (original[i] !== updated[i]) {
      console.log(`First diff at index ${i}`);
      console.log(
        `Original: ${JSON.stringify(original.substring(Math.max(0, i - 10), i + 40))}`,
      );
      console.log(
        `Updated: ${JSON.stringify(updated.substring(Math.max(0, i - 10), i + 40))}`,
      );
      break;
    }
  }
} else {
  console.log("They match exactly.");
}
