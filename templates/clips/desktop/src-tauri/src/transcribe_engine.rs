//! On-device speech models, run through transcribe.cpp.
//!
//! Every local model shares this one native library, and with it one copy of
//! ggml. A second crate that links its own static ggml would silently run on
//! whichever copy the linker kept, so new local engines belong here too.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Condvar, Mutex, MutexGuard, Once, OnceLock, PoisonError, TryLockError};
use std::time::{Duration, Instant};

use transcribe_cpp::{
    Backend, CancelToken, CommitPolicy, Error, Model, ModelOptions, ParakeetBufferedStreamOptions,
    RunExtension, RunOptions, Session, SessionOptions, StreamExtension, StreamOptions,
    TimestampKind, WhisperRunOptions,
};

const SESSION_THREADS: i32 = 2;

/// Parakeet's live window, in ms of audio: 5.6 s of left context, 0.56 s
/// chunks and 0.56 s of lookahead. Every value must be one of the model's
/// trained `(L, C, R)` frame tuples (here `(70, 7, 7)` at 80 ms a frame);
/// anything else fails at stream start.
const PARAKEET_STREAM_LEFT_MS: i32 = 5_600;
const PARAKEET_STREAM_CHUNK_MS: i32 = 560;
const PARAKEET_STREAM_RIGHT_MS: i32 = 560;

/// How long a copy's holder gets to hand it back before the slot stops
/// waiting, retires that copy and loads a fresh one.
pub(crate) const MODEL_HANDBACK_WAIT: Duration = Duration::from_millis(500);

/// What a refused load or lease says once the app has started quitting.
pub(crate) const QUITTING: &str = "local-model-quitting";

/// What a live stream's lease says when one-shot runs hold the copy.
pub(crate) const IN_USE: &str = "local-model-in-use";

/// What a load says when it would replace another model that one-shot runs
/// hold. A meeting's runs can hold theirs for hours, so the caller tries again
/// later rather than waiting for them or loading a second model beside them.
pub(crate) const OTHER_MODEL_IN_USE: &str = "local-model-other-model-in-use";

/// Whether a load or lease error is the slot turning the caller away, with
/// nothing wrong with the model, rather than a failure.
pub(crate) fn is_refusal(error: &str) -> bool {
    [QUITTING, IN_USE, OTHER_MODEL_IN_USE].contains(&error)
}

/// Names the model in a load or lease error for the log and the pill. A
/// refusal stays as it is, since callers match on it.
pub(crate) fn model_error(model: &str, error: String) -> String {
    if is_refusal(&error) {
        error
    } else {
        format!("{model} {error}")
    }
}

/// The one resident local model. Whisper and Parakeet share it, so the app
/// never holds both in memory; asking for the other one swaps it.
pub(crate) static LOCAL_MODEL: ModelSlot = ModelSlot::new(load_model);

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

/// One loaded model file. Asking for a different path replaces it, so
/// switching models frees the previous one.
///
/// transcribe.cpp refuses a run on a model while a stream is live on it
/// (`Busy`), holds a new stream back until a run in flight returns, and a
/// native call that never returns keeps the model's compute lock for good. So
/// every use of a copy goes through a lease: a live stream gets the copy to
/// itself, one-shot runs share it (transcribe.cpp queues them), and a caller
/// that finds the copy held either waits for it to be handed back or the
/// slot retires that copy and loads another. Only a copy a live stream holds
/// is ever retired: runs end on their own (or when cancelled), and a meeting's
/// can rightly hold the copy for hours, so a second copy loaded beside them
/// would only double the memory. That holds across models too: a load that
/// would replace a model runs hold is refused with [`OTHER_MODEL_IN_USE`].
pub(crate) struct ModelSlot<M: Clone = Model> {
    load: fn(&Path) -> Result<M, String>,
    /// Held while a model loads, so loads never overlap and a caller that
    /// only looks at the resident copy never waits behind one.
    loading: Mutex<()>,
    resident: Mutex<Option<Resident<M>>>,
    /// Every lease out, on the resident copy or a retired one.
    leases: Leases,
    /// Called whenever the resident model changes, so Settings can refresh.
    on_change: OnceLock<Box<dyn Fn() + Send + Sync>>,
}

#[derive(Clone)]
struct Resident<M> {
    path: PathBuf,
    model: M,
    copy: Arc<CopyUse>,
}

/// Who holds one loaded copy.
#[derive(Default)]
struct CopyUse {
    /// [`STREAMING`] while a live stream holds the copy, otherwise how many
    /// one-shot runs do.
    holders: AtomicUsize,
    /// True once a warm-up has run on this copy.
    warm: AtomicBool,
}

const STREAMING: usize = usize::MAX;

#[derive(Clone, Copy, PartialEq, Eq)]
enum HoldKind {
    Stream,
    Run,
}

impl CopyUse {
    fn held_by_runs(&self) -> bool {
        !matches!(self.holders.load(Ordering::SeqCst), 0 | STREAMING)
    }

    fn try_take(&self, kind: HoldKind) -> bool {
        match kind {
            HoldKind::Stream => self
                .holders
                .compare_exchange(0, STREAMING, Ordering::SeqCst, Ordering::SeqCst)
                .is_ok(),
            HoldKind::Run => self
                .holders
                .fetch_update(Ordering::SeqCst, Ordering::SeqCst, |held| {
                    if held == STREAMING {
                        None
                    } else {
                        Some(held + 1)
                    }
                })
                .is_ok(),
        }
    }

    fn give_back(&self, kind: HoldKind) {
        match kind {
            HoldKind::Stream => self.holders.store(0, Ordering::SeqCst),
            HoldKind::Run => {
                self.holders.fetch_sub(1, Ordering::SeqCst);
            }
        }
    }
}

/// The count of leases out, which quitting waits on, and whether the slot
/// still lends at all. One lock covers both, so no lease can slip out after
/// quitting has counted.
struct Leases {
    state: Mutex<LeaseState>,
    returned: Condvar,
}

struct LeaseState {
    out: usize,
    closed: bool,
}

impl Leases {
    const fn new() -> Self {
        Self {
            state: Mutex::new(LeaseState {
                out: 0,
                closed: false,
            }),
            returned: Condvar::new(),
        }
    }

    fn open(&self) -> bool {
        let mut state = lock(&self.state);
        if state.closed {
            return false;
        }
        state.out += 1;
        true
    }

    fn give_back(&self) {
        let mut state = lock(&self.state);
        state.out -= 1;
        if state.out == 0 {
            self.returned.notify_all();
        }
    }

    fn is_closed(&self) -> bool {
        lock(&self.state).closed
    }

    fn close(&self) {
        lock(&self.state).closed = true;
    }

    /// Waits until every lease is back or `deadline` passes, and returns how
    /// many are still out.
    fn wait_until_all_back(&self, deadline: Instant) -> usize {
        let mut state = lock(&self.state);
        while state.out > 0 {
            let Some(left) = deadline.checked_duration_since(Instant::now()) else {
                break;
            };
            state = self
                .returned
                .wait_timeout(state, left)
                .unwrap_or_else(PoisonError::into_inner)
                .0;
        }
        state.out
    }
}

