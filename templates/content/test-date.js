import fs from "fs";
import yaml from "yaml";
const content = fs.readFileSync(
  "content/projects/alice/test-cursor-alternatives/draft.md",
  "utf-8",
);
const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n)*/);
const data = yaml.parse(match[1]);
console.log(JSON.stringify(data.builder, null, 2));
