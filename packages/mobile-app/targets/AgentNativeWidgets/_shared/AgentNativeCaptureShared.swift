import ActivityKit
import AppIntents
import Foundation

let agentNativeAppGroup = "group.com.agentnative.mobile"
let agentNativeCaptureStopNotification = Notification.Name(
  "AgentNativeCaptureStopRequested"
)

@available(iOS 16.1, *)
struct AgentNativeCaptureAttributes: ActivityAttributes {
  struct ContentState: Codable, Hashable {
    let phase: String
    let startedAt: Date
  }

  let captureId: String
  let kind: String
}

@available(iOS 17.0, *)
struct StopAgentNativeCaptureIntent: LiveActivityIntent {
  static let title: LocalizedStringResource = "Stop Capture"
  static let description = IntentDescription(
    "Stop the active Agent Native recording."
  )

  @Parameter(title: "Capture ID")
  var captureId: String

  init() {}

  init(captureId: String) {
    self.captureId = captureId
  }

  func perform() async throws -> some IntentResult {
    NotificationCenter.default.post(
      name: agentNativeCaptureStopNotification,
      object: nil,
      userInfo: ["captureId": captureId]
    )
    return .result()
  }
}

@available(iOS 18.0, *)
struct OpenAgentNativeDictationControlIntent: ControlConfigurationIntent {
  static let title: LocalizedStringResource = "Dictate"
  static let description = IntentDescription("Prepare a new dictation.")
  static let openAppWhenRun = true

  func perform() async throws -> some IntentResult & OpensIntent {
    .result(
      opensIntent: OpenURLIntent(URL(string: "agentnative://capture/dictate")!)
    )
  }
}

@available(iOS 18.0, *)
struct OpenAgentNativeAudioControlIntent: ControlConfigurationIntent {
  static let title: LocalizedStringResource = "Record Audio"
  static let description = IntentDescription("Prepare a new audio recording.")
  static let openAppWhenRun = true

  func perform() async throws -> some IntentResult & OpensIntent {
    .result(
      opensIntent: OpenURLIntent(URL(string: "agentnative://capture/audio")!)
    )
  }
}

@available(iOS 18.0, *)
struct OpenAgentNativeVideoControlIntent: ControlConfigurationIntent {
  static let title: LocalizedStringResource = "Capture Video"
  static let description = IntentDescription("Prepare a new video capture.")
  static let openAppWhenRun = true

  func perform() async throws -> some IntentResult & OpensIntent {
    .result(
      opensIntent: OpenURLIntent(URL(string: "agentnative://capture/video")!)
    )
  }
}
