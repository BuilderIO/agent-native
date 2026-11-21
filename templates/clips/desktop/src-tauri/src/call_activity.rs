const BROWSER_CALL_APP_BUNDLE_IDS: &[&str] = &[
    "com.google.chrome",
    "company.thebrowser.browser",
    "com.apple.safari",
    "org.mozilla.firefox",
];

#[cfg(any(target_os = "macos", test))]
pub(crate) fn supported_browser_bundle_id(bundle_id: &str) -> Option<&'static str> {
    BROWSER_CALL_APP_BUNDLE_IDS
        .iter()
        .copied()
        .find(|candidate| candidate.eq_ignore_ascii_case(bundle_id))
}

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
    !BROWSER_CALL_APP_BUNDLE_IDS.contains(&candidate)
        && bundle_id
            .strip_prefix(candidate)
            .map(|suffix| suffix.starts_with('.'))
            .unwrap_or(false)
}

/// Call apps that also capture audio outside calls (voice and video
/// messages). A call in these apps both captures and plays audio.
const DUPLEX_CALL_APP_BUNDLE_IDS: &[&str] = &["com.tinyspeck.slackmacgap"];

#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub(crate) fn is_duplex_call_app(bundle_id: &str) -> bool {
    DUPLEX_CALL_APP_BUNDLE_IDS
        .iter()
        .any(|candidate| bundle_id_matches(bundle_id, candidate))
}

/// Which per-process audio signals count as "the app is in a call".
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum AudioRule {
    /// The microphone is running.
    Input,
    /// Microphone and playback run together (call start for duplex apps).
    InputAndOutput,
    /// Microphone or playback runs (call still going for duplex apps: a
    /// muted participant releases the mic while remote audio keeps playing).
    InputOrOutput,
}

#[cfg(target_os = "macos")]
pub(crate) fn call_app_uses_microphone(bundle_ids: &[String]) -> Option<bool> {
    call_matching_process_microphone(bundle_ids, None, AudioRule::Input)
}

/// Whether a call that is already being recorded is still going. Duplex apps
/// (Slack) stay in the call while they capture or play audio, so muting in a
/// huddle does not end it; other apps end when the microphone is released.
#[cfg(target_os = "macos")]
pub(crate) fn call_app_still_in_call(bundle_ids: &[String]) -> Option<bool> {
    let (duplex, mic_only): (Vec<String>, Vec<String>) = bundle_ids
        .iter()
        .cloned()
        .partition(|bundle_id| is_duplex_call_app(bundle_id));
    let duplex_state = (!duplex.is_empty())
        .then(|| call_matching_process_microphone(&duplex, None, AudioRule::InputOrOutput));
    let mic_state = (!mic_only.is_empty())
        .then(|| call_matching_process_microphone(&mic_only, None, AudioRule::Input));
    combine_call_states(duplex_state, mic_state)
}

/// Joins the states of two app groups: any live group keeps the call going.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub(crate) fn combine_call_states(
    a: Option<Option<bool>>,
    b: Option<Option<bool>>,
) -> Option<bool> {
    let states: Vec<Option<bool>> = [a, b].into_iter().flatten().collect();
    if states.contains(&Some(true)) {
        return Some(true);
    }
    if states.is_empty() || states.contains(&None) {
        return None;
    }
    Some(false)
}

/// Like [`call_app_uses_microphone`], but only reports a call while the app
/// both captures and plays audio. Apps that also record voice or video
/// messages (Slack) capture without playing; a live call does both.
#[cfg(target_os = "macos")]
pub(crate) fn call_app_uses_duplex_audio(bundle_ids: &[String]) -> Option<bool> {
    call_matching_process_microphone(bundle_ids, None, AudioRule::InputAndOutput)
}

#[cfg(target_os = "macos")]
pub(crate) fn call_process_uses_microphone(pid: i32, bundle_id: &str) -> Option<bool> {
    call_matching_process_microphone(&[bundle_id.to_string()], Some(pid), AudioRule::Input)
}

/// Combines per-process audio states for apps that must capture and play at
/// once. Input and output may run in different helper processes, so each
/// side is judged across all matching processes.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub(crate) fn duplex_audio_state(
    any_input: bool,
    any_output: bool,
    input_unreadable: bool,
    output_unreadable: bool,
) -> Option<bool> {
    if any_input && any_output {
        return Some(true);
    }
    if (!any_input && input_unreadable) || (!any_output && output_unreadable) {
        return None;
    }
    Some(false)
}

