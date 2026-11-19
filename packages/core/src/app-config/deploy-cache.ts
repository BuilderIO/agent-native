import { z } from "zod";

export const deployCacheConfig = z.object({
  enabled: z.boolean().default(true).meta({
    env: "AGENT_NATIVE_DEPLOY_CACHE",
    doc: "Reuse an app's previous build output in workspace deploys when none of its inputs changed. Set false to rebuild every app.",
  }),
  dir: z.string().min(1).optional().meta({
    env: "AGENT_NATIVE_DEPLOY_CACHE_DIR",
    doc: "Directory holding the workspace deploy build cache. Defaults to node_modules/.cache/agent-native/deploy-build under the workspace root.",
  }),
  verifySample: z.number().int().min(0).default(0).meta({
    env: "AGENT_NATIVE_DEPLOY_CACHE_VERIFY",
    doc: "Rebuild this many cached apps per deploy and fail if the rebuilt output differs from the cached output. 0 disables verification.",
  }),
  envIgnore: z.array(z.string().min(1)).default([]).meta({
    env: "AGENT_NATIVE_DEPLOY_CACHE_ENV_IGNORE",
    doc: "Comma-separated environment variable names (a trailing `*` matches a prefix) left out of the build cache key because they never reach a build output.",
  }),
  onlyApps: z.array(z.string().min(1)).optional().meta({
    env: "AGENT_NATIVE_DEPLOY_ONLY_APPS",
    doc: "Comma-separated app ids for one leg of a split workspace deploy: only these apps are built, each records its build id, and packaging is skipped. Cannot be combined with prebuiltApps.",
  }),
  prebuiltApps: z.array(z.string().min(1)).optional().meta({
    env: "AGENT_NATIVE_DEPLOY_PREBUILT_APPS",
    doc: "Comma-separated app ids whose build output a split leg already put back into the app directory. The deploy packages them with their recorded build id instead of rebuilding them.",
  }),
});
