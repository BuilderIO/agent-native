/**
 * CLI bootstrap: `agent-native action` and `agent-native agent` mount no Nitro
 * plugins, so the provider this template registers in `server/plugins/
 * onboarding.ts` never reaches them. Registering it here is what makes this
 * template's own storage rules — not the framework provider's stricter ones —
 * serve its CLI runs.
 */

import { registerFileUploadProvider } from "@agent-native/core/file-upload";

import { s3FileUploadProvider } from "../server/lib/s3-upload-provider.js";

registerFileUploadProvider(s3FileUploadProvider);
