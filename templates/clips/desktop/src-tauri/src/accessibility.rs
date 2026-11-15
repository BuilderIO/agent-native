//! macOS Accessibility (AX) bridge — read the focused UI element's text.
//!
//! This powers the personal-vocabulary auto-learn loop in
//! `templates/clips/desktop/src/lib/personal-vocabulary.ts`. After a
//! dictation pastes text into whatever app the user is in, the JS polls
//! `read_focused_field_text` every 200ms for ~10s. If the user edits a
//! single word ("kublectl" -> "kubectl") we record the term/replacement
//! pair as a vocabulary entry that biases future recognitions.
//!
//! ## Permission model
//!
//! macOS Accessibility cannot be granted via an entitlement — the user
//! must explicitly trust the app under
//! System Settings -> Privacy & Security -> Accessibility. We expose three
//! commands:
//!
//!   - `accessibility_check_permission()` — silent, returns whether the
//!     process is currently trusted. NEVER prompts.
//!   - `accessibility_request_permission()` — explicitly prompts the user
//!     (System Settings opens with our row highlighted). Only call this
//!     from a settings UI gesture.
//!   - `read_focused_field_text()` — returns the focused field's text, or
//!     "" if not trusted / nothing focused / unreadable. Never prompts,
//!     never panics, never blocks meaningfully (<5ms typical).
//!
//! `personal-vocabulary.ts` calls `read_focused_field_text` only — if it
//! returns "" repeatedly, the JS quietly stops polling. Auto-prompting on
//! every paste would be intrusive.
//!
//! ## API used
//!
//! From `ApplicationServices.framework`:
//!
//!   - `AXIsProcessTrustedWithOptions(options: CFDictionary?) -> bool`
//!   - `AXUIElementCreateSystemWide() -> AXUIElementRef`
//!   - `AXUIElementCopyAttributeValue(element, attr, &out) -> AXError`
//!   - kAXTrustedCheckOptionPrompt key
//!
//! Attributes:
//!
//!   - `AXFocusedUIElement` — the system-wide focused element
//!   - `AXValue` — the element's text value (for text fields, AXTextField,
//!     AXTextArea, contenteditable, etc.)
//!
//! ## Edge cases
//!
//!   - Apps that don't expose `AXFocusedUIElement` (some Electron apps
//!     with custom focus management) -> we get null and return "".
//!   - Chrome/web fields: AX values for `<input>`/`<textarea>` work fine.
//!     For `contenteditable` divs the value can sometimes come back as the
//!     full document body — `diffSingleWord` in JS filters those out.
//!   - Password fields: AX deliberately blocks reads — value comes back
//!     null/empty. We return "". (Good for privacy.)
//!   - AXValue can also be a CFNumber (sliders) or CFURL — we only return
//!     a String when it's a CFString; otherwise "".

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AccessibilityFingerprint {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub document: Option<AccessibilitySemanticNode>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub focused: Option<AccessibilitySemanticNode>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub visible_labels: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AccessibilitySemanticNode {
    pub role: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub document: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub selected_text: Option<String>,
}

const MAX_AX_NODES: usize = 6;
const MAX_AX_DEPTH: usize = 1;
const MAX_AX_STRING_BYTES: usize = 160;
const MAX_AX_LABELS: usize = 8;
const MAX_AX_TOTAL_BYTES: usize = 1_200;

fn safe_ax_text(value: Option<String>, remaining: &mut usize) -> Option<String> {
    let value = value?;
    let value = value.split_whitespace().collect::<Vec<_>>().join(" ");
    if value.is_empty() || looks_like_credential(&value) {
        return None;
    }
    let limit = MAX_AX_STRING_BYTES.min(*remaining);
    if limit == 0 {
        return None;
    }
    let mut end = value.len().min(limit);
    while end > 0 && !value.is_char_boundary(end) {
        end -= 1;
    }
    let value = value[..end].to_string();
    if value.is_empty() {
        return None;
    }
    *remaining = remaining.saturating_sub(value.len());
    Some(value)
}

fn looks_like_credential(value: &str) -> bool {
    let lower = value.to_ascii_lowercase();
    if [
        "password",
        "passcode",
        "secret=",
        "client secret",
        "api key",
        "api_key",
        "access token",
        "auth token",
        "bearer ",
    ]
    .iter()
    .any(|marker| lower.contains(marker))
    {
        return true;
    }
    let compact = value
        .chars()
        .filter(|c| !c.is_whitespace())
        .collect::<String>();
    let tokenish = compact.len() >= 32
        && compact
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '-' | '.'));
    let jwtish = compact.matches('.').count() == 2 && compact.len() >= 32;
    let private_key = value.contains("-----BEGIN") && value.contains("PRIVATE KEY-----");
    tokenish || jwtish || private_key
}

fn role_is_secure(role: &str) -> bool {
    let role = role.to_ascii_lowercase();
    role.contains("secure") || role.contains("password")
}

