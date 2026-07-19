#!/usr/bin/env node

import { runPrivateVaultRecoverCli } from "./private-vault-recover.js";

process.exitCode = await runPrivateVaultRecoverCli();
