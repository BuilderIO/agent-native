//! macOS Accessibility (AX) bridge — read the focused UI element's text.
//!
//! This powers the personal-vocabulary auto-learn loop in
//! `templates/clips/desktop/src/lib/personal-vocabulary.ts`. After a Wispr
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
        // Pass prompt=true: if not yet trusted, macOS surfaces a dialog
        // and opens the Accessibility pane in System Settings. Return
        // value reflects current state (will be `false` until the user
        // adds + restarts the app).
        Ok(macos::is_trusted(true))
    }
    #[cfg(not(target_os = "macos"))]
    {
        Err("Accessibility API not available on this OS".into())
    }
}

#[cfg(target_os = "macos")]
mod macos {
    use std::ffi::c_void;
    use std::ptr;

    type CFTypeRef = *const c_void;
    type CFStringRef = *const c_void;
    type CFDictionaryRef = *const c_void;
    type CFBooleanRef = *const c_void;
    type CFAllocatorRef = *const c_void;
    type CFIndex = isize;
    type CFTypeID = usize;
    type Boolean = u8;
    type AXUIElementRef = *const c_void;
    type AXError = i32;

    const AX_ERROR_SUCCESS: AXError = 0;

    // CFStringEncoding for UTF-8 = 0x08000100.
    const K_CF_STRING_ENCODING_UTF8: u32 = 0x08000100;

    #[link(name = "ApplicationServices", kind = "framework")]
    extern "C" {
        fn AXIsProcessTrustedWithOptions(options: CFDictionaryRef) -> Boolean;
        fn AXUIElementCreateSystemWide() -> AXUIElementRef;
        fn AXUIElementCopyAttributeValue(
            element: AXUIElementRef,
            attribute: CFStringRef,
            value: *mut CFTypeRef,
        ) -> AXError;
        // Exposed as a constant CFStringRef in ApplicationServices.
        static kAXTrustedCheckOptionPrompt: CFStringRef;
    }

    #[link(name = "CoreFoundation", kind = "framework")]
    extern "C" {
        fn CFStringCreateWithCString(
            allocator: CFAllocatorRef,
            c_str: *const i8,
            encoding: u32,
        ) -> CFStringRef;
        fn CFStringGetCStringPtr(
            string: CFStringRef,
            encoding: u32,
        ) -> *const i8;
        fn CFStringGetLength(string: CFStringRef) -> CFIndex;
        fn CFStringGetMaximumSizeForEncoding(
            length: CFIndex,
            encoding: u32,
        ) -> CFIndex;
        fn CFStringGetCString(
            string: CFStringRef,
            buffer: *mut i8,
            buffer_size: CFIndex,
            encoding: u32,
        ) -> Boolean;
        fn CFRelease(cf: CFTypeRef);
        fn CFGetTypeID(cf: CFTypeRef) -> CFTypeID;
        fn CFStringGetTypeID() -> CFTypeID;
        fn CFDictionaryCreate(
            allocator: CFAllocatorRef,
            keys: *const *const c_void,
            values: *const *const c_void,
            num_values: CFIndex,
            key_callbacks: *const c_void,
            value_callbacks: *const c_void,
        ) -> CFDictionaryRef;
        // kCFTypeDictionaryKeyCallBacks / kCFTypeDictionaryValueCallBacks
        // are exposed as static structs we can pass as opaque pointers.
        static kCFTypeDictionaryKeyCallBacks: c_void;
        static kCFTypeDictionaryValueCallBacks: c_void;
        static kCFBooleanTrue: CFBooleanRef;
    }

    /// Build a CFString from a Rust &str. Caller must CFRelease the result.
    unsafe fn cfstr(s: &str) -> CFStringRef {
        let c = std::ffi::CString::new(s).unwrap();
        CFStringCreateWithCString(ptr::null(), c.as_ptr(), K_CF_STRING_ENCODING_UTF8)
    }

    /// Convert a CFStringRef to a Rust String. Does NOT release the CFString.
    unsafe fn cfstring_to_string(cfstr: CFStringRef) -> Option<String> {
        if cfstr.is_null() {
            return None;
        }
        // Fast path: try to get a direct pointer to the underlying UTF-8.
        let direct = CFStringGetCStringPtr(cfstr, K_CF_STRING_ENCODING_UTF8);
        if !direct.is_null() {
            let cstr = std::ffi::CStr::from_ptr(direct);
            return Some(cstr.to_string_lossy().into_owned());
        }
        // Slow path: copy out via a sized buffer.
        let len = CFStringGetLength(cfstr);
        if len == 0 {
            return Some(String::new());
        }
        let max = CFStringGetMaximumSizeForEncoding(len, K_CF_STRING_ENCODING_UTF8);
        if max <= 0 {
            return None;
        }
        let mut buf = vec![0i8; (max as usize) + 1];
        let ok = CFStringGetCString(cfstr, buf.as_mut_ptr(), buf.len() as CFIndex, K_CF_STRING_ENCODING_UTF8);
        if ok == 0 {
            return None;
        }
        let cstr = std::ffi::CStr::from_ptr(buf.as_ptr());
        Some(cstr.to_string_lossy().into_owned())
    }

    /// Whether the current process is trusted for Accessibility. If `prompt`
    /// is true and we are NOT yet trusted, macOS shows a system dialog
    /// directing the user to System Settings.
    pub fn is_trusted(prompt: bool) -> bool {
        unsafe {
            if !prompt {
                return AXIsProcessTrustedWithOptions(ptr::null()) != 0;
            }
            // Build { kAXTrustedCheckOptionPrompt: kCFBooleanTrue }.
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

    /// Read AXValue of the system-wide focused element. Returns "" on any
    /// failure (untrusted, no focus, non-string value, etc.). Never panics.
    pub fn read_focused_field_text_impl() -> String {
        unsafe {
            // Bail fast (and silently) if the user hasn't trusted us. The
            // JS treats "" as "couldn't read" and stops polling after a
            // few empty results.
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
            let err = AXUIElementCopyAttributeValue(
                focused as AXUIElementRef,
                value_attr,
                &mut value,
            );
            CFRelease(value_attr as CFTypeRef);
            CFRelease(focused);

            if err != AX_ERROR_SUCCESS || value.is_null() {
                return String::new();
            }

            // Only return the value if it's a CFString. AXValue can also
            // come back as CFNumber (sliders/steppers), CFURL, or a
            // structured AXValue (e.g. CGPoint for AXPosition) — none
            // useful for us here.
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
}
