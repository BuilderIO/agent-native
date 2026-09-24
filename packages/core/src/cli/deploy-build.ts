import fs from "fs";
import path from "path";

export interface DeployPostBuildInvocation {
  command: string;
  args: string[];
  scriptPath: string;
}

export function hasDeployPreset(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.NITRO_PRESET?.trim());
}

export function resolveDeployPostBuildInvocation({
  cliDir,
  env = process.env,
  findTsxBin,
}: {
  cliDir: string;
  env?: NodeJS.ProcessEnv;
  findTsxBin: () => string;
}): DeployPostBuildInvocation | undefined {
  const builtDeployBuild = path.resolve(cliDir, "../deploy/build.js");
  if (fs.existsSync(builtDeployBuild)) {
    return {
      command: "node",
      args: [builtDeployBuild],
      scriptPath: builtDeployBuild,
    };
  }

  const sourceDeployBuild = path.resolve(cliDir, "../deploy/build.ts");
  if (fs.existsSync(sourceDeployBuild)) {
    return {
      command: findTsxBin(),
      args: [sourceDeployBuild],
      scriptPath: sourceDeployBuild,
    };
  }

  if (hasDeployPreset(env)) {
    throw new Error(
      `[build] Deploy build script not found. Expected ${builtDeployBuild} ` +
        `or ${sourceDeployBuild}; refusing to publish an incomplete ` +
        `NITRO_PRESET=${env.NITRO_PRESET} build.`,
    );
  }

  return undefined;
}
