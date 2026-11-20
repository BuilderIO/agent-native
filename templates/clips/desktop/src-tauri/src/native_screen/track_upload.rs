//! Sends a rich recording's track files to Clips while they grow:
//! `POST /api/uploads/:id/tracks/:track?index=<n>&contentType=<type>`, chunks
//! in order and the size the recording's own upload uses. Whole chunks go while
//! recording and the remainder once the track's file is closed. The chunk that
//! ends a closed file adds `isFinal=1`, so storage that takes a short chunk only
//! as an upload's last, as Builder.io's does, closes the upload with it. A track never
//! holds up or fails the recording: every outcome here only decides whether the
//! track is listed when the tracks are finalized.
//!
//! Tracks never slow the recording's own upload. While recording, a track chunk
//! goes only when the recording's upload has nothing waiting beyond the chunk
//! it is on. After Stop, nothing goes until the recording's upload is finalized
//! and the track is released, one track after another.

use super::*;

const TRACK_POLL_MS: u64 = 500;
const TRACK_CHUNK_ATTEMPTS: u32 = 5;
const TRACK_RETRY_BASE_MS: u64 = 500;
const TRACK_RETRY_MAX_MS: u64 = 8_000;
const TRACKS_FINALIZE_ATTEMPTS: u32 = 6;
const TRACKS_FINALIZE_RETRY_BASE_MS: u64 = 1_000;

/// Where a recording's tracks go, and the credentials the recording's own
/// live upload uses.
pub(super) struct TrackUploadTarget {
    pub(super) server_url: String,
    pub(super) recording_id: String,
    pub(super) auth_token: String,
    pub(super) cookie: String,
}

impl TrackUploadTarget {
    fn url(&self, path: &str) -> Result<url::Url, String> {
        let base = self.server_url.trim_end_matches('/');
        url::Url::parse(&format!(
            "{base}/api/uploads/{}/tracks/{path}",
            self.recording_id
        ))
        .map_err(|error| format!("invalid track upload URL: {error}"))
    }

    fn post(&self, client: &reqwest::Client, url: url::Url) -> reqwest::RequestBuilder {
        let mut request = client.post(url).header("X-Request-Source", "clips-desktop");
        let token = self.auth_token.trim();
        if !token.is_empty() {
            request = request.bearer_auth(token);
        }
        let cookie = self.cookie.trim();
        if !cookie.is_empty() {
            request = request.header("Cookie", cookie);
        }
        request
    }
}

/// When a track may send, read from the recording's own upload.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum SendPhase {
    /// Only while the recording's upload has nothing waiting beyond the chunk
    /// it is on.
    Recording,
    /// Stopped: the recording's upload is draining and finalizing.
    AwaitingRecordingUpload,
    Released,
}

/// Whether a track chunk may go now. `video_unsent` is what the recording's
/// upload has written but not yet had acknowledged; `None` when that can't be
/// read, which holds the track back.
pub(super) fn track_chunk_may_go(phase: SendPhase, video_unsent: Option<u64>, chunk: u64) -> bool {
    match phase {
        SendPhase::Recording => video_unsent.is_some_and(|unsent| unsent <= chunk),
        SendPhase::AwaitingRecordingUpload => false,
        SendPhase::Released => true,
    }
}

/// Shared by every track of a recording: what holds their chunks back.
pub(super) struct TrackSendGate {
    recording_stopped: AtomicBool,
    video_unsent: Box<dyn Fn() -> Option<u64> + Send + Sync>,
}

impl TrackSendGate {
    pub(super) fn new(video_unsent: impl Fn() -> Option<u64> + Send + Sync + 'static) -> Self {
        Self {
            recording_stopped: AtomicBool::new(false),
            video_unsent: Box::new(video_unsent),
        }
    }

    /// The recording stopped: hold every track until it is released.
    pub(super) fn stop_recording(&self) {
        self.recording_stopped.store(true, Ordering::SeqCst);
    }
}

pub(super) struct TrackUploadCtrl {
    source_closed: AtomicBool,
    /// Why the source could not write its file, if it couldn't.
    source_failure: Mutex<Option<String>>,
    cancelled: AtomicBool,
    released: AtomicBool,
    sent_bytes: AtomicU64,
    /// Shared by every track of the recording: once the server says to stop
    /// sending tracks, none of them sends again.
    tracks_stopped: Arc<AtomicBool>,
    gate: Arc<TrackSendGate>,
}

