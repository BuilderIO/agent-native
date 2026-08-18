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

const DEV_CAPTURE_SOURCE_FILENAME = "AgentNativeCaptureShared.swift";

const withIosCompanion: ConfigPlugin = (config) =>
  withXcodeProject(config, async (xcodeConfig) => {
    const projectRoot = xcodeConfig.modRequest.projectRoot;
    const projectName = IOSConfig.XcodeUtils.getProjectName(projectRoot);
    const sourceDirectory = `${xcodeConfig.modRequest.platformProjectRoot}/${projectName}`;
    const appTarget = IOSConfig.XcodeUtils.getApplicationNativeTarget({
      project: xcodeConfig.modResults,
      projectName,
    });
    const sourceFiles = [
      ...SOURCE_FILENAMES.map((filename) => ({
        filename,
        sourcePath: `${projectRoot}/native/ios/${filename}`,
      })),
      ...(process.env.AGENT_NATIVE_MOBILE_DISABLE_APP_EXTENSIONS === "1"
        ? [
            {
              filename: DEV_CAPTURE_SOURCE_FILENAME,
              sourcePath: `${projectRoot}/targets/AgentNativeWidgets/_shared/${DEV_CAPTURE_SOURCE_FILENAME}`,
            },
          ]
        : []),
    ];

    await fileSystem.mkdir(sourceDirectory, { recursive: true });
    for (const { filename, sourcePath } of sourceFiles) {
      const source = await fileSystem.readFile(sourcePath, "utf8");
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
