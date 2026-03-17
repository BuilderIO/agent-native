#!/usr/bin/env node
// @agent-native/pinpoint — CLI for project setup
// MIT License
//
// Usage: npx @agent-native/pinpoint init

import { existsSync, mkdirSync, cpSync, readdirSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const command = process.argv[2];

if (command === "init") {
  init();
} else {
  console.log("Usage: npx @agent-native/pinpoint init");
  console.log("");
  console.log("Commands:");
  console.log("  init    Copy agent scripts and skill to your project");
  process.exit(0);
}

function init() {
  const projectRoot = process.cwd();

  // 1. Copy agent scripts to scripts/
  const scriptsSource = resolve(__dirname, "../src/scripts");
  const scriptsDest = resolve(projectRoot, "scripts");

  if (!existsSync(scriptsDest)) {
    mkdirSync(scriptsDest, { recursive: true });
  }

  const scriptFiles = readdirSync(scriptsSource).filter((f) =>
    f.endsWith(".ts"),
  );
  let copiedScripts = 0;

  for (const file of scriptFiles) {
    const dest = join(scriptsDest, file);
    if (existsSync(dest)) {
      console.log(`  skip  scripts/${file} (already exists)`);
    } else {
      cpSync(join(scriptsSource, file), dest);
      console.log(`  added scripts/${file}`);
      copiedScripts++;
    }
  }

  // 2. Copy agent skill if .agents/ directory pattern exists
  const skillSource = resolve(__dirname, "../.agents/skills/pinpoint");
  const skillDest = resolve(projectRoot, ".agents/skills/pinpoint");

  if (existsSync(skillSource)) {
    if (!existsSync(skillDest)) {
      mkdirSync(skillDest, { recursive: true });
    }
    const skillFile = join(skillSource, "SKILL.md");
    const skillDestFile = join(skillDest, "SKILL.md");
    if (existsSync(skillFile)) {
      if (existsSync(skillDestFile)) {
        console.log(
          "  skip  .agents/skills/pinpoint/SKILL.md (already exists)",
        );
      } else {
        cpSync(skillFile, skillDestFile);
        console.log("  added .agents/skills/pinpoint/SKILL.md");
      }
    }
  }

  console.log("");
  console.log(
    copiedScripts > 0
      ? "Pinpoint initialized. Agent scripts are in scripts/."
      : "Pinpoint already initialized. No new files copied.",
  );
  console.log("");
  console.log("Next steps:");
  console.log(
    "  1. Add <Pinpoint /> to your client:  import { Pinpoint } from '@agent-native/pinpoint/react'",
  );
  console.log(
    '  2. Add middleware to your server:     app.use("/api/pins", pagePinRoutes())',
  );
}
