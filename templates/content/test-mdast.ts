import { fromMarkdown } from "mdast-util-from-markdown";
const tree = fromMarkdown("*Hey! `[repo]` locally*");
console.log(JSON.stringify(tree, null, 2));
