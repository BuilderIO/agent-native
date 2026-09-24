import AVFoundation
import SwiftUI
import WatchConnectivity

@MainActor
final class WatchCaptureController: NSObject, ObservableObject, WCSessionDelegate {
  @Published private(set) var isRecording = false
  @Published private(set) var elapsedSeconds = 0
  @Published private(set) var pendingTransfers = 0
  @Published private(set) var message = "Ready"

  private var recorder: AVAudioRecorder?
  private var startedAt: Date?
  private var timer: Timer?
  private let pendingDirectory: URL

  override init() {
    pendingDirectory = FileManager.default.urls(
      for: .documentDirectory,
      in: .userDomainMask
    )[0].appendingPathComponent("pending-captures", isDirectory: true)
    super.init()
    try? FileManager.default.createDirectory(
      at: pendingDirectory,
      withIntermediateDirectories: true
    )
    if WCSession.isSupported() {
      WCSession.default.delegate = self
      WCSession.default.activate()
    }
    refreshPendingTransfers()
  }

  func toggleRecording() {
    if isRecording {
      finishRecording()
    } else {
      startRecording()
    }
  }

  private func startRecording() {
    AVAudioApplication.requestRecordPermission { [weak self] granted in
      Task { @MainActor in
        guard let self else {
          return
        }
        guard granted else {
          self.message = "Microphone access is required"
          return
        }
        do {
          let session = AVAudioSession.sharedInstance()
          try session.setCategory(.record, mode: .spokenAudio)
          try session.setActive(true)
          let id = UUID().uuidString.lowercased()
          let url = self.pendingDirectory.appendingPathComponent("\(id).m4a")
          let recorder = try AVAudioRecorder(
            url: url,
            settings: [
              AVFormatIDKey: kAudioFormatMPEG4AAC,
              AVSampleRateKey: 44_100,
              AVNumberOfChannelsKey: 1,
              AVEncoderAudioQualityKey: AVAudioQuality.high.rawValue,
            ]
          )
          guard recorder.record() else {
            throw NSError(
              domain: "AgentNativeWatch",
              code: 1,
              userInfo: [NSLocalizedDescriptionKey: "Recording could not start."]
            )
          }
          self.recorder = recorder
          self.startedAt = Date()
          self.elapsedSeconds = 0
          self.isRecording = true
          self.message = "Recording"
          self.timer = Timer.scheduledTimer(
            withTimeInterval: 1,
            repeats: true
          ) { [weak self] _ in
            Task { @MainActor in
              guard let self, let startedAt = self.startedAt else {
                return
              }
              self.elapsedSeconds = Int(Date().timeIntervalSince(startedAt))
            }
          }
        } catch {
          self.message = "Could not start recording"
        }
      }
    }
  }

  private func finishRecording() {
    guard let recorder else {
      return
    }
    recorder.stop()
    timer?.invalidate()
    timer = nil
    self.recorder = nil
    isRecording = false
    message = "Saved — syncing to iPhone"
    let capturedAt = startedAt ?? Date()
    startedAt = nil
    queueTransfer(
      fileURL: recorder.url,
      capturedAt: capturedAt,
      durationMs: elapsedSeconds * 1_000
    )
    try? AVAudioSession.sharedInstance().setActive(false)
    refreshPendingTransfers()
  }

  private func queueTransfer(
    fileURL: URL,
    capturedAt: Date,
    durationMs: Int
  ) {
    guard WCSession.isSupported() else {
      return
    }
    WCSession.default.transferFile(
      fileURL,
      metadata: [
        "captureId": fileURL.deletingPathExtension().lastPathComponent,
        "capturedAt": ISO8601DateFormatter().string(from: capturedAt),
        "durationMs": durationMs,
        "kind": "audio",
        "mimeType": "audio/mp4",
        "title": "Watch audio note",
      ]
    )
  }

  private func retryPendingTransfers() {
    let pending = (try? FileManager.default.contentsOfDirectory(
      at: pendingDirectory,
      includingPropertiesForKeys: nil
    )) ?? []
    let alreadyQueued = Set(
      WCSession.default.outstandingFileTransfers.map {
        $0.file.fileURL.lastPathComponent
      }
    )
    for file in pending where file.pathExtension == "m4a" {
      if !alreadyQueued.contains(file.lastPathComponent) {
        queueTransfer(fileURL: file, capturedAt: Date(), durationMs: 0)
      }
    }
    refreshPendingTransfers()
  }

  private func refreshPendingTransfers() {
    let pending = (try? FileManager.default.contentsOfDirectory(
      at: pendingDirectory,
      includingPropertiesForKeys: nil
    )) ?? []
    pendingTransfers = pending.filter { $0.pathExtension == "m4a" }.count
  }

  nonisolated func session(
    _ session: WCSession,
    activationDidCompleteWith activationState: WCSessionActivationState,
    error: Error?
  ) {
    Task { @MainActor in
      if activationState == .activated {
        self.retryPendingTransfers()
      }
    }
  }

  nonisolated func session(
    _ session: WCSession,
    didFinish fileTransfer: WCSessionFileTransfer,
    error: Error?
  ) {
    guard error == nil else {
      return
    }
    try? FileManager.default.removeItem(at: fileTransfer.file.fileURL)
    Task { @MainActor in
      self.refreshPendingTransfers()
      self.message = "Synced to iPhone"
    }
  }
}

struct ContentView: View {
  @StateObject private var capture = WatchCaptureController()

  var body: some View {
    VStack(spacing: 12) {
      Image(systemName: capture.isRecording ? "waveform.circle.fill" : "mic.circle.fill")
        .font(.system(size: 42))
        .foregroundStyle(capture.isRecording ? .red : Color.green)
      Text(capture.isRecording ? duration(capture.elapsedSeconds) : capture.message)
        .font(capture.isRecording ? .title3.monospacedDigit() : .caption)
        .multilineTextAlignment(.center)
      Button(capture.isRecording ? "Stop" : "Record") {
        capture.toggleRecording()
      }
      .buttonStyle(.borderedProminent)
      .tint(capture.isRecording ? .red : .green)
      if capture.pendingTransfers > 0 {
        Text("\(capture.pendingTransfers) waiting to sync")
          .font(.caption2)
          .foregroundStyle(.secondary)
      }
    }
  }

  private func duration(_ seconds: Int) -> String {
    String(format: "%02d:%02d", seconds / 60, seconds % 60)
  }
}

@main
struct AgentNativeWatchApp: App {
  var body: some Scene {
    WindowGroup {
      ContentView()
    }
  }
}
