import {
  IOSConfig,
  type ConfigPlugin,
  createRunOncePlugin,
  withXcodeProject,
} from "expo/config-plugins";

declare const require: (specifier: string) => unknown;

const fileSystem = require("node:fs/promises") as {
  mkdir(path: string, options: { recursive: true }): Promise<unknown>;
  writeFile(path: string, contents: string): Promise<void>;
};

const SWIFT_FILENAME = "AgentNativeAppIntents.swift";

const SWIFT_SOURCE = `import AppIntents
import UIKit

@available(iOS 16.0, *)
private enum AgentNativeAppIntentLink {
  @MainActor
  static func open(_ value: String) {
    guard let url = URL(string: value) else {
      return
    }
    UIApplication.shared.open(url, options: [:], completionHandler: nil)
  }
}

@available(iOS 16.0, *)
struct StartAgentNativeDictationIntent: AppIntent {
  static let title: LocalizedStringResource = "Start Dictation"
  static let description = IntentDescription("Open Agent Native and start dictating.")
  static let openAppWhenRun = true

  @MainActor
  func perform() async throws -> some IntentResult {
    AgentNativeAppIntentLink.open("agentnative://capture/dictate")
    return .result()
  }
}

@available(iOS 16.0, *)
struct RecordAgentNativeAudioIntent: AppIntent {
  static let title: LocalizedStringResource = "Record Audio"
  static let description = IntentDescription("Open Agent Native and start an audio recording.")
  static let openAppWhenRun = true

  @MainActor
  func perform() async throws -> some IntentResult {
    AgentNativeAppIntentLink.open("agentnative://capture/audio")
    return .result()
  }
}

@available(iOS 16.0, *)
struct CaptureAgentNativeVideoIntent: AppIntent {
  static let title: LocalizedStringResource = "Capture Video"
  static let description = IntentDescription("Open Agent Native and start a video capture.")
  static let openAppWhenRun = true

  @MainActor
  func perform() async throws -> some IntentResult {
    AgentNativeAppIntentLink.open("agentnative://capture/video")
    return .result()
  }
}

@available(iOS 16.0, *)
struct OpenAgentNativeClipsIntent: AppIntent {
  static let title: LocalizedStringResource = "Open Clips"
  static let description = IntentDescription("Open Clips in Agent Native.")
  static let openAppWhenRun = true

  @MainActor
  func perform() async throws -> some IntentResult {
    AgentNativeAppIntentLink.open("agentnative://clips")
    return .result()
  }
}

@available(iOS 16.0, *)
struct AgentNativeAppShortcuts: AppShortcutsProvider {
  static var appShortcuts: [AppShortcut] {
    AppShortcut(
      intent: StartAgentNativeDictationIntent(),
      phrases: [
        "Dictate with \\(.applicationName)",
        "Start dictation in \\(.applicationName)",
      ],
      shortTitle: "Start Dictation",
      systemImageName: "waveform"
    )
    AppShortcut(
      intent: RecordAgentNativeAudioIntent(),
      phrases: [
        "Record audio with \\(.applicationName)",
        "Start an audio recording in \\(.applicationName)",
      ],
      shortTitle: "Record Audio",
      systemImageName: "mic"
    )
    AppShortcut(
      intent: CaptureAgentNativeVideoIntent(),
      phrases: [
        "Capture video with \\(.applicationName)",
        "Start a video in \\(.applicationName)",
      ],
      shortTitle: "Capture Video",
      systemImageName: "video"
    )
    AppShortcut(
      intent: OpenAgentNativeClipsIntent(),
      phrases: [
        "Open Clips in \\(.applicationName)",
        "Show Clips in \\(.applicationName)",
      ],
      shortTitle: "Open Clips",
      systemImageName: "play.rectangle"
    )
  }
}
`;

const withIosAppIntents: ConfigPlugin = (config) =>
  withXcodeProject(config, async (xcodeConfig) => {
    const projectRoot = xcodeConfig.modRequest.projectRoot;
    const projectName = IOSConfig.XcodeUtils.getProjectName(projectRoot);
    const sourceDirectory = `${xcodeConfig.modRequest.platformProjectRoot}/${projectName}`;
    const sourcePath = `${sourceDirectory}/${SWIFT_FILENAME}`;
    const appTarget = IOSConfig.XcodeUtils.getApplicationNativeTarget({
      project: xcodeConfig.modResults,
      projectName,
    });

    await fileSystem.mkdir(sourceDirectory, { recursive: true });
    await fileSystem.writeFile(sourcePath, SWIFT_SOURCE);

    xcodeConfig.modResults = IOSConfig.XcodeUtils.addBuildSourceFileToGroup({
      filepath: SWIFT_FILENAME,
      groupName: projectName,
      project: xcodeConfig.modResults,
      targetUuid: appTarget.uuid,
    });

    return xcodeConfig;
  });

export default createRunOncePlugin(
  withIosAppIntents,
  "with-ios-app-intents",
  "1.0.0",
);
