import fs from "fs";
import yaml from "yaml";
const content = fs.readFileSync(
  "content/projects/alice/test-cursor-alternatives/draft.md",
  "utf-8",
);
const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n)*/);
const data = yaml.parse(match[1]);
console.log(data.builder.date);
console.log(typeof data.builder.date);
console.log(data.builder.date instanceof Date);
