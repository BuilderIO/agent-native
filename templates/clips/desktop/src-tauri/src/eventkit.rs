//! macOS EventKit bridge — read iCloud / system calendar events.
//!
//! Two commands:
//!
//!   - `eventkit_request_access()` — prompts the user for calendar access
//!     and returns the granted bool.
//!   - `eventkit_list_events(within_hours)` — returns `Vec<EventKitEvent>`
//!     for events between [now, now + within_hours].
//!
//! On non-macOS this module exposes the same command surface but every
//! invocation returns an "unsupported" error so the JS side gets a clear
//! message rather than a missing-command panic.
//!
//! NOTE: We deliberately call EventKit via raw objc2 messaging rather than
//! the `objc2-event-kit` crate. The crate's high-level bindings vary across
//! 0.3.x patch versions (some types/methods are feature-gated, some changed
//! signatures between minor releases) and we only need a tiny slice of the
//! framework — easier and more durable to hand-roll the few selectors than
//! to chase the binding surface.

use serde::{Deserialize, Serialize};
use tauri::AppHandle;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EventKitEvent {
    pub id: String,
    pub title: String,
    /// RFC3339 timestamps.
    pub start: String,
    pub end: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub organizer: Option<String>,
    #[serde(default)]
    pub attendees: Vec<String>,
}

#[tauri::command]
pub async fn eventkit_request_access(app: AppHandle) -> Result<bool, String> {
    #[cfg(target_os = "macos")]
    {
        macos::request_access_impl(app).await
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
        Err("EventKit is only available on macOS.".into())
    }
}

#[tauri::command]
pub async fn eventkit_list_events(
    app: AppHandle,
    within_hours: u32,
) -> Result<Vec<EventKitEvent>, String> {
    #[cfg(target_os = "macos")]
    {
        macos::list_events_impl(app, within_hours).await
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app, within_hours);
        Err("EventKit is only available on macOS.".into())
    }
}

#[cfg(target_os = "macos")]
mod macos {
    use std::ffi::c_void;
    use std::sync::mpsc;
    use std::time::Duration;

    use block2::RcBlock;
    use objc2::rc::Retained;
    use objc2::runtime::{AnyClass, AnyObject, Bool};
    use objc2::{class, msg_send};
    use objc2_foundation::{NSArray, NSString};
    use tauri::AppHandle;

    use super::EventKitEvent;

    /// EKEntityType::Event == 0
    const EK_ENTITY_TYPE_EVENT: usize = 0;

