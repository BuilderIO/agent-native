import AVFoundation
import CoreMedia
import Foundation
import ReplayKit

private struct ReplayKitCaptureManifest: Codable {
  let captureId: String
  let capturedAt: String
  let fileName: String
  let kind: String
  let mimeType: String
  let title: String
}

final class SampleHandler: RPBroadcastSampleHandler {
  private let appGroup = "group.com.agentnative.mobile"
  private var writer: AVAssetWriter?
  private var videoInput: AVAssetWriterInput?
  private var appAudioInput: AVAssetWriterInput?
  private var microphoneInput: AVAssetWriterInput?
  private var outputURL: URL?
  private var captureId = ""
  private var startedSession = false
  private var terminalError: Error?

  override func broadcastStarted(withSetupInfo setupInfo: [String: NSObject]?) {
    captureId = UUID().uuidString.lowercased()
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
      writer = try AVAssetWriter(outputURL: url, fileType: .mp4)
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
      writer.startSession(atSourceTime: CMSampleBufferGetPresentationTimeStamp(sampleBuffer))
      startedSession = true
    }
    if videoInput?.isReadyForMoreMediaData == true,
      videoInput?.append(sampleBuffer) == false
    {
      throw writer.error ?? captureError("A screen video frame could not be saved.")
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
    if input?.isReadyForMoreMediaData == true,
      input?.append(sampleBuffer) == false
    {
      throw writer.error ?? captureError("Screen recording audio could not be saved.")
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
      writer.status == .completed,
      let outputURL
    else {
      let error = writer.error ?? captureError("Screen recording did not finish safely.")
      finishBroadcastWithError(error)
      return
    }

    do {
      let manifest = ReplayKitCaptureManifest(
        captureId: captureId,
        capturedAt: ISO8601DateFormatter().string(from: Date()),
        fileName: outputURL.lastPathComponent,
        kind: "video",
        mimeType: "video/mp4",
        title: "Screen recording"
      )
      let data = try JSONEncoder().encode(manifest)
      try data.write(
        to: outputURL.deletingPathExtension().appendingPathExtension("json"),
        options: .atomic
      )
    } catch {
      finishBroadcastWithError(error)
    }
  }

  private func captureError(_ message: String) -> NSError {
    NSError(
      domain: "AgentNativeBroadcast",
      code: 2,
      userInfo: [NSLocalizedDescriptionKey: message]
    )
  }
}
