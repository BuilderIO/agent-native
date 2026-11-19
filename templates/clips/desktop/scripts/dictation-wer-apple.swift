// Transcribes WAV files with Apple Speech for scripts/dictation-wer.ts, which
// compiles it with an embedded Info.plist carrying the usage description.
//
//   apple-speech [--request-permission] <output.json> <wav>...
//
// Without --request-permission it never shows the permission prompt: an
// undecided permission exits 3, a refused one exits 4.

import Foundation
import Speech

var args = Array(CommandLine.arguments.dropFirst())
let requestPermission = args.first == "--request-permission"
if requestPermission { args.removeFirst() }
guard args.count >= 2 else {
  FileHandle.standardError.write(
    "usage: apple-speech [--request-permission] <output.json> <wav>...\n".data(using: .utf8)!)
  exit(2)
}
let output = URL(fileURLWithPath: args[0])
let wavs = args.dropFirst()

func fail(_ message: String, code: Int32) -> Never {
  FileHandle.standardError.write("\(message)\n".data(using: .utf8)!)
  exit(code)
}

func spin(until done: () -> Bool, timeout: TimeInterval) -> Bool {
  let deadline = Date(timeIntervalSinceNow: timeout)
  while !done() && Date() < deadline {
    RunLoop.main.run(mode: .default, before: Date(timeIntervalSinceNow: 0.05))
  }
  return done()
}

var status = SFSpeechRecognizer.authorizationStatus()
if status == .notDetermined && requestPermission {
  var answered = false
  SFSpeechRecognizer.requestAuthorization { granted in
    status = granted
    answered = true
  }
  _ = spin(until: { answered }, timeout: 600)
}
switch status {
case .authorized:
  break
case .notDetermined:
  fail(
    "Apple Speech needs the Speech Recognition permission. Run again with --request-permission and allow the prompt.",
    code: 3)
default:
  fail(
    "Speech Recognition is turned off for this terminal. Allow it in System Settings > Privacy & Security > Speech Recognition.",
    code: 4)
}

guard let recognizer = SFSpeechRecognizer(locale: Locale(identifier: "en-US")),
  recognizer.isAvailable
else {
  fail("Apple Speech is not available for en-US on this Mac.", code: 5)
}

var results: [[String: Any]] = []
for wav in wavs {
  let request = SFSpeechURLRecognitionRequest(url: URL(fileURLWithPath: wav))
  request.shouldReportPartialResults = false
  if #available(macOS 13, *) { request.addsPunctuation = true }
  var text: String?
  var error: String?
  var finished = false
  let started = Date()
  let task = recognizer.recognitionTask(with: request) { result, failure in
    if let result, result.isFinal {
      text = result.bestTranscription.formattedString
      finished = true
    } else if let failure {
      error = failure.localizedDescription
      finished = true
    }
  }
  if !spin(until: { finished }, timeout: 600) {
    task.cancel()
    error = "timed out"
  }
  results.append([
    "wav": wav,
    "text": text.map { $0 as Any } ?? NSNull(),
    "ms": Int(Date().timeIntervalSince(started) * 1000),
    "error": error.map { $0 as Any } ?? NSNull(),
  ])
}

let data = try JSONSerialization.data(withJSONObject: ["engine": "apple", "results": results])
try data.write(to: output)
