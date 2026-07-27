import AppKit
import ApplicationServices
import Foundation

private struct HelperFailure: Error, CustomStringConvertible {
    let description: String
}

private final class ComputerHelper {
    private var snapshotId: String?
    private var targets: [String: AXUIElement] = [:]
    private var snapshotBundleId: String?
    private var snapshotOrigin: String?
    private var nodeCount = 0
    private let maxNodes = 500
    private let maxDepth = 8

    func handle(_ request: [String: Any]) throws -> Any? {
        guard let command = request["command"] as? String else {
            throw HelperFailure(description: "Missing command.")
        }
        switch command {
        case "snapshot":
            return try takeSnapshot()
        case "mutate":
            guard
                let operation = request["operation"] as? [String: Any],
                let scope = request["expectedScope"] as? [String: Any]
            else {
                throw HelperFailure(description: "Mutation requires an operation and scope.")
            }
            try mutate(operation, expectedScope: scope)
            return nil
        case "releaseAll":
            releaseAllInputs()
            return nil
        default:
            throw HelperFailure(description: "Unsupported command.")
        }
    }

    private func takeSnapshot() throws -> [String: Any] {
        let context = try focusedContext()
        let id = UUID().uuidString
        snapshotId = id
        snapshotBundleId = context.bundleId
        snapshotOrigin = context.origin
        targets.removeAll(keepingCapacity: true)
        nodeCount = 0

        var nodes: [[String: Any]] = []
        if let focusedWindow = copyElement(context.application, kAXFocusedWindowAttribute as CFString) {
            nodes.append(snapshotNode(focusedWindow, depth: 0))
        } else {
            nodes.append(snapshotNode(context.application, depth: 0))
        }

        var result: [String: Any] = [
            "snapshotId": id,
            "bundleId": context.bundleId,
            "capturedAt": ISO8601DateFormatter().string(from: Date()),
            "nodes": nodes,
        ]
        if let name = context.applicationName { result["applicationName"] = name }
        if let origin = context.origin { result["origin"] = origin }
        return result
    }

    private func snapshotNode(_ element: AXUIElement, depth: Int) -> [String: Any] {
        nodeCount += 1
        let nodeId = String(nodeCount)
        targets[nodeId] = element
        let role = copyString(element, kAXRoleAttribute as CFString) ?? "AXUnknown"
        var node: [String: Any] = ["id": nodeId, "role": role]
        if let title = copyString(element, kAXTitleAttribute as CFString), !title.isEmpty {
            node["title"] = truncate(title, limit: 300)
        }
        // Password and secure text values never leave the helper.
        if role != "AXSecureTextField",
           let value = copyString(element, kAXValueAttribute as CFString),
           !value.isEmpty {
            node["value"] = truncate(value, limit: 1_000)
        }
        if let frame = frame(of: element) { node["frame"] = frame }

        if depth < maxDepth && nodeCount < maxNodes,
           let children = copyElements(element, kAXChildrenAttribute as CFString) {
            var childNodes: [[String: Any]] = []
            for child in children where nodeCount < maxNodes {
                childNodes.append(snapshotNode(child, depth: depth + 1))
            }
            if !childNodes.isEmpty { node["children"] = childNodes }
        }
        return node
    }

