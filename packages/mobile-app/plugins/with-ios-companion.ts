import {
  IOSConfig,
  type ConfigPlugin,
  createRunOncePlugin,
  withXcodeProject,
} from "expo/config-plugins";

declare const require: (specifier: string) => unknown;

const fileSystem = require("node:fs/promises") as {
  mkdir(path: string, options: { recursive: true }): Promise<unknown>;
  readFile(path: string, encoding: "utf8"): Promise<string>;
  writeFile(path: string, contents: string): Promise<void>;
};

const SOURCE_FILENAMES = [
  "AgentNativeIOSCompanion.swift",
  "AgentNativeIOSCompanionBridge.m",
] as const;

const withIosCompanion: ConfigPlugin = (config) =>
  withXcodeProject(config, async (xcodeConfig) => {
    const projectRoot = xcodeConfig.modRequest.projectRoot;
    const projectName = IOSConfig.XcodeUtils.getProjectName(projectRoot);
    const sourceDirectory = `${xcodeConfig.modRequest.platformProjectRoot}/${projectName}`;
    const appTarget = IOSConfig.XcodeUtils.getApplicationNativeTarget({
      project: xcodeConfig.modResults,
      projectName,
    });

    await fileSystem.mkdir(sourceDirectory, { recursive: true });
    for (const filename of SOURCE_FILENAMES) {
      const source = await fileSystem.readFile(
        `${projectRoot}/native/ios/${filename}`,
        "utf8",
      );
      await fileSystem.writeFile(`${sourceDirectory}/${filename}`, source);
      xcodeConfig.modResults = IOSConfig.XcodeUtils.addBuildSourceFileToGroup({
        filepath: `${projectName}/${filename}`,
        groupName: projectName,
        project: xcodeConfig.modResults,
        targetUuid: appTarget.uuid,
      });
    }

    return xcodeConfig;
  });

export default createRunOncePlugin(
  withIosCompanion,
  "with-ios-companion",
  "1.0.0",
);
