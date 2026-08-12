//! Whether a conferencing app is holding a live audio input right now.
//!
//! Both meeting watchers read this, from opposite ends of a call: the ad-hoc
//! detector treats a running input as corroboration that a call actually
//! started, and the silence detector treats its release as evidence one ended.

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

/// Returns whether one of the target conferencing apps currently has a live
/// CoreAudio input stream. `None` means the OS could not provide a reliable
/// answer, so callers must keep the existing conservative fallbacks.
///
/// `kAudioProcessPropertyIsRunningInput` is macOS 14+, so an older system is a
/// `None` and never a `Some(false)`. Callers that collapse the two make the
/// feature silently dead on Sonoma-minus rather than degraded.
///
/// Observation only: this enumerates process objects and never opens an input
/// unit. A detector that grabbed one while idle would fight `whisper_speech`,
/// which holds VPIO with uplink processing bypassed precisely so a call app
/// cannot starve Clips of mic buffers.
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
        if !bundle_ids.iter().any(|candidate| candidate == &bundle_id) {
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
        if input_status == kAudioHardwareNoError && input_running != 0 {
            return Some(true);
        }
    }

    Some(false)
}