    private func mutate(_ operation: [String: Any], expectedScope: [String: Any]) throws {
        guard
            let kind = operation["kind"] as? String,
            let target = operation["target"] as? [String: Any],
            let requestedSnapshot = target["snapshotId"] as? String,
            let nodeId = target["nodeId"] as? String,
            let requestedBundle = target["bundleId"] as? String,
            requestedSnapshot == snapshotId,
            requestedBundle == snapshotBundleId,
            let element = targets[nodeId]
        else {
            throw HelperFailure(description: "Stale or invalid semantic target.")
        }

        let current = try focusedContext()
        let allowedBundles = expectedScope["bundleIds"] as? [String] ?? []
        let allowedOrigins = expectedScope["origins"] as? [String] ?? []
        guard current.bundleId == requestedBundle, allowedBundles.contains(current.bundleId) else {
            throw HelperFailure(description: "Focused application is outside the task scope.")
        }

        let requestedOrigin = canonicalOrigin(target["origin"] as? String)
        guard requestedOrigin == canonicalOrigin(snapshotOrigin),
              requestedOrigin == canonicalOrigin(current.origin) else {
            throw HelperFailure(description: "Focused origin changed after observation.")
        }
        if let origin = requestedOrigin, !allowedOrigins.contains(origin) {
            throw HelperFailure(description: "Focused origin is outside the task scope.")
        }

        if let expectedRole = target["expectedRole"] as? String {
            guard copyString(element, kAXRoleAttribute as CFString) == expectedRole else {
                throw HelperFailure(description: "Semantic target role changed after observation.")
            }
        }
        guard isElementEnabled(element) else {
            throw HelperFailure(description: "Semantic target is no longer enabled.")
        }

        switch kind {
        case "input.click":
            try click(element, button: operation["button"] as? String ?? "left")
        case "input.type":
            guard let text = operation["text"] as? String else {
                throw HelperFailure(description: "Typing requires text.")
            }
            focus(element)
            try typeText(text)
        case "input.key":
            guard let key = operation["key"] as? String else {
                throw HelperFailure(description: "Key input requires a key.")
            }
            focus(element)
            try pressKey(key, modifiers: operation["modifiers"] as? [String] ?? [])
        case "input.scroll":
            guard let dx = number(operation["deltaX"]), let dy = number(operation["deltaY"]) else {
                throw HelperFailure(description: "Scroll requires numeric deltas.")
            }
            try scroll(element, deltaX: dx, deltaY: dy)
        default:
            throw HelperFailure(description: "Unsupported mutation.")
        }
    }

    private func click(_ element: AXUIElement, button: String) throws {
        guard let rect = rect(of: element), rect.width > 0, rect.height > 0 else {
            throw HelperFailure(description: "Target does not have a clickable frame.")
        }
        let point = CGPoint(x: rect.midX, y: rect.midY)
        let mouseButton: CGMouseButton = button == "right" ? .right : .left
        let downType: CGEventType = button == "right" ? .rightMouseDown : .leftMouseDown
        let upType: CGEventType = button == "right" ? .rightMouseUp : .leftMouseUp
        guard
            let down = CGEvent(mouseEventSource: nil, mouseType: downType, mouseCursorPosition: point, mouseButton: mouseButton),
            let up = CGEvent(mouseEventSource: nil, mouseType: upType, mouseCursorPosition: point, mouseButton: mouseButton)
        else { throw HelperFailure(description: "Could not create mouse events.") }
        down.post(tap: .cghidEventTap)
        up.post(tap: .cghidEventTap)
    }

    private func typeText(_ text: String) throws {
        guard let down = CGEvent(keyboardEventSource: nil, virtualKey: 0, keyDown: true),
              let up = CGEvent(keyboardEventSource: nil, virtualKey: 0, keyDown: false) else {
            throw HelperFailure(description: "Could not create keyboard events.")
        }
        let units = Array(text.utf16)
        down.keyboardSetUnicodeString(stringLength: units.count, unicodeString: units)
        up.keyboardSetUnicodeString(stringLength: units.count, unicodeString: units)
        down.post(tap: .cghidEventTap)
        up.post(tap: .cghidEventTap)
    }

    private func pressKey(_ key: String, modifiers: [String]) throws {
        guard let code = keyCode(key) else {
            throw HelperFailure(description: "Unsupported key name.")
        }
        let flags = modifierFlags(modifiers)
        guard let down = CGEvent(keyboardEventSource: nil, virtualKey: code, keyDown: true),
              let up = CGEvent(keyboardEventSource: nil, virtualKey: code, keyDown: false) else {
            throw HelperFailure(description: "Could not create keyboard events.")
        }
        down.flags = flags
        up.flags = flags
        down.post(tap: .cghidEventTap)
        up.post(tap: .cghidEventTap)
    }