impl TrackUploadCtrl {
    pub(super) fn new(tracks_stopped: Arc<AtomicBool>, gate: Arc<TrackSendGate>) -> Self {
        Self {
            source_closed: AtomicBool::new(false),
            source_failure: Mutex::new(None),
            cancelled: AtomicBool::new(false),
            released: AtomicBool::new(false),
            sent_bytes: AtomicU64::new(0),
            tracks_stopped,
            gate,
        }
    }

    /// The recording's own upload is finalized and it is this track's turn:
    /// send the rest of it.
    pub(super) fn release(&self) {
        self.released.store(true, Ordering::SeqCst);
    }

    /// Bytes stored so far, to tell a slow upload from a stuck one.
    pub(super) fn sent_bytes(&self) -> u64 {
        self.sent_bytes.load(Ordering::SeqCst)
    }

    fn phase(&self) -> SendPhase {
        if self.released.load(Ordering::SeqCst) {
            SendPhase::Released
        } else if self.gate.recording_stopped.load(Ordering::SeqCst) {
            SendPhase::AwaitingRecordingUpload
        } else {
            SendPhase::Recording
        }
    }

    fn may_send(&self, chunk: u64) -> bool {
        let phase = self.phase();
        let video_unsent = match phase {
            SendPhase::Recording => (self.gate.video_unsent)(),
            _ => None,
        };
        track_chunk_may_go(phase, video_unsent, chunk)
    }

    /// The track's file is complete: send what is left of it.
    pub(super) fn close_source(&self) {
        self.source_closed.store(true, Ordering::SeqCst);
    }

    /// Nothing writes the track's file any more.
    pub(super) fn source_closed(&self) -> bool {
        self.source_closed.load(Ordering::SeqCst)
    }

    /// The source could not write its file, so what is on disk can't be sent:
    /// the upload fails for good, which stops the source and deletes the
    /// file, as when the server can't take it. Called before `close_source`.
    pub(super) fn fail_source(&self, reason: String) {
        self.source_failure
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .get_or_insert(reason);
    }

    pub(super) fn source_failure(&self) -> Option<String> {
        self.source_failure
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .clone()
    }

    pub(super) fn cancel(&self) {
        self.cancelled.store(true, Ordering::SeqCst);
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) enum TrackUploadOutcome {
    /// Every byte of the closed file is stored.
    Sent {
        bytes: u64,
        chunks: u64,
    },
    /// The file was empty when it closed, so there is nothing to list.
    Empty,
    /// The server said to stop sending this recording's tracks.
    Stopped(String),
    Cancelled,
    Failed(String),
}

pub(super) struct TrackUpload {
    pub(super) ctrl: Arc<TrackUploadCtrl>,
    pub(super) result_rx: tokio::sync::oneshot::Receiver<TrackUploadOutcome>,
}

/// The server's answer to one chunk, as the uploader acts on it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) enum ChunkReply {
    /// Stored now, or stored before and acknowledged again.
    Stored,
    /// The server has a different next chunk in mind.
    ExpectedIndex(u64),
    /// Wait and send the same chunk again.
    Retryable(String),
    /// Stop every track of this recording; the recording itself carries on.
    TracksStopped(String),
    /// No answer: a network error, or a server error with no instructions.
    Transient(String),
    Rejected(String),
}

#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReplyBody {
    ok: Option<bool>,
    error: Option<String>,
    message: Option<String>,
    retryable: Option<bool>,
    tracks_stopped: Option<bool>,
    expected_index: Option<u64>,
    already_finalized: Option<bool>,
    dropped_tracks: Option<serde_json::Value>,
}

impl ReplyBody {
    fn parse(body: &str) -> Self {
        serde_json::from_str(body).unwrap_or_default()
    }

    fn reason(&self, status: u16, body: &str) -> String {
        let text = self
            .error
            .clone()
            .or_else(|| self.message.clone())
            .unwrap_or_else(|| body.chars().take(200).collect());
        format!("{status}: {text}")
    }
}

pub(super) fn classify_chunk_reply(status: u16, body: &str) -> ChunkReply {
    let reply = ReplyBody::parse(body);
    if (200..300).contains(&status) && reply.ok == Some(true) {
        return ChunkReply::Stored;
    }
    let reason = reply.reason(status, body);
    if reply.tracks_stopped == Some(true) {
        ChunkReply::TracksStopped(reason)
    } else if reply.retryable == Some(true) {
        ChunkReply::Retryable(reason)
    } else if let Some(index) = reply.expected_index {
        ChunkReply::ExpectedIndex(index)
    } else if status >= 500 {
        ChunkReply::Transient(reason)
    } else {
        ChunkReply::Rejected(reason)
    }
}

