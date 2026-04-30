//! Native macOS dictation via Apple's Speech framework.
//!
//! Web Speech API (`webkitSpeechRecognition`) does not work inside a Tauri
//! WKWebView — Apple gates `WebSpeechAPIEnabled` to false in embedded
//! WKWebViews, so the recognition session starts but no `onresult` ever fires.
//! The fix is to drive `SFSpeechRecognizer` + `AVAudioEngine` from Rust and
//! forward partial / final transcripts to the renderer over Tauri events.
//!
//! This module exposes three Tauri commands:
//!
//! | Command                | Purpose                                                |
//! | ---------------------- | ------------------------------------------------------ |
//! | `native_speech_start`  | Build the engine + recognizer + tap, kick off a task. |
//! | `native_speech_stop`   | Stop audio, let the in-flight final result land.       |
//! | `native_speech_cancel` | Stop audio + cancel the task (no final result).        |
//!
//! Events emitted on the AppHandle:
//!   - `voice:partial-transcript` `{ text: String }` — interim hypotheses
//!   - `voice:final-transcript`   `{ text: String }` — only when `result.isFinal`
//!   - `voice:speech-error`       `{ error: String }` — any failure
//!
//! All ObjC interop is `unsafe` by definition; the comments above each block
//! call out the soundness argument.

#[cfg(target_os = "macos")]
mod imp {
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::{Arc, Mutex, OnceLock};

