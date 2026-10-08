use tauri::AppHandle;

#[tauri::command]
pub async fn native_speech_start(
    app: AppHandle,
    locale: Option<String>,
    mic_device_id: Option<String>,
    mic_device_label: Option<String>,
    owner: Option<String>,
) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        macos::native_speech_start_impl(
            app,
            locale,
            mic_device_id,
            mic_device_label,
            macos::SessionOwner::from_param(owner),
        )
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app, locale, mic_device_id, mic_device_label, owner);
        Err("Native speech recognition is only supported on macOS.".into())
    }
}

#[tauri::command]
pub async fn native_speech_set_vocabulary(strings: Vec<String>) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        macos::set_pending_vocabulary(strings);
        Ok(())
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = strings;
        Ok(())
    }
}

#[tauri::command]
pub async fn native_speech_request_permission() -> Result<bool, String> {
    #[cfg(target_os = "macos")]
    {
        macos::request_speech_permission()
    }
    #[cfg(not(target_os = "macos"))]
    {
        Ok(false)
    }
}

#[tauri::command]
pub async fn native_speech_stop(app: AppHandle, owner: Option<String>) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        macos::native_speech_stop_impl(app, owner.map(|o| macos::SessionOwner::from_param(Some(o))))
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app, owner);
        Ok(())
    }
}

#[tauri::command]
pub async fn native_speech_cancel(app: AppHandle, owner: Option<String>) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        macos::native_speech_cancel_impl(
            app,
            owner.map(|o| macos::SessionOwner::from_param(Some(o))),
        )
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app, owner);
        Ok(())
    }
}

#[cfg(target_os = "macos")]
pub(crate) mod macos {
    use std::ffi::c_void;
    use std::mem::size_of;
    use std::ptr::NonNull;
    use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
    use std::sync::{Arc, Mutex, OnceLock};

    use block2::{RcBlock, StackBlock};
    use dispatch2::{DispatchQueue, DispatchRetained};
    use objc2::rc::Retained;
    use objc2::runtime::{AnyObject, NSObject, NSObjectProtocol, ProtocolObject};
    use objc2::{define_class, msg_send, AllocAnyThread, ClassType, DefinedClass};
    use objc2_audio_toolbox::{
        kAudioOutputUnitProperty_CurrentDevice, kAudioUnitScope_Global, AudioUnitSetProperty,
    };
    use objc2_av_foundation::{
        AVCaptureAudioDataOutput, AVCaptureAudioDataOutputSampleBufferDelegate,
        AVCaptureConnection, AVCaptureDevice, AVCaptureDeviceInput, AVCaptureOutput,
        AVCaptureSession, AVMediaTypeAudio,
    };
    use objc2_avf_audio::{
        AVAudioEngine, AVAudioInputNode, AVAudioPCMBuffer, AVAudioSession,
        AVAudioSessionCategoryOptions, AVAudioSessionCategoryPlayAndRecord, AVAudioTime,
        AVAudioVoiceProcessingOtherAudioDuckingConfiguration,
        AVAudioVoiceProcessingOtherAudioDuckingLevel, AVFormatIDKey, AVLinearPCMBitDepthKey,
        AVLinearPCMIsFloatKey, AVLinearPCMIsNonInterleaved, AVNumberOfChannelsKey,
    };
    use objc2_core_audio::{
        kAudioHardwareNoError, kAudioHardwarePropertyTranslateUIDToDevice,
        kAudioObjectPropertyElementMain, kAudioObjectPropertyScopeGlobal, kAudioObjectSystemObject,
        AudioObjectGetPropertyData, AudioObjectID, AudioObjectPropertyAddress,
    };
    use objc2_core_audio_types::kAudioFormatLinearPCM;
    use objc2_core_media::CMSampleBuffer;
    use objc2_foundation::{
        NSArray, NSBundle, NSDictionary, NSError, NSLocale, NSNumber, NSString,
    };
    use objc2_speech::{
        SFSpeechAudioBufferRecognitionRequest, SFSpeechRecognitionResult, SFSpeechRecognitionTask,
        SFSpeechRecognizer, SFSpeechRecognizerAuthorizationStatus,
    };
    use serde::Serialize;
    use tauri::{AppHandle, Emitter};

    use screencapturekit::audio_devices::AudioInputDevice;

    const SPEECH_USAGE_DESCRIPTION_KEY: &str = "NSSpeechRecognitionUsageDescription";
    const SPEECH_USAGE_DESCRIPTION_ERROR: &str =
        "Clips cannot start macOS speech recognition because the app bundle is missing NSSpeechRecognitionUsageDescription.";

    fn is_macos_app_bundle_path(path: &std::path::Path) -> bool {
        let Some(contents) = path.parent().and_then(|path| path.parent()) else {
            return false;
        };
        contents.file_name().is_some_and(|name| name == "Contents")
            && contents
                .parent()
                .and_then(|path| path.extension())
                .is_some_and(|extension| extension == "app")
    }

    fn running_from_macos_app_bundle() -> bool {
        std::env::current_exe()
            .ok()
            .is_some_and(|path| is_macos_app_bundle_path(&path))
    }

    pub(crate) fn has_speech_usage_description() -> bool {
        if !running_from_macos_app_bundle() {
            return false;
        }
        let bundle = NSBundle::mainBundle();
        let Some(info) = bundle.infoDictionary() else {
            return false;
        };
        let key = NSString::from_str(SPEECH_USAGE_DESCRIPTION_KEY);
        info.objectForKey(&*key)
            .and_then(|value| value.downcast::<NSString>().ok())
            .is_some_and(|value| !value.is_empty())
    }

    fn ensure_speech_usage_description() -> Result<(), String> {
        if !running_from_macos_app_bundle() {
            return Err(
                "Native macOS dictation is unavailable in tauri dev; run the bundled Clips app to test it."
                    .into(),
            );
        }
        if has_speech_usage_description() {
            Ok(())
        } else {
            Err(SPEECH_USAGE_DESCRIPTION_ERROR.into())
        }
    }

    #[cfg(test)]
    mod bundle_tests {
        use super::is_macos_app_bundle_path;
        use std::path::Path;

        #[test]
        fn only_bundled_macos_executables_can_request_speech_permission() {
            assert!(is_macos_app_bundle_path(Path::new(
                "/Applications/Clips.app/Contents/MacOS/Clips",
            )));
            assert!(!is_macos_app_bundle_path(Path::new(
                "/workspace/desktop/src-tauri/target/debug/Clips",
            )));
        }
    }

    #[derive(Clone, Copy, PartialEq, Eq, Debug)]
    pub(crate) enum SessionOwner {
        Dictation,
        Meeting,
    }

    impl SessionOwner {
        pub(crate) fn from_param(owner: Option<String>) -> Self {
            match owner.as_deref() {
                Some("meeting") => SessionOwner::Meeting,
                _ => SessionOwner::Dictation,
            }
        }
    }

    fn native_speech_voice_processing_mode(owner: SessionOwner) -> MicVoiceProcessingMode {
        match owner {
            SessionOwner::Meeting => MicVoiceProcessingMode::Bypassed,
            SessionOwner::Dictation => MicVoiceProcessingMode::Disabled,
        }
    }

    /// One in-flight dictation. Holds strong references to the AppKit objects
    /// so they don't drop while the recognition task is still emitting
    /// results.
    ///
    /// SAFETY: `Retained<T>` is `Send`/`Sync` iff the underlying class is.
    /// None of these Apple classes have `Send` impls upstream, but in
    /// practice they are reference-counted and message-thread-safe (Apple's
    /// docs note this for `SFSpeechRecognizer` and `AVAudioEngine`;
    /// `appendAudioPCMBuffer:` is explicitly designed to be called from the
    /// realtime audio thread). We never share `&` references across threads
    /// — we only move ownership through the `Mutex` — so `Send` is the only
    /// impl we need, and we mark it manually below.
    struct SpeechSession {
        generation: u64,
        completion_started: Arc<AtomicBool>,
        callback_finished: Arc<AtomicBool>,
        audio: SpeechAudio,
        request: Retained<SFSpeechAudioBufferRecognitionRequest>,
        task: Retained<SFSpeechRecognitionTask>,
        cancelled: Arc<AtomicBool>,
        stopped: Arc<AtomicBool>,
        owner: SessionOwner,
    }

    enum SpeechAudio {
        Engine {
            engine: Retained<AVAudioEngine>,
            tap_installed: AtomicBool,
        },
        Capture(DictationCapture),
    }

    // SAFETY: see the doc comment on `SpeechSession`. We never alias the
    // inner pointers across threads — the session is moved through a Mutex.
    unsafe impl Send for SpeechSession {}

    #[derive(Clone, PartialEq, Eq)]
    struct RawMicDeviceKey {
        id: Option<String>,
        label: Option<String>,
    }

    impl RawMicDeviceKey {
        fn from_selection(device_id: Option<&str>, device_label: Option<&str>) -> Self {
            Self {
                id: device_id
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .map(ToOwned::to_owned),
                label: device_label
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .map(ToOwned::to_owned),
            }
        }
    }

    #[derive(Clone)]
    struct RawMicTapTarget {
        app: AppHandle,
        on_samples: Arc<dyn Fn(&[f32]) + Send + Sync>,
        level_tick: Arc<AtomicU32>,
    }

    struct WarmedRawMicEngine {
        engine: Retained<AVAudioEngine>,
        input_node: Retained<AVAudioInputNode>,
        device_key: RawMicDeviceKey,
        target: Arc<Mutex<Option<RawMicTapTarget>>>,
    }