/// An answer whose body couldn't be read doesn't say whether the chunk was
/// stored, so the chunk goes again: the server acknowledges one it holds.
fn chunk_reply_from(status: u16, body: Result<String, String>) -> ChunkReply {
    match body {
        Ok(body) => classify_chunk_reply(status, &body),
        Err(error) => {
            ChunkReply::Transient(format!("{status}: the answer couldn't be read: {error}"))
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum NextSend {
    Chunk {
        index: u64,
        offset: u64,
        len: u64,
        /// The file is closed and this chunk ends it.
        last: bool,
    },
    /// Less than a chunk is waiting and the file is still growing.
    Wait,
    Done,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) enum Step {
    Continue,
    RetryAfter(Duration),
    Finish(TrackUploadOutcome),
}

/// Which chunk goes next and what each answer means, apart from the network.
pub(super) struct TrackUploadState {
    chunk: u64,
    offset: u64,
    index: u64,
    attempts: u32,
}

impl TrackUploadState {
    pub(super) fn new(chunk: u64) -> Self {
        Self {
            chunk: chunk.max(1),
            offset: 0,
            index: 0,
            attempts: 0,
        }
    }

    pub(super) fn next(&self, file_len: u64, source_closed: bool) -> NextSend {
        let waiting = file_len.saturating_sub(self.offset);
        let len = if waiting >= self.chunk {
            self.chunk
        } else if source_closed && waiting > 0 {
            waiting
        } else if source_closed {
            return NextSend::Done;
        } else {
            return NextSend::Wait;
        };
        NextSend::Chunk {
            index: self.index,
            offset: self.offset,
            len,
            last: source_closed && self.offset + len == file_len,
        }
    }

    /// The outcome once `next` says `Done`.
    pub(super) fn done(&self) -> TrackUploadOutcome {
        if self.offset == 0 {
            TrackUploadOutcome::Empty
        } else {
            TrackUploadOutcome::Sent {
                bytes: self.offset,
                chunks: self.index,
            }
        }
    }

    pub(super) fn on_reply(&mut self, sent_len: u64, reply: ChunkReply, file_len: u64) -> Step {
        match reply {
            ChunkReply::Stored => {
                self.offset += sent_len;
                self.index += 1;
                self.attempts = 0;
                Step::Continue
            }
            ChunkReply::ExpectedIndex(index) => {
                // Every chunk but the last is whole, so chunk n starts at n
                // chunks in.
                let offset = index.saturating_mul(self.chunk);
                if offset > file_len {
                    return Step::Finish(TrackUploadOutcome::Failed(format!(
                        "the server expects chunk {index}, past the end of the file"
                    )));
                }
                self.attempts += 1;
                if self.attempts >= TRACK_CHUNK_ATTEMPTS {
                    return Step::Finish(TrackUploadOutcome::Failed(format!(
                        "the server kept asking for a different chunk (last: {index})"
                    )));
                }
                self.index = index;
                self.offset = offset;
                Step::Continue
            }
            ChunkReply::Retryable(reason) | ChunkReply::Transient(reason) => {
                self.attempts += 1;
                if self.attempts >= TRACK_CHUNK_ATTEMPTS {
                    return Step::Finish(TrackUploadOutcome::Failed(format!(
                        "chunk {} failed {} times: {reason}",
                        self.index, self.attempts
                    )));
                }
                Step::RetryAfter(retry_delay(
                    TRACK_RETRY_BASE_MS,
                    TRACK_RETRY_MAX_MS,
                    self.attempts,
                ))
            }
            ChunkReply::TracksStopped(reason) => Step::Finish(TrackUploadOutcome::Stopped(reason)),
            ChunkReply::Rejected(reason) => Step::Finish(TrackUploadOutcome::Failed(reason)),
        }
    }
}

fn retry_delay(base_ms: u64, max_ms: u64, attempt: u32) -> Duration {
    let shift = attempt.saturating_sub(1).min(16);
    Duration::from_millis((base_ms << shift).min(max_ms))
}

/// Starts a track's uploader. `on_end` hears its outcome first, from the
/// uploader's task, and must not block.
pub(super) fn spawn_track_uploader(
    target: Arc<TrackUploadTarget>,
    track: &'static str,
    content_type: &'static str,
    path: PathBuf,
    ctrl: Arc<TrackUploadCtrl>,
    on_end: impl FnOnce(&TrackUploadOutcome) + Send + 'static,
) -> TrackUpload {
    let (tx, rx) = tokio::sync::oneshot::channel();
    let task_ctrl = Arc::clone(&ctrl);
    tauri::async_runtime::spawn(async move {
        let outcome = track_upload_loop(&target, track, content_type, &path, &task_ctrl).await;
        if matches!(outcome, TrackUploadOutcome::Stopped(_)) {
            task_ctrl.tracks_stopped.store(true, Ordering::SeqCst);
        }
        eprintln!(
            "[rich-tracks] {}: {track} upload ended: {outcome:?}",
            target.recording_id
        );
        on_end(&outcome);
        let _ = tx.send(outcome);
    });
    TrackUpload {
        ctrl,
        result_rx: rx,
    }
}

async fn track_upload_loop(
    target: &TrackUploadTarget,
    track: &'static str,
    content_type: &'static str,
    path: &Path,
    ctrl: &TrackUploadCtrl,
) -> TrackUploadOutcome {
    let client = match reqwest::Client::builder()
        .timeout(Duration::from_secs(120))
        .build()
    {
        Ok(client) => client,
        Err(error) => {
            return TrackUploadOutcome::Failed(format!("track upload client failed: {error}"))
        }
    };
    let chunk = UPLOAD_CHUNK_BYTES as u64;
    let mut state = TrackUploadState::new(chunk);
    loop {
        if ctrl.cancelled.load(Ordering::SeqCst) {
            return TrackUploadOutcome::Cancelled;
        }
        if ctrl.tracks_stopped.load(Ordering::SeqCst) {
            return TrackUploadOutcome::Stopped("another track was stopped".into());
        }
        // Read before the length: once the source is closed, the length read
        // after it is final. Read before the failure too: a source that fails
        // says so before it closes, so a closed file is never sent as whole.
        let source_closed = ctrl.source_closed.load(Ordering::SeqCst);
        if let Some(reason) = ctrl.source_failure() {
            return TrackUploadOutcome::Failed(reason);
        }
        let file_len = match std::fs::metadata(path) {
            Ok(metadata) => metadata.len(),
            Err(error) if error.kind() == ErrorKind::NotFound => 0,
            Err(error) => {
                return TrackUploadOutcome::Failed(format!(
                    "track file {} unreadable: {error}",
                    path.display()
                ))
            }
        };
        let (index, offset, len, last) = match state.next(file_len, source_closed) {
            NextSend::Chunk { .. } if !ctrl.may_send(chunk) => {
                tokio::time::sleep(Duration::from_millis(TRACK_POLL_MS)).await;
                continue;
            }
            NextSend::Chunk {
                index,
                offset,
                len,
                last,
            } => (index, offset, len, last),
            NextSend::Wait => {
                tokio::time::sleep(Duration::from_millis(TRACK_POLL_MS)).await;
                continue;
            }
            NextSend::Done => return state.done(),
        };
        let bytes = match read_track_range(path, offset, len) {
            Ok(bytes) => bytes,
            Err(error) => return TrackUploadOutcome::Failed(error),
        };
        let reply =
            send_track_chunk(&client, target, track, content_type, index, last, bytes).await;
        let step = state.on_reply(len, reply, file_len);
        ctrl.sent_bytes.store(state.offset, Ordering::SeqCst);
        match step {
            Step::Continue => {}
            Step::RetryAfter(delay) => {
                eprintln!(
                    "[rich-tracks] {}: {track} chunk #{index} not stored; retrying in {}ms",
                    target.recording_id,
                    delay.as_millis()
                );
                tokio::time::sleep(delay).await;
            }
            Step::Finish(outcome) => return outcome,
        }
    }
}

fn read_track_range(path: &Path, offset: u64, len: u64) -> Result<Vec<u8>, String> {
    let mut file = File::open(path).map_err(|e| format!("track file open failed: {e}"))?;
    file.seek(SeekFrom::Start(offset))
        .map_err(|e| format!("track file seek failed: {e}"))?;
    let mut buf = vec![0_u8; len as usize];
    file.read_exact(&mut buf)
        .map_err(|e| format!("track file read failed: {e}"))?;
    Ok(buf)
}

fn track_chunk_url(
    target: &TrackUploadTarget,
    track: &str,
    content_type: &str,
    index: u64,
    last: bool,
) -> Result<url::Url, String> {
    let mut url = target.url(track)?;
    {
        let mut query = url.query_pairs_mut();
        query
            .append_pair("index", &index.to_string())
            .append_pair("contentType", content_type);
        if last {
            query.append_pair("isFinal", "1");
        }
    }
    Ok(url)
}

async fn send_track_chunk(
    client: &reqwest::Client,
    target: &TrackUploadTarget,
    track: &str,
    content_type: &str,
    index: u64,
    last: bool,
    body: Vec<u8>,
) -> ChunkReply {
    let url = match track_chunk_url(target, track, content_type, index, last) {
        Ok(url) => url,
        Err(error) => return ChunkReply::Rejected(error),
    };
    let response = target
        .post(client, url)
        .header("Content-Type", content_type)
        .body(body)
        .send()
        .await;
    match response {
        Ok(response) => {
            let status = response.status().as_u16();
            let body = response.text().await.map_err(|error| error.to_string());
            chunk_reply_from(status, body)
        }
        Err(error) => ChunkReply::Transient(format!("track upload failed: {error}")),
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) enum FinalizeReply {
    Done,
    Retryable(String),
    Failed(String),
}

pub(super) fn classify_finalize_reply(status: u16, body: &str) -> FinalizeReply {
    let reply = ReplyBody::parse(body);
    let reason = reply.reason(status, body);
    if (200..300).contains(&status) && reply.ok == Some(true) {
        // A 200 can still say no track was kept.
        if reply.tracks_stopped == Some(true) && reply.already_finalized != Some(true) {
            let dropped = reply
                .dropped_tracks
                .map(|value| value.to_string())
                .unwrap_or_default();
            return FinalizeReply::Failed(format!("the server kept no tracks {dropped}"));
        }
        return FinalizeReply::Done;
    }
    if reply.tracks_stopped == Some(true) {
        FinalizeReply::Failed(reason)
    } else if reply.retryable == Some(true) || status >= 500 {
        FinalizeReply::Retryable(reason)
    } else {
        FinalizeReply::Failed(reason)
    }
}

/// As with a chunk, an unread answer is tried again: a finalize that already
/// went through answers `alreadyFinalized`.
fn finalize_reply_from(status: u16, body: Result<String, String>) -> FinalizeReply {
    match body {
        Ok(body) => classify_finalize_reply(status, &body),
        Err(error) => {
            FinalizeReply::Retryable(format!("{status}: the answer couldn't be read: {error}"))
        }
    }
}

/// `POST /api/uploads/:id/tracks/finalize`, retrying a retryable answer a few
/// times with backoff.
pub(super) async fn post_tracks_finalize(
    target: &TrackUploadTarget,
    body: &serde_json::Value,
) -> Result<(), String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(60))
        .build()
        .map_err(|error| format!("tracks finalize client failed: {error}"))?;
    let url = target.url("finalize")?;
    let mut attempt = 0;
    loop {
        attempt += 1;
        let reply = match target.post(&client, url.clone()).json(body).send().await {
            Ok(response) => {
                let status = response.status().as_u16();
                let text = response.text().await.map_err(|error| error.to_string());
                finalize_reply_from(status, text)
            }
            Err(error) => FinalizeReply::Retryable(format!("tracks finalize failed: {error}")),
        };
        match reply {
            FinalizeReply::Done => return Ok(()),
            FinalizeReply::Failed(reason) => return Err(reason),
            FinalizeReply::Retryable(reason) if attempt >= TRACKS_FINALIZE_ATTEMPTS => {
                return Err(format!("gave up after {attempt} attempts: {reason}"))
            }
            FinalizeReply::Retryable(reason) => {
                let delay = retry_delay(TRACKS_FINALIZE_RETRY_BASE_MS, 30_000, attempt);
                eprintln!(
                    "[rich-tracks] {}: tracks finalize attempt {attempt} not done ({reason}); retrying in {}ms",
                    target.recording_id,
                    delay.as_millis()
                );
                tokio::time::sleep(delay).await;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const CHUNK: u64 = 100;

    fn send_all(
        state: &mut TrackUploadState,
        file_len: u64,
        closed: bool,
    ) -> Vec<(u64, u64, u64, bool)> {
        let mut sent = Vec::new();
        while let NextSend::Chunk {
            index,
            offset,
            len,
            last,
        } = state.next(file_len, closed)
        {
            sent.push((index, offset, len, last));
            assert_eq!(
                state.on_reply(len, ChunkReply::Stored, file_len),
                Step::Continue
            );
        }
        sent
    }

    #[test]
    fn whole_chunks_go_while_recording_and_the_remainder_after_stop() {
        let mut state = TrackUploadState::new(CHUNK);
        assert_eq!(state.next(0, false), NextSend::Wait);
        assert_eq!(state.next(99, false), NextSend::Wait);
        assert_eq!(
            send_all(&mut state, 250, false),
            [(0, 0, 100, false), (1, 100, 100, false)]
        );
        assert_eq!(state.next(250, false), NextSend::Wait);
        // Closed: the 50 bytes left go as the last chunk.
        assert_eq!(send_all(&mut state, 250, true), [(2, 200, 50, true)]);
        assert_eq!(state.next(250, true), NextSend::Done);
        assert_eq!(
            state.done(),
            TrackUploadOutcome::Sent {
                bytes: 250,
                chunks: 3
            }
        );

        // A file that ends on a chunk boundary has no short chunk.
        let mut state = TrackUploadState::new(CHUNK);
        assert_eq!(
            send_all(&mut state, 200, true),
            [(0, 0, 100, false), (1, 100, 100, true)]
        );
        assert_eq!(state.next(200, true), NextSend::Done);

        // A file shorter than a chunk goes in one, as its last.
        let mut state = TrackUploadState::new(CHUNK);
        assert_eq!(send_all(&mut state, 20, true), [(0, 0, 20, true)]);

        // Nothing written at all.
        let state = TrackUploadState::new(CHUNK);
        assert_eq!(state.next(0, true), NextSend::Done);
        assert_eq!(state.done(), TrackUploadOutcome::Empty);
    }

    #[test]
    fn resumes_from_the_index_the_server_expects() {
        let mut state = TrackUploadState::new(CHUNK);
        assert_eq!(
            send_all(&mut state, 300, false),
            [
                (0, 0, 100, false),
                (1, 100, 100, false),
                (2, 200, 100, false)
            ]
        );
        // Say the server lost the last chunk and wants chunk 2 again.
        assert_eq!(
            state.on_reply(100, ChunkReply::ExpectedIndex(2), 300),
            Step::Continue
        );
        assert_eq!(
            state.next(300, false),
            NextSend::Chunk {
                index: 2,
                offset: 200,
                len: 100,
                last: false
            }
        );
        // A stored chunk acknowledged again counts as stored.
        assert_eq!(
            classify_chunk_reply(
                200,
                r#"{"ok":true,"track":"input","index":2,"bytesUploaded":300,"duplicate":true}"#
            ),
            ChunkReply::Stored
        );
        // An index past the file can't be resumed from.
        assert!(matches!(
            state.on_reply(100, ChunkReply::ExpectedIndex(9), 300),
            Step::Finish(TrackUploadOutcome::Failed(_))
        ));
    }

    #[test]
    fn the_chunk_that_ends_a_closed_track_says_it_is_final() {
        let target = TrackUploadTarget {
            server_url: "https://clips.example/".into(),
            recording_id: "rec-1".into(),
            auth_token: String::new(),
            cookie: String::new(),
        };
        assert_eq!(
            track_chunk_url(&target, "input", "application/gzip", 0, true)
                .unwrap()
                .as_str(),
            "https://clips.example/api/uploads/rec-1/tracks/input?index=0&contentType=application%2Fgzip&isFinal=1"
        );
        assert_eq!(
            track_chunk_url(&target, "screen", "video/mp4", 3, false)
                .unwrap()
                .as_str(),
            "https://clips.example/api/uploads/rec-1/tracks/screen?index=3&contentType=video%2Fmp4"
        );
    }

    #[test]
    fn retryable_answers_back_off_and_then_fail_the_track() {
        let mut state = TrackUploadState::new(CHUNK);
        let delays: Vec<Step> = (0..TRACK_CHUNK_ATTEMPTS - 1)
            .map(|_| state.on_reply(100, ChunkReply::Retryable("503".into()), 100))
            .collect();
        assert_eq!(
            delays,
            [
                Step::RetryAfter(Duration::from_millis(500)),
                Step::RetryAfter(Duration::from_millis(1000)),
                Step::RetryAfter(Duration::from_millis(2000)),
                Step::RetryAfter(Duration::from_millis(4000)),
            ]
        );
        // Nothing moved while retrying.
        assert_eq!(
            state.next(100, true),
            NextSend::Chunk {
                index: 0,
                offset: 0,
                len: 100,
                last: true
            }
        );
        assert!(matches!(
            state.on_reply(100, ChunkReply::Transient("timeout".into()), 100),
            Step::Finish(TrackUploadOutcome::Failed(_))
        ));
        // A stored chunk resets the count.
        let mut state = TrackUploadState::new(CHUNK);
        state.on_reply(100, ChunkReply::Transient("reset".into()), 100);
        state.on_reply(100, ChunkReply::Stored, 100);
        assert_eq!(state.attempts, 0);
    }

    #[test]
    fn server_answers_are_classified_by_their_flags() {
        assert_eq!(
            classify_chunk_reply(
                200,
                r#"{"ok":true,"track":"input","index":0,"bytesUploaded":10}"#
            ),
            ChunkReply::Stored
        );
        // The size limit stops every track.
        assert!(matches!(
            classify_chunk_reply(
                413,
                r#"{"ok":false,"error":"Tracks for this recording reached their size limit.","tracksStopped":true,"bytesReceived":10,"maxBytes":5}"#
            ),
            ChunkReply::TracksStopped(_)
        ));
        assert!(matches!(
            classify_chunk_reply(
                403,
                r#"{"ok":false,"error":"Rich recordings are off.","labDisabled":true,"tracksStopped":true}"#
            ),
            ChunkReply::TracksStopped(_)
        ));
        assert!(matches!(
            classify_chunk_reply(409, r#"{"ok":false,"error":"Try again.","retryable":true}"#),
            ChunkReply::Retryable(_)
        ));
        assert!(matches!(
            classify_chunk_reply(
                409,
                r#"{"ok":false,"error":"The upload failed.","tracksStopped":true}"#
            ),
            ChunkReply::TracksStopped(_)
        ));
        assert_eq!(
            classify_chunk_reply(
                409,
                r#"{"ok":false,"error":"Track chunks go in order; send chunk 3 next.","expectedIndex":3}"#
            ),
            ChunkReply::ExpectedIndex(3)
        );
        assert!(matches!(
            classify_chunk_reply(502, "<html>bad gateway</html>"),
            ChunkReply::Transient(_)
        ));
        assert!(matches!(
            classify_chunk_reply(
                409,
                r#"{"ok":false,"error":"A newer upload of this recording is active.","staleAttempt":true}"#
            ),
            ChunkReply::Rejected(_)
        ));
        assert!(matches!(
            classify_chunk_reply(401, r#"{"statusCode":401,"message":"Unauthorized"}"#),
            ChunkReply::Rejected(_)
        ));

        let mut state = TrackUploadState::new(CHUNK);
        assert_eq!(
            state.on_reply(100, ChunkReply::TracksStopped("413".into()), 100),
            Step::Finish(TrackUploadOutcome::Stopped("413".into()))
        );
    }

    #[test]
    fn tracks_send_only_behind_the_recordings_own_upload() {
        // While recording: only when the recording's upload has no more than
        // the chunk it is on waiting.
        let recording = SendPhase::Recording;
        assert!(track_chunk_may_go(recording, Some(0), CHUNK));
        assert!(track_chunk_may_go(recording, Some(CHUNK), CHUNK));
        assert!(!track_chunk_may_go(recording, Some(CHUNK + 1), CHUNK));
        assert!(!track_chunk_may_go(recording, Some(5 * CHUNK), CHUNK));
        // Unknown backlog holds the track back.
        assert!(!track_chunk_may_go(recording, None, CHUNK));
        // After Stop, nothing goes until the track is released.
        let stopped = SendPhase::AwaitingRecordingUpload;
        assert!(!track_chunk_may_go(stopped, Some(0), CHUNK));
        assert!(track_chunk_may_go(SendPhase::Released, None, CHUNK));

        let unsent = Arc::new(AtomicU64::new(0));
        let probe = Arc::clone(&unsent);
        let gate = Arc::new(TrackSendGate::new(move || {
            Some(probe.load(Ordering::SeqCst))
        }));
        let input = TrackUploadCtrl::new(Arc::new(AtomicBool::new(false)), Arc::clone(&gate));
        let screen = TrackUploadCtrl::new(Arc::new(AtomicBool::new(false)), Arc::clone(&gate));
        assert_eq!(input.phase(), SendPhase::Recording);
        assert!(input.may_send(CHUNK));
        unsent.store(3 * CHUNK, Ordering::SeqCst);
        assert!(!screen.may_send(CHUNK));
        unsent.store(0, Ordering::SeqCst);
        gate.stop_recording();
        assert_eq!(screen.phase(), SendPhase::AwaitingRecordingUpload);
        assert!(!input.may_send(CHUNK) && !screen.may_send(CHUNK));
        // Released one at a time: the input track first, the screen after it.
        input.release();
        assert!(input.may_send(CHUNK));
        assert!(!screen.may_send(CHUNK));
        screen.release();
        assert!(screen.may_send(CHUNK));
    }

    #[test]
    fn a_source_that_cannot_write_its_file_fails_its_upload_even_once_closed() {
        let target = TrackUploadTarget {
            server_url: "http://127.0.0.1:9".into(),
            recording_id: "rec-write-failed".into(),
            auth_token: String::new(),
            cookie: String::new(),
        };
        let ctrl = TrackUploadCtrl::new(
            Arc::new(AtomicBool::new(false)),
            Arc::new(TrackSendGate::new(|| Some(0))),
        );
        // Nothing reached the file, and the source closed it after saying it
        // failed: without the failure that reads as an empty track.
        ctrl.fail_source("its file could not be written".into());
        ctrl.close_source();
        let path = std::env::temp_dir().join(format!(
            "clips-track-upload-test-{}-missing.jsonl.gz",
            std::process::id()
        ));
        let outcome = tokio::runtime::Builder::new_current_thread()
            .enable_time()
            .build()
            .unwrap()
            .block_on(track_upload_loop(
                &target,
                "input",
                "application/gzip",
                &path,
                &ctrl,
            ));
        assert_eq!(
            outcome,
            TrackUploadOutcome::Failed("its file could not be written".into())
        );
        // Cancelling still wins: the recording is going, not the track.
        ctrl.cancel();
        let outcome = tokio::runtime::Builder::new_current_thread()
            .enable_time()
            .build()
            .unwrap()
            .block_on(track_upload_loop(
                &target,
                "input",
                "application/gzip",
                &path,
                &ctrl,
            ));
        assert_eq!(outcome, TrackUploadOutcome::Cancelled);
    }

    #[test]
    fn an_answer_that_cannot_be_read_is_tried_again() {
        assert!(matches!(
            chunk_reply_from(200, Err("connection reset".into())),
            ChunkReply::Transient(_)
        ));
        assert_eq!(
            chunk_reply_from(200, Ok(r#"{"ok":true,"duplicate":true}"#.into())),
            ChunkReply::Stored
        );
        assert!(matches!(
            finalize_reply_from(200, Err("connection reset".into())),
            FinalizeReply::Retryable(_)
        ));
        assert_eq!(
            finalize_reply_from(200, Ok(r#"{"ok":true,"alreadyFinalized":true}"#.into())),
            FinalizeReply::Done
        );
    }

    #[test]
    fn finalize_answers_are_done_retryable_or_failed() {
        assert_eq!(
            classify_finalize_reply(
                200,
                r#"{"ok":true,"mediaFormat":"rich","richBytes":10,"tracks":[]}"#
            ),
            FinalizeReply::Done
        );
        assert_eq!(
            classify_finalize_reply(200, r#"{"ok":true,"alreadyFinalized":true}"#),
            FinalizeReply::Done
        );
        assert!(matches!(
            classify_finalize_reply(
                200,
                r#"{"ok":true,"mediaFormat":"flat","tracks":[],"droppedTracks":["input"],"tracksStopped":true}"#
            ),
            FinalizeReply::Failed(_)
        ));
        assert!(matches!(
            classify_finalize_reply(
                409,
                r#"{"ok":false,"error":"Not finalized yet.","recordingNotFinalized":true,"retryable":true}"#
            ),
            FinalizeReply::Retryable(_)
        ));
        assert!(matches!(
            classify_finalize_reply(503, ""),
            FinalizeReply::Retryable(_)
        ));
        assert!(matches!(
            classify_finalize_reply(
                409,
                r#"{"ok":false,"error":"Burned.","tracksStopped":true}"#
            ),
            FinalizeReply::Failed(_)
        ));
        assert!(matches!(
            classify_finalize_reply(400, r#"{"statusCode":400,"message":"Invalid body"}"#),
            FinalizeReply::Failed(_)
        ));
    }
}
