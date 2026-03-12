#!/usr/bin/env tsx
/**
 * Script dispatcher — runs any script in the scripts/ folder.
 * Usage: pnpm script <script-name> [--args]
 */

import { runScript } from "agentnative/scripts";

runScript();
