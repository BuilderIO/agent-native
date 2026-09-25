import AVFoundation
import CoreMedia
import Foundation
import ReplayKit

private struct ReplayKitCaptureManifest: Codable {
  let captureId: String
  let capturedAt: String
  let durationMs: Int
  let fileName: String
  let kind: String
  let mimeType: String
  let status: String
  let title: String
  let updatedAt: String
}

final class SampleHandler: RPBroadcastSampleHandler {
  private let appGroup = "group.com.agentnative.mobile"
  private var writer: AVAssetWriter?
  private var videoInput: AVAssetWriterInput?
  private var appAudioInput: AVAssetWriterInput?
  private var microphoneInput: AVAssetWriterInput?
  private var outputURL: URL?
  private var manifestURL: URL?
  private var captureId = ""
  private var capturedAt = Date()
  private var startedSession = false
  private var sessionStartSeconds: Double?
  private var latestSampleEndSeconds: Double?
  private var lastManifestDurationMs = 0
  private var terminalError: Error?

  override func broadcastStarted(withSetupInfo setupInfo: [String: NSObject]?) {
    captureId = UUID().uuidString.lowercased()
    capturedAt = Date()
    guard let container = FileManager.default.containerURL(
      forSecurityApplicationGroupIdentifier: appGroup
    ) else {
      finishBroadcastWithError(
        NSError(
          domain: "AgentNativeBroadcast",
          code: 1,
          userInfo: [NSLocalizedDescriptionKey: "Shared capture storage is unavailable."]
        )
      )
      return
    }

    let directory = container.appendingPathComponent("captures", isDirectory: true)
    do {
      try FileManager.default.createDirectory(
        at: directory,
        withIntermediateDirectories: true
      )
      let url = directory.appendingPathComponent("\(captureId).mp4")
      outputURL = url
      manifestURL = url.deletingPathExtension().appendingPathExtension("json")
      writer = try AVAssetWriter(outputURL: url, fileType: .mp4)
      try writeManifest(status: "recording", durationMs: 0)
    } catch {
      finishBroadcastWithError(error)
    }
  }

  override func processSampleBuffer(
    _ sampleBuffer: CMSampleBuffer,
    with sampleBufferType: RPSampleBufferType
  ) {
    guard CMSampleBufferDataIsReady(sampleBuffer), terminalError == nil else {
      return
    }
    do {
      switch sampleBufferType {
      case .video:
        try appendVideo(sampleBuffer)
      case .audioApp:
        try appendAudio(sampleBuffer, microphone: false)
      case .audioMic:
        try appendAudio(sampleBuffer, microphone: true)
      @unknown default:
        break
      }
    } catch {
      terminalError = error
      finishBroadcastWithError(error)
    }
  }

