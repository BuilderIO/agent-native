import { markdownToBuilder } from "./client/lib/markdown-to-builder.js";
import { builderToMarkdown } from "./client/lib/builder-to-markdown.js";

// Mock Image
(global as any).Image = class Image {
  onload: any = null;
  onerror: any = null;
  src = "";
  naturalWidth = 800;
  naturalHeight = 600;
  constructor() {
    setTimeout(() => {
      if (this.onload) this.onload();
    }, 10);
  }
};

async function test() {
  const pullHtml = "<em>Hey! <code>[repo]</code> locally</em>";
  console.log("If Builder JSON had single em:", pullHtml);
  const pull2 = builderToMarkdown([
    {
      "@type": "@builder.io/sdk:Element",
      id: "1",
      component: { name: "Text", options: { text: pullHtml } },
      responsiveStyles: {},
    },
  ]);
  console.log("BuilderToMarkdown splits it to MD:", pull2);
  const push2 = await markdownToBuilder(pull2);
  console.log(
    "And markdownToBuilder converts that MD to HTML:",
    push2.blocks[0].component.options.text,
  );
}
test();