    // SAFETY: Same argument as `SpeechSession` / `RawMicCapture`: AVAudioEngine
    // and AVAudioInputNode are refcounted ObjC objects that we move through
    // Mutex ownership, without sharing Rust references across threads.
    unsafe impl Send for WarmedRawMicEngine {}

    struct RawMicWarmCache {
        device_key: RawMicDeviceKey,
        target: Arc<Mutex<Option<RawMicTapTarget>>>,
    }

    struct SessionRegistry<T> {
        active: Option<T>,
        finishing: Vec<T>,
    }

    impl<T> Default for SessionRegistry<T> {
        fn default() -> Self {
            Self {
                active: None,
                finishing: Vec::new(),
            }
        }
    }

    fn session_slot() -> &'static Mutex<SessionRegistry<SpeechSession>> {
        static SLOT: OnceLock<Mutex<SessionRegistry<SpeechSession>>> = OnceLock::new();
        SLOT.get_or_init(|| Mutex::new(SessionRegistry::default()))
    }

    fn warmed_raw_mic_engine_slot() -> &'static Mutex<Option<WarmedRawMicEngine>> {
        static SLOT: OnceLock<Mutex<Option<WarmedRawMicEngine>>> = OnceLock::new();
        SLOT.get_or_init(|| Mutex::new(None))
    }

    fn session_generation() -> &'static AtomicU64 {
        static GEN: OnceLock<AtomicU64> = OnceLock::new();
        GEN.get_or_init(|| AtomicU64::new(0))
    }

    fn owner_stop_generation(owner: SessionOwner) -> &'static AtomicU64 {
        static DICTATION_GEN: OnceLock<AtomicU64> = OnceLock::new();
        static MEETING_GEN: OnceLock<AtomicU64> = OnceLock::new();
        match owner {
            SessionOwner::Dictation => DICTATION_GEN.get_or_init(|| AtomicU64::new(0)),
            SessionOwner::Meeting => MEETING_GEN.get_or_init(|| AtomicU64::new(0)),
        }
    }

    #[derive(Clone, Copy, Debug, PartialEq, Eq)]
    struct RestartGuard {
        session_generation: u64,
        owner_stop_generation: u64,
    }

    fn restart_guard_is_current(
        guard: RestartGuard,
        current_session_generation: u64,
        current_owner_stop_generation: u64,
    ) -> bool {
        guard.session_generation == current_session_generation
            && guard.owner_stop_generation == current_owner_stop_generation
    }

    fn restart_setup_is_current(
        guard: RestartGuard,
        reserved_generation: Option<u64>,
        current_session_generation: u64,
        current_owner_stop_generation: u64,
    ) -> bool {
        reserved_generation.unwrap_or(guard.session_generation) == current_session_generation
            && guard.owner_stop_generation == current_owner_stop_generation
    }

    fn put_session_if_current_generation<T>(
        slot: &mut Option<T>,
        session: T,
        current_generation: u64,
        generation: impl FnOnce(&T) -> u64,
        completion_started: impl FnOnce(&T) -> bool,
    ) -> Result<(), T> {
        if slot.is_none()
            && generation(&session) == current_generation
            && !completion_started(&session)
        {
            *slot = Some(session);
            Ok(())
        } else {
            Err(session)
        }
    }

    #[derive(Clone, Copy, Debug, PartialEq, Eq)]
    enum StoppedSessionDisposition {
        Active,
        Finishing,
        Completed,
    }

    fn restore_stopped_session<T>(
        registry: &mut SessionRegistry<T>,
        session: T,
        current_generation: u64,
        generation: impl FnOnce(&T) -> u64,
        completion_started: impl FnOnce(&T) -> bool,
        callback_finished: impl FnOnce(&T) -> bool,
    ) -> StoppedSessionDisposition {
        let session_generation = generation(&session);
        let completion_started = completion_started(&session);
        let callback_finished = callback_finished(&session);
        if registry.active.is_none()
            && session_generation == current_generation
            && !completion_started
            && !callback_finished
        {
            registry.active = Some(session);
            StoppedSessionDisposition::Active
        } else if callback_finished {
            drop(session);
            StoppedSessionDisposition::Completed
        } else {
            registry.finishing.push(session);
            StoppedSessionDisposition::Finishing
        }
    }

    fn retain_session_until_callback<T>(
        registry: &mut SessionRegistry<T>,
        session: T,
        callback_pending: impl FnOnce(&T) -> bool,
        callback_finished: impl FnOnce(&T) -> bool,
    ) -> Option<T> {
        if callback_pending(&session) {
            if !callback_finished(&session) {
                registry.finishing.push(session);
            }
            None
        } else {
            Some(session)
        }
    }

    fn take_sessions_if_generation_matches<T>(
        registry: &mut SessionRegistry<T>,
        expected_generation: u64,
        generation: impl Fn(&T) -> u64,
    ) -> Vec<T> {
        let mut removed = Vec::new();
        if registry
            .active
            .as_ref()
            .is_some_and(|session| generation(session) == expected_generation)
        {
            if let Some(session) = registry.active.take() {
                removed.push(session);
            }
        }

        let mut index = 0;
        while index < registry.finishing.len() {
            if generation(&registry.finishing[index]) == expected_generation {
                removed.push(registry.finishing.swap_remove(index));
            } else {
                index += 1;
            }
        }
        removed
    }

    fn claim_session_completion(completion_started: &AtomicBool) -> bool {
        // Serialize callback entry with session installation and retirement.
        let _slot = session_slot()
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        !completion_started.swap(true, Ordering::SeqCst)
    }

    fn invalidate_restart(owner: Option<SessionOwner>) {
        match owner {
            Some(owner) => {
                owner_stop_generation(owner).fetch_add(1, Ordering::SeqCst);
            }
            None => {
                owner_stop_generation(SessionOwner::Dictation).fetch_add(1, Ordering::SeqCst);
                owner_stop_generation(SessionOwner::Meeting).fetch_add(1, Ordering::SeqCst);
            }
        }
    }

    const MAX_TRANSIENT_RESTARTS: u32 = 5;

    #[derive(Serialize, Clone)]
    struct PartialPayload {
        text: String,
        source: &'static str,
    }

    #[derive(Serialize, Clone)]
    struct FinalPayload {
        text: String,
        source: &'static str,
    }

    #[derive(Serialize, Clone)]
    struct ErrorPayload {
        error: String,
        source: &'static str,
    }

    #[derive(Serialize, Clone)]
    pub(crate) struct AudioLevelPayload {
        pub level: f32,
        pub source: &'static str,
    }

    pub(crate) fn peak_level_for_pcm(buf: &AVAudioPCMBuffer) -> f32 {
        // SAFETY: AVAudioPCMBuffer with float format exposes `floatChannelData`
        // as a pointer to `channelCount` pointers, each pointing at
        // `frameLength` floats. We read each channel, bounded by the
        // engine-reported frame length.
        unsafe {
            let frames = buf.frameLength() as usize;
            if frames == 0 {
                return 0.0;
            }
            let channel_count = buf.format().channelCount() as usize;
            if channel_count == 0 {
                return 0.0;
            }
            let channels_ptr = buf.floatChannelData();
            if channels_ptr.is_null() {
                return 0.0;
            }
            let mut peak: f32 = 0.0;
            let step = (frames / 64).max(1);
            for channel in 0..channel_count {
                let channel_ptr = (*channels_ptr.add(channel)).as_ptr();
                if channel_ptr.is_null() {
                    continue;
                }
                let slice = std::slice::from_raw_parts(channel_ptr, frames);
                let mut i = 0;
                while i < frames {
                    let v = slice[i].abs();
                    if v > peak {
                        peak = v;
                    }
                    i += step;
                }
            }
            peak.min(1.0)
        }
    }

    fn mono_mix_pcm(buf: &AVAudioPCMBuffer) -> Vec<f32> {
        // SAFETY: Same buffer layout as `peak_level_for_pcm`. Multi-channel
        // built-in Mac microphones can put useful voice energy outside channel
        // 0, so mix all channels for Whisper instead of forwarding only the
        // first channel.
        unsafe {
            let frames = buf.frameLength() as usize;
            if frames == 0 {
                return Vec::new();
            }
            let channel_count = buf.format().channelCount() as usize;
            if channel_count == 0 {
                return Vec::new();
            }
            let channels_ptr = buf.floatChannelData();
            if channels_ptr.is_null() {
                return Vec::new();
            }
            let mut mono = vec![0.0_f32; frames];
            let mut mixed_channels = 0usize;
            for channel in 0..channel_count {
                let channel_ptr = (*channels_ptr.add(channel)).as_ptr();
                if channel_ptr.is_null() {
                    continue;
                }
                let slice = std::slice::from_raw_parts(channel_ptr, frames);
                for (dst, src) in mono.iter_mut().zip(slice.iter()) {
                    *dst += *src;
                }
                mixed_channels += 1;
            }
            if mixed_channels > 1 {
                let scale = 1.0 / mixed_channels as f32;
                for sample in &mut mono {
                    *sample *= scale;
                }
            }
            mono
        }
    }

    /// Block synchronously until the system has a definitive authorization
    /// decision. Returns the final status. The handler block runs on an
    /// internal queue, so we use a one-shot mpsc channel to bridge it back
    /// here.
    ///
    /// SAFETY: `SFSpeechRecognizer::requestAuthorization` is documented as
    /// thread-agnostic — it just stores the handler and invokes it once the
    /// system has an answer. The handler itself only sends a value on a
    /// channel; no ObjC interop, no UI work.
    fn ensure_authorized() -> Result<(), String> {
        ensure_speech_usage_description()?;

        let current = unsafe { SFSpeechRecognizer::authorizationStatus() };
        if current == SFSpeechRecognizerAuthorizationStatus::Authorized {
            return Ok(());
        }
        if current == SFSpeechRecognizerAuthorizationStatus::Denied {
            return Err(
                "Speech recognition denied (System Settings > Privacy & Security > Speech Recognition)."
                    .into(),
            );
        }
        if current == SFSpeechRecognizerAuthorizationStatus::Restricted {
            return Err("Speech recognition is restricted on this device.".into());
        }

        let (tx, rx) = std::sync::mpsc::sync_channel::<SFSpeechRecognizerAuthorizationStatus>(1);
        let tx = Mutex::new(Some(tx));
        // SAFETY: the handler is owned by the system until it fires once;
        // we box it into an `RcBlock` so the closure stays alive across the
        // ObjC boundary. The closure captures only the
        // `Mutex<Option<SyncSender>>`, which is `Send + Sync`.
        let handler = RcBlock::new(move |status: SFSpeechRecognizerAuthorizationStatus| {
            if let Ok(mut guard) = tx.lock() {
                if let Some(sender) = guard.take() {
                    let _ = sender.send(status);
                }
            }
        });
        unsafe { SFSpeechRecognizer::requestAuthorization(&handler) };

        match rx.recv_timeout(std::time::Duration::from_secs(30)) {
            Ok(SFSpeechRecognizerAuthorizationStatus::Authorized) => Ok(()),
            Ok(SFSpeechRecognizerAuthorizationStatus::Denied) => {
                Err("Speech recognition denied by user.".into())
            }
            Ok(SFSpeechRecognizerAuthorizationStatus::Restricted) => {
                Err("Speech recognition is restricted on this device.".into())
            }
            Ok(SFSpeechRecognizerAuthorizationStatus::NotDetermined) => {
                Err("Speech recognition authorization still undetermined.".into())
            }
            Ok(_) => Err("Unknown speech recognition authorization status.".into()),
            Err(_) => Err("Timed out waiting for speech recognition authorization.".into()),
        }
    }

    pub fn request_speech_permission() -> Result<bool, String> {
        ensure_authorized().map(|_| true)
    }

    fn build_recognizer(locale: Option<&str>) -> Result<Retained<SFSpeechRecognizer>, String> {
        let identifier = locale.unwrap_or("en-US");
        // SAFETY: `NSString::from_str` and
        // `NSLocale::localeWithLocaleIdentifier:` are pure constructors that
        // retain on success. The resulting NSLocale is owned by the returned
        // Retained and dropped when this fn returns.
        let recognizer = unsafe {
            let ns_id = NSString::from_str(identifier);
            let locale_obj: Retained<NSLocale> = objc2::msg_send![
                NSLocale::class(),
                localeWithLocaleIdentifier: &*ns_id
            ];
            let allocated = SFSpeechRecognizer::alloc();
            SFSpeechRecognizer::initWithLocale(allocated, &locale_obj)
        };
        let recognizer = recognizer
            .ok_or_else(|| format!("SFSpeechRecognizer init failed for locale {identifier}"))?;
        if !unsafe { recognizer.isAvailable() } {
            return Err("SFSpeechRecognizer is not currently available (network down?).".into());
        }
        Ok(recognizer)
    }

    fn normalize_audio_device_name(value: &str) -> String {
        value
            .to_lowercase()
            .replace("(default)", "")
            .split_whitespace()
            .collect::<Vec<_>>()
            .join(" ")
    }

    fn names_match(a: &str, b: &str) -> bool {
        let a = normalize_audio_device_name(a);
        let b = normalize_audio_device_name(b);
        !a.is_empty() && !b.is_empty() && (a == b || a.contains(&b) || b.contains(&a))
    }

    fn is_built_in_input_name(value: &str) -> bool {
        let value = normalize_audio_device_name(value);
        value.contains("macbook")
            || value.contains("built-in")
            || value.contains("built in")
            || value.contains("internal microphone")
    }

    fn audio_object_id_for_uid(uid: &str) -> Result<AudioObjectID, String> {
        let ns_uid = NSString::from_str(uid);
        let uid_ref = Retained::as_ptr(&ns_uid) as *const c_void;
        let qualifier = uid_ref;
        let mut device_id: AudioObjectID = 0;
        let mut data_size = size_of::<AudioObjectID>() as u32;
        let mut address = AudioObjectPropertyAddress {
            mSelector: kAudioHardwarePropertyTranslateUIDToDevice,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain,
        };

        let status = unsafe {
            AudioObjectGetPropertyData(
                kAudioObjectSystemObject as AudioObjectID,
                NonNull::from(&mut address),
                size_of::<*const c_void>() as u32,
                (&qualifier as *const *const c_void).cast::<c_void>(),
                NonNull::from(&mut data_size),
                NonNull::new_unchecked((&mut device_id as *mut AudioObjectID).cast::<c_void>()),
            )
        };

        if status != kAudioHardwareNoError || device_id == 0 {
            return Err(format!(
                "Could not resolve macOS audio device id for microphone UID {uid} (OSStatus {status})."
            ));
        }

        Ok(device_id)
    }

    fn resolve_input_device(
        device_id: Option<&str>,
        device_label: Option<&str>,
    ) -> Result<Option<(AudioInputDevice, AudioObjectID)>, String> {
        let device_id = device_id.map(str::trim).filter(|value| !value.is_empty());
        let device_label = device_label
            .map(str::trim)
            .filter(|value| !value.is_empty());
        let has_specific_selection = device_id.is_some() || device_label.is_some();
        let devices = AudioInputDevice::list();

        let resolved = device_id
            .and_then(|id| devices.iter().find(|device| device.id == id))
            .or_else(|| {
                device_label.and_then(|label| {
                    devices
                        .iter()
                        .find(|device| names_match(&device.name, label))
                })
            })
            .or_else(|| {
                if has_specific_selection {
                    None
                } else {
                    devices
                        .iter()
                        .find(|device| is_built_in_input_name(&device.name))
                }
            });

        let Some(device) = resolved else {
            if has_specific_selection {
                let requested = device_label.or(device_id).unwrap_or("selected microphone");
                let available = devices
                    .iter()
                    .map(|device| device.name.as_str())
                    .collect::<Vec<_>>()
                    .join(", ");
                return Err(format!(
                    "Selected microphone '{requested}' is not available to native speech. Available inputs: {available}"
                ));
            }
            return Ok(None);
        };

        let object_id = audio_object_id_for_uid(&device.id)?;
        Ok(Some((device.clone(), object_id)))
    }

    fn configure_engine_input_device(
        engine: &AVAudioEngine,
        device_id: Option<&str>,
        device_label: Option<&str>,
    ) -> Result<(), String> {
        let Some((device, mut object_id)) = resolve_input_device(device_id, device_label)? else {
            return Ok(());
        };

        let input = unsafe { engine.inputNode() };
        let audio_unit = unsafe { input.audioUnit() };
        let status = unsafe {
            AudioUnitSetProperty(
                audio_unit,
                kAudioOutputUnitProperty_CurrentDevice,
                kAudioUnitScope_Global,
                0,
                (&mut object_id as *mut AudioObjectID).cast::<c_void>(),
                size_of::<AudioObjectID>() as u32,
            )
        };

        if status != kAudioHardwareNoError {
            return Err(format!(
                "Could not set native speech microphone to {} (OSStatus {status}).",
                device.name
            ));
        }

        eprintln!(
            "[voice-dictation] native speech microphone pinned to {} ({})",
            device.name, device.id
        );
        Ok(())
    }

    fn enable_voice_processing(input_node: &AVAudioInputNode) -> Result<(), String> {
        match unsafe { input_node.setVoiceProcessingEnabled_error(true) } {
            Ok(()) => Ok(()),
            Err(err) => {
                let message = ns_error_message(&err);
                eprintln!("[whisper-mic] voice processing enable failed: {message}");
                Err(format!("VoiceProcessingIO enable failed: {message}"))
            }
        }
    }

    fn enable_bypassed_voice_processing(input_node: &AVAudioInputNode) -> Result<(), String> {
        enable_voice_processing(input_node)?;
        unsafe {
            input_node.setVoiceProcessingBypassed(true);
            input_node.setVoiceProcessingAGCEnabled(false);
        }
        eprintln!("[whisper-mic] VoiceProcessingIO enabled in bypass mode for meeting fallback");
        Ok(())
    }

    fn disable_voice_processing_ducking(input_node: &AVAudioInputNode) {
        unsafe {
            let responds: bool = objc2::msg_send![
                input_node,
                respondsToSelector: objc2::sel!(setVoiceProcessingOtherAudioDuckingConfiguration:)
            ];
            if responds {
                input_node.setVoiceProcessingOtherAudioDuckingConfiguration(
                    AVAudioVoiceProcessingOtherAudioDuckingConfiguration {
                        enableAdvancedDucking: objc2::runtime::Bool::NO,
                        duckingLevel: AVAudioVoiceProcessingOtherAudioDuckingLevel::Min,
                    },
                );
            }
        }
    }

    fn configure_shared_mic_audio_session() {
        unsafe {
            let session = AVAudioSession::sharedInstance();
            let Some(category) = AVAudioSessionCategoryPlayAndRecord else {
                eprintln!("[whisper-mic] PlayAndRecord category missing — skipping MixWithOthers");
                return;
            };
            let options = AVAudioSessionCategoryOptions::MixWithOthers;
            if let Err(err) = session.setCategory_withOptions_error(category, options) {
                eprintln!(
                    "[whisper-mic] setCategory MixWithOthers failed: {} — continuing",
                    ns_error_message(&err)
                );
                return;
            }
            if let Err(err) = session.setActive_error(true) {
                eprintln!(
                    "[whisper-mic] AVAudioSession setActive failed: {} — continuing",
                    ns_error_message(&err)
                );
                return;
            }
            eprintln!("[whisper-mic] AVAudioSession PlayAndRecord + MixWithOthers active");
        }
    }

    fn take_warmed_raw_mic_engine(device_key: &RawMicDeviceKey) -> Option<WarmedRawMicEngine> {
        let mut slot = warmed_raw_mic_engine_slot().lock().ok()?;
        let should_reuse = slot
            .as_ref()
            .map(|cached| &cached.device_key == device_key)
            .unwrap_or(false);
        if should_reuse {
            slot.take()
        } else {
            if let Some(stale) = slot.take() {
                discard_warmed_raw_mic_engine(stale);
            }
            None
        }
    }

    fn store_warmed_raw_mic_engine(engine: WarmedRawMicEngine) {
        if let Ok(mut slot) = warmed_raw_mic_engine_slot().lock() {
            if let Some(previous) = slot.replace(engine) {
                discard_warmed_raw_mic_engine(previous);
            }
        }
    }

    fn clear_warmed_raw_mic_engine() {
        if let Ok(mut slot) = warmed_raw_mic_engine_slot().lock() {
            if let Some(engine) = slot.take() {
                discard_warmed_raw_mic_engine(engine);
            }
        }
    }

    fn discard_warmed_raw_mic_engine(engine: WarmedRawMicEngine) {
        let WarmedRawMicEngine {
            engine,
            input_node,
            device_key: _,
            target,
        } = engine;
        if let Ok(mut current) = target.lock() {
            *current = None;
        }
        unsafe {
            if engine.isRunning() {
                engine.stop();
            }
        }
        let _ = objc2::exception::catch(std::panic::AssertUnwindSafe(|| unsafe {
            input_node.removeTapOnBus(0);
        }));
    }

    fn install_reusable_raw_mic_tap(
        input_node: &AVAudioInputNode,
        target: Arc<Mutex<Option<RawMicTapTarget>>>,
    ) -> Result<(), String> {
        let target_for_tap = target.clone();
        let tap_block = StackBlock::new(
            move |buffer: std::ptr::NonNull<AVAudioPCMBuffer>,
                  _when: std::ptr::NonNull<AVAudioTime>| {
                let Some(target) = target_for_tap
                    .try_lock()
                    .ok()
                    .and_then(|guard| guard.as_ref().cloned())
                else {
                    return;
                };
                let buf = unsafe { buffer.as_ref() };
                let mono = mono_mix_pcm(buf);
                if !mono.is_empty() {
                    (target.on_samples)(&mono);
                }
                let n = target.level_tick.fetch_add(1, Ordering::Relaxed);
                if n % 2 == 0 {
                    let level = peak_level_for_pcm(buf);
                    let _ = target.app.emit(
                        "voice:audio-level",
                        AudioLevelPayload {
                            level,
                            source: "mic",
                        },
                    );
                }
            },
        )
        .copy();
        let block_ptr: *mut block2::Block<
            dyn Fn(std::ptr::NonNull<AVAudioPCMBuffer>, std::ptr::NonNull<AVAudioTime>) + 'static,
        > = (&*tap_block) as *const _ as *mut _;
        objc2::exception::catch(std::panic::AssertUnwindSafe(|| unsafe {
            input_node.installTapOnBus_bufferSize_format_block(
                0, 1024,
                None, // use hardware's current format — avoids SCO↔A2DP stale-format race
                block_ptr,
            );
        }))
        .map_err(|e| format!("installTapOnBus threw: {e:?}"))
    }

    fn build_warmed_raw_mic_engine(
        mic_device_id: Option<&str>,
        mic_device_label: Option<&str>,
        device_key: RawMicDeviceKey,
    ) -> Result<WarmedRawMicEngine, String> {
        configure_shared_mic_audio_session();
        let engine: Retained<AVAudioEngine> = unsafe { AVAudioEngine::new() };
        configure_engine_input_device(&engine, mic_device_id, mic_device_label)?;
        let input_node: Retained<AVAudioInputNode> = unsafe { engine.inputNode() };
        let _ = enable_voice_processing(&input_node);
        objc2::exception::catch(std::panic::AssertUnwindSafe(|| unsafe { engine.prepare() }))
            .map_err(|e| format!("AVAudioEngine prepare threw: {e:?}"))?;
        let target = Arc::new(Mutex::new(None));
        install_reusable_raw_mic_tap(&input_node, target.clone())?;
        disable_voice_processing_ducking(&input_node);
        Ok(WarmedRawMicEngine {
            engine,
            input_node,
            device_key,
            target,
        })
    }

    fn stop_engine_and_remove_tap(session: &SpeechSession) {
        let (engine, tap_installed) = match &session.audio {
            SpeechAudio::Engine {
                engine,
                tap_installed,
            } => (engine, tap_installed),
            SpeechAudio::Capture(capture) => {
                capture.stop();
                return;
            }
        };
        // `removeTapOnBus` throws an NSException that aborts the process when
        // the node has no tap, so only the first caller may remove it.
        unsafe {
            if tap_installed.swap(false, Ordering::SeqCst) {
                engine.inputNode().removeTapOnBus(0);
            }
            if engine.isRunning() {
                engine.stop();
            }
        }
    }

    struct DictationSampleIvars {
        request: Retained<SFSpeechAudioBufferRecognitionRequest>,
        app: AppHandle,
        buffers: AtomicU64,
        peak_bits: AtomicU32,
    }

    define_class!(
        // SAFETY: NSObject has no subclassing requirements and the type has no
        // Drop impl. AVFoundation calls the delegate on our serial queue.
        #[unsafe(super(NSObject))]
        #[name = "ClipsDictationSampleDelegate"]
        #[ivars = DictationSampleIvars]
        struct DictationSampleDelegate;

        unsafe impl NSObjectProtocol for DictationSampleDelegate {}

        unsafe impl AVCaptureAudioDataOutputSampleBufferDelegate for DictationSampleDelegate {
            #[unsafe(method(captureOutput:didOutputSampleBuffer:fromConnection:))]
            fn did_output_sample_buffer(
                &self,
                _output: &AVCaptureOutput,
                sample_buffer: &CMSampleBuffer,
                _connection: &AVCaptureConnection,
            ) {
                let ivars = self.ivars();
                unsafe { ivars.request.appendAudioSampleBuffer(sample_buffer) };
                let n = ivars.buffers.fetch_add(1, Ordering::Relaxed);
                let level = peak_level_for_sample_buffer(sample_buffer);
                ivars
                    .peak_bits
                    .fetch_max(level.to_bits(), Ordering::Relaxed);
                if n % 2 == 0 {
                    let _ = ivars.app.emit(
                        "voice:audio-level",
                        AudioLevelPayload {
                            level,
                            source: "mic",
                        },
                    );
                }
            }
        }
    );

    impl DictationSampleDelegate {
        fn new(
            request: Retained<SFSpeechAudioBufferRecognitionRequest>,
            app: AppHandle,
        ) -> Retained<Self> {
            let this = Self::alloc().set_ivars(DictationSampleIvars {
                request,
                app,
                buffers: AtomicU64::new(0),
                peak_bits: AtomicU32::new(0),
            });
            unsafe { msg_send![super(this), init] }
        }
    }

    /// Mono float32 is requested in `capture_audio_settings`, so the block
    /// buffer is a flat `f32` array. Non-negative floats order the same as
    /// their bit patterns, which is what lets `peak_bits` use `fetch_max`.
    fn peak_level_for_sample_buffer(sample_buffer: &CMSampleBuffer) -> f32 {
        unsafe {
            let Some(block) = sample_buffer.data_buffer() else {
                return 0.0;
            };
            let mut length_at_offset = 0usize;
            let mut data: *mut std::ffi::c_char = std::ptr::null_mut();
            let status =
                block.data_pointer(0, &mut length_at_offset, std::ptr::null_mut(), &mut data);
            if status != 0 || data.is_null() {
                return 0.0;
            }
            let samples =
                std::slice::from_raw_parts(data as *const f32, length_at_offset / size_of::<f32>());
            let step = (samples.len() / 64).max(1);
            samples
                .iter()
                .step_by(step)
                .fold(0.0_f32, |peak, v| peak.max(v.abs()))
                .min(1.0)
        }
    }

    fn capture_audio_settings() -> Option<Retained<NSDictionary<NSString, AnyObject>>> {
        let keys = unsafe {
            [
                AVFormatIDKey?,
                AVLinearPCMIsFloatKey?,
                AVLinearPCMBitDepthKey?,
                AVLinearPCMIsNonInterleaved?,
                AVNumberOfChannelsKey?,
            ]
        };
        let values = [
            NSNumber::numberWithUnsignedInt(kAudioFormatLinearPCM),
            NSNumber::numberWithBool(true),
            NSNumber::numberWithUnsignedInt(32),
            NSNumber::numberWithBool(false),
            NSNumber::numberWithUnsignedInt(1),
        ];
        let objects: Vec<&AnyObject> = values.iter().map(|v| v.as_ref()).collect();
        Some(NSDictionary::from_slices(&keys, &objects))
    }

    /// Dictation reads the mic through AVCaptureSession instead of
    /// AVAudioEngine. Pinning AVAudioEngine's input to a device that differs
    /// from its default output device (e.g. AirPods while the engine renders
    /// to the system aggregate) delivers no buffers after the first
    /// configuration change, so the recognizer reports "No speech detected".
    struct DictationCapture {
        session: Retained<AVCaptureSession>,
        output: Retained<AVCaptureAudioDataOutput>,
        delegate: Retained<DictationSampleDelegate>,
        _queue: DispatchRetained<DispatchQueue>,
        device_name: String,
        stopped: AtomicBool,
    }

    impl DictationCapture {
        fn start(
            app: AppHandle,
            request: Retained<SFSpeechAudioBufferRecognitionRequest>,
            mic_device_id: Option<&str>,
            mic_device_label: Option<&str>,
        ) -> Result<Self, String> {
            let device = resolve_capture_device(mic_device_id, mic_device_label)?;
            let device_name = unsafe { device.localizedName() }.to_string();
            let device_uid = unsafe { device.uniqueID() }.to_string();

            let input = unsafe { AVCaptureDeviceInput::deviceInputWithDevice_error(&device) }
                .map_err(|err| {
                    format!(
                        "Could not open microphone {device_name}: {}",
                        ns_error_message(&err)
                    )
                })?;
            let session = unsafe { AVCaptureSession::new() };
            let output = unsafe { AVCaptureAudioDataOutput::new() };
            unsafe {
                if !session.canAddInput(&input) {
                    return Err(format!("Microphone {device_name} cannot be captured."));
                }
                session.addInput(&input);
                output.setAudioSettings(capture_audio_settings().as_deref());
                if !session.canAddOutput(&output) {
                    return Err("Audio capture output is unavailable.".into());
                }
                session.addOutput(&output);
            }

            let delegate = DictationSampleDelegate::new(request, app);
            let queue = DispatchQueue::new("com.clips.dictation.capture", None);
            unsafe {
                output.setSampleBufferDelegate_queue(
                    Some(ProtocolObject::from_ref(&*delegate)),
                    Some(&queue),
                );
            }
            objc2::exception::catch(std::panic::AssertUnwindSafe(|| unsafe {
                session.startRunning()
            }))
            .map_err(|e| format!("AVCaptureSession start threw: {e:?}"))?;
            if !unsafe { session.isRunning() } {
                return Err(format!("Could not start capture from {device_name}."));
            }
            eprintln!(
                "[voice-dictation] native speech capturing from {device_name} ({device_uid}) via AVCaptureSession"
            );
            Ok(Self {
                session,
                output,
                delegate,
                _queue: queue,
                device_name,
                stopped: AtomicBool::new(false),
            })
        }

        fn stop(&self) {
            if self.stopped.swap(true, Ordering::SeqCst) {
                return;
            }
            unsafe {
                self.session.stopRunning();
                self.output.setSampleBufferDelegate_queue(None, None);
            }
            let ivars = self.delegate.ivars();
            eprintln!(
                "[voice-dictation] native capture from {} delivered {} buffers (peak {:.4})",
                self.device_name,
                ivars.buffers.load(Ordering::Relaxed),
                f32::from_bits(ivars.peak_bits.load(Ordering::Relaxed)),
            );
        }
    }

    fn resolve_capture_device(
        device_id: Option<&str>,
        device_label: Option<&str>,
    ) -> Result<Retained<AVCaptureDevice>, String> {
        if let Some((device, _)) = resolve_input_device(device_id, device_label)? {
            let uid = NSString::from_str(&device.id);
            return unsafe { AVCaptureDevice::deviceWithUniqueID(&uid) }.ok_or_else(|| {
                format!("Microphone {} is not available for capture.", device.name)
            });
        }
        let media_type = unsafe { AVMediaTypeAudio }
            .ok_or_else(|| "AVMediaTypeAudio is unavailable.".to_string())?;
        unsafe { AVCaptureDevice::defaultDeviceWithMediaType(media_type) }
            .ok_or_else(|| "No microphone is available.".into())
    }

    fn finish_session_callback(expected_generation: u64, callback_finished: &AtomicBool) {
        let mut slot = session_slot()
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let sessions =
            take_sessions_if_generation_matches(&mut slot, expected_generation, |session| {
                session.generation
            });
        for session in &sessions {
            stop_engine_and_remove_tap(session);
        }
        // Stop restoration uses this lock too, so cleanup cannot run just before retirement.
        callback_finished.store(true, Ordering::SeqCst);
    }

    fn ns_error_message(err: &NSError) -> String {
        // SAFETY: `localizedDescription` always returns a non-nil NSString
        // per Apple's docs.
        let desc: Retained<NSString> = unsafe { objc2::msg_send![err, localizedDescription] };
        let s = desc.to_string();
        if s.is_empty() {
            format!("NSError code {}", err.code())
        } else {
            s
        }
    }

    fn is_transient_recognizer_error(err: &NSError) -> bool {
        let domain: Retained<NSString> = unsafe { objc2::msg_send![err, domain] };
        domain.to_string() == "kAFAssistantErrorDomain" && matches!(err.code(), 203 | 1110)
    }

    fn pending_vocabulary_slot() -> &'static Mutex<Vec<String>> {
        static SLOT: OnceLock<Mutex<Vec<String>>> = OnceLock::new();
        SLOT.get_or_init(|| Mutex::new(Vec::new()))
    }

    pub fn set_pending_vocabulary(strings: Vec<String>) {
        if let Ok(mut slot) = pending_vocabulary_slot().lock() {
            *slot = strings;
        }
    }

    fn take_pending_vocabulary() -> Vec<String> {
        pending_vocabulary_slot()
            .lock()
            .map(|mut s| std::mem::take(&mut *s))
            .unwrap_or_default()
    }

    fn start_engine_audio(
        app: &AppHandle,
        request: &Retained<SFSpeechAudioBufferRecognitionRequest>,
        owner: SessionOwner,
        mic_device_id: Option<&str>,
        mic_device_label: Option<&str>,
    ) -> Result<SpeechAudio, String> {
        // Spin up the engine and grab its input node + native format.
        // SAFETY: `AVAudioEngine::new()` returns a retained engine.
        // `inputNode` is the engine's singleton input — also retained.
        configure_shared_mic_audio_session();
        let engine: Retained<AVAudioEngine> = unsafe { AVAudioEngine::new() };
        configure_engine_input_device(&engine, mic_device_id, mic_device_label)?;
        let input_node = unsafe { engine.inputNode() };
        let native_voice_processing = native_speech_voice_processing_mode(owner);
        let voice_processing_enabled = match native_voice_processing {
            MicVoiceProcessingMode::Bypassed => {
                enable_bypassed_voice_processing(&input_node)?;
                true
            }
            MicVoiceProcessingMode::Enabled => enable_voice_processing(&input_node).is_ok(),
            MicVoiceProcessingMode::Disabled => false,
        };
        objc2::exception::catch(std::panic::AssertUnwindSafe(|| unsafe { engine.prepare() }))
            .map_err(|e| format!("AVAudioEngine prepare threw: {e:?}"))?;

        // Install a tap that forwards every PCM buffer into the recognition
        // request. The tap callback runs on the realtime audio thread —
        // keep it tight and lock-free.
        //
        // SAFETY: `installTapOnBus:` performs a `Block_copy` internally so
        // the caller does not need to keep `tap_block` alive after this
        // call; the audio engine retains its own copy until
        // `removeTapOnBus:` is called. We pass the block as a raw `*mut
        // Block<F>` — the cast from `&Block<F>` is sound because the
        // FFI surface treats the pointer as opaque (it's just refcounted
        // by `Block_copy`).
        {
            let request_for_tap = request.clone();
            let app_for_level = app.clone();
            let level_tick = std::sync::atomic::AtomicU32::new(0);
            let level_tick = std::sync::Arc::new(level_tick);
            let tap_block = StackBlock::new(
                move |buffer: std::ptr::NonNull<AVAudioPCMBuffer>,
                      _when: std::ptr::NonNull<AVAudioTime>| {
                    // SAFETY: `buffer` is provided by the audio engine and
                    // is valid for the duration of the call.
                    let buf = unsafe { buffer.as_ref() };
                    unsafe {
                        request_for_tap.appendAudioPCMBuffer(buf);
                    }
                    let n = level_tick.fetch_add(1, Ordering::Relaxed);
                    if n % 2 == 0 {
                        let level = peak_level_for_pcm(buf);
                        let _ = app_for_level.emit(
                            "voice:audio-level",
                            AudioLevelPayload {
                                level,
                                source: "mic",
                            },
                        );
                    }
                },
            )
            .copy();
            let block_ptr: *mut block2::Block<
                dyn Fn(std::ptr::NonNull<AVAudioPCMBuffer>, std::ptr::NonNull<AVAudioTime>)
                    + 'static,
            > = (&*tap_block) as *const _ as *mut _;
            objc2::exception::catch(std::panic::AssertUnwindSafe(|| unsafe {
                input_node.installTapOnBus_bufferSize_format_block(
                    0, 1024,
                    None, // use hardware's current format — avoids SCO↔A2DP stale-format race
                    block_ptr,
                );
            }))
            .map_err(|e| format!("installTapOnBus threw: {e:?}"))?;
        }

        objc2::exception::catch(std::panic::AssertUnwindSafe(|| unsafe {
            engine.prepare();
            engine.startAndReturnError()
        }))
        .map_err(|e| format!("AVAudioEngine start threw: {e:?}"))
        .and_then(|r| {
            r.map_err(|e| format!("AVAudioEngine start failed: {}", ns_error_message(&e)))
        })
        .map_err(|msg| {
            unsafe { input_node.removeTapOnBus(0) };
            msg
        })?;

        if voice_processing_enabled {
            disable_voice_processing_ducking(&input_node);
        }

        Ok(SpeechAudio::Engine {
            engine,
            tap_installed: AtomicBool::new(true),
        })
    }

    pub fn native_speech_start_impl(
        app: AppHandle,
        locale: Option<String>,
        mic_device_id: Option<String>,
        mic_device_label: Option<String>,
        owner: SessionOwner,
    ) -> Result<(), String> {
        native_speech_start_impl_inner(
            app,
            locale,
            mic_device_id,
            mic_device_label,
            owner,
            0,
            None,
            None,
        )
    }

    fn native_speech_start_impl_inner(
        app: AppHandle,
        locale: Option<String>,
        mic_device_id: Option<String>,
        mic_device_label: Option<String>,
        owner: SessionOwner,
        restart_attempt: u32,
        restart_guard: Option<RestartGuard>,
        restart_reserved_generation: Option<Arc<AtomicU64>>,
    ) -> Result<(), String> {
        {
            let slot = session_slot().lock().map_err(|e| e.to_string())?;
            if let Some(guard) = restart_guard {
                if !restart_guard_is_current(
                    guard,
                    session_generation().load(Ordering::SeqCst),
                    owner_stop_generation(owner).load(Ordering::SeqCst),
                ) {
                    return Ok(());
                }
            }
            if let Some(prev) = slot.active.as_ref() {
                if prev.owner == SessionOwner::Meeting && owner == SessionOwner::Dictation {
                    return Err("speech-engine-busy-meeting".into());
                }
            }
        }

        ensure_authorized()?;

        let (my_gen, my_stop_gen) = {
            let mut slot = session_slot().lock().map_err(|e| e.to_string())?;
            if let Some(guard) = restart_guard {
                if !restart_guard_is_current(
                    guard,
                    session_generation().load(Ordering::SeqCst),
                    owner_stop_generation(owner).load(Ordering::SeqCst),
                ) {
                    return Ok(());
                }
            }
            let generation = session_generation().fetch_add(1, Ordering::SeqCst) + 1;
            if let Some(prev) = slot.active.take() {
                stop_engine_and_remove_tap(&prev);
                if let Some(prev) = retain_session_until_callback(
                    &mut slot,
                    prev,
                    |session| {
                        session.stopped.load(Ordering::SeqCst)
                            || session.completion_started.load(Ordering::SeqCst)
                    },
                    |session| session.callback_finished.load(Ordering::SeqCst),
                ) {
                    prev.cancelled.store(true, Ordering::SeqCst);
                    // SAFETY: `cancel()` is a fire-and-forget ObjC call.
                    unsafe { prev.task.cancel() };
                }
            }
            (
                generation,
                owner_stop_generation(owner).load(Ordering::SeqCst),
            )
        };
        if let Some(reserved_generation) = &restart_reserved_generation {
            reserved_generation.store(my_gen, Ordering::SeqCst);
        }

        let contextual_strings = {
            let v = take_pending_vocabulary();
            (!v.is_empty()).then_some(v)
        };

        let recognizer = build_recognizer(locale.as_deref())?;

        // Build the audio buffer request and flip on partial reporting.
        // SAFETY: `new()` returns a freshly retained instance; the setters
        // are plain BOOL property writes.
        let request: Retained<SFSpeechAudioBufferRecognitionRequest> =
            unsafe { SFSpeechAudioBufferRecognitionRequest::new() };
        unsafe {
            request.setShouldReportPartialResults(true);
            request.setAddsPunctuation(true);
            // Personal-vocabulary bias: if the renderer passed any learned
            // terms (from `clips_vocabulary` via list-vocabulary), feed
            // them into SFSpeechRecognizer's `contextualStrings` so the
            // recognizer prefers the user's spelling. SAFETY:
            // `NSMutableArray::new()` returns a freshly retained empty
            // array; we add NSString instances cloned from owned Rust
            // strings, then pass the resulting array to the setter which
            // retains it for the lifetime of the request.
            if let Some(strings) = contextual_strings.as_ref() {
                if !strings.is_empty() {
                    let ns_strings: Vec<Retained<NSString>> =
                        strings.iter().map(|s| NSString::from_str(s)).collect();
                    let refs: Vec<&NSString> = ns_strings.iter().map(|s| &**s).collect();
                    let arr: Retained<NSArray<NSString>> = NSArray::from_slice(&refs);
                    request.setContextualStrings(&arr);
                }
            }
        }

        let audio = match owner {
            SessionOwner::Dictation => SpeechAudio::Capture(DictationCapture::start(
                app.clone(),
                request.clone(),
                mic_device_id.as_deref(),
                mic_device_label.as_deref(),
            )?),
            SessionOwner::Meeting => start_engine_audio(
                &app,
                &request,
                owner,
                mic_device_id.as_deref(),
                mic_device_label.as_deref(),
            )?,
        };

        let cancelled = Arc::new(AtomicBool::new(false));
        let stopped = Arc::new(AtomicBool::new(false));
        let completion_started = Arc::new(AtomicBool::new(false));
        let callback_finished = Arc::new(AtomicBool::new(false));

        // Build the result handler. SFSpeechRecognizer invokes this once
        // per partial result and once with `isFinal=true` when the request
        // ends.
        // SAFETY: the block runs on the recognizer's queue (default = main).
        // We capture clones of `AppHandle` (cheap, refcounted) and the four
        // atomics. We never touch ObjC objects from outside their native
        // lifetime — both `result` and `error` are passed in raw and we
        // wrap them via `&*ptr` only after a null check.
        let result_handler = RcBlock::new({
            let app = app.clone();
            let cancelled = cancelled.clone();
            let stopped = stopped.clone();
            let completion_started = completion_started.clone();
            let callback_finished = callback_finished.clone();
            let locale = locale.clone();
            let mic_device_id = mic_device_id.clone();
            let mic_device_label = mic_device_label.clone();
            move |result_ptr: *mut SFSpeechRecognitionResult, error_ptr: *mut NSError| {
                let is_cancelled = cancelled.load(Ordering::SeqCst);
                let is_stopped = stopped.load(Ordering::SeqCst);
                if !error_ptr.is_null() && result_ptr.is_null() {
                    if !claim_session_completion(&completion_started) {
                        return;
                    }
                    let err = unsafe { &*error_ptr };
                    let msg = ns_error_message(err);
                    let transient = is_transient_recognizer_error(err);
                    eprintln!(
                        "[speech] recognizer ended with error (code {}, transient={transient}): {msg}",
                        err.code()
                    );

                    let restarts_exhausted =
                        transient && restart_attempt + 1 >= MAX_TRANSIENT_RESTARTS;

                    if !is_cancelled && (!transient || restarts_exhausted) {
                        let error = if restarts_exhausted {
                            format!(
                                "Speech recognition kept failing ({msg}) — stopped after {MAX_TRANSIENT_RESTARTS} attempts."
                            )
                        } else {
                            msg
                        };
                        let _ = app.emit(
                            "voice:speech-error",
                            ErrorPayload {
                                error,
                                source: "mic",
                            },
                        );
                    }
                    finish_session_callback(my_gen, &callback_finished);

                    if !is_cancelled && !is_stopped && transient && !restarts_exhausted {
                        let guard = RestartGuard {
                            session_generation: my_gen,
                            owner_stop_generation: my_stop_gen,
                        };
                        let next_attempt = restart_attempt + 1;
                        let app = app.clone();
                        let locale = locale.clone();
                        let mic_device_id = mic_device_id.clone();
                        let mic_device_label = mic_device_label.clone();
                        std::thread::spawn(move || {
                            std::thread::sleep(std::time::Duration::from_millis(300));
                            if !restart_guard_is_current(
                                guard,
                                session_generation().load(Ordering::SeqCst),
                                owner_stop_generation(owner).load(Ordering::SeqCst),
                            ) {
                                return;
                            }
                            let reserved_generation = Arc::new(AtomicU64::new(0));
                            if let Err(e) = native_speech_start_impl_inner(
                                app.clone(),
                                locale,
                                mic_device_id,
                                mic_device_label,
                                owner,
                                next_attempt,
                                Some(guard),
                                Some(reserved_generation.clone()),
                            ) {
                                if restart_setup_is_current(
                                    guard,
                                    match reserved_generation.load(Ordering::SeqCst) {
                                        0 => None,
                                        generation => Some(generation),
                                    },
                                    session_generation().load(Ordering::SeqCst),
                                    owner_stop_generation(owner).load(Ordering::SeqCst),
                                ) {
                                    let _ = app.emit(
                                        "voice:speech-error",
                                        ErrorPayload {
                                            error: e,
                                            source: "mic",
                                        },
                                    );
                                }
                            }
                        });
                    }
                    return;
                }
                if result_ptr.is_null() || is_cancelled {
                    return;
                }
                // SAFETY: `result_ptr` was non-null per the check above; the
                // recognizer keeps the result alive for the duration of
                // this callback.
                let result = unsafe { &*result_ptr };
                if unsafe { result.isFinal() } {
                    if !claim_session_completion(&completion_started) {
                        return;
                    }
                    let transcription = unsafe { result.bestTranscription() };
                    let text = unsafe { transcription.formattedString() }.to_string();
                    let _ = app.emit(
                        "voice:final-transcript",
                        FinalPayload {
                            text,
                            source: "mic",
                        },
                    );
                    finish_session_callback(my_gen, &callback_finished);
                } else if !is_stopped {
                    let transcription = unsafe { result.bestTranscription() };
                    let text = unsafe { transcription.formattedString() }.to_string();
                    let _ = app.emit(
                        "voice:partial-transcript",
                        PartialPayload {
                            text,
                            source: "mic",
                        },
                    );
                }
            }
        });

        // Kick off the recognition task. This retains the request + handler
        // and returns a task we can later cancel().
        // SAFETY: `recognitionTaskWithRequest_resultHandler` retains both
        // inputs.
        let task = unsafe {
            recognizer.recognitionTaskWithRequest_resultHandler(&request, &result_handler)
        };

        let session = SpeechSession {
            generation: my_gen,
            completion_started,
            callback_finished,
            audio,
            request,
            task,
            cancelled,
            stopped,
            owner,
        };
        let installed = {
            let mut slot = session_slot().lock().map_err(|e| e.to_string())?;
            let current_generation = session_generation().load(Ordering::SeqCst);
            if owner_stop_generation(owner).load(Ordering::SeqCst) == my_stop_gen {
                put_session_if_current_generation(
                    &mut slot.active,
                    session,
                    current_generation,
                    |session| session.generation,
                    |session| session.completion_started.load(Ordering::SeqCst),
                )
            } else {
                Err(session)
            }
        };

        if let Err(session) = installed {
            stop_engine_and_remove_tap(&session);
            let session = {
                let mut slot = session_slot()
                    .lock()
                    .unwrap_or_else(|poisoned| poisoned.into_inner());
                if session.completion_started.load(Ordering::SeqCst) {
                    if !session.callback_finished.load(Ordering::SeqCst) {
                        slot.finishing.push(session);
                    }
                    None
                } else {
                    session.completion_started.store(true, Ordering::SeqCst);
                    session.cancelled.store(true, Ordering::SeqCst);
                    Some(session)
                }
            };
            let Some(session) = session else {
                return Ok(());
            };

            // SAFETY: `cancel()` is a fire-and-forget ObjC call.
            unsafe { session.task.cancel() };
            return Err("speech-engine-start-superseded".into());
        }

        Ok(())
    }

    pub(crate) struct RawMicCapture {
        engine: Retained<AVAudioEngine>,
        input_node: Retained<AVAudioInputNode>,
        sample_rate: f64,
        warm_cache: Option<RawMicWarmCache>,
    }

    // SAFETY: same argument as `SpeechSession` — refcounted ObjC objects that
    // are message-thread-safe and only moved through ownership, never aliased.
    unsafe impl Send for RawMicCapture {}

    impl RawMicCapture {
        pub(crate) fn sample_rate(&self) -> f64 {
            self.sample_rate
        }

        pub(crate) fn stop(self) {
            let RawMicCapture {
                engine,
                input_node,
                sample_rate: _,
                warm_cache,
            } = self;
            if let Some(cache) = warm_cache {
                unsafe {
                    if engine.isRunning() {
                        engine.stop();
                    }
                }
                if let Ok(mut target) = cache.target.lock() {
                    *target = None;
                }
                store_warmed_raw_mic_engine(WarmedRawMicEngine {
                    engine,
                    input_node,
                    device_key: cache.device_key,
                    target: cache.target,
                });
                return;
            }
            unsafe {
                input_node.removeTapOnBus(0);
                if engine.isRunning() {
                    engine.stop();
                }
            }
        }
    }

    fn start_warmed_raw_mic_capture(
        app: AppHandle,
        mic_device_id: Option<String>,
        mic_device_label: Option<String>,
        on_samples: Arc<dyn Fn(&[f32]) + Send + Sync>,
    ) -> Result<RawMicCapture, String> {
        let device_key =
            RawMicDeviceKey::from_selection(mic_device_id.as_deref(), mic_device_label.as_deref());
        let warmed = match take_warmed_raw_mic_engine(&device_key) {
            Some(warmed) => warmed,
            None => build_warmed_raw_mic_engine(
                mic_device_id.as_deref(),
                mic_device_label.as_deref(),
                device_key.clone(),
            )?,
        };
        if let Ok(mut target) = warmed.target.lock() {
            *target = Some(RawMicTapTarget {
                app: app.clone(),
                on_samples,
                level_tick: Arc::new(AtomicU32::new(0)),
            });
        } else {
            return Err("warmed mic target lock poisoned".into());
        }

        let start_result = objc2::exception::catch(std::panic::AssertUnwindSafe(|| unsafe {
            warmed.engine.startAndReturnError()
        }))
        .map_err(|e| format!("AVAudioEngine start threw: {e:?}"))
        .and_then(|r| {
            r.map_err(|e| format!("AVAudioEngine start failed: {}", ns_error_message(&e)))
        });
        if let Err(msg) = start_result {
            if let Ok(mut target) = warmed.target.lock() {
                *target = None;
            }
            return Err(msg);
        }

        let format = unsafe { warmed.input_node.outputFormatForBus(0) };
        let sample_rate = unsafe { format.sampleRate() };
        eprintln!(
            "[whisper-mic] reused warm VPIO tap format: {} Hz, {} ch",
            sample_rate as u32,
            unsafe { format.channelCount() }
        );

        let WarmedRawMicEngine {
            engine,
            input_node,
            device_key,
            target,
        } = warmed;
        Ok(RawMicCapture {
            engine,
            input_node,
            sample_rate,
            warm_cache: Some(RawMicWarmCache { device_key, target }),
        })
    }

    #[derive(Clone, Copy, Debug, PartialEq, Eq)]
    pub(crate) enum MicVoiceProcessingMode {
        Disabled,
        Enabled,
        Bypassed,
    }

    pub(crate) fn start_raw_mic_capture(
        app: AppHandle,
        mic_device_id: Option<String>,
        mic_device_label: Option<String>,
        voice_processing: MicVoiceProcessingMode,
        reuse_voice_processing_engine: bool,
        on_samples: Arc<dyn Fn(&[f32]) + Send + Sync>,
    ) -> Result<RawMicCapture, String> {
        if voice_processing == MicVoiceProcessingMode::Enabled && reuse_voice_processing_engine {
            return start_warmed_raw_mic_capture(app, mic_device_id, mic_device_label, on_samples);
        }
        clear_warmed_raw_mic_engine();

        configure_shared_mic_audio_session();

        let engine: Retained<AVAudioEngine> = unsafe { AVAudioEngine::new() };
        configure_engine_input_device(
            &engine,
            mic_device_id.as_deref(),
            mic_device_label.as_deref(),
        )?;
        let input_node: Retained<AVAudioInputNode> = unsafe { engine.inputNode() };

        let voice_processing_enabled = match voice_processing {
            MicVoiceProcessingMode::Bypassed => {
                enable_bypassed_voice_processing(&input_node)?;
                true
            }
            MicVoiceProcessingMode::Enabled => enable_voice_processing(&input_node).is_ok(),
            MicVoiceProcessingMode::Disabled => {
                eprintln!("[whisper-mic] voice processing disabled for shared mic capture");
                false
            }
        };
        objc2::exception::catch(std::panic::AssertUnwindSafe(|| unsafe { engine.prepare() }))
            .map_err(|e| format!("AVAudioEngine prepare threw: {e:?}"))?;

        {
            let on_samples = on_samples.clone();
            let app_for_level = app.clone();
            let level_tick = std::sync::Arc::new(std::sync::atomic::AtomicU32::new(0));
            let tap_block = StackBlock::new(
                move |buffer: std::ptr::NonNull<AVAudioPCMBuffer>,
                      _when: std::ptr::NonNull<AVAudioTime>| {
                    let buf = unsafe { buffer.as_ref() };
                    let mono = mono_mix_pcm(buf);
                    if !mono.is_empty() {
                        on_samples(&mono);
                    }
                    let n = level_tick.fetch_add(1, Ordering::Relaxed);
                    if n % 2 == 0 {
                        let level = peak_level_for_pcm(buf);
                        let _ = app_for_level.emit(
                            "voice:audio-level",
                            AudioLevelPayload {
                                level,
                                source: "mic",
                            },
                        );
                    }
                },
            )
            .copy();
            let block_ptr: *mut block2::Block<
                dyn Fn(std::ptr::NonNull<AVAudioPCMBuffer>, std::ptr::NonNull<AVAudioTime>)
                    + 'static,
            > = (&*tap_block) as *const _ as *mut _;
            objc2::exception::catch(std::panic::AssertUnwindSafe(|| unsafe {
                input_node.installTapOnBus_bufferSize_format_block(
                    0, 1024,
                    None, // use hardware's current format — avoids SCO↔A2DP stale-format race
                    block_ptr,
                );
            }))
            .map_err(|e| format!("installTapOnBus threw: {e:?}"))?;
        }

        if let Err(err) = unsafe { engine.startAndReturnError() } {
            let msg = ns_error_message(&err);
            unsafe { input_node.removeTapOnBus(0) };
            return Err(format!("AVAudioEngine start failed: {msg}"));
        }

        let format = unsafe { input_node.outputFormatForBus(0) };
        let sample_rate = unsafe { format.sampleRate() };
        eprintln!(
            "[whisper-mic] tap format after start: {} Hz, {} ch",
            sample_rate as u32,
            unsafe { format.channelCount() }
        );

        if voice_processing_enabled {
            disable_voice_processing_ducking(&input_node);
        }

        Ok(RawMicCapture {
            engine,
            input_node,
            sample_rate,
            warm_cache: None,
        })
    }

    fn take_session_for(
        slot: &mut SessionRegistry<SpeechSession>,
        owner: Option<SessionOwner>,
    ) -> Option<SpeechSession> {
        // Dictation and meeting transcription share one recognizer slot, so a
        // stop from one must not tear down the other's live session.
        let owned_by_other = matches!(
            (slot.active.as_ref(), owner),
            (Some(current), Some(owner)) if current.owner != owner
        );
        if owned_by_other {
            return None;
        }
        slot.active.take()
    }

    pub fn native_speech_stop_impl(
        _app: AppHandle,
        owner: Option<SessionOwner>,
    ) -> Result<(), String> {
        let session = {
            let mut slot = session_slot().lock().map_err(|e| e.to_string())?;
            invalidate_restart(owner);
            take_session_for(&mut slot, owner)
        };
        let Some(session) = session else {
            return Ok(());
        };

        session.stopped.store(true, Ordering::SeqCst);
        stop_engine_and_remove_tap(&session);
        // SAFETY: `endAudio()` signals that no more buffers are coming. The
        // result handler will still fire once more, so retain the session
        // until that callback finishes even if a newer start owns the slot.
        unsafe { session.request.endAudio() };

        {
            let mut slot = session_slot().lock().map_err(|e| e.to_string())?;
            let current_generation = session_generation().load(Ordering::SeqCst);
            restore_stopped_session(
                &mut slot,
                session,
                current_generation,
                |session| session.generation,
                |session| session.completion_started.load(Ordering::SeqCst),
                |session| session.callback_finished.load(Ordering::SeqCst),
            );
        }
        Ok(())
    }

    pub fn native_speech_cancel_impl(
        _app: AppHandle,
        owner: Option<SessionOwner>,
    ) -> Result<(), String> {
        let session = {
            let mut slot = session_slot().lock().map_err(|e| e.to_string())?;
            invalidate_restart(owner);
            take_session_for(&mut slot, owner)
        };
        let Some(session) = session else {
            return Ok(());
        };
        session.cancelled.store(true, Ordering::SeqCst);
        stop_engine_and_remove_tap(&session);
        // SAFETY: `cancel()` discards any pending result and halts the task.
        unsafe { session.task.cancel() };
        Ok(())
    }

    pub fn shutdown() {
        let sessions = match session_slot().lock() {
            Ok(mut slot) => {
                invalidate_restart(None);
                let mut sessions = slot.active.take().into_iter().collect::<Vec<_>>();
                sessions.append(&mut slot.finishing);
                sessions
            }
            Err(poisoned) => {
                let mut slot = poisoned.into_inner();
                invalidate_restart(None);
                let mut sessions = slot.active.take().into_iter().collect::<Vec<_>>();
                sessions.append(&mut slot.finishing);
                sessions
            }
        };
        for session in sessions {
            session.cancelled.store(true, Ordering::SeqCst);
            session.stopped.store(true, Ordering::SeqCst);
            unsafe { session.task.cancel() };
            stop_engine_and_remove_tap(&session);
        }
        clear_warmed_raw_mic_engine();
    }

    #[cfg(test)]
    mod tests {
        use super::{
            native_speech_voice_processing_mode, put_session_if_current_generation,
            restart_guard_is_current, restart_setup_is_current, restore_stopped_session,
            retain_session_until_callback, take_sessions_if_generation_matches,
            MicVoiceProcessingMode, RestartGuard, SessionOwner, SessionRegistry,
            StoppedSessionDisposition,
        };
        use std::sync::Arc;

        #[derive(Debug)]
        struct TestResource;

        #[derive(Debug)]
        struct TestSession {
            generation: u64,
            completion_started: bool,
            callback_finished: bool,
            stopped: bool,
            resource: Arc<TestResource>,
        }

        fn test_session(generation: u64) -> TestSession {
            TestSession {
                generation,
                completion_started: false,
                callback_finished: false,
                stopped: false,
                resource: Arc::new(TestResource),
            }
        }

        #[test]
        fn stale_callback_cleanup_preserves_the_replacement_session() {
            let mut registry = SessionRegistry {
                active: Some(test_session(2)),
                finishing: Vec::new(),
            };

            let removed =
                take_sessions_if_generation_matches(&mut registry, 1, |session| session.generation);

            assert!(removed.is_empty());
            assert_eq!(
                registry.active.as_ref().map(|session| session.generation),
                Some(2)
            );
        }

        #[test]
        fn stopped_session_stays_owned_until_its_callback_finishes_without_replacing_newer_session()
        {
            let mut registry = SessionRegistry {
                active: Some(test_session(2)),
                finishing: Vec::new(),
            };
            let old_session = test_session(1);
            let old_resource = Arc::downgrade(&old_session.resource);

            let disposition = restore_stopped_session(
                &mut registry,
                old_session,
                2,
                |session| session.generation,
                |session| session.completion_started,
                |session| session.callback_finished,
            );

            assert_eq!(disposition, StoppedSessionDisposition::Finishing);
            assert_eq!(
                registry.active.as_ref().map(|session| session.generation),
                Some(2)
            );
            assert_eq!(registry.finishing.len(), 1);
            assert!(old_resource.upgrade().is_some());

            drop(take_sessions_if_generation_matches(
                &mut registry,
                1,
                |session| session.generation,
            ));

            assert!(registry.finishing.is_empty());
            assert!(old_resource.upgrade().is_none());
            assert_eq!(
                registry.active.as_ref().map(|session| session.generation),
                Some(2)
            );
        }

        #[test]
        fn completed_session_is_dropped_instead_of_retained() {
            let mut registry = SessionRegistry::<TestSession>::default();
            let mut completed = test_session(2);
            completed.completion_started = true;
            completed.callback_finished = true;
            let resource = Arc::downgrade(&completed.resource);

            let disposition = restore_stopped_session(
                &mut registry,
                completed,
                2,
                |session| session.generation,
                |session| session.completion_started,
                |session| session.callback_finished,
            );

            assert_eq!(disposition, StoppedSessionDisposition::Completed);
            assert!(registry.active.is_none());
            assert!(registry.finishing.is_empty());
            assert!(resource.upgrade().is_none());
        }

        #[test]
        fn in_progress_completion_is_not_restored_to_the_active_slot() {
            let mut registry = SessionRegistry::<TestSession>::default();
            let mut session = test_session(2);
            session.completion_started = true;
            let resource = Arc::downgrade(&session.resource);

            let disposition = restore_stopped_session(
                &mut registry,
                session,
                2,
                |session| session.generation,
                |session| session.completion_started,
                |session| session.callback_finished,
            );

            assert_eq!(disposition, StoppedSessionDisposition::Finishing);
            assert!(registry.active.is_none());
            assert_eq!(registry.finishing.len(), 1);
            assert!(resource.upgrade().is_some());

            drop(take_sessions_if_generation_matches(
                &mut registry,
                2,
                |session| session.generation,
            ));

            assert!(resource.upgrade().is_none());
        }

        #[test]
        fn a_new_start_retains_a_restored_stopped_session_until_its_callback_finishes() {
            let mut registry = SessionRegistry::<TestSession>::default();
            let mut session = test_session(1);
            session.stopped = true;
            let resource = Arc::downgrade(&session.resource);

            let disposition = restore_stopped_session(
                &mut registry,
                session,
                1,
                |session| session.generation,
                |session| session.completion_started,
                |session| session.callback_finished,
            );
            assert_eq!(disposition, StoppedSessionDisposition::Active);

            let restored = registry.active.take().unwrap();
            let previous = retain_session_until_callback(
                &mut registry,
                restored,
                |session| session.stopped || session.completion_started,
                |session| session.callback_finished,
            );

            assert!(previous.is_none());
            assert!(registry.active.is_none());
            assert_eq!(registry.finishing.len(), 1);
            assert!(resource.upgrade().is_some());

            drop(take_sessions_if_generation_matches(
                &mut registry,
                1,
                |session| session.generation,
            ));

            assert!(resource.upgrade().is_none());
        }

        #[test]
        fn stale_start_does_not_replace_the_newer_session() {
            let mut slot = Some(test_session(2));

            let installed = put_session_if_current_generation(
                &mut slot,
                test_session(1),
                2,
                |session| session.generation,
                |session| session.completion_started,
            );

            assert_eq!(installed.unwrap_err().generation, 1);
            assert_eq!(slot.as_ref().map(|session| session.generation), Some(2));
        }

        #[test]
        fn new_start_invalidates_a_delayed_restart() {
            let guard = RestartGuard {
                session_generation: 4,
                owner_stop_generation: 2,
            };

            assert!(!restart_guard_is_current(guard, 5, 2));
        }

        #[test]
        fn stop_invalidates_a_delayed_restart_for_its_owner() {
            let guard = RestartGuard {
                session_generation: 4,
                owner_stop_generation: 2,
            };

            assert!(!restart_guard_is_current(guard, 4, 3));
        }

        #[test]
        fn restart_setup_errors_are_suppressed_after_stop_or_new_start() {
            let guard = RestartGuard {
                session_generation: 4,
                owner_stop_generation: 2,
            };

            assert!(restart_setup_is_current(guard, None, 4, 2));
            assert!(restart_setup_is_current(guard, Some(5), 5, 2));
            assert!(!restart_setup_is_current(guard, Some(5), 5, 3));
            assert!(!restart_setup_is_current(guard, Some(5), 6, 2));
        }

        #[test]
        fn meeting_native_speech_fallback_uses_bypassed_voice_processing() {
            assert_eq!(
                native_speech_voice_processing_mode(SessionOwner::Meeting),
                MicVoiceProcessingMode::Bypassed
            );
        }

        #[test]
        fn dictation_native_speech_keeps_raw_input() {
            assert_eq!(
                native_speech_voice_processing_mode(SessionOwner::Dictation),
                MicVoiceProcessingMode::Disabled
            );
        }
    }
}

pub fn shutdown() {
    #[cfg(target_os = "macos")]
    macos::shutdown();
}