    private func scroll(_ element: AXUIElement, deltaX: Int32, deltaY: Int32) throws {
        guard let rect = rect(of: element) else {
            throw HelperFailure(description: "Scroll target does not have a frame.")
        }
        let point = CGPoint(x: rect.midX, y: rect.midY)
        CGEvent(mouseEventSource: nil, mouseType: .mouseMoved, mouseCursorPosition: point,
                mouseButton: .left)?.post(tap: .cghidEventTap)
        CGEvent(scrollWheelEvent2Source: nil, units: .pixel, wheelCount: 2,
                wheel1: deltaY, wheel2: deltaX, wheel3: 0)?.post(tap: .cghidEventTap)
    }

    private func focus(_ element: AXUIElement) {
        AXUIElementSetAttributeValue(element, kAXFocusedAttribute as CFString, kCFBooleanTrue)
    }

    private func releaseAllInputs() {
        let location = CGEvent(source: nil)?.location ?? .zero
        CGEvent(mouseEventSource: nil, mouseType: .leftMouseUp, mouseCursorPosition: location,
                mouseButton: .left)?.post(tap: .cghidEventTap)
        CGEvent(mouseEventSource: nil, mouseType: .rightMouseUp, mouseCursorPosition: location,
                mouseButton: .right)?.post(tap: .cghidEventTap)
        for keyCode: CGKeyCode in [54, 55, 56, 57, 58, 59, 60, 61, 62] {
            CGEvent(keyboardEventSource: nil, virtualKey: keyCode, keyDown: false)?.post(tap: .cghidEventTap)
        }
    }

    private func focusedContext() throws -> (application: AXUIElement, bundleId: String, applicationName: String?, origin: String?) {
        let system = AXUIElementCreateSystemWide()
        guard let application = copyElement(system, kAXFocusedApplicationAttribute as CFString) else {
            throw HelperFailure(description: "No focused application is available.")
        }
        var pid: pid_t = 0
        guard AXUIElementGetPid(application, &pid) == .success,
              let running = NSRunningApplication(processIdentifier: pid),
              let bundleId = running.bundleIdentifier else {
            throw HelperFailure(description: "Could not identify the focused application.")
        }
        return (application, bundleId, running.localizedName, originForApplication(application))
    }

    private func originForApplication(_ application: AXUIElement) -> String? {
        let candidates = [
            copyElement(application, kAXFocusedWindowAttribute as CFString),
            copyElement(application, kAXFocusedUIElementAttribute as CFString),
        ].compactMap { $0 }
        for element in candidates {
            var budget = 120
            if let origin = findOrigin(element, depth: 0, budget: &budget) { return origin }
        }
        return nil
    }

    private func findOrigin(_ element: AXUIElement, depth: Int, budget: inout Int) -> String? {
        guard budget > 0, depth < 8 else { return nil }
        budget -= 1
        if let value = copyAny(element, kAXURLAttribute as CFString) {
            if let url = value as? URL, let origin = canonicalOrigin(url.absoluteString) { return origin }
            if let string = value as? String, let origin = canonicalOrigin(string) { return origin }
        }
        for child in copyElements(element, kAXChildrenAttribute as CFString) ?? [] {
            if let origin = findOrigin(child, depth: depth + 1, budget: &budget) { return origin }
        }
        return nil
    }
}

private func copyAny(_ element: AXUIElement, _ attribute: CFString) -> AnyObject? {
    var value: CFTypeRef?
    guard AXUIElementCopyAttributeValue(element, attribute, &value) == .success else { return nil }
    return value
}

