//! macOS overlay that draws the cursor effects where the recorder sees them.
//!
//! One borderless, click-through window per display, at screen-saver level and
//! shareable with screen capture. Mouse monitors move the highlight and spawn
//! click rings. Everything here runs on the main thread.

use std::cell::RefCell;
use std::ptr::NonNull;

use block2::RcBlock;
use objc2::rc::Retained;
use objc2::runtime::AnyObject;
use objc2::{MainThreadMarker, MainThreadOnly};
use objc2_app_kit::{
    NSBackingStoreType, NSColor, NSEvent, NSEventMask, NSEventType, NSScreen,
    NSScreenSaverWindowLevel, NSWindow, NSWindowCollectionBehavior, NSWindowSharingType,
    NSWindowStyleMask,
};
use objc2_core_foundation::{CGPoint, CGRect, CGSize};
use objc2_core_graphics::{CGColor, CGPath};
use objc2_foundation::{NSNumber, NSString};
use objc2_quartz_core::{
    kCAMediaTimingFunctionLinear, CABasicAnimation, CALayer, CAMediaTiming, CAMediaTimingFunction,
    CAShapeLayer, CATransaction,
};

use super::model::{
    click_ring_radius, parse_hex_color, CursorEffectsConfig, CLICK_RING_DURATION_SECS,
    CLICK_RING_LINE_WIDTH, HIGHLIGHT_OPACITY, HIGHLIGHT_RADIUS,
};

struct ScreenOverlay {
    window: Retained<NSWindow>,
    root: Retained<CALayer>,
    highlight: Retained<CAShapeLayer>,
    frame: CGRect,
    scale: f64,
}

struct Overlay {
    config: CursorEffectsConfig,
    screens: Vec<ScreenOverlay>,
    monitors: Vec<Retained<AnyObject>>,
    paused: bool,
}

thread_local! {
    static OVERLAY: RefCell<Option<Overlay>> = const { RefCell::new(None) };
}

fn cg_color(hex: &str) -> objc2_core_foundation::CFRetained<CGColor> {
    let (r, g, b) = parse_hex_color(hex).unwrap_or((1.0, 1.0, 0.0));
    CGColor::new_srgb(r, g, b, 1.0)
}

fn ellipse(center: CGPoint, radius: f64) -> objc2_core_foundation::CFRetained<CGPath> {
    let rect = CGRect::new(
        CGPoint::new(center.x - radius, center.y - radius),
        CGSize::new(radius * 2.0, radius * 2.0),
    );
    // SAFETY: a null transform means identity.
    unsafe { CGPath::with_ellipse_in_rect(rect, std::ptr::null()) }
}

fn without_implicit_animation(update: impl FnOnce()) {
    CATransaction::begin();
    CATransaction::setDisableActions(true);
    update();
    CATransaction::commit();
}

fn contains(frame: &CGRect, point: CGPoint) -> bool {
    point.x >= frame.origin.x
        && point.x < frame.origin.x + frame.size.width
        && point.y >= frame.origin.y
        && point.y < frame.origin.y + frame.size.height
}

fn local_point(frame: &CGRect, point: CGPoint) -> CGPoint {
    CGPoint::new(point.x - frame.origin.x, point.y - frame.origin.y)
}

fn style_highlight(highlight: &CAShapeLayer, config: &CursorEffectsConfig) {
    highlight.setFillColor(Some(&cg_color(&config.highlight_color)));
    highlight.setHidden(!config.highlight_enabled);
}

