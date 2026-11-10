import {
  BuilderCredentialLookupError,
  resolveHasBuilderGatewayCredential,
} from "@agent-native/core/server";

/** "unknown" means the credential store could not be read, which is not the same as having no credential. */
export type CloudTranscriptionAccess = "available" | "unavailable" | "unknown";

export async function resolveCloudTranscriptionAccess(): Promise<CloudTranscriptionAccess> {
  try {
    return (await resolveHasBuilderGatewayCredential())
      ? "available"
      : "unavailable";
  } catch (error) {
    if (!(error instanceof BuilderCredentialLookupError)) throw error;
    return "unknown";
  }
}
