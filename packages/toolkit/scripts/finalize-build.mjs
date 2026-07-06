// tsgo compiles TypeScript only; it does not emit non-TS assets. Copy the CSS
// entrypoint(s) from src into dist so the published package ships them, mirroring
// @agent-native/core's finalize-build step.
import { copyFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

for (const name of readdirSync("src")) {
  if (name.endsWith(".css")) {
    copyFileSync(join("src", name), join("dist", name));
  }
}
