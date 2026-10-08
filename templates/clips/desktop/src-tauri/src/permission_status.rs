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
        fn CGPreflightListenEventAccess() -> bool;
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
        unsafe {
            let cls = class!(AVCaptureDevice);
            let ns_type = NSString::from_str(media_type);
            let status: i64 = msg_send![cls, authorizationStatusForMediaType: &*ns_type];
            status == 3
        }
    }

    fn check_speech() -> bool {
        if !crate::native_speech::macos::has_speech_usage_description() {
            return false;
        }
        unsafe {
            SFSpeechRecognizer::authorizationStatus()
                == SFSpeechRecognizerAuthorizationStatus::Authorized
        }
    }

    fn check_input_monitoring() -> bool {
        unsafe { CGPreflightListenEventAccess() }
    }
}