private func copyElement(_ element: AXUIElement, _ attribute: CFString) -> AXUIElement? {
    guard let value = copyAny(element, attribute),
          CFGetTypeID(value) == AXUIElementGetTypeID() else { return nil }
    return unsafeBitCast(value, to: AXUIElement.self)
}

private func copyElements(_ element: AXUIElement, _ attribute: CFString) -> [AXUIElement]? {
    copyAny(element, attribute) as? [AXUIElement]
}

private func copyString(_ element: AXUIElement, _ attribute: CFString) -> String? {
    if let string = copyAny(element, attribute) as? String { return string }
    if let number = copyAny(element, attribute) as? NSNumber { return number.stringValue }
    return nil
}

private func rect(of element: AXUIElement) -> CGRect? {
    guard let position = copyAny(element, kAXPositionAttribute as CFString),
          let size = copyAny(element, kAXSizeAttribute as CFString) else { return nil }
    var point = CGPoint.zero
    var dimensions = CGSize.zero
    guard CFGetTypeID(position) == AXValueGetTypeID(),
          CFGetTypeID(size) == AXValueGetTypeID() else { return nil }
    let positionValue = unsafeBitCast(position, to: AXValue.self)
    let sizeValue = unsafeBitCast(size, to: AXValue.self)
    guard AXValueGetValue(positionValue, .cgPoint, &point),
          AXValueGetValue(sizeValue, .cgSize, &dimensions) else { return nil }
    return CGRect(origin: point, size: dimensions)
}

private func frame(of element: AXUIElement) -> [String: Double]? {
    guard let rect = rect(of: element) else { return nil }
    return ["x": rect.origin.x, "y": rect.origin.y, "width": rect.width, "height": rect.height]
}

private func isElementEnabled(_ element: AXUIElement) -> Bool {
    guard let value = copyAny(element, kAXEnabledAttribute as CFString) else { return true }
    return (value as? NSNumber)?.boolValue ?? true
}

private func canonicalOrigin(_ value: String?) -> String? {
    guard let value, let components = URLComponents(string: value),
          let scheme = components.scheme?.lowercased(), let host = components.host?.lowercased() else { return nil }
    var result = "\(scheme)://\(host)"
    if let port = components.port { result += ":\(port)" }
    return result
}

private func truncate(_ value: String, limit: Int) -> String {
    value.count <= limit ? value : String(value.prefix(limit))
}

private func number(_ value: Any?) -> Int32? {
    (value as? NSNumber)?.int32Value
}

private func modifierFlags(_ names: [String]) -> CGEventFlags {
    var flags: CGEventFlags = []
    for name in names.map({ $0.lowercased() }) {
        switch name {
        case "command", "meta": flags.insert(.maskCommand)
        case "control": flags.insert(.maskControl)
        case "option", "alt": flags.insert(.maskAlternate)
        case "shift": flags.insert(.maskShift)
        default: break
        }
    }
    return flags
}

private func keyCode(_ name: String) -> CGKeyCode? {
    let keys: [String: CGKeyCode] = [
        "enter": 36, "return": 36, "tab": 48, "space": 49, "delete": 51,
        "escape": 53, "left": 123, "right": 124, "down": 125, "up": 126,
        "home": 115, "end": 119, "pageup": 116, "pagedown": 121,
    ]
    return keys[name.lowercased()]
}

private let helper = ComputerHelper()
while let line = readLine() {
    autoreleasepool {
        var response: [String: Any] = ["ok": false]
        do {
            guard let data = line.data(using: .utf8),
                  let request = try JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let id = request["id"] as? NSNumber else {
                throw HelperFailure(description: "Invalid request envelope.")
            }
            response["id"] = id
            let result = try helper.handle(request)
            response["ok"] = true
            if let result { response["result"] = result }
        } catch {
            response["error"] = String(describing: error)
        }
        if let data = try? JSONSerialization.data(withJSONObject: response),
           let output = String(data: data, encoding: .utf8) {
            print(output)
            fflush(stdout)
        }
    }
}