/// Combines per-process audio states for a call that is already running:
/// either side keeps it alive.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub(crate) fn either_audio_state(
    any_input: bool,
    any_output: bool,
    input_unreadable: bool,
    output_unreadable: bool,
) -> Option<bool> {
    if any_input || any_output {
        return Some(true);
    }
    if input_unreadable || output_unreadable {
        return None;
    }
    Some(false)
}

#[cfg(target_os = "macos")]
fn call_matching_process_microphone(
    bundle_ids: &[String],
    expected_pid: Option<i32>,
    rule: AudioRule,
) -> Option<bool> {
    use core_foundation::base::TCFType;
    use core_foundation::string::CFString;
    use objc2_core_audio::{
        kAudioHardwareNoError, kAudioHardwarePropertyProcessObjectList,
        kAudioObjectPropertyElementMain, kAudioObjectPropertyScopeGlobal, kAudioObjectSystemObject,
        kAudioProcessPropertyBundleID, kAudioProcessPropertyIsRunningInput,
        kAudioProcessPropertyIsRunningOutput, kAudioProcessPropertyPID, AudioObjectGetPropertyData,
        AudioObjectGetPropertyDataSize, AudioObjectID, AudioObjectPropertyAddress,
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
    if list_status != kAudioHardwareNoError {
        return None;
    }
    if data_size == 0 {
        return Some(false);
    }
    if data_size as usize % size_of::<AudioObjectID>() != 0 {
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

    let mut unreadable_process_id = false;
    let mut unreadable_target_bundle = false;
    let mut unreadable_input = false;
    let mut matched_bundle = false;
    let mut any_input = false;
    let mut any_output = false;
    let mut unreadable_output = false;

    for process in processes {
        if let Some(expected_pid) = expected_pid {
            let mut pid_address = AudioObjectPropertyAddress {
                mSelector: kAudioProcessPropertyPID,
                mScope: kAudioObjectPropertyScopeGlobal,
                mElement: kAudioObjectPropertyElementMain,
            };
            let mut process_pid: i32 = 0;
            let mut pid_size = size_of::<i32>() as u32;
            let pid_status = unsafe {
                AudioObjectGetPropertyData(
                    process,
                    NonNull::from(&mut pid_address),
                    0,
                    std::ptr::null(),
                    NonNull::from(&mut pid_size),
                    NonNull::new((&mut process_pid as *mut i32).cast::<c_void>())?,
                )
            };
            if pid_status != kAudioHardwareNoError {
                unreadable_process_id = true;
                continue;
            }
            if process_pid != expected_pid {
                continue;
            }
        }

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
            if expected_pid.is_some() {
                unreadable_target_bundle = true;
            }
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
        matched_bundle = true;

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
            unreadable_input = true;
        } else if input_running != 0 {
            if rule == AudioRule::Input {
                return Some(true);
            }
            any_input = true;
        }

        if rule != AudioRule::Input {
            let mut output_address = AudioObjectPropertyAddress {
                mSelector: kAudioProcessPropertyIsRunningOutput,
                mScope: kAudioObjectPropertyScopeGlobal,
                mElement: kAudioObjectPropertyElementMain,
            };
            let mut output_running: u32 = 0;
            let mut output_size = size_of::<u32>() as u32;
            let output_status = unsafe {
                AudioObjectGetPropertyData(
                    process,
                    NonNull::from(&mut output_address),
                    0,
                    std::ptr::null(),
                    NonNull::from(&mut output_size),
                    NonNull::new((&mut output_running as *mut u32).cast::<c_void>())?,
                )
            };
            if output_status != kAudioHardwareNoError {
                unreadable_output = true;
            } else if output_running != 0 {
                any_output = true;
            }
        }
    }

    match rule {
        AudioRule::InputAndOutput => {
            return duplex_audio_state(any_input, any_output, unreadable_input, unreadable_output);
        }
        AudioRule::InputOrOutput => {
            return either_audio_state(any_input, any_output, unreadable_input, unreadable_output);
        }
        AudioRule::Input => {}
    }

    if expected_pid.is_some()
        && (unreadable_target_bundle
            || (unreadable_process_id && !matched_bundle)
            || (unreadable_input && matched_bundle))
    {
        return None;
    }
    if unreadable_input && matched_bundle {
        return None;
    }
    Some(false)
}

#[cfg(test)]
mod tests {
    use super::{
        bundle_id_matches, combine_call_states, duplex_audio_state, either_audio_state,
        is_duplex_call_app, supported_browser_bundle_id, BROWSER_CALL_APP_BUNDLE_IDS,
    };

    #[test]
    fn muting_in_a_huddle_keeps_the_call_going() {
        // Muted: Slack releases the mic but keeps playing remote audio.
        assert_eq!(either_audio_state(false, true, false, false), Some(true));
        // Talking: both run.
        assert_eq!(either_audio_state(true, true, false, false), Some(true));
        // Left the huddle: neither runs.
        assert_eq!(either_audio_state(false, false, false, false), Some(false));
        // Nothing readable and nothing live: unknown, never "ended".
        assert_eq!(either_audio_state(false, false, false, true), None);
        assert_eq!(either_audio_state(false, false, true, false), None);
    }

    #[test]
    fn only_slack_is_a_duplex_call_app() {
        assert!(is_duplex_call_app("com.tinyspeck.slackmacgap"));
        assert!(is_duplex_call_app("com.tinyspeck.slackmacgap.helper"));
        assert!(!is_duplex_call_app("us.zoom.xos"));
        assert!(!is_duplex_call_app("com.microsoft.teams2"));
        assert!(!is_duplex_call_app("com.google.chrome"));
    }

    #[test]
    fn call_states_of_app_groups_combine() {
        assert_eq!(combine_call_states(Some(Some(true)), None), Some(true));
        assert_eq!(combine_call_states(Some(Some(false)), None), Some(false));
        assert_eq!(combine_call_states(None, Some(None)), None);
        assert_eq!(
            combine_call_states(Some(Some(false)), Some(Some(true))),
            Some(true)
        );
        assert_eq!(combine_call_states(Some(Some(false)), Some(None)), None);
        assert_eq!(combine_call_states(None, None), None);
    }

    #[test]
    fn slack_helpers_match_the_slack_bundle() {
        assert!(bundle_id_matches(
            "com.tinyspeck.slackmacgap.helper",
            "com.tinyspeck.slackmacgap"
        ));
        assert!(bundle_id_matches(
            "com.tinyspeck.slackmacgap",
            "com.tinyspeck.slackmacgap"
        ));
        assert!(!bundle_id_matches(
            "com.tinyspeck.slackmacgapx",
            "com.tinyspeck.slackmacgap"
        ));
    }

    #[test]
    fn duplex_audio_needs_capture_and_playback() {
        assert_eq!(duplex_audio_state(true, true, false, false), Some(true));
        assert_eq!(
            duplex_audio_state(true, false, false, false),
            Some(false),
            "recording a voice message captures without playing"
        );
        assert_eq!(duplex_audio_state(false, true, false, false), Some(false));
        assert_eq!(duplex_audio_state(false, false, false, false), Some(false));
        assert_eq!(duplex_audio_state(true, false, false, true), None);
        assert_eq!(duplex_audio_state(false, true, true, false), None);
        assert_eq!(
            duplex_audio_state(true, true, true, true),
            Some(true),
            "a readable live pair wins over another unreadable helper"
        );
    }

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

    #[test]
    fn supported_browser_bundle_ids_are_exact_and_case_insensitive() {
        for bundle_id in BROWSER_CALL_APP_BUNDLE_IDS {
            assert_eq!(
                supported_browser_bundle_id(bundle_id),
                Some(*bundle_id),
                "{bundle_id} is a supported browser"
            );
            assert!(bundle_id_matches(bundle_id, bundle_id));
            assert!(!bundle_id_matches(
                &format!("{bundle_id}.helper"),
                bundle_id
            ));
        }
        assert_eq!(
            supported_browser_bundle_id("COM.GOOGLE.CHROME"),
            Some("com.google.chrome")
        );
        assert_eq!(supported_browser_bundle_id("com.google.chromium"), None);
    }
}
