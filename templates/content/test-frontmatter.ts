import { readFile } from "fs/promises";
import { parseFrontmatter } from "./client/lib/frontmatter.js";
const md = await readFile("content/projects/alice/claude-code-for-designers/draft.md", "utf-8");
const parsed = parseFrontmatter(md);
console.log("Original starts with:", md.substring(0, 30).replace(/\n/g, '\\n'));
console.log("Parsed content starts with:", parsed.content.substring(0, 30).replace(/\n/g, '\\n'));
console.log("Parsed data:", Object.keys(parsed.data));