  private func appendVideo(_ sampleBuffer: CMSampleBuffer) throws {
    guard let writer else {
      return
    }
    if videoInput == nil {
      guard let imageBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) else {
        return
      }
      let width = CVPixelBufferGetWidth(imageBuffer)
      let height = CVPixelBufferGetHeight(imageBuffer)
      let input = AVAssetWriterInput(
        mediaType: .video,
        outputSettings: [
          AVVideoCodecKey: AVVideoCodecType.h264,
          AVVideoWidthKey: width,
          AVVideoHeightKey: height,
          AVVideoCompressionPropertiesKey: [
            AVVideoAverageBitRateKey: 6_000_000,
            AVVideoExpectedSourceFrameRateKey: 30,
            AVVideoMaxKeyFrameIntervalKey: 60,
          ],
        ]
      )
      input.expectsMediaDataInRealTime = true
      guard writer.canAdd(input) else {
        throw captureError("The screen video stream could not be attached.")
      }
      writer.add(input)
      videoInput = input
    }
    if !startedSession {
      guard writer.startWriting() else {
        throw writer.error ?? captureError("Screen recording could not start.")
      }
      let presentationTime = CMSampleBufferGetPresentationTimeStamp(sampleBuffer)
      writer.startSession(atSourceTime: presentationTime)
      sessionStartSeconds = validSeconds(presentationTime)
      startedSession = true
    }
    if videoInput?.isReadyForMoreMediaData == true {
      guard videoInput?.append(sampleBuffer) == true else {
        throw writer.error ?? captureError("A screen video frame could not be saved.")
      }
      recordProgress(from: sampleBuffer)
    }
  }

  private func appendAudio(
    _ sampleBuffer: CMSampleBuffer,
    microphone: Bool
  ) throws {
    guard let writer, startedSession else {
      return
    }
    var input = microphone ? microphoneInput : appAudioInput
    if input == nil {
      let nextInput = AVAssetWriterInput(
        mediaType: .audio,
        outputSettings: [
          AVFormatIDKey: kAudioFormatMPEG4AAC,
          AVSampleRateKey: 44_100,
          AVNumberOfChannelsKey: microphone ? 1 : 2,
          AVEncoderBitRateKey: microphone ? 96_000 : 160_000,
        ],
        sourceFormatHint: CMSampleBufferGetFormatDescription(sampleBuffer)
      )
      nextInput.expectsMediaDataInRealTime = true
      guard writer.canAdd(nextInput) else {
        throw captureError("A screen recording audio stream could not be attached.")
      }
      writer.add(nextInput)
      if microphone {
        microphoneInput = nextInput
      } else {
        appAudioInput = nextInput
      }
      input = nextInput
    }
    if input?.isReadyForMoreMediaData == true {
      guard input?.append(sampleBuffer) == true else {
        throw writer.error ?? captureError("Screen recording audio could not be saved.")
      }
      recordProgress(from: sampleBuffer)
    }
  }

  override func broadcastFinished() {
    guard terminalError == nil, let writer, startedSession else {
      return
    }
    videoInput?.markAsFinished()
    appAudioInput?.markAsFinished()
    microphoneInput?.markAsFinished()
    let finished = DispatchSemaphore(value: 0)
    writer.finishWriting {
      finished.signal()
    }
    guard finished.wait(timeout: .now() + 8) == .success,
      writer.status == .completed
    else {
      let error = writer.error ?? captureError("Screen recording did not finish safely.")
      finishBroadcastWithError(error)
      return
    }

    do {
      try writeManifest(status: "completed", durationMs: currentDurationMs())
    } catch {
      finishBroadcastWithError(error)
    }
  }

  private func recordProgress(from sampleBuffer: CMSampleBuffer) {
    guard let sampleStart = validSeconds(
      CMSampleBufferGetPresentationTimeStamp(sampleBuffer)
    ) else {
      return
    }
    let sampleDuration = validSeconds(CMSampleBufferGetDuration(sampleBuffer)) ?? 0
    latestSampleEndSeconds = max(
      latestSampleEndSeconds ?? sampleStart,
      sampleStart + max(0, sampleDuration)
    )
    let durationMs = currentDurationMs()
    guard durationMs - lastManifestDurationMs >= 1_000 else {
      return
    }
    do {
      try writeManifest(status: "recording", durationMs: durationMs)
      lastManifestDurationMs = durationMs
    } catch {
      terminalError = error
      finishBroadcastWithError(error)
    }
  }

  private func currentDurationMs() -> Int {
    guard let sessionStartSeconds, let latestSampleEndSeconds else {
      return 0
    }
    return max(0, Int(((latestSampleEndSeconds - sessionStartSeconds) * 1_000).rounded()))
  }

  private func validSeconds(_ time: CMTime) -> Double? {
    guard time.isValid, !time.isIndefinite else {
      return nil
    }
    let seconds = CMTimeGetSeconds(time)
    return seconds.isFinite ? seconds : nil
  }

  private func writeManifest(status: String, durationMs: Int) throws {
    guard let outputURL, let manifestURL else {
      throw captureError("Screen recording recovery metadata is unavailable.")
    }
    let formatter = ISO8601DateFormatter()
    let manifest = ReplayKitCaptureManifest(
      captureId: captureId,
      capturedAt: formatter.string(from: capturedAt),
      durationMs: max(0, durationMs),
      fileName: outputURL.lastPathComponent,
      kind: "video",
      mimeType: "video/mp4",
      status: status,
      title: "Screen recording",
      updatedAt: formatter.string(from: Date())
    )
    let data = try JSONEncoder().encode(manifest)
    try data.write(to: manifestURL, options: .atomic)
  }

  private func captureError(_ message: String) -> NSError {
    NSError(
      domain: "AgentNativeBroadcast",
      code: 2,
      userInfo: [NSLocalizedDescriptionKey: message]
    )
  }
}
