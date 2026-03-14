import type { BuilderBlock } from "./shared/api.js";

function isStandardTextBlock(block: any): boolean {
  if (block.component?.name !== "Text") return false;
  const styles = block.responsiveStyles?.large;
  if (!styles) return false;
  const keys = Object.keys(styles);
  return keys.length === 1 && keys[0] === "marginTop" && styles.marginTop === "20px";
}

const blocks = [
  { component: { name: "Text", options: { text: "<p>1</p>" } }, responsiveStyles: { large: { marginTop: "20px" } } },
  { component: { name: "Text", options: { text: "<h2>2</h2>" } }, responsiveStyles: { large: { marginTop: "20px" } } },
  { component: { name: "Image" } },
  { component: { name: "Text", options: { text: "<p>3</p>" } }, responsiveStyles: { large: { marginTop: "20px" } } },
  { component: { name: "Text", options: { text: "<blockquote>4</blockquote>" } }, responsiveStyles: { large: { marginTop: "20px", paddingLeft: "10px" } } },
  { component: { name: "Text", options: { text: "<p>5</p>" } }, responsiveStyles: { large: { marginTop: "20px" } } },
];

const finalBlocks: any[] = [];
for (const block of blocks) {
  if (block.component?.name === "Text" && isStandardTextBlock(block)) {
    const lastBlock = finalBlocks[finalBlocks.length - 1];
    if (lastBlock && lastBlock.component?.name === "Text" && isStandardTextBlock(lastBlock)) {
      lastBlock.component.options.text += "\n" + block.component.options.text;
      continue;
    }
  }
  finalBlocks.push(block);
}

console.log(JSON.stringify(finalBlocks, null, 2));
