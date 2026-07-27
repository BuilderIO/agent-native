#!/usr/bin/env tsx
import { runSyncStarterManifestCli } from "../packages/core/src/cli/sync-builder-starter-manifest.js";

process.exit(runSyncStarterManifestCli(process.argv.slice(2)));
