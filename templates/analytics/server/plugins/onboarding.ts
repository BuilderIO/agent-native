
import { registerFileUploadProvider } from "@agent-native/core/file-upload";
import { createOnboardingPlugin } from "@agent-native/core/onboarding";

import { s3FileUploadProvider } from "../lib/s3-upload-provider.js";

const basePlugin = createOnboardingPlugin();

export default async (nitroApp: any): Promise<void> => {
  await basePlugin(nitroApp);

  registerFileUploadProvider(s3FileUploadProvider);
};