/// One caller's hold on a copy, handed back when it drops.
struct Hold<'a> {
    copy: Arc<CopyUse>,
    kind: HoldKind,
    leases: &'a Leases,
}

impl Drop for Hold<'_> {
    fn drop(&mut self) {
        self.copy.give_back(self.kind);
        self.leases.give_back();
    }
}

/// Sole use of a model for one live stream. The slot hands the model to
/// nobody else until this is dropped, so drop it only once the stream and its
/// session are gone.
pub(crate) struct StreamLease<'a, M: Clone = Model> {
    model: M,
    hold: Hold<'a>,
}

impl<M: Clone> StreamLease<'_, M> {
    pub(crate) fn model(&self) -> &M {
        &self.model
    }

    pub(crate) fn is_warm(&self) -> bool {
        self.hold.copy.warm.load(Ordering::SeqCst)
    }

    pub(crate) fn mark_warm(&self) {
        self.hold.copy.warm.store(true, Ordering::SeqCst);
    }
}

/// A model for one-shot runs, shared with other runs but with no live
/// stream. Drop it only once every session opened on its model is gone: a
/// stream started on the copy while one of those sessions is still running
/// would be refused or held back by transcribe.cpp.
pub(crate) struct RunLease<'a, M: Clone = Model> {
    model: M,
    hold: Hold<'a>,
}

impl<'a, M: Clone> RunLease<'a, M> {
    pub(crate) fn model(&self) -> &M {
        &self.model
    }

    /// Another run lease on the same copy, for a second worker.
    pub(crate) fn share(&self) -> Result<RunLease<'a, M>, String> {
        if !self.hold.leases.open() {
            return Err(QUITTING.to_owned());
        }
        // A run already holds the copy, so no stream can: this always takes.
        let taken = self.hold.copy.try_take(HoldKind::Run);
        debug_assert!(taken);
        Ok(RunLease {
            model: self.model.clone(),
            hold: Hold {
                copy: self.hold.copy.clone(),
                kind: HoldKind::Run,
                leases: self.hold.leases,
            },
        })
    }
}

/// Why the slot could not lend a model to a live stream straight away.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum LeaseRefused {
    /// Another model, or none, is resident, or one is loading.
    NotLoaded,
    /// Loaded, but no warm-up has run on it yet.
    Cold,
    /// A live stream still holds it.
    Streaming,
    /// One-shot runs hold it.
    Running,
    /// Another model is resident and one-shot runs hold it, so this one
    /// can't be loaded until they end.
    OtherModelRunning,
    /// The app is quitting.
    Quitting,
}

impl LeaseRefused {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            LeaseRefused::NotLoaded => "not loaded",
            LeaseRefused::Cold => "not warmed up",
            LeaseRefused::Streaming => "still held by an earlier live pass",
            LeaseRefused::Running => "held by a one-shot transcription",
            LeaseRefused::OtherModelRunning => {
                "not loaded, and a one-shot transcription holds the other model"
            }
            LeaseRefused::Quitting => "closed because the app is quitting",
        }
    }
}

impl<M: Clone> ModelSlot<M> {
    pub(crate) const fn new(load: fn(&Path) -> Result<M, String>) -> Self {
        Self {
            load,
            loading: Mutex::new(()),
            resident: Mutex::new(None),
            leases: Leases::new(),
            on_change: OnceLock::new(),
        }
    }

    /// Calls `on_change` whenever the resident model is loaded, swapped,
    /// retired or released. Only the first call takes effect.
    pub(crate) fn set_on_change(&self, on_change: impl Fn() + Send + Sync + 'static) {
        let _ = self.on_change.set(Box::new(on_change));
    }

    fn changed(&self) {
        if let Some(on_change) = self.on_change.get() {
            on_change();
        }
    }

