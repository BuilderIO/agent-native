import { markdownToBuilder } from "./client/lib/markdown-to-builder.js";
import { builderToMarkdown } from "./client/lib/builder-to-markdown.js";

// Mock Image
global.Image = class Image {
  onload = null; onerror = null; src = ""; naturalWidth = 800; naturalHeight = 600;
  constructor() { setTimeout(() => { if (this.onload) this.onload(); }, 10); }
};

async function test() {
  const md = "*Hey!* `[repo]` *locally*";
  const push = await markdownToBuilder(md);
  console.log("Push HTML:", push.blocks[0].component.options.text);
  
  const pull = builderToMarkdown(push.blocks);
  console.log("Pull MD:", pull);

  const pullHtml = "<em>Hey! <code>[repo]</code> locally</em>";
  console.log("If Builder had single em:", pullHtml);
  const pull2 = builderToMarkdown([{ component: { name: "Text", options: { text: pullHtml } } }]);
  console.log("BuilderToMarkdown splits it to:", pull2);
  const push2 = await markdownToBuilder(pull2);
  console.log("And Push again gives:", push2.blocks[0].component.options.text);
}
test();
