import ActivityKit
import AppIntents
import SwiftUI
import WidgetKit

private let captureAccent = Color(red: 0.78, green: 0.95, blue: 0.42)

private struct CaptureQuickActionsEntry: TimelineEntry {
  let date: Date
}

private struct CaptureQuickActionsProvider: TimelineProvider {
  func placeholder(in context: Context) -> CaptureQuickActionsEntry {
    CaptureQuickActionsEntry(date: Date())
  }

  func getSnapshot(
    in context: Context,
    completion: @escaping (CaptureQuickActionsEntry) -> Void
  ) {
    completion(CaptureQuickActionsEntry(date: Date()))
  }

  func getTimeline(
    in context: Context,
    completion: @escaping (Timeline<CaptureQuickActionsEntry>) -> Void
  ) {
    completion(
      Timeline(
        entries: [CaptureQuickActionsEntry(date: Date())],
        policy: .never
      )
    )
  }
}

private struct CaptureLink: View {
  let label: String
  let systemImage: String
  let url: String

  var body: some View {
    Link(destination: URL(string: url)!) {
      VStack(spacing: 7) {
        Image(systemName: systemImage)
          .font(.title3.weight(.semibold))
        Text(label)
          .font(.caption2.weight(.semibold))
      }
      .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
    .accessibilityLabel(label)
  }
}

private struct CaptureQuickActionsView: View {
  var body: some View {
    HStack(spacing: 4) {
      CaptureLink(
        label: "Dictate",
        systemImage: "waveform",
        url: "agentnative://capture/dictate"
      )
      CaptureLink(
        label: "Meeting",
        systemImage: "mic",
        url: "agentnative://capture/audio"
      )
      CaptureLink(
        label: "Video",
        systemImage: "video",
        url: "agentnative://capture/video"
      )
    }
    .tint(captureAccent)
    .containerBackground(for: .widget) {
      Color(red: 0.09, green: 0.09, blue: 0.11)
    }
  }
}

struct AgentNativeCaptureWidget: Widget {
  let kind = "AgentNativeCaptureWidget"

  var body: some WidgetConfiguration {
    StaticConfiguration(
      kind: kind,
      provider: CaptureQuickActionsProvider()
    ) { _ in
      CaptureQuickActionsView()
    }
    .configurationDisplayName("Quick Capture")
    .description("Prepare dictation, meeting audio, or video in one tap.")
    .supportedFamilies([.systemMedium, .accessoryRectangular])
  }
}

@available(iOS 16.1, *)
struct AgentNativeCaptureLiveActivity: Widget {
  var body: some WidgetConfiguration {
    ActivityConfiguration(for: AgentNativeCaptureAttributes.self) { context in
      HStack(spacing: 14) {
        Image(systemName: context.attributes.kind == "video" ? "video.fill" : "waveform")
          .foregroundStyle(captureAccent)
          .font(.title2)
        VStack(alignment: .leading, spacing: 3) {
          Text(context.attributes.kind == "video" ? "Capturing video" : "Recording")
            .font(.headline)
          Text(timerInterval: context.state.startedAt...Date.distantFuture, countsDown: false)
            .font(.caption.monospacedDigit())
            .foregroundStyle(.secondary)
        }
        Spacer()
        Button(intent: StopAgentNativeCaptureIntent(captureId: context.attributes.captureId)) {
          Label("Stop", systemImage: "stop.fill")
            .labelStyle(.iconOnly)
        }
        .buttonStyle(.borderedProminent)
        .tint(.red)
        .accessibilityLabel("Stop recording")
      }
      .padding()
      .activityBackgroundTint(Color(red: 0.07, green: 0.07, blue: 0.08))
      .activitySystemActionForegroundColor(.white)
      .widgetURL(URL(string: "agentnative://capture/\(context.attributes.kind == "video" ? "video" : "audio")"))
    } dynamicIsland: { context in
      DynamicIsland {
        DynamicIslandExpandedRegion(.leading) {
          Image(systemName: context.attributes.kind == "video" ? "video.fill" : "waveform")
            .foregroundStyle(captureAccent)
        }
        DynamicIslandExpandedRegion(.center) {
          Text(timerInterval: context.state.startedAt...Date.distantFuture, countsDown: false)
            .font(.headline.monospacedDigit())
        }
        DynamicIslandExpandedRegion(.trailing) {
          Button(intent: StopAgentNativeCaptureIntent(captureId: context.attributes.captureId)) {
            Image(systemName: "stop.fill")
              .foregroundStyle(.red)
          }
          .accessibilityLabel("Stop recording")
        }
        DynamicIslandExpandedRegion(.bottom) {
          Text("Agent Native capture is active")
            .font(.caption)
            .foregroundStyle(.secondary)
        }
      } compactLeading: {
        Image(systemName: "waveform")
          .foregroundStyle(captureAccent)
      } compactTrailing: {
        Text(timerInterval: context.state.startedAt...Date.distantFuture, countsDown: false)
          .font(.caption2.monospacedDigit())
          .foregroundStyle(captureAccent)
      } minimal: {
        Image(systemName: "waveform")
          .foregroundStyle(captureAccent)
      }
      .widgetURL(URL(string: "agentnative://capture/\(context.attributes.kind == "video" ? "video" : "audio")"))
    }
  }
}

@available(iOS 18.0, *)
struct AgentNativeDictationControl: ControlWidget {
  static let kind = "com.agentnative.mobile.control.dictate"

  var body: some ControlWidgetConfiguration {
    StaticControlConfiguration(kind: Self.kind) {
      ControlWidgetButton(action: OpenAgentNativeDictationControlIntent()) {
        Label("Dictate", systemImage: "waveform")
      }
    }
    .displayName("Dictate")
    .description("Prepare an Agent Native dictation.")
  }
}

@available(iOS 18.0, *)
struct AgentNativeAudioControl: ControlWidget {
  static let kind = "com.agentnative.mobile.control.audio"

  var body: some ControlWidgetConfiguration {
    StaticControlConfiguration(kind: Self.kind) {
      ControlWidgetButton(action: OpenAgentNativeAudioControlIntent()) {
        Label("Record Audio", systemImage: "mic")
      }
    }
    .displayName("Record Audio")
    .description("Prepare an Agent Native audio recording.")
  }
}

@available(iOS 18.0, *)
struct AgentNativeVideoControl: ControlWidget {
  static let kind = "com.agentnative.mobile.control.video"

  var body: some ControlWidgetConfiguration {
    StaticControlConfiguration(kind: Self.kind) {
      ControlWidgetButton(action: OpenAgentNativeVideoControlIntent()) {
        Label("Capture Video", systemImage: "video")
      }
    }
    .displayName("Capture Video")
    .description("Prepare an Agent Native video capture.")
  }
}

@main
struct AgentNativeWidgetsBundle: WidgetBundle {
  @WidgetBundleBuilder
  var body: some Widget {
    AgentNativeCaptureWidget()
    AgentNativeCaptureLiveActivity()
    if #available(iOS 18.0, *) {
      AgentNativeDictationControl()
      AgentNativeAudioControl()
      AgentNativeVideoControl()
    }
  }
}
