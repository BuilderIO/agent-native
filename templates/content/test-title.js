import {
  markdownToBuilder,
  titleToHandle,
} from "./client/lib/markdown-to-builder.js";
import { parseFrontmatter } from "./client/lib/frontmatter.js";
import fs from "fs";
const content = fs.readFileSync(
  "content/projects/alice/test-cursor-alternatives/draft.md",
  "utf-8",
);
const { content: cleanContent } = parseFrontmatter(content);
markdownToBuilder(cleanContent).then((result) => {
  console.log("Extracted title:", result.title);
  console.log("Handle:", titleToHandle(result.title));
});
