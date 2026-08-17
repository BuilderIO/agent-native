import AVFoundation
import CoreGraphics
import Darwin
import Foundation
import Vision

private let maxFrames = 30
private let maxTextBytes = 8 * 1_024

private func response(_ object: [String: Any]) -> UnsafeMutablePointer<CChar>? {
    guard JSONSerialization.isValidJSONObject(object),
          let data = try? JSONSerialization.data(withJSONObject: object),
          let json = String(data: data, encoding: .utf8) else {
        return strdup("{\"ok\":false,\"error\":\"OCR response encoding failed\"}")
    }
    return strdup(json)
}

private func milliseconds(_ time: CMTime) -> Int64 {
    guard time.isNumeric else { return 0 }
    return Int64((CMTimeGetSeconds(time) * 1_000).rounded())
}

private func boundedText(_ text: String) -> String {
    guard text.utf8.count > maxTextBytes else { return text }
    // Decoding the byte prefix replaces a partial final scalar safely rather
    // than splitting Swift's Unicode storage at an arbitrary index.
    return String(decoding: text.utf8.prefix(maxTextBytes), as: UTF8.self)
}

/// Runs wholly on-device. The result is JSON allocated by `strdup`; Rust must
/// return it through `clips_screen_memory_ocr_free` exactly once.
@_cdecl("clips_screen_memory_ocr_json")
public func clipsScreenMemoryOcrJson(
    _ videoPath: UnsafePointer<CChar>?,
    _ sampleIntervalSeconds: UInt64
) -> UnsafeMutablePointer<CChar>? {
    guard let videoPath else {
        return response(["ok": false, "error": "missing video path"])
    }

    let path = String(cString: videoPath)
    let asset = AVURLAsset(url: URL(fileURLWithPath: path))
    let duration = asset.duration
    guard duration.isNumeric, CMTimeGetSeconds(duration) >= 0 else {
        return response(["ok": false, "error": "video duration unavailable"])
    }

    let requestedInterval = max(1, min(sampleIntervalSeconds, UInt64(Int.max)))
    let generator = AVAssetImageGenerator(asset: asset)
    generator.appliesPreferredTrackTransform = true
    generator.requestedTimeToleranceBefore = .zero
    generator.requestedTimeToleranceAfter = .zero

    let seconds = CMTimeGetSeconds(duration)
    var requestedTimes: [CMTime] = []
    var second: Double = 0
    while second <= seconds && requestedTimes.count < maxFrames {
        requestedTimes.append(CMTime(seconds: second, preferredTimescale: 1_000))
        second += Double(requestedInterval)
    }
    if requestedTimes.isEmpty {
        requestedTimes.append(.zero)
    }

    var frames: [[String: Any]] = []
    for requestedTime in requestedTimes {
        autoreleasepool {
            var actualTime = CMTime.zero
            guard let image = try? generator.copyCGImage(at: requestedTime, actualTime: &actualTime) else {
                return
            }

            let request = VNRecognizeTextRequest()
            request.recognitionLevel = .fast
            request.usesLanguageCorrection = false
            request.minimumTextHeight = 0.015
            let handler = VNImageRequestHandler(cgImage: image, options: [:])
            guard (try? handler.perform([request])) != nil else { return }

            let observations = request.results ?? []
            let candidates = observations.compactMap { $0.topCandidates(1).first }
            let text = boundedText(candidates.map(\.string).joined(separator: "\n"))
            guard !text.isEmpty else { return }
            let confidence = candidates.map { Double($0.confidence) }.reduce(0, +)
                / Double(max(candidates.count, 1))
            frames.append([
                "offsetMs": milliseconds(actualTime),
                "text": text,
                "confidence": confidence,
                "width": image.width,
                "height": image.height,
            ])
        }
    }

    return response(["ok": true, "frames": frames])
}

@_cdecl("clips_screen_memory_ocr_free")
public func clipsScreenMemoryOcrFree(_ responsePointer: UnsafeMutablePointer<CChar>?) {
    free(responsePointer)
}