    /// Returns Some(NSObject*) for the given class name, or None if the
    /// runtime doesn't know about it (e.g. the EventKit framework is not
    /// linked, or we're running on a platform variant that doesn't ship it).
    fn class_named(name: &str) -> Option<&'static AnyClass> {
        let bytes = std::ffi::CString::new(name).ok()?;
        AnyClass::get(&bytes)
    }

    /// Allocate + init a new EKEventStore. Returns a Retained handle.
    unsafe fn new_event_store() -> Option<Retained<AnyObject>> {
        let cls = class_named("EKEventStore")?;
        let allocated: *mut AnyObject = msg_send![cls, alloc];
        if allocated.is_null() {
            return None;
        }
        let inited: *mut AnyObject = msg_send![allocated, init];
        if inited.is_null() {
            return None;
        }
        Retained::from_raw(inited)
    }

    pub async fn request_access_impl(_app: AppHandle) -> Result<bool, String> {
        let store = unsafe { new_event_store() }
            .ok_or_else(|| "EventKit not available".to_string())?;
        let (tx, rx) = mpsc::sync_channel::<bool>(1);
        // The completion block is fire-and-forget from EventKit's side. Use
        // RcBlock so the closure stays alive past the requesting frame.
        let block = RcBlock::new(move |granted: Bool, _err: *mut AnyObject| {
            let _ = tx.send(granted.as_bool());
        });
        unsafe {
            // macOS 14 introduced -requestFullAccessToEventsWithCompletion:
            // (the older selector is still functional but may be deprecated
            // — selector lookup decides at runtime).
            let new_sel = objc2::sel!(requestFullAccessToEventsWithCompletion:);
            let responds: Bool = msg_send![&*store, respondsToSelector: new_sel];
            if responds.as_bool() {
                let _: () = msg_send![
                    &*store,
                    requestFullAccessToEventsWithCompletion: &*block
                ];
            } else {
                let _: () = msg_send![
                    &*store,
                    requestAccessToEntityType: EK_ENTITY_TYPE_EVENT,
                    completion: &*block
                ];
            }
        }
        match rx.recv_timeout(Duration::from_secs(60)) {
            Ok(b) => Ok(b),
            Err(_) => Err("EventKit request timed out".into()),
        }
    }

    pub async fn list_events_impl(
        _app: AppHandle,
        within_hours: u32,
    ) -> Result<Vec<EventKitEvent>, String> {
        unsafe {
            let store = new_event_store()
                .ok_or_else(|| "EventKit not available".to_string())?;

            let date_cls = class!(NSDate);
            let now: *mut AnyObject = msg_send![date_cls, date];
            if now.is_null() {
                return Err("NSDate.date returned null".into());
            }
            let interval: f64 = (within_hours as f64) * 3600.0;
            let end: *mut AnyObject = msg_send![
                date_cls,
                dateWithTimeIntervalSinceNow: interval
            ];
            if end.is_null() {
                return Err("NSDate.dateWithTimeIntervalSinceNow returned null".into());
            }

            // calendars (Option<NSArray>) — passing nil means "all calendars".
            let calendars_arr: *mut AnyObject = msg_send![
                &*store,
                calendarsForEntityType: EK_ENTITY_TYPE_EVENT
            ];
            // Build the predicate and fetch events.
            let predicate: *mut AnyObject = msg_send![
                &*store,
                predicateForEventsWithStartDate: now,
                endDate: end,
                calendars: calendars_arr
            ];
            if predicate.is_null() {
                return Err("predicateForEvents returned nil".into());
            }
            let events: *mut AnyObject = msg_send![
                &*store,
                eventsMatchingPredicate: predicate
            ];
            if events.is_null() {
                return Ok(Vec::new());
            }
            let count: usize = msg_send![events, count];
            let mut out: Vec<EventKitEvent> = Vec::with_capacity(count);
            // ISO formatter (singleton-style).
            let formatter_cls = class_named("NSISO8601DateFormatter")
                .ok_or_else(|| "NSISO8601DateFormatter missing".to_string())?;
            let formatter: *mut AnyObject = msg_send![formatter_cls, new];

            for i in 0..count {
                let ev: *mut AnyObject = msg_send![events, objectAtIndex: i];
                if ev.is_null() {
                    continue;
                }
                let id = ns_string_to_owned(msg_send![ev, eventIdentifier]);
                let title =
                    ns_string_to_owned(msg_send![ev, title]).unwrap_or_else(|| "(untitled)".to_string());
                let start_date: *mut AnyObject = msg_send![ev, startDate];
                let end_date: *mut AnyObject = msg_send![ev, endDate];
                let start_s = ns_date_to_rfc3339(formatter, start_date);
                let end_s = ns_date_to_rfc3339(formatter, end_date);
                // Organizer (EKParticipant).
                let organizer: *mut AnyObject = msg_send![ev, organizer];
                let organizer_name = if organizer.is_null() {
                    None
                } else {
                    ns_string_to_owned(msg_send![organizer, name])
                };
                // Attendees (NSArray<EKParticipant *>).
                let attendees_arr: *mut AnyObject = msg_send![ev, attendees];
                let attendees = if attendees_arr.is_null() {
                    Vec::new()
                } else {
                    let n: usize = msg_send![attendees_arr, count];
                    let mut v = Vec::with_capacity(n);
                    for j in 0..n {
                        let p: *mut AnyObject = msg_send![attendees_arr, objectAtIndex: j];
                        if p.is_null() {
                            continue;
                        }
                        if let Some(name) = ns_string_to_owned(msg_send![p, name]) {
                            v.push(name);
                        }
                    }
                    v
                };

                out.push(EventKitEvent {
                    id: id.unwrap_or_default(),
                    title,
                    start: start_s,
                    end: end_s,
                    organizer: organizer_name,
                    attendees,
                });
            }
            Ok(out)
        }
    }

    unsafe fn ns_string_to_owned(ptr: *mut AnyObject) -> Option<String> {
        if ptr.is_null() {
            return None;
        }
        // Cast to NSString and read its UTF-8 chars.
        let utf8_ptr: *const i8 = msg_send![ptr, UTF8String];
        if utf8_ptr.is_null() {
            return None;
        }
        let cstr = std::ffi::CStr::from_ptr(utf8_ptr);
        Some(cstr.to_string_lossy().into_owned())
    }

    unsafe fn ns_date_to_rfc3339(formatter: *mut AnyObject, date: *mut AnyObject) -> String {
        if formatter.is_null() || date.is_null() {
            return String::new();
        }
        let s: *mut AnyObject = msg_send![formatter, stringFromDate: date];
        ns_string_to_owned(s).unwrap_or_default()
    }

    // Suppress unused-import warnings for items that may only be referenced
    // in some build configurations.
    #[allow(dead_code)]
    fn _suppress(_: &NSString, _: &NSArray<NSString>, _: *mut c_void) {}
}