    use block2::{RcBlock, StackBlock};
    use objc2::rc::Retained;
    use objc2::{AnyThread, ClassType};
    use objc2_avf_audio::{AVAudioEngine, AVAudioPCMBuffer, AVAudioTime};
    use objc2_foundation::{NSError, NSLocale, NSString};
    use objc2_speech::{
        SFSpeechAudioBufferRecognitionRequest, SFSpeechRecognitionResult,
        SFSpeechRecognitionTask, SFSpeechRecognizer, SFSpeechRecognizerAuthorizationStatus,
    };
    use serde::Serialize;
    use tauri::{AppHandle, Emitter};

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
        engine: Retained<AVAudioEngine>,
        request: Retained<SFSpeechAudioBufferRecognitionRequest>,
        task: Retained<SFSpeechRecognitionTask>,
        /// Set by `cancel()` so the result handler stops emitting events
        /// after the user dismissed the dictation.
        cancelled: Arc<AtomicBool>,
        /// Set by `stop()` so the result handler suppresses further partials
        /// but still emits the final transcript when it arrives.
        stopped: Arc<AtomicBool>,
    }

    // SAFETY: see the doc comment on `SpeechSession`. We never alias the
    // inner pointers across threads — the session is moved through a Mutex.
    unsafe impl Send for SpeechSession {}

    /// Process-global session slot. We only allow one dictation at a time —
    /// starting a new one while another is in flight cancels the old one
    /// first.
    fn session_slot() -> &'static Mutex<Option<SpeechSession>> {
        static SLOT: OnceLock<Mutex<Option<SpeechSession>>> = OnceLock::new();
        SLOT.get_or_init(|| Mutex::new(None))
    }

    #[derive(Serialize, Clone)]
    struct PartialPayload {
        text: String,
    }

    #[derive(Serialize, Clone)]
    struct FinalPayload {
        text: String,
    }

    #[derive(Serialize, Clone)]
    struct ErrorPayload {
        error: String,
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
        // Fast path: already known.
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

        // NotDetermined — prompt the user. Bridge the async callback into a
        // sync wait via mpsc.
        let (tx, rx) =
            std::sync::mpsc::sync_channel::<SFSpeechRecognizerAuthorizationStatus>(1);
        let tx = Mutex::new(Some(tx));
        // SAFETY: the handler is owned by the system until it fires once;
        // we box it into an `RcBlock` so the closure stays alive across the
        // ObjC boundary. The closure captures only the
        // `Mutex<Option<SyncSender>>`, which is `Send + Sync`.
        let handler =
            RcBlock::new(move |status: SFSpeechRecognizerAuthorizationStatus| {
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

    /// Build a fresh recognizer for the given locale (defaulting to en-US if
    /// the user didn't pass one or the BCP-47 string was unsupported).
    fn build_recognizer(
        locale: Option<&str>,
    ) -> Result<Retained<SFSpeechRecognizer>, String> {
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
        let recognizer = recognizer.ok_or_else(|| {
            format!("SFSpeechRecognizer init failed for locale {identifier}")
        })?;
        // Guard against the recognizer being temporarily offline (e.g. for a
        // locale that requires Apple's servers and we have no network).
        if !unsafe { recognizer.isAvailable() } {
            return Err(
                "SFSpeechRecognizer is not currently available (network down?).".into(),
            );
        }
        Ok(recognizer)
    }

    /// Tear down whatever session is currently running. Called from `start`
    /// to guarantee a fresh slate, and from `cancel` / `stop` for explicit
    /// teardown.
    fn stop_engine_and_remove_tap(session: &SpeechSession) {
        // SAFETY: `AVAudioEngine` and `AVAudioInputNode` are
        // message-thread-safe per Apple's docs. `inputNode` returns a
        // singleton already retained by the engine; both calls are
        // fire-and-forget and have no return value.
        unsafe {
            let input = session.engine.inputNode();
            input.removeTapOnBus(0);
            if session.engine.isRunning() {
                session.engine.stop();
            }
        }
    }

    /// Helper for the result handler — clears the global session slot once a
    /// terminal event (final result or error) has been emitted, so a
    /// subsequent `start()` doesn't try to cancel a defunct task.
    fn clear_session_slot() {
        if let Ok(mut slot) = session_slot().lock() {
            if let Some(session) = slot.take() {
                stop_engine_and_remove_tap(&session);
            }
        }
    }

    /// Pull a human-readable string out of an NSError. Falls back to the raw
    /// error code if `localizedDescription` is missing.
    fn ns_error_message(err: &NSError) -> String {
        // SAFETY: `localizedDescription` always returns a non-nil NSString
        // per Apple's docs.
        let desc: Retained<NSString> =
            unsafe { objc2::msg_send![err, localizedDescription] };
        let s = desc.to_string();
        if s.is_empty() {
            format!("NSError code {}", err.code())
        } else {
            s
        }
    }

    #[tauri::command]
    pub async fn native_speech_start(
        app: AppHandle,
        locale: Option<String>,
    ) -> Result<(), String> {
        // Cancel any prior session first — there's only one mic tap per input
        // node, and we want a deterministic state going in.
        {
            let mut slot = session_slot().lock().map_err(|e| e.to_string())?;
            if let Some(prev) = slot.take() {
                prev.cancelled.store(true, Ordering::SeqCst);
                // SAFETY: `cancel()` is a fire-and-forget ObjC call.
                unsafe { prev.task.cancel() };
                stop_engine_and_remove_tap(&prev);
            }
        }

        ensure_authorized()?;

        let recognizer = build_recognizer(locale.as_deref())?;

        // Build the audio buffer request and flip on partial reporting.
        // SAFETY: `new()` returns a freshly retained instance; the setters
        // are plain BOOL property writes.
        let request: Retained<SFSpeechAudioBufferRecognitionRequest> =
            unsafe { SFSpeechAudioBufferRecognitionRequest::new() };
        unsafe {
            request.setShouldReportPartialResults(true);
            request.setAddsPunctuation(true);
        }

        // Spin up the engine and grab its input node + native format.
        // SAFETY: `AVAudioEngine::new()` returns a retained engine.
        // `inputNode` is the engine's singleton input — also retained.
        let engine: Retained<AVAudioEngine> = unsafe { AVAudioEngine::new() };
        let input_node = unsafe { engine.inputNode() };
        let format = unsafe { input_node.outputFormatForBus(0) };

        // Install a tap that forwards every PCM buffer into the recognition
        // request. The tap callback runs on the realtime audio thread —
        // keep it tight and lock-free.
        //
        // SAFETY: `installTapOnBus:` retains the block until
        // `removeTapOnBus:` is called. The block captures
        // `request_for_tap`, a refcounted ObjC reference;
        // `appendAudioPCMBuffer:` is documented as safe to call from any
        // thread. We use `StackBlock::copy()` to upgrade it to a heap-owned
        // `RcBlock` so its lifetime survives until the tap is removed.
        {
            let request_for_tap = request.clone();
            let tap_block = StackBlock::new(
                move |buffer: std::ptr::NonNull<AVAudioPCMBuffer>,
                      _when: std::ptr::NonNull<AVAudioTime>| {
                    // SAFETY: `buffer` is provided by the audio engine and
                    // is valid for the duration of the call.
                    unsafe {
                        request_for_tap.appendAudioPCMBuffer(buffer.as_ref());
                    }
                },
            )
            .copy();
            // SAFETY: AVFoundation's `installTapOnBus:` performs a
            // `Block_copy` internally, so the caller does not need to keep
            // `tap_block` alive. We hand it a `*mut Block<F>` cast from the
            // `RcBlock`'s deref — the block_copy will retain it on the
            // ObjC side, and `tap_block` drops at end of scope releasing
            // our copy. removeTapOnBus: + drop fully tears it down.
            let block_ptr: *mut block2::Block<
                dyn Fn(
                        std::ptr::NonNull<AVAudioPCMBuffer>,
                        std::ptr::NonNull<AVAudioTime>,
                    ) + 'static,
            > = (&*tap_block) as *const _ as *mut _;
            unsafe {
                input_node.installTapOnBus_bufferSize_format_block(
                    0,
                    1024,
                    Some(&format),
                    block_ptr,
                );
            }
        }

        // Start the engine. If this fails the tap stays installed; tear it
        // down so the next start() doesn't trip "only one tap may be
        // installed".
        // SAFETY: `prepare` and `startAndReturnError` are documented as the
        // standard kick-off; they touch the audio HAL and may fail when the
        // input device is in a weird state.
        if let Err(err) = unsafe {
            engine.prepare();
            engine.startAndReturnError()
        } {
            let msg = ns_error_message(&err);
            unsafe { input_node.removeTapOnBus(0) };
            return Err(format!("AVAudioEngine start failed: {msg}"));
        }

        // Cancel + stop flags shared with the result handler.
        let cancelled = Arc::new(AtomicBool::new(false));
        let stopped = Arc::new(AtomicBool::new(false));

        // Build the result handler. SFSpeechRecognizer invokes this once
        // per partial result and once with `isFinal=true` when the request
        // ends.
        let app_for_handler = app.clone();
        let cancelled_for_handler = cancelled.clone();
        let stopped_for_handler = stopped.clone();
        // SAFETY: the block runs on the recognizer's queue (default = main).
        // We capture clones of `AppHandle` (cheap, refcounted) and the two
        // atomics. We never touch ObjC objects from outside their native
        // lifetime — both `result` and `error` are passed in raw and we wrap
        // them via `&*ptr` only after a null check.
        let result_handler = RcBlock::new(
            move |result_ptr: *mut SFSpeechRecognitionResult, error_ptr: *mut NSError| {
                let cancelled = cancelled_for_handler.load(Ordering::SeqCst);
                let stopped = stopped_for_handler.load(Ordering::SeqCst);
                // Error path: surface and clean up the slot.
                if !error_ptr.is_null() && result_ptr.is_null() {
                    if !cancelled {
                        // SAFETY: `error_ptr` non-null per the check above;
                        // the recognizer keeps it alive for the duration of
                        // this callback.
                        let err = unsafe { &*error_ptr };
                        let msg = ns_error_message(err);
                        let _ = app_for_handler
                            .emit("voice:speech-error", ErrorPayload { error: msg });
                    }
                    clear_session_slot();
                    return;
                }
                if result_ptr.is_null() {
                    return;
                }
                if cancelled {
                    return;
                }
                // SAFETY: `result_ptr` was non-null per the check above; the
                // recognizer keeps the result alive for the duration of this
                // callback.
                let result = unsafe { &*result_ptr };
                let transcription = unsafe { result.bestTranscription() };
                let formatted = unsafe { transcription.formattedString() };
                let text = formatted.to_string();
                let is_final = unsafe { result.isFinal() };
                if is_final {
                    let _ = app_for_handler
                        .emit("voice:final-transcript", FinalPayload { text });
                    clear_session_slot();
                } else if !stopped {
                    let _ = app_for_handler
                        .emit("voice:partial-transcript", PartialPayload { text });
                }
            },
        );

        // Kick off the recognition task. This retains the request + handler
        // and returns a task we can later cancel().
        // SAFETY: `recognitionTaskWithRequest_resultHandler` retains both
        // inputs.
        let task = unsafe {
            recognizer.recognitionTaskWithRequest_resultHandler(&request, &result_handler)
        };

        // Stash the session for `stop()` / `cancel()` to find.
        {
            let mut slot = session_slot().lock().map_err(|e| e.to_string())?;
            *slot = Some(SpeechSession {
                engine,
                request,
                task,
                cancelled,
                stopped,
            });
        }

        Ok(())
    }

    #[tauri::command]
    pub async fn native_speech_stop(_app: AppHandle) -> Result<(), String> {
        // Take the session out so subsequent `stop()` calls are no-ops. We
        // KEEP the recognition task running — calling `endAudio()` lets it
        // deliver a final result via the handler, which then emits
        // `voice:final-transcript`.
        let session = {
            let mut slot = session_slot().lock().map_err(|e| e.to_string())?;
            slot.take()
        };
        let Some(session) = session else {
            return Ok(());
        };

        session.stopped.store(true, Ordering::SeqCst);
        stop_engine_and_remove_tap(&session);
        // SAFETY: `endAudio()` is a fire-and-forget signal to the recognizer
        // that no more buffers are coming. The result handler will still
        // fire once more (with `isFinal=true`) — that's why we don't drop
        // the task here; we put the session back so the atomics + ObjC refs
        // stay alive until the final result lands.
        unsafe { session.request.endAudio() };

        // Re-stash the session so the result handler can find the
        // cancelled/stopped atomics if it races. The handler will clear it
        // on the final result via `clear_session_slot()`.
        {
            let mut slot = session_slot().lock().map_err(|e| e.to_string())?;
            *slot = Some(session);
        }
        Ok(())
    }

    #[tauri::command]
    pub async fn native_speech_cancel(_app: AppHandle) -> Result<(), String> {
        let session = {
            let mut slot = session_slot().lock().map_err(|e| e.to_string())?;
            slot.take()
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
}

#[cfg(target_os = "macos")]
pub use imp::{native_speech_cancel, native_speech_start, native_speech_stop};

#[cfg(not(target_os = "macos"))]
mod stub {
    use tauri::AppHandle;

    /// On non-macOS targets the framework is unavailable; surface a clear
    /// error to the renderer so it can fall back to the server-side path.
    #[tauri::command]
    pub async fn native_speech_start(
        _app: AppHandle,
        _locale: Option<String>,
    ) -> Result<(), String> {
        Err("Native speech recognition is only supported on macOS.".into())
    }

    #[tauri::command]
    pub async fn native_speech_stop(_app: AppHandle) -> Result<(), String> {
        Ok(())
    }

    #[tauri::command]
    pub async fn native_speech_cancel(_app: AppHandle) -> Result<(), String> {
        Ok(())
    }
}

#[cfg(not(target_os = "macos"))]
pub use stub::{native_speech_cancel, native_speech_start, native_speech_stop};
