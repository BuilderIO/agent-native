import ActivityKit
import Foundation
import React
import ReplayKit
import UIKit
import WatchConnectivity

private struct AgentNativeSharedCaptureManifest: Codable {
  let captureId: String
  let capturedAt: String
  let durationMs: Int
  let fileName: String
  let kind: String
  let mimeType: String
  let title: String
}

@objc(AgentNativeIOSCompanion)
final class AgentNativeIOSCompanion: RCTEventEmitter, WCSessionDelegate {
  @MainActor
  private static var activities: [String: Activity<AgentNativeCaptureAttributes>] = [:]
  private var hasListeners = false
  private var stopObserver: NSObjectProtocol?

  override init() {
    super.init()
    stopObserver = NotificationCenter.default.addObserver(
      forName: agentNativeCaptureStopNotification,
      object: nil,
      queue: .main
    ) { [weak self] notification in
      guard let captureId = notification.userInfo?["captureId"] as? String else {
        return
      }
      self?.emit("captureStopRequested", body: ["captureId": captureId])
    }
    if WCSession.isSupported() {
      WCSession.default.delegate = self
      WCSession.default.activate()
    }
  }

  deinit {
    if let stopObserver {
      NotificationCenter.default.removeObserver(stopObserver)
    }
  }

  @objc
  override static func requiresMainQueueSetup() -> Bool {
    true
  }

  override func supportedEvents() -> [String]! {
    ["captureStopRequested", "sharedCaptureAvailable"]
  }

  override func startObserving() {
    hasListeners = true
  }

  override func stopObserving() {
    hasListeners = false
  }

  private func emit(_ name: String, body: Any) {
    guard hasListeners else {
      return
    }
    sendEvent(withName: name, body: body)
  }

  @objc(startCaptureActivity:kind:startedAtMs:resolver:rejecter:)
  func startCaptureActivity(
    _ captureId: String,
    kind: String,
    startedAtMs: NSNumber,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    guard #available(iOS 16.2, *) else {
      resolve(nil)
      return
    }
    Task { @MainActor in
      do {
        if let existing = Activity<AgentNativeCaptureAttributes>.activities.first(
          where: { $0.attributes.captureId == captureId }
        ) {
          Self.activities[captureId] = existing
          resolve(existing.id)
          return
        }
        let startedAt = Date(timeIntervalSince1970: startedAtMs.doubleValue / 1_000)
        let activity = try Activity.request(
          attributes: AgentNativeCaptureAttributes(
            captureId: captureId,
            kind: kind
          ),
          content: ActivityContent(
            state: AgentNativeCaptureAttributes.ContentState(
              phase: "recording",
              startedAt: startedAt
            ),
            staleDate: nil
          ),
          pushType: nil
        )
        Self.activities[captureId] = activity
        resolve(activity.id)
      } catch {
        reject("activity_start_failed", error.localizedDescription, error)
      }
    }
  }

  @objc(updateCaptureActivity:phase:resolver:rejecter:)
  func updateCaptureActivity(
    _ captureId: String,
    phase: String,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    guard #available(iOS 16.2, *) else {
      resolve(nil)
      return
    }
    Task { @MainActor in
      guard let activity = Self.activities[captureId]
        ?? Activity<AgentNativeCaptureAttributes>.activities.first(
          where: { $0.attributes.captureId == captureId }
        )
      else {
        resolve(nil)
        return
      }
      await activity.update(
        ActivityContent(
          state: AgentNativeCaptureAttributes.ContentState(
            phase: phase,
            startedAt: activity.content.state.startedAt
          ),
          staleDate: nil
        )
      )
      resolve(nil)
    }
  }

  @objc(endCaptureActivity:phase:resolver:rejecter:)
  func endCaptureActivity(
    _ captureId: String,
    phase: String,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    guard #available(iOS 16.2, *) else {
      resolve(nil)
      return
    }
    Task { @MainActor in
      guard let activity = Self.activities.removeValue(forKey: captureId)
        ?? Activity<AgentNativeCaptureAttributes>.activities.first(
          where: { $0.attributes.captureId == captureId }
        )
      else {
        resolve(nil)
        return
      }
      await activity.end(
        ActivityContent(
          state: AgentNativeCaptureAttributes.ContentState(
            phase: phase,
            startedAt: activity.content.state.startedAt
          ),
          staleDate: nil
        ),
        dismissalPolicy: .immediate
      )
      resolve(nil)
    }
  }

  @objc(endStaleCaptureActivities:rejecter:)
  func endStaleCaptureActivities(
    _ resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    guard #available(iOS 16.2, *) else {
      resolve(nil)
      return
    }
    Task { @MainActor in
      for activity in Activity<AgentNativeCaptureAttributes>.activities {
        await activity.end(nil, dismissalPolicy: .immediate)
      }
      Self.activities.removeAll()
      resolve(nil)
    }
  }

  nonisolated func session(
    _ session: WCSession,
    activationDidCompleteWith activationState: WCSessionActivationState,
    error: Error?
  ) {}

  nonisolated func sessionDidBecomeInactive(_ session: WCSession) {}

  nonisolated func sessionDidDeactivate(_ session: WCSession) {
    session.activate()
  }

  nonisolated func session(
    _ session: WCSession,
    didReceive file: WCSessionFile
  ) {
    let metadata = file.metadata ?? [:]
    let captureId = (metadata["captureId"] as? String)
      ?? UUID().uuidString.lowercased()
    guard let container = FileManager.default.containerURL(
      forSecurityApplicationGroupIdentifier: agentNativeAppGroup
    ) else {
      return
    }
    let directory = container.appendingPathComponent("captures", isDirectory: true)
    do {
      try FileManager.default.createDirectory(
        at: directory,
        withIntermediateDirectories: true
      )
      let destination = directory.appendingPathComponent("\(captureId).m4a")
      if FileManager.default.fileExists(atPath: destination.path) {
        try FileManager.default.removeItem(at: destination)
      }
      try FileManager.default.copyItem(at: file.fileURL, to: destination)
      let manifest = AgentNativeSharedCaptureManifest(
        captureId: captureId,
        capturedAt: (metadata["capturedAt"] as? String)
          ?? ISO8601DateFormatter().string(from: Date()),
        durationMs: metadata["durationMs"] as? Int ?? 0,
        fileName: destination.lastPathComponent,
        kind: "audio",
        mimeType: "audio/mp4",
        title: (metadata["title"] as? String) ?? "Watch audio note"
      )
      let manifestData = try JSONEncoder().encode(manifest)
      try manifestData.write(
        to: destination.deletingPathExtension().appendingPathExtension("json"),
        options: .atomic
      )
      DispatchQueue.main.async { [weak self] in
        self?.emit("sharedCaptureAvailable", body: ["captureId": captureId])
      }
    } catch {
      return
    }
  }
}

@objc(AgentNativeBroadcastPickerManager)
final class AgentNativeBroadcastPickerManager: RCTViewManager {
  @objc
  override static func requiresMainQueueSetup() -> Bool {
    true
  }

  override func view() -> UIView! {
    let picker = RPSystemBroadcastPickerView(frame: .zero)
    picker.preferredExtension = "com.agentnative.mobile.broadcast"
    picker.showsMicrophoneButton = true
    picker.backgroundColor = .clear
    return picker
  }
}