    fn hold(&self, copy: &Arc<CopyUse>, kind: HoldKind) -> Result<Hold<'_>, LeaseRefused> {
        if !self.leases.open() {
            return Err(LeaseRefused::Quitting);
        }
        if !copy.try_take(kind) {
            self.leases.give_back();
            return Err(if copy.held_by_runs() {
                LeaseRefused::Running
            } else {
                LeaseRefused::Streaming
            });
        }
        Ok(Hold {
            copy: copy.clone(),
            kind,
            leases: &self.leases,
        })
    }

    /// The model at `path` for one-shot runs, loaded on first use, or
    /// [`OTHER_MODEL_IN_USE`] while runs hold another model. The flag is true
    /// when this call did the loading.
    pub(crate) fn lease_for_run(&self, path: &Path) -> Result<(RunLease<'_, M>, bool), String> {
        let _loading = lock(&self.loading);
        if let Some((model, hold)) = self.hold_resident(path, HoldKind::Run)? {
            return Ok((RunLease { model, hold }, false));
        }
        let (model, hold) = self.load_into_slot(path, HoldKind::Run)?;
        Ok((RunLease { model, hold }, true))
    }

    /// Sole use of the model at `path` for a live stream, loading it if
    /// needed, or [`IN_USE`] while one-shot runs hold it and
    /// [`OTHER_MODEL_IN_USE`] while they hold another model. Check
    /// [`StreamLease::is_warm`] before relying on its speed.
    pub(crate) fn lease_for_stream(&self, path: &Path) -> Result<StreamLease<'_, M>, String> {
        let _loading = lock(&self.loading);
        let (model, hold) = match self.hold_resident(path, HoldKind::Stream)? {
            Some(held) => held,
            None => self.load_into_slot(path, HoldKind::Stream)?,
        };
        Ok(StreamLease { model, hold })
    }

    /// The resident model at `path` for a live stream, only if it has warmed
    /// up and nothing else holds it. Never waits and never loads, so a caller
    /// can start capturing audio the moment this returns.
    pub(crate) fn try_lease_warm(&self, path: &Path) -> Result<StreamLease<'_, M>, LeaseRefused> {
        let resident = lock(&self.resident);
        let current = match resident.as_ref() {
            Some(current) if current.path == path => current,
            Some(other) if other.copy.held_by_runs() => {
                return Err(LeaseRefused::OtherModelRunning)
            }
            _ => return Err(LeaseRefused::NotLoaded),
        };
        if !current.copy.warm.load(Ordering::SeqCst) {
            return Err(LeaseRefused::Cold);
        }
        let hold = self.hold(&current.copy, HoldKind::Stream)?;
        Ok(StreamLease {
            model: current.model.clone(),
            hold,
        })
    }

    pub(crate) fn holds_warm(&self, path: &Path) -> bool {
        lock(&self.resident).as_ref().is_some_and(|resident| {
            resident.path == path && resident.copy.warm.load(Ordering::SeqCst)
        })
    }

    /// Unloads the model at `path` if it is the resident one. Sessions that
    /// still hold it keep it alive until they finish.
    pub(crate) fn release(&self, path: &Path) -> Result<bool, String> {
        let _loading = lock(&self.loading);
        let released = {
            let mut resident = lock(&self.resident);
            let matches = resident
                .as_ref()
                .is_some_and(|resident| resident.path == path);
            if matches {
                *resident = None;
            }
            matches
        };
        if released {
            self.changed();
        }
        Ok(released)
    }

    /// Loads `path` only when no model is resident, so a background prewarm
    /// never evicts a model someone asked for. `None` means it left the slot
    /// alone.
    pub(crate) fn load_if_empty(&self, path: &Path) -> Result<Option<RunLease<'_, M>>, String> {
        let _loading = lock(&self.loading);
        if lock(&self.resident).is_some() {
            return Ok(None);
        }
        let (model, hold) = self.load_into_slot(path, HoldKind::Run)?;
        Ok(Some(RunLease { model, hold }))
    }

    /// For quitting: lends and loads nothing more, waits up to `wait` for
    /// every lease to come back and any load to finish, then drops the
    /// resident copy. Callers cancel the work holding leases first.
    ///
    /// ggml's Metal backend keeps its device in a C++ static whose destructor
    /// asserts that every Metal buffer is gone, so `exit` aborts the process
    /// while any model or session is alive. A native call that never returns
    /// can't be made to let go of its model from inside the process; `Err`
    /// says what was still out, and the caller must then end the process
    /// without running static destructors.
    pub(crate) fn shut_down(&self, wait: Duration) -> Result<(), String> {
        self.leases.close();
        let deadline = Instant::now() + wait;
        let out = self.leases.wait_until_all_back(deadline);
        let loads_done = loop {
            if !matches!(self.loading.try_lock(), Err(TryLockError::WouldBlock)) {
                break true;
            }
            if Instant::now() >= deadline {
                break false;
            }
            std::thread::sleep(Duration::from_millis(10));
        };
        lock(&self.resident).take();
        match (out, loads_done) {
            (0, true) => Ok(()),
            (0, false) => Err("a model load is still running".to_owned()),
            (out, true) => Err(format!("{out} model leases are still out")),
            (out, false) => Err(format!(
                "{out} model leases are still out and a model load is still running"
            )),
        }
    }

    /// Takes a `kind` hold on the resident copy of `path`, or `None` when
    /// another file (or nothing) is resident. A live stream holding the copy
    /// gets [`MODEL_HANDBACK_WAIT`] to hand it back; after that the copy is
    /// retired, so the slot never keeps a model a stuck stream is holding. A
    /// stream asking for a copy runs hold gets [`IN_USE`] at once. Call with
    /// `loading` held.
    fn hold_resident(&self, path: &Path, kind: HoldKind) -> Result<Option<(M, Hold<'_>)>, String> {
        let deadline = Instant::now() + MODEL_HANDBACK_WAIT;
        loop {
            let mut resident = lock(&self.resident);
            let Some(current) = resident.as_ref().filter(|resident| resident.path == path) else {
                return Ok(None);
            };
            match self.hold(&current.copy, kind) {
                Ok(hold) => return Ok(Some((current.model.clone(), hold))),
                Err(LeaseRefused::Quitting) => return Err(QUITTING.to_owned()),
                Err(LeaseRefused::Running) if kind == HoldKind::Stream => {
                    return Err(IN_USE.to_owned())
                }
                Err(_) => {}
            }
            if Instant::now() >= deadline {
                eprintln!(
                    "[models] an earlier transcription still holds {}; retiring that copy",
                    path.file_name().unwrap_or_default().to_string_lossy()
                );
                *resident = None;
                drop(resident);
                self.changed();
                return Ok(None);
            }
            drop(resident);
            std::thread::sleep(Duration::from_millis(10));
        }
    }

    /// Empties the slot for a load. A copy one-shot runs hold stays, and the
    /// load gets [`OTHER_MODEL_IN_USE`] at once. A live stream holding it gets
    /// [`MODEL_HANDBACK_WAIT`] to hand it back, then the copy is retired, so a
    /// stuck stream can't keep the other model out. Call with `loading` held.
    fn empty_for_load(&self) -> Result<(), String> {
        let deadline = Instant::now() + MODEL_HANDBACK_WAIT;
        loop {
            let mut resident = lock(&self.resident);
            let Some(current) = resident.as_ref() else {
                return Ok(());
            };
            if current.copy.held_by_runs() {
                return Err(OTHER_MODEL_IN_USE.to_owned());
            }
            let streaming = current.copy.holders.load(Ordering::SeqCst) == STREAMING;
            if streaming && Instant::now() < deadline {
                drop(resident);
                std::thread::sleep(Duration::from_millis(10));
                continue;
            }
            if streaming {
                eprintln!(
                    "[models] a live stream still holds {}; retiring that copy",
                    current
                        .path
                        .file_name()
                        .unwrap_or_default()
                        .to_string_lossy()
                );
            }
            // Free the old model before loading the new one, so a swap never
            // briefly holds both.
            let previous = resident.take();
            drop(resident);
            drop(previous);
            self.changed();
            return Ok(());
        }
    }

    /// Replaces the resident model with a fresh copy of `path`, with a `kind`
    /// hold already on it. Call with `loading` held.
    fn load_into_slot(&self, path: &Path, kind: HoldKind) -> Result<(M, Hold<'_>), String> {
        if self.leases.is_closed() {
            return Err(QUITTING.to_owned());
        }
        self.empty_for_load()?;
        let model = (self.load)(path)?;
        let copy = Arc::new(CopyUse::default());
        // Refused only when the app started quitting during the load; the
        // fresh copy is then dropped here rather than kept for exit.
        let hold = self.hold(&copy, kind).map_err(|_| QUITTING.to_owned())?;
        *lock(&self.resident) = Some(Resident {
            path: path.to_path_buf(),
            model: model.clone(),
            copy,
        });
        self.changed();
        Ok((model, hold))
    }
}

pub(crate) fn load_model(path: &Path) -> Result<Model, String> {
    static LOGGING: Once = Once::new();
    LOGGING.call_once(transcribe_cpp::init_logging);

    let options = ModelOptions {
        backend: if cfg!(target_arch = "aarch64") {
            Backend::Auto
        } else {
            Backend::Cpu
        },
        ..ModelOptions::default()
    };
    Model::load_with(path, &options).map_err(|e| format!("model load failed: {e}"))
}

/// Cancelled once the app starts quitting. Every session starts with it, so
/// quitting can stop the runs of callers that install no token of their own.
pub(crate) fn quit_token() -> &'static CancelToken {
    static TOKEN: OnceLock<CancelToken> = OnceLock::new();
    TOKEN.get_or_init(CancelToken::new)
}

