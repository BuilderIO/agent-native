import { computeBlockDiff } from "../server/routes/notion-diff";

const oldBlocks = [{ type: 'paragraph', paragraph: { rich_text: [{ text: { content: 'a' } }] } }];
const newBlocks = [{ type: 'paragraph', paragraph: { rich_text: [{ text: { content: 'b' } }] } }];

const ops = computeBlockDiff(oldBlocks, newBlocks);
console.log(ops);
