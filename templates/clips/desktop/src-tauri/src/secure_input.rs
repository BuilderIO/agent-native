//! Warns when another app keeps macOS Secure Input on.
//!
//! While an app has Secure Input on (a focused password field, for example in
//! Chrome), macOS does not deliver keyboard shortcuts to other apps, so Clips'
//! dictation and recording shortcuts look dead. A short password entry is
//! normal; Secure Input that stays on is not, so Clips tells the user once per
//! episode which app holds it.

use std::time::Duration;

#[cfg(target_os = "macos")]
use tauri::AppHandle;
#[cfg(target_os = "macos")]
use tauri_plugin_notification::NotificationExt;

/// How long another app may hold Secure Input before Clips warns.
pub const WARN_AFTER: Duration = Duration::from_secs(20);
const POLL_EVERY: Duration = Duration::from_secs(5);

/// The notification text: (title, body).
pub fn notification_text(app_name: &str) -> (String, String) {
    let app = match app_name.trim() {
        "" => "Another app",
        name => name,
    };
    (
        "Clips shortcuts are blocked".to_string(),
        format!(
            "{app} is protecting a password field, so macOS blocks other apps' shortcuts. Click outside the password field in {app}, or close that tab."
        ),
    )
}

/// Tracks one Secure Input episode and decides when to warn.
#[derive(Default, Debug)]
pub struct Tracker {
    holder: Option<i32>,
    held_for: Duration,
    warned: bool,
}

impl Tracker {
    /// Feed the current holder (or `None`) after `elapsed` since the last
    /// call. Returns the pid to warn about, at most once per episode.
    pub fn observe(&mut self, holder: Option<i32>, elapsed: Duration) -> Option<i32> {
        if holder != self.holder {
            self.holder = holder;
            self.held_for = Duration::ZERO;
            self.warned = false;
            return None;
        }
        let pid = holder?;
        self.held_for += elapsed;
        if !self.warned && self.held_for >= WARN_AFTER {
            self.warned = true;
            return Some(pid);
        }
        None
    }
}

#[cfg(target_os = "macos")]
pub fn watch(app: &AppHandle) {
    let app = app.clone();
    let own_pid = std::process::id() as i32;
    let spawned = std::thread::Builder::new()
        .name("secure-input-watch".into())
        .spawn(move || {
            let mut tracker = Tracker::default();
            loop {
                std::thread::sleep(POLL_EVERY);
                let holder = macos::secure_input_pid().filter(|pid| *pid != own_pid);
                if let Some(pid) = tracker.observe(holder, POLL_EVERY) {
                    let app_name = macos::app_name(pid).unwrap_or_else(|| "Another app".into());
                    eprintln!(
                        "[secure-input] {app_name} (pid {pid}) keeps Secure Input on; Clips shortcuts are blocked"
                    );
                    let (title, body) = notification_text(&app_name);
                    if let Err(err) = app.notification().builder().title(title).body(body).show() {
                        eprintln!("[secure-input] notification failed: {err}");
                    }
                }
            }
        });
    if let Err(err) = spawned {
        eprintln!("[secure-input] failed to start watcher: {err}");
    }
}

#[cfg(target_os = "macos")]
mod macos {
    use core_foundation::base::{CFType, TCFType};
    use core_foundation::dictionary::{CFDictionary, CFDictionaryRef};
    use core_foundation::number::CFNumber;
    use core_foundation::string::CFString;

    #[link(name = "CoreGraphics", kind = "framework")]
    extern "C" {
        fn CGSessionCopyCurrentDictionary() -> CFDictionaryRef;
    }

    /// The pid that has Secure Input on, if any.
    pub fn secure_input_pid() -> Option<i32> {
        unsafe {
            let raw = CGSessionCopyCurrentDictionary();
            if raw.is_null() {
                return None;
            }
            let dict: CFDictionary<CFString, CFType> = CFDictionary::wrap_under_create_rule(raw);
            let key = CFString::from_static_string("kCGSSessionSecureInputPID");
            let value = dict.find(&key)?;
            let number = value.downcast::<CFNumber>()?;
            number.to_i32().filter(|pid| *pid > 0)
        }
    }

    pub fn app_name(pid: i32) -> Option<String> {
        use objc2::msg_send;
        use objc2::rc::autoreleasepool;
        use objc2::runtime::{AnyClass, AnyObject};

        autoreleasepool(|_| unsafe {
            let class_name = std::ffi::CString::new("NSRunningApplication").ok()?;
            let cls: &AnyClass = AnyClass::get(&class_name)?;
            let app: *mut AnyObject = msg_send![cls, runningApplicationWithProcessIdentifier: pid];
            if app.is_null() {
                return None;
            }
            let name: *mut AnyObject = msg_send![app, localizedName];
            if name.is_null() {
                return None;
            }
            let utf8: *const i8 = msg_send![name, UTF8String];
            if utf8.is_null() {
                return None;
            }
            Some(
                std::ffi::CStr::from_ptr(utf8)
                    .to_string_lossy()
                    .into_owned(),
            )
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn warns_once_after_secure_input_stays_on() {
        let mut t = Tracker::default();
        let step = Duration::from_secs(5);
        assert_eq!(t.observe(Some(42), step), None); // episode starts
        assert_eq!(t.observe(Some(42), step), None); // 5 s
        assert_eq!(t.observe(Some(42), step), None); // 10 s
        assert_eq!(t.observe(Some(42), step), None); // 15 s
        assert_eq!(t.observe(Some(42), step), Some(42)); // 20 s
        assert_eq!(t.observe(Some(42), step), None); // already warned
    }

    #[test]
    fn names_the_app_that_holds_secure_input() {
        let (title, body) = notification_text("Google Chrome");
        assert_eq!(title, "Clips shortcuts are blocked");
        assert!(body.contains("password field in Google Chrome"));
        assert!(notification_text(" ")
            .1
            .starts_with("Another app is protecting"));
    }

    #[test]
    fn a_short_password_entry_does_not_warn() {
        let mut t = Tracker::default();
        let step = Duration::from_secs(5);
        t.observe(Some(7), step);
        t.observe(Some(7), step);
        assert_eq!(t.observe(None, step), None);
        // A new episode starts the clock again.
        assert_eq!(t.observe(Some(7), step), None);
        assert_eq!(t.observe(Some(7), step), None);
    }
}