pub(crate) fn open_session(model: &Model) -> Result<Session, String> {
    let options = SessionOptions {
        n_threads: SESSION_THREADS,
        ..SessionOptions::default()
    };
    let mut session = model
        .session_with(&options)
        .map_err(|e| format!("session init failed: {e}"))?;
    session.set_cancel_token(quit_token());
    Ok(session)
}

/// A window the model rates more likely than this to hold no speech is
/// dropped, which keeps silence and steady noise from coming back as text.
const MAX_NO_SPEECH_PROBABILITY: f32 = 0.72;

/// Greedy decoding of 16 kHz mono PCM, with each 30 s window decoded on its
/// own (no previous-text prompt). Returns `(start_ms, end_ms, text)` segments
/// relative to the start of `samples`; `language: None` auto-detects.
pub(crate) fn transcribe_whisper(
    session: &mut Session,
    samples: &[f32],
    language: Option<&str>,
) -> Result<Vec<(i64, i64, String)>, String> {
    let options = RunOptions {
        timestamps: TimestampKind::Segment,
        language: language.map(str::to_owned),
        family: Some(RunExtension::Whisper(WhisperRunOptions {
            condition_on_prev_tokens: Some(false),
            temperature: Some(0.0),
            // transcribe.cpp drops a window only when it is both likely
            // silent and below `logprob_thold`, and the same threshold
            // decides whether a window is retried at a higher temperature.
            // An infinite threshold lets the no-speech probability decide
            // alone, which needs the retries off: no window could pass the
            // threshold, so every one would end on the hottest retry.
            temperature_inc: Some(0.0),
            no_speech_thold: Some(MAX_NO_SPEECH_PROBABILITY),
            logprob_thold: Some(f32::INFINITY),
            ..WhisperRunOptions::default()
        })),
        ..RunOptions::default()
    };
    // An early stop comes with the text decoded before it, but the speech
    // after it is lost. Returning that text would pass a cut-off transcript
    // off as a whole one, so an early stop fails the run.
    let transcript = session.run(samples, &options).map_err(|e| match e {
        Error::OutputTruncated { .. } => {
            "whisper stopped early: decoding hit its token limit".to_owned()
        }
        Error::OutputRepetition { .. } => {
            "whisper stopped early: the output began repeating".to_owned()
        }
        e => format!("whisper inference failed: {e}"),
    })?;
    Ok(transcript
        .segments
        .into_iter()
        .map(|segment| (segment.t0_ms, segment.t1_ms, segment.text))
        .collect())
}

fn parakeet_run_options(timestamps: TimestampKind) -> RunOptions {
    RunOptions {
        timestamps,
        language: Some("en".to_owned()),
        ..RunOptions::default()
    }
}

/// English Parakeet decoding of 16 kHz mono PCM in one pass. Returns
/// `(start_ms, end_ms, text)` segments relative to the start of `samples`.
pub(crate) fn transcribe_parakeet(
    session: &mut Session,
    samples: &[f32],
) -> Result<Vec<(i64, i64, String)>, String> {
    let transcript = session
        .run(samples, &parakeet_run_options(TimestampKind::Segment))
        .map_err(|e| format!("parakeet inference failed: {e}"))?;
    Ok(transcript
        .segments
        .into_iter()
        .map(|segment| (segment.t0_ms, segment.t1_ms, segment.text))
        .collect())
}

/// Transcribes Parakeet audio as it arrives. `next_audio` returns the next
/// 16 kHz mono samples, waiting for them if needed, and `None` once the
/// recording has ended; the stream is then finalized and its text returned.
/// The session's model refuses offline runs until this returns, so a caller
/// that gives up on it must cancel the session first.
pub(crate) fn transcribe_parakeet_live(
    session: &mut Session,
    mut next_audio: impl FnMut() -> Result<Option<Vec<f32>>, String>,
    mut on_partial: impl FnMut(&str),
) -> Result<String, String> {
    let stream_options = StreamOptions {
        commit_policy: CommitPolicy::Auto,
        family: Some(StreamExtension::ParakeetBuffered(
            ParakeetBufferedStreamOptions {
                left_ms: Some(PARAKEET_STREAM_LEFT_MS),
                chunk_ms: Some(PARAKEET_STREAM_CHUNK_MS),
                right_ms: Some(PARAKEET_STREAM_RIGHT_MS),
            },
        )),
        ..StreamOptions::default()
    };
    let mut stream = session
        .stream(&parakeet_run_options(TimestampKind::None), &stream_options)
        .map_err(|e| format!("parakeet stream start failed: {e}"))?;
    while let Some(samples) = next_audio()? {
        if samples.is_empty() {
            continue;
        }
        let update = stream
            .feed(&samples)
            .map_err(|e| format!("parakeet stream feed failed: {e}"))?;
        if update.result_changed {
            on_partial(stream.text().display().trim());
        }
    }
    stream
        .finalize()
        .map_err(|e| format!("parakeet stream finalize failed: {e}"))?;
    Ok(stream.text().full.trim().to_owned())
}

/// Runs a second of silence through a live stream and an offline pass, so the
/// backend's first-use setup happens now rather than in the first dictation.
pub(crate) fn warm_up_parakeet(model: &Model) -> Result<(), String> {
    let silence = vec![0.0; 16_000];
    let mut session = open_session(model)?;
    let mut fed = false;
    transcribe_parakeet_live(
        &mut session,
        || Ok((!std::mem::replace(&mut fed, true)).then(|| silence.clone())),
        |_| {},
    )?;
    transcribe_parakeet(&mut session, &silence)?;
    Ok(())
}

#[cfg(test)]
pub(crate) mod tests {
    use std::sync::Weak;

    use super::*;

    /// A stand-in model: which file it came from and which load made it. A
    /// test can keep a `Weak` to it to see whether it was freed.
    type FakeModel = Arc<(PathBuf, u64)>;

    fn fake_load(path: &Path) -> Result<FakeModel, String> {
        use std::sync::atomic::AtomicU64;
        static LOADS: AtomicU64 = AtomicU64::new(0);
        if path.ends_with("broken.gguf") {
            return Err("model load failed: not a GGUF".into());
        }
        if path.ends_with("slow.gguf") {
            std::thread::sleep(Duration::from_millis(300));
        }
        if path.ends_with("hung.gguf") {
            std::thread::sleep(Duration::from_millis(1_500));
        }
        Ok(Arc::new((
            path.to_path_buf(),
            LOADS.fetch_add(1, Ordering::SeqCst),
        )))
    }

    fn warm_slot(path: &Path) -> (ModelSlot<FakeModel>, FakeModel) {
        let slot = ModelSlot::new(fake_load);
        let lease = slot.lease_for_stream(path).unwrap();
        lease.mark_warm();
        let model = lease.model().clone();
        drop(lease);
        (slot, model)
    }

