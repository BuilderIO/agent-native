use serde::Serialize;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PermissionStatuses {
    pub screen: bool,
    pub camera: bool,
    pub microphone: bool,
    pub speech: bool,
    pub accessibility: bool,
    pub input_monitoring: bool,
}

#[tauri::command]
pub fn check_permission_statuses() -> PermissionStatuses {
    #[cfg(target_os = "macos")]
    {
        macos::check_all()
    }
    #[cfg(not(target_os = "macos"))]
    {
        // Windows and Linux permissions are granted through the WebView and,
        // on Linux, the XDG desktop portal. There is no reliable synchronous
        // preflight equivalent to macOS TCC here, so report unavailable rather
        // than claiming permissions were granted. The non-macOS UI relies on
        // the actual media prompt and does not render these values.
        PermissionStatuses {
            screen: false,
            camera: false,
            microphone: false,
            speech: false,
            accessibility: false,
            input_monitoring: false,
        }
    }
}

#[cfg(target_os = "macos")]
mod macos {
    use super::PermissionStatuses;
    use objc2::{class, msg_send};
    use objc2_foundation::NSString;
    use objc2_speech::{SFSpeechRecognizer, SFSpeechRecognizerAuthorizationStatus};

    extern "C" {
        fn CGPreflightScreenCaptureAccess() -> bool;
        // kIOHIDRequestTypeListenEvent = 1; returns IOHIDAccessType where
        // kIOHIDAccessTypeGranted = 0, kIOHIDAccessTypeDenied = 1, kIOHIDAccessTypeUnknown = 2
        fn IOHIDCheckAccess(request_type: u32) -> i32;
    }

    pub fn check_all() -> PermissionStatuses {
        PermissionStatuses {
            screen: check_screen(),
            camera: check_av_capture("vide"),
            microphone: check_av_capture("soun"),
            speech: check_speech(),
            accessibility: crate::accessibility::macos::is_trusted(false),
            input_monitoring: check_input_monitoring(),
        }
    }

    fn check_screen() -> bool {
        unsafe { CGPreflightScreenCaptureAccess() }
    }

    fn check_av_capture(media_type: &str) -> bool {
        // AVAuthorizationStatus: notDetermined=0, restricted=1, denied=2, authorized=3
        unsafe {
            let cls = class!(AVCaptureDevice);
            let ns_type = NSString::from_str(media_type);
            let status: i64 = msg_send![cls, authorizationStatusForMediaType: &*ns_type];
            status == 3
        }
    }

    fn check_speech() -> bool {
        unsafe {
            SFSpeechRecognizer::authorizationStatus()
                == SFSpeechRecognizerAuthorizationStatus::Authorized
        }
    }

    fn check_input_monitoring() -> bool {
        unsafe { IOHIDCheckAccess(1) == 0 }
    }
}