fn make_screen_overlay(
    mtm: MainThreadMarker,
    screen: &NSScreen,
    config: &CursorEffectsConfig,
) -> Option<ScreenOverlay> {
    let frame = screen.frame();
    let scale = screen.backingScaleFactor();
    // SAFETY: standard borderless window init on the main thread.
    let window = unsafe {
        NSWindow::initWithContentRect_styleMask_backing_defer(
            NSWindow::alloc(mtm),
            frame,
            NSWindowStyleMask::Borderless,
            NSBackingStoreType::Buffered,
            false,
        )
    };
    // SAFETY: we own the window through `Retained` and close it ourselves.
    unsafe { window.setReleasedWhenClosed(false) };
    window.setOpaque(false);
    window.setBackgroundColor(Some(&NSColor::clearColor()));
    window.setHasShadow(false);
    window.setIgnoresMouseEvents(true);
    window.setLevel(NSScreenSaverWindowLevel);
    // Unlike Clips' own chrome, this window must appear in the recording.
    window.setSharingType(NSWindowSharingType::ReadOnly);
    window.setCollectionBehavior(
        NSWindowCollectionBehavior::CanJoinAllSpaces
            | NSWindowCollectionBehavior::Stationary
            | NSWindowCollectionBehavior::FullScreenAuxiliary
            | NSWindowCollectionBehavior::IgnoresCycle,
    );
    let view = window.contentView()?;
    view.setWantsLayer(true);
    let root = view.layer()?;

    let highlight = CAShapeLayer::new();
    let diameter = HIGHLIGHT_RADIUS * 2.0;
    let bounds = CGRect::new(CGPoint::new(0.0, 0.0), CGSize::new(diameter, diameter));
    without_implicit_animation(|| {
        highlight.setBounds(bounds);
        highlight.setPath(Some(&ellipse(
            CGPoint::new(HIGHLIGHT_RADIUS, HIGHLIGHT_RADIUS),
            HIGHLIGHT_RADIUS,
        )));
        highlight.setStrokeColor(None);
        highlight.setLineWidth(0.0);
        highlight.setOpacity(HIGHLIGHT_OPACITY);
        highlight.setContentsScale(scale);
        highlight.setHidden(true);
        style_highlight(&highlight, config);
        root.addSublayer(&highlight);
    });
    window.orderFrontRegardless();
    Some(ScreenOverlay {
        window,
        root,
        highlight,
        frame,
        scale,
    })
}

fn move_highlight(overlay: &Overlay, point: CGPoint) {
    without_implicit_animation(|| {
        for screen in &overlay.screens {
            let inside = contains(&screen.frame, point);
            screen
                .highlight
                .setHidden(!inside || !overlay.config.highlight_enabled);
            if inside {
                screen
                    .highlight
                    .setPosition(local_point(&screen.frame, point));
            }
        }
    });
}

fn spawn_click_ring(screen: &ScreenOverlay, point: CGPoint, color_hex: &str) {
    let max_radius = click_ring_radius(CLICK_RING_DURATION_SECS);
    let side = (max_radius + CLICK_RING_LINE_WIDTH) * 2.0;
    let center = CGPoint::new(side / 2.0, side / 2.0);
    // A zero-size ellipse degenerates; start from a hairline radius instead.
    let from_path = ellipse(center, 0.01);
    let to_path = ellipse(center, max_radius);

    let ring = CAShapeLayer::new();
    let linear = CAMediaTimingFunction::functionWithName(unsafe { kCAMediaTimingFunctionLinear });
    let grow = CABasicAnimation::animationWithKeyPath(Some(&NSString::from_str("path")));
    let fade = CABasicAnimation::animationWithKeyPath(Some(&NSString::from_str("opacity")));
    // SAFETY: CGPath is toll-free bridged to an Objective-C object.
    unsafe {
        grow.setFromValue(Some(&*(&*from_path as *const CGPath as *const AnyObject)));
        grow.setToValue(Some(&*(&*to_path as *const CGPath as *const AnyObject)));
        fade.setFromValue(Some(&NSNumber::numberWithFloat(1.0)));
        fade.setToValue(Some(&NSNumber::numberWithFloat(0.0)));
    }
    for animation in [&grow, &fade] {
        animation.setDuration(CLICK_RING_DURATION_SECS);
        animation.setTimingFunction(Some(&linear));
    }

    let ring_for_cleanup = ring.clone();
    let cleanup = RcBlock::new(move || ring_for_cleanup.removeFromSuperlayer());
    CATransaction::begin();
    CATransaction::setDisableActions(true);
    // SAFETY: the block only touches a retained layer on the main thread.
    unsafe { CATransaction::setCompletionBlock(Some(&cleanup)) };
    ring.setBounds(CGRect::new(CGPoint::new(0.0, 0.0), CGSize::new(side, side)));
    ring.setPosition(local_point(&screen.frame, point));
    ring.setContentsScale(screen.scale);
    ring.setFillColor(None);
    ring.setStrokeColor(Some(&cg_color(color_hex)));
    ring.setLineWidth(CLICK_RING_LINE_WIDTH);
    // Final model values, so nothing flashes back when the animations end.
    ring.setPath(Some(&to_path));
    ring.setOpacity(0.0);
    ring.addAnimation_forKey(&grow, Some(&NSString::from_str("grow")));
    ring.addAnimation_forKey(&fade, Some(&NSString::from_str("fade")));
    screen.root.addSublayer(&ring);
    CATransaction::commit();
}

