import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const bundlePath = resolve("dist/assets/capture-page.js");
const bundle = await readFile(bundlePath, "utf8");

if (/^\s*(?:import|export)\b/m.test(bundle)) {
  throw new Error(
    `${bundlePath} still contains module syntax and cannot be injected by chrome.scripting.executeScript.`,
  );
}

if (!bundle.includes("agent-native.capture-result.v1")) {
  throw new Error(
    `${bundlePath} is missing the capture result message contract.`,
  );
}
