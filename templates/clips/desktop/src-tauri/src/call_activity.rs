
#[cfg(target_os = "macos")]
pub(crate) fn default_call_app_bundle_ids() -> Vec<String> {
    [
        "us.zoom.xos",
        "us.zoom.ZoomClips",
        "com.microsoft.teams2",
        "com.microsoft.teams",
    ]
    .into_iter()
    .map(|bundle_id| bundle_id.to_lowercase())
    .collect()
}

pub(crate) fn bundle_id_matches(bundle_id: &str, candidate: &str) -> bool {
    let bundle_id = bundle_id.to_lowercase();
    let candidate = candidate.to_lowercase();
    let (bundle_id, candidate) = (bundle_id.as_str(), candidate.as_str());
    if bundle_id == candidate {
        return true;
    }
    if candidate == "us.zoom.xos" {
        return bundle_id.starts_with("us.zoom.");
    }
    !matches!(
        candidate,
        "com.google.chrome"
            | "company.thebrowser.browser"
            | "com.apple.safari"
            | "org.mozilla.firefox"
    ) && bundle_id
        .strip_prefix(candidate)
        .map(|suffix| suffix.starts_with('.'))
        .unwrap_or(false)
}

#[cfg(target_os = "macos")]
pub(crate) fn call_app_uses_microphone(bundle_ids: &[String]) -> Option<bool> {
    use core_foundation::base::TCFType;
    use core_foundation::string::CFString;
    use objc2_core_audio::{
        kAudioHardwareNoError, kAudioHardwarePropertyProcessObjectList,
        kAudioObjectPropertyElementMain, kAudioObjectPropertyScopeGlobal, kAudioObjectSystemObject,
        kAudioProcessPropertyBundleID, kAudioProcessPropertyIsRunningInput,
        AudioObjectGetPropertyData, AudioObjectGetPropertyDataSize, AudioObjectID,
        AudioObjectPropertyAddress,
    };
    use std::ffi::c_void;
    use std::mem::size_of;
    use std::ptr::NonNull;

    let mut list_address = AudioObjectPropertyAddress {
        mSelector: kAudioHardwarePropertyProcessObjectList,
        mScope: kAudioObjectPropertyScopeGlobal,
        mElement: kAudioObjectPropertyElementMain,
    };
    let mut data_size = 0;
    let list_status = unsafe {
        AudioObjectGetPropertyDataSize(
            kAudioObjectSystemObject as AudioObjectID,
            NonNull::from(&mut list_address),
            0,
            std::ptr::null(),
            NonNull::from(&mut data_size),
        )
    };
    if list_status != kAudioHardwareNoError || data_size == 0 {
        return None;
    }

    let mut processes = vec![0 as AudioObjectID; data_size as usize / size_of::<AudioObjectID>()];
    let list_status = unsafe {
        AudioObjectGetPropertyData(
            kAudioObjectSystemObject as AudioObjectID,
            NonNull::from(&mut list_address),
            0,
            std::ptr::null(),
            NonNull::from(&mut data_size),
            NonNull::new(processes.as_mut_ptr().cast::<c_void>())?,
        )
    };
    if list_status != kAudioHardwareNoError {
        return None;
    }

    let mut matched_bundle_with_unreadable_input = false;

    for process in processes {
        let mut bundle_address = AudioObjectPropertyAddress {
            mSelector: kAudioProcessPropertyBundleID,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain,
        };
        let mut bundle_ref: *const c_void = std::ptr::null();
        let mut bundle_size = size_of::<*const c_void>() as u32;
        let bundle_status = unsafe {
            AudioObjectGetPropertyData(
                process,
                NonNull::from(&mut bundle_address),
                0,
                std::ptr::null(),
                NonNull::from(&mut bundle_size),
                NonNull::new((&mut bundle_ref as *mut *const c_void).cast::<c_void>())?,
            )
        };
        if bundle_status != kAudioHardwareNoError || bundle_ref.is_null() {
            continue;
        }
        let bundle_id = unsafe {
            CFString::wrap_under_get_rule(bundle_ref as core_foundation::string::CFStringRef)
        }
        .to_string()
        .to_lowercase();
        if !bundle_ids
            .iter()
            .any(|candidate| bundle_id_matches(&bundle_id, candidate))
        {
            continue;
        }

        let mut input_address = AudioObjectPropertyAddress {
            mSelector: kAudioProcessPropertyIsRunningInput,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain,
        };
        let mut input_running: u32 = 0;
        let mut input_size = size_of::<u32>() as u32;
        let input_status = unsafe {
            AudioObjectGetPropertyData(
                process,
                NonNull::from(&mut input_address),
                0,
                std::ptr::null(),
                NonNull::from(&mut input_size),
                NonNull::new((&mut input_running as *mut u32).cast::<c_void>())?,
            )
        };
        if input_status != kAudioHardwareNoError {
            matched_bundle_with_unreadable_input = true;
            continue;
        }
        if input_running != 0 {
            return Some(true);
        }
    }

    if matched_bundle_with_unreadable_input {
        return None;
    }
    Some(false)
}

#[cfg(test)]
mod tests {
    use super::bundle_id_matches;

    #[test]
    fn matches_native_helpers_but_only_exact_browser_processes() {
        assert!(bundle_id_matches("us.zoom.xos.helper.audio", "us.zoom.xos"));
        assert!(bundle_id_matches("us.zoom.xos", "us.zoom.xos"));
        assert!(bundle_id_matches("com.google.chrome", "com.google.chrome"));
        assert!(bundle_id_matches("com.google.chrome", "com.google.Chrome"));
        assert!(bundle_id_matches("us.zoom.cpthost", "us.zoom.XOS"));
        assert!(!bundle_id_matches(
            "com.google.chrome.helper.renderer",
            "com.google.chrome"
        ));
        assert!(!bundle_id_matches(
            "com.google.chromium",
            "com.google.chrome"
        ));
        assert!(!bundle_id_matches(
            "com.microsoft.teams2",
            "com.microsoft.teams"
        ));
    }

    #[test]
    fn zoom_in_call_helpers_match_by_bundle_prefix() {
        assert!(bundle_id_matches("us.zoom.cpthost", "us.zoom.xos"));
        assert!(bundle_id_matches("us.zoom.caphost", "us.zoom.xos"));
        assert!(bundle_id_matches("us.zoom.aomhost", "us.zoom.xos"));
        assert!(bundle_id_matches("us.zoom.airhost", "us.zoom.xos"));
        assert!(bundle_id_matches("us.zoom.zccimeetinghost", "us.zoom.xos"));
        assert!(bundle_id_matches("us.zoom.zoomclips", "us.zoom.xos"));
        assert!(!bundle_id_matches(
            "com.microsoft.teams2",
            "com.microsoft.teams"
        ));
    }
}