fn handle_event(event: &NSEvent) {
    let point = NSEvent::mouseLocation();
    let event_type = event.r#type();
    OVERLAY.with(|cell| {
        let guard = cell.borrow();
        let Some(overlay) = guard.as_ref() else {
            return;
        };
        if overlay.paused {
            return;
        }
        move_highlight(overlay, point);
        let secondary = event_type == NSEventType::RightMouseDown;
        if !overlay.config.click_enabled || !(secondary || event_type == NSEventType::LeftMouseDown)
        {
            return;
        }
        let color = if secondary {
            &overlay.config.secondary_click_color
        } else {
            &overlay.config.click_color
        };
        if let Some(screen) = overlay
            .screens
            .iter()
            .find(|screen| contains(&screen.frame, point))
        {
            spawn_click_ring(screen, point, color);
        }
    });
}

fn install_monitors() -> Vec<Retained<AnyObject>> {
    let mask = NSEventMask::MouseMoved
        | NSEventMask::LeftMouseDragged
        | NSEventMask::RightMouseDragged
        | NSEventMask::OtherMouseDragged
        | NSEventMask::LeftMouseDown
        | NSEventMask::RightMouseDown;
    let mut monitors = Vec::new();
    // Global monitors see events sent to other apps; mouse events need no
    // Accessibility permission.
    let global = RcBlock::new(|event: NonNull<NSEvent>| {
        handle_event(unsafe { event.as_ref() });
    });
    match NSEvent::addGlobalMonitorForEventsMatchingMask_handler(mask, &global) {
        Some(monitor) => monitors.push(monitor),
        None => eprintln!("[clips-tray] cursor effects: global mouse monitor unavailable"),
    }
    // Local monitors cover events sent to Clips' own windows.
    let local = RcBlock::new(|event: NonNull<NSEvent>| -> *mut NSEvent {
        handle_event(unsafe { event.as_ref() });
        event.as_ptr()
    });
    match unsafe { NSEvent::addLocalMonitorForEventsMatchingMask_handler(mask, &local) } {
        Some(monitor) => monitors.push(monitor),
        None => eprintln!("[clips-tray] cursor effects: local mouse monitor unavailable"),
    }
    monitors
}

pub fn start(config: CursorEffectsConfig) {
    stop();
    let Some(mtm) = MainThreadMarker::new() else {
        eprintln!("[clips-tray] cursor effects: start called off the main thread");
        return;
    };
    let screens: Vec<ScreenOverlay> = NSScreen::screens(mtm)
        .iter()
        .filter_map(|screen| make_screen_overlay(mtm, &screen, &config))
        .collect();
    let overlay = Overlay {
        config,
        screens,
        monitors: install_monitors(),
        paused: false,
    };
    move_highlight(&overlay, NSEvent::mouseLocation());
    crate::dlog!(
        "[clips-tray] cursor effects on: {} display(s), highlight={} click={}",
        overlay.screens.len(),
        overlay.config.highlight_enabled,
        overlay.config.click_enabled
    );
    OVERLAY.with(|cell| *cell.borrow_mut() = Some(overlay));
}

pub fn stop() {
    let Some(overlay) = OVERLAY.with(|cell| cell.borrow_mut().take()) else {
        return;
    };
    for monitor in &overlay.monitors {
        // SAFETY: each monitor came from addGlobal/LocalMonitor above.
        unsafe { NSEvent::removeMonitor(monitor) };
    }
    for screen in &overlay.screens {
        screen.window.orderOut(None);
        screen.window.close();
    }
    crate::dlog!("[clips-tray] cursor effects off");
}

pub fn set_paused(paused: bool) {
    OVERLAY.with(|cell| {
        let mut guard = cell.borrow_mut();
        let Some(overlay) = guard.as_mut() else {
            return;
        };
        overlay.paused = paused;
        for screen in &overlay.screens {
            if paused {
                screen.window.orderOut(None);
            } else {
                screen.window.orderFrontRegardless();
            }
        }
        if !paused {
            move_highlight(overlay, NSEvent::mouseLocation());
        }
    });
}

pub fn reconfigure(config: CursorEffectsConfig) {
    let restart = OVERLAY.with(|cell| {
        let mut guard = cell.borrow_mut();
        let Some(overlay) = guard.as_mut() else {
            return false;
        };
        if !config.highlight_enabled && !config.click_enabled {
            return true;
        }
        without_implicit_animation(|| {
            for screen in &overlay.screens {
                style_highlight(&screen.highlight, &config);
            }
        });
        overlay.config = config.clone();
        move_highlight(overlay, NSEvent::mouseLocation());
        false
    });
    if restart {
        stop();
    }
}