fn safe_ax_url(url: String, remaining: &mut usize) -> Option<String> {
    let url = url.split(['?', '#']).next()?.to_string();
    let authority = url
        .split_once("://")?
        .1
        .split('/')
        .next()
        .unwrap_or_default();
    if authority.contains('@') {
        return None;
    }
    if url.split('/').skip(3).any(looks_like_credential) {
        return None;
    }
    safe_ax_text(Some(url), remaining)
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActiveWindowContext {
    pub app_name: Option<String>,
    pub window_title: Option<String>,
    pub bundle_id: Option<String>,
    pub source: String,
}

#[tauri::command]
pub async fn active_window_context() -> Result<ActiveWindowContext, String> {
    #[cfg(target_os = "macos")]
    {
        Ok(macos::active_window_context_impl())
    }
    #[cfg(not(target_os = "macos"))]
    {
        Ok(ActiveWindowContext {
            app_name: None,
            window_title: None,
            bundle_id: None,
            source: "unsupported".into(),
        })
    }
}

#[tauri::command]
pub async fn read_focused_field_text() -> Result<String, String> {
    #[cfg(target_os = "macos")]
    {
        Ok(macos::read_focused_field_text_impl())
    }
    #[cfg(not(target_os = "macos"))]
    {
        Err("Accessibility API not available on this OS".into())
    }
}

/// Whether the focused UI element takes text. `None` means Accessibility could
/// not answer (the app did not reply in time, which happens on a busy Mac); the
/// caller should then try to paste rather than give up.
pub fn focused_text_field_state() -> Option<bool> {
    #[cfg(target_os = "macos")]
    {
        macos::focused_text_field_state_impl()
    }
    #[cfg(not(target_os = "macos"))]
    {
        Some(false)
    }
}

/// Paste unless Accessibility positively says the focus is not a text field.
pub fn should_paste(state: Option<bool>) -> bool {
    state.unwrap_or(true)
}

/// Result of one Accessibility attribute read, keeping apart "the app said
/// there is no such value" and "the app did not answer".
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AxRead<T> {
    Value(T),
    /// The app answered: the attribute is unsupported, has no value, or has an
    /// unexpected type.
    Absent,
    /// The app did not answer (timed out or failed to reply).
    Unanswered,
}

impl<T> AxRead<T> {
    fn is_present(&self) -> Option<bool> {
        match self {
            AxRead::Value(_) => Some(true),
            AxRead::Absent => Some(false),
            AxRead::Unanswered => None,
        }
    }
}

/// AX error codes that mean the app did not answer: kAXErrorFailure (-25200),
/// kAXErrorCannotComplete (-25204, the messaging timeout) and
/// kAXErrorNotImplemented (-25208, an app that does not serve Accessibility).
/// Everything else, such as kAXErrorAttributeUnsupported (-25205) or
/// kAXErrorNoValue (-25212), is an answer.
pub fn ax_error_is_unanswered(error: i32) -> bool {
    matches!(error, -25200 | -25204 | -25208)
}

/// Three-valued AND: `Some(false)` wins, then `None`, then `Some(true)`.
fn all_known(parts: &[Option<bool>]) -> Option<bool> {
    if parts.iter().any(|part| *part == Some(false)) {
        Some(false)
    } else if parts.iter().any(Option::is_none) {
        None
    } else {
        Some(true)
    }
}

/// Decide whether the focused element takes text from its attribute reads.
/// `None` means a read that mattered went unanswered, so the caller should try
/// the paste; an answered "unsupported" or "no value" never leads to `None`.
pub fn classify_focused_element(
    role: &AxRead<String>,
    editable: &AxRead<bool>,
    selected_range: &AxRead<()>,
    value: &AxRead<()>,
) -> Option<bool> {
    let role = match role {
        AxRead::Value(role) => role.as_str(),
        AxRead::Absent => return Some(false),
        AxRead::Unanswered => return None,
    };
    if matches!(
        role,
        "AXTextField" | "AXTextArea" | "AXSearchField" | "AXComboBox"
    ) {
        return Some(true);
    }
    if role != "AXWebArea" {
        return Some(false);
    }
    let is_editable = match editable {
        AxRead::Value(editable) => Some(*editable),
        AxRead::Absent => Some(false),
        AxRead::Unanswered => None,
    };
    // Three-valued OR of "has a selection range" and "has a value".
    let has_content = match (selected_range.is_present(), value.is_present()) {
        (Some(true), _) | (_, Some(true)) => Some(true),
        (Some(false), Some(false)) => Some(false),
        _ => None,
    };
    all_known(&[is_editable, has_content])
}

pub fn focused_text_field_available() -> bool {
    should_paste(focused_text_field_state())
}

#[tauri::command]
pub async fn accessibility_check_permission() -> Result<bool, String> {
    #[cfg(target_os = "macos")]
    {
        Ok(macos::is_trusted(false))
    }
    #[cfg(not(target_os = "macos"))]
    {
        Err("Accessibility API not available on this OS".into())
    }
}

#[tauri::command]
pub async fn accessibility_request_permission() -> Result<bool, String> {
    #[cfg(target_os = "macos")]
    {
        Ok(macos::is_trusted(true))
    }
    #[cfg(not(target_os = "macos"))]
    {
        Err("Accessibility API not available on this OS".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn role(role: &str) -> AxRead<String> {
        AxRead::Value(role.to_string())
    }

    #[test]
    fn unsupported_role_is_not_a_text_field() {
        // The app answered that the element has no role: no fallback paste.
        let state = classify_focused_element(
            &AxRead::Absent,
            &AxRead::Absent,
            &AxRead::Absent,
            &AxRead::Absent,
        );
        assert_eq!(state, Some(false));
        assert!(!should_paste(state));
    }

    #[test]
    fn unanswered_role_falls_back_to_paste() {
        let state = classify_focused_element(
            &AxRead::Unanswered,
            &AxRead::Absent,
            &AxRead::Absent,
            &AxRead::Absent,
        );
        assert_eq!(state, None);
        assert!(should_paste(state));
    }

    #[test]
    fn text_roles_take_text_and_other_roles_do_not() {
        for text_role in ["AXTextField", "AXTextArea", "AXSearchField", "AXComboBox"] {
            assert_eq!(
                classify_focused_element(
                    &role(text_role),
                    &AxRead::Unanswered,
                    &AxRead::Unanswered,
                    &AxRead::Unanswered,
                ),
                Some(true)
            );
        }
        assert_eq!(
            classify_focused_element(
                &role("AXButton"),
                &AxRead::Unanswered,
                &AxRead::Unanswered,
                &AxRead::Unanswered,
            ),
            Some(false)
        );
    }

    #[test]
    fn timed_out_web_area_read_does_not_block_paste_into_editable_field() {
        // AXEditable timed out, but the field has a selection range.
        let state = classify_focused_element(
            &role("AXWebArea"),
            &AxRead::Unanswered,
            &AxRead::Value(()),
            &AxRead::Absent,
        );
        assert_eq!(state, None);
        assert!(should_paste(state));

        // Editable, the selection-range read timed out, no value.
        let state = classify_focused_element(
            &role("AXWebArea"),
            &AxRead::Value(true),
            &AxRead::Unanswered,
            &AxRead::Absent,
        );
        assert_eq!(state, None);
        assert!(should_paste(state));

        // A timeout that does not matter: the other read already says yes.
        assert_eq!(
            classify_focused_element(
                &role("AXWebArea"),
                &AxRead::Value(true),
                &AxRead::Unanswered,
                &AxRead::Value(()),
            ),
            Some(true)
        );
    }

    #[test]
    fn answered_web_area_reads_decide_without_fallback() {
        let editable_with_range = classify_focused_element(
            &role("AXWebArea"),
            &AxRead::Value(true),
            &AxRead::Value(()),
            &AxRead::Absent,
        );
        assert_eq!(editable_with_range, Some(true));

        let not_editable = classify_focused_element(
            &role("AXWebArea"),
            &AxRead::Value(false),
            &AxRead::Unanswered,
            &AxRead::Unanswered,
        );
        assert_eq!(not_editable, Some(false));

        let editable_unsupported = classify_focused_element(
            &role("AXWebArea"),
            &AxRead::Absent,
            &AxRead::Value(()),
            &AxRead::Value(()),
        );
        assert_eq!(editable_unsupported, Some(false));

        let editable_without_content = classify_focused_element(
            &role("AXWebArea"),
            &AxRead::Value(true),
            &AxRead::Absent,
            &AxRead::Absent,
        );
        assert_eq!(editable_without_content, Some(false));
    }

    #[test]
    fn ax_error_kinds() {
        assert!(ax_error_is_unanswered(-25204)); // kAXErrorCannotComplete
        assert!(ax_error_is_unanswered(-25200)); // kAXErrorFailure
        assert!(ax_error_is_unanswered(-25208)); // kAXErrorNotImplemented
        assert!(!ax_error_is_unanswered(-25205)); // kAXErrorAttributeUnsupported
        assert!(!ax_error_is_unanswered(-25212)); // kAXErrorNoValue
        assert!(!ax_error_is_unanswered(0));
    }

    #[test]
    fn pastes_unless_accessibility_says_no_text_field() {
        assert!(should_paste(Some(true)));
        assert!(should_paste(None));
        assert!(!should_paste(Some(false)));
    }

    #[test]
    fn ax_text_is_bounded_and_budgeted() {
        let mut remaining = 12;
        let value = safe_ax_text(Some("a very long accessible title".into()), &mut remaining)
            .expect("safe title");
        assert_eq!(value.len(), 12);
        assert_eq!(remaining, 0);
        assert!(safe_ax_text(Some("another title".into()), &mut remaining).is_none());
    }

    #[test]
    fn credential_shaped_text_is_not_retained() {
        let mut remaining = MAX_AX_TOTAL_BYTES;
        assert!(safe_ax_text(Some("password: hunter2".into()), &mut remaining).is_none());
        assert!(
            safe_ax_text(Some("API key: short-but-sensitive".into()), &mut remaining).is_none()
        );
        assert!(safe_ax_text(
            Some("eyJhbGciOiJIUzI1NiJ9.abcdefghijklmnopqrstuvwxyz.0123456789abcdef".into()),
            &mut remaining
        )
        .is_none());
        assert!(role_is_secure("AXSecureTextField"));
        assert!(safe_ax_url(
            "https://alice:secret@example.test/document".into(),
            &mut remaining
        )
        .is_none());
        assert!(safe_ax_url(
            "https://example.test/session/abcdefghijklmnopqrstuvwxyz123456".into(),
            &mut remaining
        )
        .is_none());
    }
}

#[cfg(target_os = "macos")]
pub(crate) mod macos {
    use super::{
        ax_error_is_unanswered, classify_focused_element, role_is_secure, safe_ax_text,
        safe_ax_url, AccessibilityFingerprint, AccessibilitySemanticNode, ActiveWindowContext,
        AxRead, MAX_AX_DEPTH, MAX_AX_LABELS, MAX_AX_NODES, MAX_AX_TOTAL_BYTES,
    };
    use core_foundation::array::CFArray;
    use core_foundation::base::{CFType, TCFType};
    use core_foundation::dictionary::CFDictionary;
    use core_foundation::number::CFNumber;
    use core_foundation::string::CFString;
    use core_graphics::window::{
        kCGNullWindowID, kCGWindowListExcludeDesktopElements, kCGWindowListOptionOnScreenOnly,
        CGWindowListCopyWindowInfo,
    };
    use std::ffi::c_void;
    use std::ptr;

    type CFTypeRef = *const c_void;
    type CFStringRef = *const c_void;
    type CFDictionaryRef = *const c_void;
    type CFArrayRef = *const c_void;
    type CFBooleanRef = *const c_void;
    type CFAllocatorRef = *const c_void;
    type CFIndex = isize;
    type CFTypeID = usize;
    type Boolean = u8;
    type AXUIElementRef = *const c_void;
    type AXError = i32;

    const AX_ERROR_SUCCESS: AXError = 0;

    const K_CF_STRING_ENCODING_UTF8: u32 = 0x08000100;
    const IGNORED_WINDOW_OWNERS: &[&str] = &[
        "Clips",
        "Clips Dev",
        "Control Center",
        "Dock",
        "Notification Center",
        "SystemUIServer",
        "Window Server",
    ];

    #[link(name = "ApplicationServices", kind = "framework")]
    extern "C" {
        fn AXIsProcessTrustedWithOptions(options: CFDictionaryRef) -> Boolean;
        fn AXUIElementCreateSystemWide() -> AXUIElementRef;
        fn AXUIElementCreateApplication(pid: i32) -> AXUIElementRef;
        fn AXUIElementCopyAttributeValue(
            element: AXUIElementRef,
            attribute: CFStringRef,
            value: *mut CFTypeRef,
        ) -> AXError;
        static kAXTrustedCheckOptionPrompt: CFStringRef;
    }

    #[link(name = "CoreFoundation", kind = "framework")]
    extern "C" {
        fn CFStringCreateWithCString(
            allocator: CFAllocatorRef,
            c_str: *const i8,
            encoding: u32,
        ) -> CFStringRef;
        fn CFStringGetCStringPtr(string: CFStringRef, encoding: u32) -> *const i8;
        fn CFStringGetLength(string: CFStringRef) -> CFIndex;
        fn CFStringGetMaximumSizeForEncoding(length: CFIndex, encoding: u32) -> CFIndex;
        fn CFStringGetCString(
            string: CFStringRef,
            buffer: *mut i8,
            buffer_size: CFIndex,
            encoding: u32,
        ) -> Boolean;
        fn CFRelease(cf: CFTypeRef);
        fn CFGetTypeID(cf: CFTypeRef) -> CFTypeID;
        fn CFStringGetTypeID() -> CFTypeID;
        fn CFBooleanGetTypeID() -> CFTypeID;
        fn CFURLGetTypeID() -> CFTypeID;
        fn CFArrayGetCount(array: CFArrayRef) -> CFIndex;
        fn CFArrayGetValueAtIndex(array: CFArrayRef, index: CFIndex) -> *const c_void;
        fn CFURLGetString(url: CFTypeRef) -> CFStringRef;
        fn CFDictionaryCreate(
            allocator: CFAllocatorRef,
            keys: *const *const c_void,
            values: *const *const c_void,
            num_values: CFIndex,
            key_callbacks: *const c_void,
            value_callbacks: *const c_void,
        ) -> CFDictionaryRef;
        static kCFTypeDictionaryKeyCallBacks: c_void;
        static kCFTypeDictionaryValueCallBacks: c_void;
        static kCFBooleanTrue: CFBooleanRef;
    }

    unsafe fn cfstr(s: &str) -> CFStringRef {
        let c = std::ffi::CString::new(s).unwrap();
        CFStringCreateWithCString(ptr::null(), c.as_ptr(), K_CF_STRING_ENCODING_UTF8)
    }

    unsafe fn cfstring_to_string(cfstr: CFStringRef) -> Option<String> {
        if cfstr.is_null() {
            return None;
        }
        let direct = CFStringGetCStringPtr(cfstr, K_CF_STRING_ENCODING_UTF8);
        if !direct.is_null() {
            let cstr = std::ffi::CStr::from_ptr(direct);
            return Some(cstr.to_string_lossy().into_owned());
        }
        let len = CFStringGetLength(cfstr);
        if len == 0 {
            return Some(String::new());
        }
        let max = CFStringGetMaximumSizeForEncoding(len, K_CF_STRING_ENCODING_UTF8);
        if max <= 0 {
            return None;
        }
        let mut buf = vec![0i8; (max as usize) + 1];
        let ok = CFStringGetCString(
            cfstr,
            buf.as_mut_ptr(),
            buf.len() as CFIndex,
            K_CF_STRING_ENCODING_UTF8,
        );
        if ok == 0 {
            return None;
        }
        let cstr = std::ffi::CStr::from_ptr(buf.as_ptr());
        Some(cstr.to_string_lossy().into_owned())
    }

    pub fn is_trusted(prompt: bool) -> bool {
        unsafe {
            if !prompt {
                return AXIsProcessTrustedWithOptions(ptr::null()) != 0;
            }
            let key: CFStringRef = kAXTrustedCheckOptionPrompt;
            let value: CFBooleanRef = kCFBooleanTrue;
            let keys: [*const c_void; 1] = [key];
            let vals: [*const c_void; 1] = [value];
            let dict = CFDictionaryCreate(
                ptr::null(),
                keys.as_ptr(),
                vals.as_ptr(),
                1,
                &kCFTypeDictionaryKeyCallBacks as *const _,
                &kCFTypeDictionaryValueCallBacks as *const _,
            );
            if dict.is_null() {
                return AXIsProcessTrustedWithOptions(ptr::null()) != 0;
            }
            let trusted = AXIsProcessTrustedWithOptions(dict) != 0;
            CFRelease(dict as CFTypeRef);
            trusted
        }
    }

    pub fn read_focused_field_text_impl() -> String {
        unsafe {
            if !is_trusted(false) {
                return String::new();
            }

            let system = AXUIElementCreateSystemWide();
            if system.is_null() {
                return String::new();
            }

            let focused_attr = cfstr("AXFocusedUIElement");
            if focused_attr.is_null() {
                CFRelease(system as CFTypeRef);
                return String::new();
            }

            let mut focused: CFTypeRef = ptr::null();
            let err = AXUIElementCopyAttributeValue(system, focused_attr, &mut focused);
            CFRelease(focused_attr as CFTypeRef);
            CFRelease(system as CFTypeRef);

            if err != AX_ERROR_SUCCESS || focused.is_null() {
                return String::new();
            }

            let value_attr = cfstr("AXValue");
            if value_attr.is_null() {
                CFRelease(focused);
                return String::new();
            }

            let mut value: CFTypeRef = ptr::null();
            let err =
                AXUIElementCopyAttributeValue(focused as AXUIElementRef, value_attr, &mut value);
            CFRelease(value_attr as CFTypeRef);
            CFRelease(focused);

            if err != AX_ERROR_SUCCESS || value.is_null() {
                return String::new();
            }

            let is_string = CFGetTypeID(value) == CFStringGetTypeID();
            let result = if is_string {
                cfstring_to_string(value as CFStringRef).unwrap_or_default()
            } else {
                String::new()
            };
            CFRelease(value);
            result
        }
    }

    /// Copy one attribute, keeping apart "no such value" and "no answer".
    /// On `Value`, the caller owns the returned reference and must release it.
    unsafe fn copy_ax_attribute_read(
        element: AXUIElementRef,
        attribute: &str,
    ) -> AxRead<CFTypeRef> {
        let attribute_name = attribute;
        let attribute = cfstr(attribute);
        if attribute.is_null() {
            return AxRead::Absent;
        }
        let mut value = ptr::null();
        let error = AXUIElementCopyAttributeValue(element, attribute, &mut value);
        CFRelease(attribute as CFTypeRef);
        if error == AX_ERROR_SUCCESS && !value.is_null() {
            return AxRead::Value(value);
        }
        if !value.is_null() {
            CFRelease(value);
        }
        if ax_error_is_unanswered(error) {
            eprintln!("[accessibility] {attribute_name} read went unanswered (AXError {error})");
            AxRead::Unanswered
        } else {
            AxRead::Absent
        }
    }

    unsafe fn ax_string_read(element: AXUIElementRef, attribute: &str) -> AxRead<String> {
        match copy_ax_attribute_read(element, attribute) {
            AxRead::Value(raw) => {
                let value = if CFGetTypeID(raw) == CFStringGetTypeID() {
                    cfstring_to_string(raw as CFStringRef)
                } else {
                    None
                };
                CFRelease(raw);
                value.map_or(AxRead::Absent, AxRead::Value)
            }
            AxRead::Absent => AxRead::Absent,
            AxRead::Unanswered => AxRead::Unanswered,
        }
    }

    unsafe fn ax_bool_read(element: AXUIElementRef, attribute: &str) -> AxRead<bool> {
        match copy_ax_attribute_read(element, attribute) {
            AxRead::Value(raw) => {
                let value = (CFGetTypeID(raw) == CFBooleanGetTypeID())
                    .then_some(raw == kCFBooleanTrue as CFTypeRef);
                CFRelease(raw);
                value.map_or(AxRead::Absent, AxRead::Value)
            }
            AxRead::Absent => AxRead::Absent,
            AxRead::Unanswered => AxRead::Unanswered,
        }
    }

    unsafe fn ax_presence_read(element: AXUIElementRef, attribute: &str) -> AxRead<()> {
        match copy_ax_attribute_read(element, attribute) {
            AxRead::Value(raw) => {
                CFRelease(raw);
                AxRead::Value(())
            }
            AxRead::Absent => AxRead::Absent,
            AxRead::Unanswered => AxRead::Unanswered,
        }
    }

    pub fn focused_text_field_state_impl() -> Option<bool> {
        unsafe {
            if !is_trusted(false) {
                return Some(false);
            }

            let system = AXUIElementCreateSystemWide();
            if system.is_null() {
                return None;
            }
            let focused = copy_ax_attribute_read(system, "AXFocusedUIElement");
            CFRelease(system as CFTypeRef);
            let focused = match focused {
                AxRead::Value(focused) => focused as AXUIElementRef,
                AxRead::Absent => return Some(false),
                AxRead::Unanswered => return None,
            };

            let role = ax_string_read(focused, "AXRole");
            let is_web_area = role == AxRead::Value("AXWebArea".to_string());
            // Only a web area needs the extra reads; skip them otherwise so a
            // slow app is not asked three more questions for nothing.
            let (editable, selected_range, value) = if is_web_area {
                (
                    ax_bool_read(focused, "AXEditable"),
                    ax_presence_read(focused, "AXSelectedTextRange"),
                    match ax_string_read(focused, "AXValue") {
                        AxRead::Value(_) => AxRead::Value(()),
                        AxRead::Absent => AxRead::Absent,
                        AxRead::Unanswered => AxRead::Unanswered,
                    },
                )
            } else {
                (AxRead::Absent, AxRead::Absent, AxRead::Absent)
            };
            CFRelease(focused as CFTypeRef);

            let state = classify_focused_element(&role, &editable, &selected_range, &value);
            match state {
                Some(true) => {}
                Some(false) => eprintln!(
                    "[accessibility] focused element is not a text field (role {role:?})"
                ),
                None => eprintln!(
                    "[accessibility] text field check unanswered (role {role:?}, editable {editable:?}, range {selected_range:?}, value {value:?})"
                ),
            }
            state
        }
    }

    pub fn semantic_fingerprint_for_pid_impl(pid: i32) -> Option<AccessibilityFingerprint> {
        unsafe {
            if !is_trusted(false) {
                return None;
            }
            let application = AXUIElementCreateApplication(pid);
            if application.is_null() {
                return None;
            }
            let window = copy_ax_element_attribute(application, "AXFocusedWindow");
            let focused = copy_ax_element_attribute(application, "AXFocusedUIElement");
            CFRelease(application as CFTypeRef);

            let document_element = window.or(focused)?;
            let mut remaining = MAX_AX_TOTAL_BYTES;
            let document = semantic_node(document_element, false, &mut remaining);
            let focused_node =
                focused.and_then(|element| semantic_node(element, true, &mut remaining));
            let mut labels = Vec::new();
            collect_visible_labels(document_element, 0, &mut labels, &mut remaining);

            if let Some(window) = window {
                CFRelease(window);
            }
            if let Some(focused) = focused {
                CFRelease(focused);
            }

            if document.is_none() && focused_node.is_none() && labels.is_empty() {
                None
            } else {
                Some(AccessibilityFingerprint {
                    document,
                    focused: focused_node,
                    visible_labels: labels,
                })
            }
        }
    }

    unsafe fn copy_ax_element_attribute(
        element: AXUIElementRef,
        attribute: &str,
    ) -> Option<AXUIElementRef> {
        let attribute = cfstr(attribute);
        if attribute.is_null() {
            return None;
        }
        let mut value = ptr::null();
        let error = AXUIElementCopyAttributeValue(element, attribute, &mut value);
        CFRelease(attribute as CFTypeRef);
        (error == AX_ERROR_SUCCESS && !value.is_null()).then_some(value as AXUIElementRef)
    }

    unsafe fn ax_string_attribute(element: AXUIElementRef, attribute: &str) -> Option<String> {
        let attribute = cfstr(attribute);
        if attribute.is_null() {
            return None;
        }
        let mut raw_value = ptr::null();
        let error = AXUIElementCopyAttributeValue(element, attribute, &mut raw_value);
        CFRelease(attribute as CFTypeRef);
        if error != AX_ERROR_SUCCESS || raw_value.is_null() {
            return None;
        }
        let value = if CFGetTypeID(raw_value) == CFStringGetTypeID() {
            cfstring_to_string(raw_value as CFStringRef)
        } else {
            None
        };
        CFRelease(raw_value);
        value
    }

    unsafe fn ax_url_attribute(element: AXUIElementRef) -> Option<String> {
        let attribute = cfstr("AXURL");
        if attribute.is_null() {
            return None;
        }
        let mut value = ptr::null();
        let error = AXUIElementCopyAttributeValue(element, attribute, &mut value);
        CFRelease(attribute as CFTypeRef);
        if error != AX_ERROR_SUCCESS || value.is_null() {
            return None;
        }
        let string = if CFGetTypeID(value) == CFStringGetTypeID() {
            value as CFStringRef
        } else if CFGetTypeID(value) == CFURLGetTypeID() {
            CFURLGetString(value)
        } else {
            ptr::null()
        };
        let result = cfstring_to_string(string)
            .and_then(|url| url.split(['?', '#']).next().map(str::to_string));
        CFRelease(value);
        result
    }

    unsafe fn semantic_node(
        element: AXUIElementRef,
        focused: bool,
        remaining: &mut usize,
    ) -> Option<AccessibilitySemanticNode> {
        let role = ax_string_attribute(element, "AXRole")?;
        if role_is_secure(&role) {
            return None;
        }
        let role = safe_ax_text(Some(role), remaining)?;
        let title = safe_ax_text(ax_string_attribute(element, "AXTitle"), remaining);
        let description = safe_ax_text(ax_string_attribute(element, "AXDescription"), remaining);
        let document = safe_ax_text(ax_string_attribute(element, "AXDocument"), remaining);
        let url = ax_url_attribute(element).and_then(|url| safe_ax_url(url, remaining));
        let selected_text = focused
            .then(|| ax_string_attribute(element, "AXSelectedText"))
            .flatten()
            .and_then(|text| safe_ax_text(Some(text), remaining));
        Some(AccessibilitySemanticNode {
            role,
            title,
            description,
            document,
            url,
            selected_text,
        })
    }

    unsafe fn collect_visible_labels(
        element: AXUIElementRef,
        depth: usize,
        labels: &mut Vec<String>,
        remaining: &mut usize,
    ) {
        if depth >= MAX_AX_DEPTH || labels.len() >= MAX_AX_LABELS || *remaining == 0 {
            return;
        }
        let attribute = cfstr("AXChildren");
        if attribute.is_null() {
            return;
        }
        let mut children = ptr::null();
        let error = AXUIElementCopyAttributeValue(element, attribute, &mut children);
        CFRelease(attribute as CFTypeRef);
        if error != AX_ERROR_SUCCESS || children.is_null() {
            return;
        }
        let count = (CFArrayGetCount(children) as usize).min(MAX_AX_NODES);
        for index in 0..count {
            if labels.len() >= MAX_AX_LABELS || *remaining == 0 {
                break;
            }
            let child = CFArrayGetValueAtIndex(children, index as CFIndex) as AXUIElementRef;
            if child.is_null() {
                continue;
            }
            let role = ax_string_attribute(child, "AXRole");
            if role.as_deref().is_some_and(role_is_secure) {
                continue;
            }
            let label = ax_string_attribute(child, "AXTitle")
                .or_else(|| ax_string_attribute(child, "AXDescription"))
                .and_then(|text| safe_ax_text(Some(text), remaining));
            if let Some(label) = label {
                labels.push(label);
            }
        }
        CFRelease(children);
    }

    pub fn active_window_context_impl() -> ActiveWindowContext {
        active_window_context_with_pid_impl().0
    }

    pub(crate) fn active_window_context_with_pid_impl() -> (ActiveWindowContext, Option<i32>) {
        let window = active_window_from_core_graphics();
        let frontmost = frontmost_application();
        let owner = window
            .as_ref()
            .and_then(|window| window.owner_pid)
            .and_then(application_for_pid);
        let owner_pid = window.as_ref().and_then(|window| window.owner_pid);

        (
            ActiveWindowContext {
                app_name: window
                    .as_ref()
                    .and_then(|w| w.app_name.clone())
                    .or_else(|| owner.as_ref().and_then(|app| app.app_name.clone()))
                    .or_else(|| frontmost.as_ref().and_then(|app| app.app_name.clone())),
                window_title: window.and_then(|w| w.window_title),
                bundle_id: owner
                    .and_then(|app| app.bundle_id)
                    .or_else(|| frontmost.and_then(|app| app.bundle_id)),
                source: "core-graphics".to_string(),
            },
            owner_pid,
        )
    }

    #[derive(Debug, Clone)]
    struct WindowInfo {
        app_name: Option<String>,
        window_title: Option<String>,
        owner_pid: Option<i32>,
    }

    #[derive(Debug, Clone)]
    struct AppInfo {
        app_name: Option<String>,
        bundle_id: Option<String>,
    }

    fn active_window_from_core_graphics() -> Option<WindowInfo> {
        unsafe {
            let raw = CGWindowListCopyWindowInfo(
                kCGWindowListOptionOnScreenOnly | kCGWindowListExcludeDesktopElements,
                kCGNullWindowID,
            );
            if raw.is_null() {
                return None;
            }

            let windows: CFArray<CFDictionary<CFString, CFType>> =
                TCFType::wrap_under_create_rule(raw);
            for index in 0..windows.len() {
                let Some(window) = windows.get(index) else {
                    continue;
                };
                let layer = dict_number_i64(&window, "kCGWindowLayer").unwrap_or(0);
                if layer != 0 {
                    continue;
                }
                let owner = dict_string(&window, "kCGWindowOwnerName");
                if owner
                    .as_deref()
                    .map(is_ignored_window_owner)
                    .unwrap_or(true)
                {
                    continue;
                }
                let title = dict_string(&window, "kCGWindowName");
                return Some(WindowInfo {
                    app_name: owner,
                    window_title: title,
                    owner_pid: dict_number_i64(&window, "kCGWindowOwnerPID")
                        .and_then(|pid| i32::try_from(pid).ok()),
                });
            }
        }
        None
    }

    fn frontmost_application() -> Option<AppInfo> {
        use objc2::msg_send;
        use objc2::rc::autoreleasepool;
        use objc2::runtime::{AnyClass, AnyObject};

        autoreleasepool(|_| unsafe {
            let class_name = std::ffi::CString::new("NSWorkspace").ok()?;
            let cls: &AnyClass = AnyClass::get(&class_name)?;
            let workspace: *mut AnyObject = msg_send![cls, sharedWorkspace];
            if workspace.is_null() {
                return None;
            }
            let app: *mut AnyObject = msg_send![workspace, frontmostApplication];
            if app.is_null() {
                return None;
            }
            let app_name: *mut AnyObject = msg_send![app, localizedName];
            let bundle_id: *mut AnyObject = msg_send![app, bundleIdentifier];
            Some(AppInfo {
                app_name: ns_string_to_owned(app_name),
                bundle_id: ns_string_to_owned(bundle_id),
            })
        })
    }

    fn application_for_pid(pid: i32) -> Option<AppInfo> {
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
            let app_name: *mut AnyObject = msg_send![app, localizedName];
            let bundle_id: *mut AnyObject = msg_send![app, bundleIdentifier];
            Some(AppInfo {
                app_name: ns_string_to_owned(app_name),
                bundle_id: ns_string_to_owned(bundle_id),
            })
        })
    }

    fn dict_string(dict: &CFDictionary<CFString, CFType>, key: &'static str) -> Option<String> {
        let key = CFString::from_static_string(key);
        let value = dict.find(&key)?;
        let string = value.downcast::<CFString>()?.to_string();
        let trimmed = string.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        }
    }

    fn dict_number_i64(dict: &CFDictionary<CFString, CFType>, key: &'static str) -> Option<i64> {
        let key = CFString::from_static_string(key);
        dict.find(&key)?.downcast::<CFNumber>()?.to_i64()
    }

    fn is_ignored_window_owner(owner: &str) -> bool {
        IGNORED_WINDOW_OWNERS
            .iter()
            .any(|ignored| owner.eq_ignore_ascii_case(ignored))
    }

    unsafe fn ns_string_to_owned(ptr: *mut objc2::runtime::AnyObject) -> Option<String> {
        if ptr.is_null() {
            return None;
        }
        let utf8_ptr: *const i8 = objc2::msg_send![ptr, UTF8String];
        if utf8_ptr.is_null() {
            return None;
        }
        let cstr = std::ffi::CStr::from_ptr(utf8_ptr);
        let value = cstr.to_string_lossy().trim().to_string();
        if value.is_empty() {
            None
        } else {
            Some(value)
        }
    }
}
