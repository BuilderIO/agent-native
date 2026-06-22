import { access } from "node:fs/promises";
import { resolve } from "node:path";

const distDir = resolve(import.meta.dirname, "../dist");

await access(resolve(distDir, "manifest.json"));
console.log(`Chrome extension build is ready at ${distDir}`);