    fn leaked_warm_slot(path: &'static Path) -> &'static ModelSlot<FakeModel> {
        let slot: &'static ModelSlot<FakeModel> = Box::leak(Box::new(ModelSlot::new(fake_load)));
        slot.lease_for_stream(path).unwrap().mark_warm();
        slot
    }

    #[test]
    fn a_copy_a_live_stream_holds_is_lent_to_no_one_else() {
        let path = Path::new("parakeet.gguf");
        let (slot, model) = warm_slot(path);
        let live = slot.try_lease_warm(path).unwrap();
        assert_eq!(live.model(), &model);
        assert_eq!(
            slot.try_lease_warm(path).err(),
            Some(LeaseRefused::Streaming),
            "a second dictation must not stream on the same copy"
        );
        drop(live);
        assert_eq!(slot.try_lease_warm(path).unwrap().model(), &model);
    }

    #[test]
    fn a_run_waits_for_a_live_stream_to_hand_its_copy_back() {
        let path: &'static Path = Path::new("parakeet.gguf");
        let slot = leaked_warm_slot(path);
        let live = slot.try_lease_warm(path).unwrap();
        let model = live.model().clone();
        let handback = std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(100));
            drop(live);
        });
        let started = Instant::now();
        let (run, loaded) = slot.lease_for_run(path).unwrap();
        handback.join().unwrap();
        assert!(!loaded);
        assert_eq!(run.model(), &model);
        assert!(started.elapsed() >= Duration::from_millis(90));
        assert!(slot.holds_warm(path));
    }

    #[test]
    fn runs_share_a_copy() {
        let path = Path::new("whisper-base.gguf");
        let slot = ModelSlot::new(fake_load);
        let (first, loaded) = slot.lease_for_run(path).unwrap();
        assert!(loaded);
        let started = Instant::now();
        let (second, loaded) = slot.lease_for_run(path).unwrap();
        assert!(!loaded);
        assert_eq!(first.model(), second.model());
        let shared = second.share().unwrap();
        assert_eq!(shared.model(), first.model());
        assert!(started.elapsed() < MODEL_HANDBACK_WAIT);
    }

    /// Dictation A's live pass failed and its whole-recording run is still
    /// computing when dictation B starts. B must not stream on that copy,
    /// where transcribe.cpp would hold B's stream behind A's run or refuse a
    /// run with `Busy`; B is turned away at once (it dictates with Apple
    /// Speech). Nothing loads a second copy beside A's, and once A's run is
    /// done the copy, still warm, goes to the next dictation.
    #[test]
    fn a_whole_recording_run_keeps_the_next_dictation_off_its_copy() {
        let path = Path::new("parakeet.gguf");
        let (slot, model) = warm_slot(path);
        let (a_fallback, loaded) = slot.lease_for_run(path).unwrap();
        assert!(!loaded);

        let asked = Instant::now();
        assert_eq!(
            slot.try_lease_warm(path).err(),
            Some(LeaseRefused::Running),
            "B must not get the copy A's run is computing on"
        );
        assert_eq!(slot.lease_for_stream(path).err().as_deref(), Some(IN_USE));
        assert!(asked.elapsed() < Duration::from_millis(50));
        assert!(slot.holds_warm(path), "A's copy stays resident");

        drop(a_fallback);
        assert_eq!(slot.try_lease_warm(path).unwrap().model(), &model);
    }

    #[test]
    fn a_copy_a_stuck_stream_never_hands_back_is_retired() {
        let path = Path::new("parakeet.gguf");
        let (slot, stuck_model) = warm_slot(path);
        let stuck = slot.try_lease_warm(path).unwrap();

        let started = Instant::now();
        let (run, loaded) = slot.lease_for_run(path).unwrap();
        assert!(loaded, "the run needs a copy no stream holds");
        assert_ne!(run.model(), &stuck_model);
        assert!(started.elapsed() >= MODEL_HANDBACK_WAIT);
        // The stuck copy is gone from the slot, and the fresh one hasn't
        // warmed up, so dictation waits for a reload instead of using either.
        assert!(!slot.holds_warm(path));
        assert_eq!(slot.try_lease_warm(path).err(), Some(LeaseRefused::Cold));
        let run_model = run.model().clone();
        drop(run);

        // The stuck stream finally giving up its old copy changes nothing.
        drop(stuck);
        let (again, loaded) = slot.lease_for_run(path).unwrap();
        assert!(!loaded);
        assert_eq!(again.model(), &run_model);
    }

    #[test]
    fn reclaiming_for_a_stream_retires_a_stuck_copy_and_loads_a_cold_one() {
        let path = Path::new("parakeet.gguf");
        let (slot, stuck_model) = warm_slot(path);
        let _stuck = slot.try_lease_warm(path).unwrap();
        let fresh = slot.lease_for_stream(path).unwrap();
        assert_ne!(fresh.model(), &stuck_model);
        assert!(!fresh.is_warm());
        fresh.mark_warm();
        drop(fresh);
        assert!(slot.try_lease_warm(path).is_ok());
    }

    #[test]
    fn a_dictation_start_never_waits_for_a_load() {
        let slot: &'static ModelSlot<FakeModel> = Box::leak(Box::new(ModelSlot::new(fake_load)));
        let path = Path::new("slow.gguf");
        let loading = std::thread::spawn(move || slot.lease_for_stream(path).map(|_| ()));
        std::thread::sleep(Duration::from_millis(50));
        let asked = Instant::now();
        assert_eq!(
            slot.try_lease_warm(path).err(),
            Some(LeaseRefused::NotLoaded)
        );
        assert!(asked.elapsed() < Duration::from_millis(100));
        loading.join().unwrap().unwrap();
        assert_eq!(slot.try_lease_warm(path).err(), Some(LeaseRefused::Cold));
    }

    #[test]
    fn another_model_or_a_failed_load_leaves_parakeet_not_ready() {
        let parakeet = Path::new("parakeet.gguf");
        let (slot, _) = warm_slot(parakeet);
        assert!(slot.holds_warm(parakeet));

        drop(slot.lease_for_run(Path::new("whisper-base.gguf")).unwrap());
        assert!(!slot.holds_warm(parakeet));
        assert_eq!(
            slot.try_lease_warm(parakeet).err(),
            Some(LeaseRefused::NotLoaded)
        );

        let broken = Path::new("broken.gguf");
        assert!(slot.lease_for_stream(broken).is_err());
        for path in [broken, Path::new("whisper-base.gguf")] {
            assert_eq!(
                slot.try_lease_warm(path).err(),
                Some(LeaseRefused::NotLoaded)
            );
        }
    }

    /// A meeting fell back to Whisper and holds it for its runs; a Parakeet
    /// dictation, its prepare, or Screen Memory asking for the other model
    /// is turned away at once instead of loading a second model beside it.
    #[test]
    fn a_load_never_replaces_a_model_runs_hold() {
        let whisper = Path::new("whisper-base.gguf");
        let parakeet = Path::new("parakeet.gguf");
        let slot = ModelSlot::new(fake_load);
        let (meeting, _) = slot.lease_for_run(whisper).unwrap();

        let asked = Instant::now();
        assert_eq!(
            slot.lease_for_run(parakeet).err().as_deref(),
            Some(OTHER_MODEL_IN_USE)
        );
        assert_eq!(
            slot.lease_for_stream(parakeet).err().as_deref(),
            Some(OTHER_MODEL_IN_USE)
        );
        assert_eq!(
            slot.try_lease_warm(parakeet).err(),
            Some(LeaseRefused::OtherModelRunning)
        );
        assert!(asked.elapsed() < Duration::from_millis(50), "never waits");

        let (whisper_run, loaded) = slot.lease_for_run(whisper).unwrap();
        assert!(!loaded, "nothing was loaded or evicted");
        assert_eq!(whisper_run.model(), meeting.model());
        drop(whisper_run);
        drop(meeting);

        let (_, loaded) = slot.lease_for_run(parakeet).unwrap();
        assert!(loaded, "the other model loads once the runs end");
    }

    #[test]
    fn a_stuck_stream_on_another_model_is_retired_after_the_handback_wait() {
        let parakeet = Path::new("parakeet.gguf");
        let (slot, stuck_model) = warm_slot(parakeet);
        let stuck = slot.try_lease_warm(parakeet).unwrap();

        let started = Instant::now();
        let (run, loaded) = slot.lease_for_run(Path::new("whisper-base.gguf")).unwrap();
        assert!(loaded);
        assert!(started.elapsed() >= MODEL_HANDBACK_WAIT);
        assert_ne!(run.model().0, stuck_model.0);
        assert!(!slot.holds_warm(parakeet));
        drop(stuck);
    }

    #[test]
    fn a_stream_handing_back_in_time_frees_its_model_before_the_other_loads() {
        let parakeet: &'static Path = Path::new("parakeet.gguf");
        let slot = leaked_warm_slot(parakeet);
        let live = slot.try_lease_warm(parakeet).unwrap();
        let live_model = Arc::downgrade(live.model());
        let handback = std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(100));
            drop(live);
        });

        let started = Instant::now();
        let (_run, loaded) = slot.lease_for_run(Path::new("whisper-base.gguf")).unwrap();
        handback.join().unwrap();
        assert!(loaded);
        assert!(started.elapsed() >= Duration::from_millis(90));
        assert!(started.elapsed() < MODEL_HANDBACK_WAIT);
        assert!(live_model.upgrade().is_none(), "never two models at once");
    }

    #[test]
    fn a_refusal_keeps_its_value_when_the_model_is_named() {
        for refusal in [QUITTING, IN_USE, OTHER_MODEL_IN_USE] {
            assert_eq!(model_error("whisper", refusal.to_owned()), refusal);
        }
        assert_eq!(
            model_error("whisper", "model load failed".to_owned()),
            "whisper model load failed"
        );
    }

    #[test]
    fn every_change_to_the_resident_model_is_announced() {
        let changes: &'static AtomicUsize = Box::leak(Box::new(AtomicUsize::new(0)));
        let slot = ModelSlot::new(fake_load);
        slot.set_on_change(move || {
            changes.fetch_add(1, Ordering::SeqCst);
        });
        let parakeet = Path::new("parakeet.gguf");
        drop(slot.lease_for_stream(parakeet).unwrap());
        assert_eq!(changes.load(Ordering::SeqCst), 1, "loaded");
        drop(slot.lease_for_run(Path::new("whisper-base.gguf")).unwrap());
        assert_eq!(changes.load(Ordering::SeqCst), 3, "evicted, then loaded");
        assert!(slot.release(Path::new("whisper-base.gguf")).unwrap());
        assert_eq!(changes.load(Ordering::SeqCst), 4, "released");
        assert!(!slot.release(parakeet).unwrap());
        assert_eq!(changes.load(Ordering::SeqCst), 4);
    }

    /// Quitting while a live stream and a whole-recording run are working:
    /// both are given time to finish, every copy is freed, and nothing new is
    /// lent or loaded afterwards.
    #[test]
    fn quitting_waits_for_live_and_offline_work_then_frees_every_copy() {
        let parakeet: &'static Path = Path::new("parakeet.gguf");
        let slot = leaked_warm_slot(parakeet);
        let live = slot.try_lease_warm(parakeet).unwrap();
        let live_model = Arc::downgrade(live.model());
        // The run waits out the stream, retires its copy and loads another.
        let (fallback, _) = slot.lease_for_run(parakeet).unwrap();
        let fallback_model = Arc::downgrade(fallback.model());
        assert!(!Weak::ptr_eq(&live_model, &fallback_model));
        let workers = [
            std::thread::spawn(move || {
                std::thread::sleep(Duration::from_millis(100));
                drop(live);
            }),
            std::thread::spawn(move || {
                std::thread::sleep(Duration::from_millis(200));
                drop(fallback);
            }),
        ];

        let started = Instant::now();
        assert_eq!(slot.shut_down(Duration::from_secs(2)), Ok(()));
        assert!(started.elapsed() >= Duration::from_millis(190));
        for worker in workers {
            worker.join().unwrap();
        }
        assert!(live_model.upgrade().is_none());
        assert!(fallback_model.upgrade().is_none());

        assert_eq!(
            slot.try_lease_warm(parakeet).err(),
            Some(LeaseRefused::NotLoaded)
        );
        assert_eq!(
            slot.lease_for_run(parakeet).err().as_deref(),
            Some(QUITTING)
        );
        assert_eq!(
            slot.lease_for_stream(parakeet).err().as_deref(),
            Some(QUITTING)
        );
    }

    /// Quitting during a load waits for it, and the copy it produces is
    /// dropped instead of being kept for exit.
    #[test]
    fn quitting_during_a_load_frees_the_copy_it_loads() {
        let slot: &'static ModelSlot<FakeModel> = Box::leak(Box::new(ModelSlot::new(fake_load)));
        let loading = std::thread::spawn(move || {
            slot.lease_for_stream(Path::new("slow.gguf"))
                .map(|lease| Arc::downgrade(lease.model()))
        });
        std::thread::sleep(Duration::from_millis(50));
        assert_eq!(slot.shut_down(Duration::from_secs(2)), Ok(()));
        assert_eq!(loading.join().unwrap().err().as_deref(), Some(QUITTING));
        assert!(!slot.holds_warm(Path::new("slow.gguf")));
    }

    /// A holder that never returns, or a load that never finishes, can't hold
    /// quitting up for longer than its wait, and is reported rather than
    /// passed off as a clean shutdown.
    #[test]
    fn quitting_gives_up_on_a_stuck_holder_or_load_after_its_wait() {
        let parakeet = Path::new("parakeet.gguf");
        let (slot, _) = warm_slot(parakeet);
        let _stuck = slot.try_lease_warm(parakeet).unwrap();
        let started = Instant::now();
        let error = slot.shut_down(Duration::from_millis(200)).unwrap_err();
        assert!(started.elapsed() < Duration::from_millis(400));
        assert!(error.contains("1 model leases are still out"), "{error}");

        let hung: &'static ModelSlot<FakeModel> = Box::leak(Box::new(ModelSlot::new(fake_load)));
        let loading =
            std::thread::spawn(move || hung.lease_for_run(Path::new("hung.gguf")).map(|_| ()));
        std::thread::sleep(Duration::from_millis(50));
        let started = Instant::now();
        let error = hung.shut_down(Duration::from_millis(200)).unwrap_err();
        assert!(started.elapsed() < Duration::from_millis(400));
        assert!(error.contains("a model load is still running"), "{error}");
        assert_eq!(loading.join().unwrap().err().as_deref(), Some(QUITTING));
    }

    /// Transcribes a recording with a downloaded model, either a GGUF or a
    /// whisper.cpp `.bin`. Run with `CLIPS_TEST_WHISPER_MODEL=<model file>
    /// CLIPS_TEST_WHISPER_WAV=<16 kHz mono 16-bit .wav>
    /// CLIPS_TEST_WHISPER_TEXT=<what the recording says> cargo test --lib
    /// transcribe_engine -- --ignored`.
    #[test]
    #[ignore = "needs a downloaded Whisper model and a WAV file"]
    fn transcribes_a_wav_file_with_a_downloaded_whisper_model() {
        let model_path = test_env("CLIPS_TEST_WHISPER_MODEL");
        let samples = read_pcm16_wav(Path::new(&test_env("CLIPS_TEST_WHISPER_WAV")));
        let expected = test_env("CLIPS_TEST_WHISPER_TEXT");

        let slot = ModelSlot::new(load_model);
        let (lease, loaded) = slot.lease_for_run(Path::new(&model_path)).unwrap();
        assert!(loaded);
        assert!(!slot.lease_for_run(Path::new(&model_path)).unwrap().1);
        let model = lease.model();
        assert_eq!(model.arch(), "whisper");

        let mut session = open_session(model).unwrap();
        let started = std::time::Instant::now();
        let segments = transcribe_whisper(&mut session, &samples, None).unwrap();
        let text = segments
            .iter()
            .map(|(_, _, text)| text.trim())
            .collect::<Vec<_>>()
            .join(" ");
        // Timings and counts only: these tests may run on someone's own
        // recordings, whose words must not reach a log.
        eprintln!(
            "[{}] {:.1}s of audio in {} ms, {} segments",
            model.backend(),
            samples.len() as f32 / 16_000.0,
            started.elapsed().as_millis(),
            segments.len(),
        );

        assert_eq!(word_errors(&expected, &text), 0, "word errors");

        // A slip in time units shows up as times ten times too large or small.
        let audio_ms = samples.len() as i64 * 1000 / 16_000;
        let mut previous_start = 0;
        for (start_ms, end_ms, _) in &segments {
            assert!(previous_start <= *start_ms && start_ms <= end_ms);
            previous_start = *start_ms;
        }
        let last_end_ms = segments.last().unwrap().1;
        assert!(
            audio_ms / 2 < last_end_ms && last_end_ms <= audio_ms + 500,
            "speech ends at {last_end_ms} ms in {audio_ms} ms of audio"
        );
    }

    /// Silence and steady noise must come back empty, not as a hallucinated
    /// "you". Uses `CLIPS_TEST_WHISPER_MODEL` like the test above.
    #[test]
    #[ignore = "needs a downloaded Whisper model"]
    fn drops_silence_and_steady_noise() {
        let model = load_model(Path::new(&test_env("CLIPS_TEST_WHISPER_MODEL"))).unwrap();
        let mut session = open_session(&model).unwrap();
        let mut seed = 0x2545_f491_u32;
        let noise = (0..5 * 16_000)
            .map(|_| {
                seed ^= seed << 13;
                seed ^= seed >> 17;
                seed ^= seed << 5;
                (seed as f32 / u32::MAX as f32 - 0.5) * 0.04
            })
            .collect::<Vec<_>>();

        for (name, samples) in [("silence", vec![0.0; 5 * 16_000]), ("noise", noise)] {
            let segments = transcribe_whisper(&mut session, &samples, None).unwrap();
            assert!(segments.is_empty(), "{name}: {} segments", segments.len());
        }
    }

    pub(crate) fn test_env(name: &str) -> String {
        std::env::var(name).unwrap_or_else(|_| panic!("set {name}; see the test's doc comment"))
    }

    fn words(text: &str) -> Vec<String> {
        text.split(|c: char| !c.is_alphanumeric())
            .filter(|word| !word.is_empty())
            .map(str::to_lowercase)
            .collect()
    }

    /// Word substitutions, deletions and insertions between two texts,
    /// ignoring case and punctuation.
    pub(crate) fn word_errors(reference: &str, hypothesis: &str) -> usize {
        let (reference, hypothesis) = (words(reference), words(hypothesis));
        let mut previous: Vec<usize> = (0..=hypothesis.len()).collect();
        for (r, reference_word) in reference.iter().enumerate() {
            let mut current = vec![r + 1; hypothesis.len() + 1];
            for (h, hypothesis_word) in hypothesis.iter().enumerate() {
                current[h + 1] = (previous[h + 1] + 1)
                    .min(current[h] + 1)
                    .min(previous[h] + usize::from(reference_word != hypothesis_word));
            }
            previous = current;
        }
        previous[hypothesis.len()]
    }

    /// Word errors per reference word.
    pub(crate) fn word_error_rate(reference: &str, hypothesis: &str) -> f64 {
        word_errors(reference, hypothesis) as f64 / words(reference).len().max(1) as f64
    }

    #[test]
    fn word_errors_count_substitutions_deletions_and_insertions() {
        assert_eq!(word_errors("Hello, world.", "hello world"), 0);
        assert_eq!(word_errors("the cat sat", "the bat sat"), 1);
        assert_eq!(word_errors("the cat sat", "the sat"), 1);
        assert_eq!(word_errors("the cat sat", "the cat sat down"), 1);
        assert_eq!(word_errors("", "anything"), 1);
        assert_eq!(word_error_rate("one two three four", "one two four"), 0.25);
    }

    /// Transcribes a recording with the downloaded Parakeet model, once in one
    /// pass and once live, fed as fast as it was spoken, and compares both
    /// with the reference and with each other. Run with
    /// `CLIPS_TEST_PARAKEET_MODEL=<model .gguf> CLIPS_TEST_PARAKEET_WAV=<16 kHz
    /// mono 16-bit .wav> CLIPS_TEST_PARAKEET_TEXT=<what it says> cargo test
    /// --release --lib transcribe_engine -- --ignored --nocapture`; add
    /// `CLIPS_TEST_PARAKEET_PACE=fast` to feed it at once. Prints timings and
    /// word error rates, never the text.
    #[test]
    #[ignore = "needs the downloaded Parakeet model and a WAV file"]
    fn transcribes_a_wav_file_with_parakeet_offline_and_live() {
        use std::time::{Duration, Instant};

        let model_path = test_env("CLIPS_TEST_PARAKEET_MODEL");
        let samples = read_pcm16_wav(Path::new(&test_env("CLIPS_TEST_PARAKEET_WAV")));
        let reference = test_env("CLIPS_TEST_PARAKEET_TEXT");
        let realtime = std::env::var("CLIPS_TEST_PARAKEET_PACE").as_deref() != Ok("fast");
        let audio = Duration::from_secs_f64(samples.len() as f64 / 16_000.0);

        let started = Instant::now();
        let model = load_model(Path::new(&model_path)).unwrap();
        assert_eq!(model.arch(), "parakeet");
        let loaded = started.elapsed();
        warm_up_parakeet(&model).unwrap();
        eprintln!(
            "[{}] loaded in {} ms, warmed up in {} ms",
            model.backend(),
            loaded.as_millis(),
            (started.elapsed() - loaded).as_millis()
        );

        let mut session = open_session(&model).unwrap();
        let started = Instant::now();
        let segments = transcribe_parakeet(&mut session, &samples).unwrap();
        let offline_text = segments
            .iter()
            .map(|(_, _, text)| text.trim())
            .collect::<Vec<_>>()
            .join(" ");
        eprintln!(
            "offline: {:.1}s of audio in {} ms, {} segments",
            audio.as_secs_f64(),
            started.elapsed().as_millis(),
            segments.len()
        );

        let started = Instant::now();
        let mut fed = 0;
        let mut partials = 0;
        let live_text = transcribe_parakeet_live(
            &mut session,
            || {
                if fed == samples.len() {
                    return Ok(None);
                }
                loop {
                    let spoken = if realtime {
                        ((started.elapsed().as_secs_f64() * 16_000.0) as usize).min(samples.len())
                    } else {
                        samples.len()
                    };
                    if spoken >= fed + 1_600 || spoken == samples.len() {
                        let block = samples[fed..spoken].to_vec();
                        fed = spoken;
                        return Ok(Some(block));
                    }
                    std::thread::sleep(Duration::from_millis(20));
                }
            },
            |_| partials += 1,
        )
        .unwrap();
        let after_audio =
            started
                .elapsed()
                .saturating_sub(if realtime { audio } else { Duration::ZERO });
        let offline_wer = word_error_rate(&reference, &offline_text);
        let live_wer = word_error_rate(&reference, &live_text);
        let live_vs_offline = word_errors(&offline_text, &live_text);
        eprintln!(
            "live ({}): final text {} ms after the audio ended, {partials} partials",
            if realtime { "real-time" } else { "fast" },
            after_audio.as_millis()
        );
        eprintln!(
            "WER against the reference: offline {:.1}%, live {:.1}%; live differs from offline by {live_vs_offline} words",
            offline_wer * 100.0,
            live_wer * 100.0
        );

        assert!(offline_wer <= 0.05, "offline WER {offline_wer:.3}");
        assert!(live_wer <= 0.05, "live WER {live_wer:.3}");
        assert!(
            live_vs_offline * 50 <= words(&offline_text).len(),
            "live and offline differ by {live_vs_offline} words"
        );
        let audio_ms = audio.as_millis() as i64;
        for (start_ms, end_ms, _) in &segments {
            assert!(0 <= *start_ms && start_ms <= end_ms && *end_ms <= audio_ms + 1000);
        }
    }

    /// The Rust half of `scripts/dictation-wer.ts`, which sets these
    /// variables and reads the JSON it writes. Transcribes each 16 kHz WAV
    /// listed in `CLIPS_WER_MANIFEST` the way dictation does: Parakeet through
    /// its live stream, Whisper in 25 s windows.
    #[test]
    #[ignore = "run by scripts/dictation-wer.ts"]
    fn transcribes_clips_for_the_wer_harness() {
        let var = |name: &str| std::env::var(name).unwrap_or_else(|_| panic!("set {name}"));
        let engine = var("CLIPS_WER_ENGINE");
        let model = load_model(Path::new(&var("CLIPS_WER_MODEL"))).unwrap();
        let manifest = std::fs::read_to_string(var("CLIPS_WER_MANIFEST")).unwrap();
        if engine == "parakeet" {
            warm_up_parakeet(&model).unwrap();
        }
        let mut results = Vec::new();
        for wav in manifest.lines().filter(|line| !line.trim().is_empty()) {
            let samples = read_pcm16_wav(Path::new(wav));
            let mut session = open_session(&model).unwrap();
            let started = std::time::Instant::now();
            let text = match engine.as_str() {
                "parakeet" => {
                    let mut blocks = samples.chunks(8_960).map(<[f32]>::to_vec);
                    transcribe_parakeet_live(&mut session, || Ok(blocks.next()), |_| {}).unwrap()
                }
                "whisper" => samples
                    .chunks(25 * 16_000)
                    .flat_map(|window| transcribe_whisper(&mut session, window, None).unwrap())
                    .map(|(_, _, text)| text.trim().to_owned())
                    .filter(|text| !text.is_empty())
                    .collect::<Vec<_>>()
                    .join(" "),
                other => panic!("unknown CLIPS_WER_ENGINE {other}"),
            };
            results.push(serde_json::json!({
                "wav": wav,
                "text": text,
                "ms": started.elapsed().as_millis() as u64,
            }));
        }
        std::fs::write(
            var("CLIPS_WER_OUTPUT"),
            serde_json::to_vec(&serde_json::json!({ "engine": engine, "results": results }))
                .unwrap(),
        )
        .unwrap();
    }

    pub(crate) fn read_pcm16_wav(path: &Path) -> Vec<f32> {
        let bytes = std::fs::read(path).unwrap();
        assert_eq!(&bytes[0..4], b"RIFF");
        assert_eq!(&bytes[8..12], b"WAVE");
        let mut offset = 12;
        let mut format_checked = false;
        while offset + 8 <= bytes.len() {
            let id = &bytes[offset..offset + 4];
            let len =
                u32::from_le_bytes(bytes[offset + 4..offset + 8].try_into().unwrap()) as usize;
            let body = &bytes[offset + 8..(offset + 8 + len).min(bytes.len())];
            if id == b"fmt " {
                let format = u16::from_le_bytes([body[0], body[1]]);
                let channels = u16::from_le_bytes([body[2], body[3]]);
                let rate = u32::from_le_bytes(body[4..8].try_into().unwrap());
                let bits = u16::from_le_bytes([body[14], body[15]]);
                assert_eq!((format, channels, rate, bits), (1, 1, 16_000, 16));
                format_checked = true;
            } else if id == b"data" {
                assert!(format_checked, "WAV data chunk came before its format");
                return body
                    .chunks_exact(2)
                    .map(|pair| i16::from_le_bytes([pair[0], pair[1]]) as f32 / 32_768.0)
                    .collect();
            }
            offset += 8 + len + (len & 1);
        }
        panic!("no data chunk in {}", path.display());
    }
}
