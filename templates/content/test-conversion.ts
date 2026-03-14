import { markdownToBuilder } from "./client/lib/markdown-to-builder.js";
// polyfill Image
global.Image = class Image {
  onload: any;
  onerror: any;
  src: string;
  naturalWidth: number = 800;
  naturalHeight: number = 600;
  constructor() {
    setTimeout(() => { if (this.onload) this.onload(); }, 10);
  }
} as any;

const md = "# Hello\n\n![img](test.jpg)";
markdownToBuilder(md).then(console.log).catch(console.error);
