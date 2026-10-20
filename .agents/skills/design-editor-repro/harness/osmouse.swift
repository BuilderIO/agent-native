import Foundation
import CoreGraphics
import ApplicationServices

func post(_ e: CGEvent?) { e?.post(tap: .cghidEventTap) }

func mouseEvent(_ type: CGEventType, _ p: CGPoint, _ button: CGMouseButton = .left) {
    post(CGEvent(mouseEventSource: nil, mouseType: type, mouseCursorPosition: p, mouseButton: button))
}

func sleepMs(_ ms: UInt32) { usleep(ms * 1000) }

let args = CommandLine.arguments
guard args.count > 1 else {
    print("usage: osmouse pos | move X Y | click X Y | drag X1 Y1 X2 Y2 [steps] [holdMs]")
    exit(2)
}

switch args[1] {
case "pos":
    if let e = CGEvent(source: nil) {
        print("{\"x\":\(Int(e.location.x)),\"y\":\(Int(e.location.y))}")
    }
case "trusted":
    print(AXIsProcessTrusted() ? "{\"accessibility\":true}" : "{\"accessibility\":false}")
case "move":
    let p = CGPoint(x: Double(args[2])!, y: Double(args[3])!)
    mouseEvent(.mouseMoved, p)
    print("{\"moved\":[\(Int(p.x)),\(Int(p.y))]}")
case "click":
    let p = CGPoint(x: Double(args[2])!, y: Double(args[3])!)
    mouseEvent(.mouseMoved, p); sleepMs(40)
    mouseEvent(.leftMouseDown, p); sleepMs(40)
    mouseEvent(.leftMouseUp, p)
    print("{\"clicked\":[\(Int(p.x)),\(Int(p.y))]}")
case "down":
    let p = CGPoint(x: Double(args[2])!, y: Double(args[3])!)
    mouseEvent(.mouseMoved, p); sleepMs(60)
    mouseEvent(.leftMouseDown, p)
    print("{\"down\":[\(Int(p.x)),\(Int(p.y))]}")
case "dragto":
    let x2 = Double(args[2])!, y2 = Double(args[3])!
    let steps = args.count > 4 ? Int(args[4])! : 20
    guard let cur = CGEvent(source: nil) else { exit(1) }
    let x1 = cur.location.x, y1 = cur.location.y
    for i in 1...steps {
        let t = Double(i) / Double(steps)
        let p = CGPoint(x: x1 + (x2 - x1) * t, y: y1 + (y2 - y1) * t)
        post(CGEvent(mouseEventSource: nil, mouseType: .leftMouseDragged, mouseCursorPosition: p, mouseButton: .left))
        sleepMs(16)
    }
    print("{\"dragto\":[\(Int(x2)),\(Int(y2))]}")
case "jiggle":
    guard let cur = CGEvent(source: nil) else { exit(1) }
    let bx = cur.location.x, by = cur.location.y
    let n = args.count > 2 ? Int(args[2])! : 10
    for i in 0..<n {
        let p = CGPoint(x: bx + (i % 2 == 0 ? 1 : -1), y: by + (i % 4 < 2 ? 1 : -1))
        post(CGEvent(mouseEventSource: nil, mouseType: .leftMouseDragged, mouseCursorPosition: p, mouseButton: .left))
        sleepMs(90)
    }
    print("{\"jiggled\":\(n)}")
case "up":
    guard let cur = CGEvent(source: nil) else { exit(1) }
    mouseEvent(.leftMouseUp, cur.location)
    print("{\"up\":[\(Int(cur.location.x)),\(Int(cur.location.y))]}")
case "drag":
    let x1 = Double(args[2])!, y1 = Double(args[3])!
    let x2 = Double(args[4])!, y2 = Double(args[5])!
    let steps = args.count > 6 ? Int(args[6])! : 40
    let holdMs = args.count > 7 ? UInt32(args[7])! : 700
    mouseEvent(.mouseMoved, CGPoint(x: x1, y: y1)); sleepMs(120)
    mouseEvent(.leftMouseDown, CGPoint(x: x1, y: y1)); sleepMs(220)
    for i in 1...steps {
        let t = Double(i) / Double(steps)
        let p = CGPoint(x: x1 + (x2 - x1) * t, y: y1 + (y2 - y1) * t)
        post(CGEvent(mouseEventSource: nil, mouseType: .leftMouseDragged, mouseCursorPosition: p, mouseButton: .left))
        sleepMs(16)
    }
    // Small settle jiggle so the target recomputes under a moving pointer.
    for i in 0..<8 {
        let p = CGPoint(x: x2 + (i % 2 == 0 ? 1 : -1), y: y2 + (i % 4 < 2 ? 1 : -1))
        post(CGEvent(mouseEventSource: nil, mouseType: .leftMouseDragged, mouseCursorPosition: p, mouseButton: .left))
        sleepMs(holdMs / 8)
    }
    mouseEvent(.leftMouseUp, CGPoint(x: x2, y: y2))
    print("{\"dragged\":[[\(Int(x1)),\(Int(y1))],[\(Int(x2)),\(Int(y2))]]}")
default:
    print("unknown command"); exit(2)
}
