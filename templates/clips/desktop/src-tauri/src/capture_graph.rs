//! A local coordinator for capture demand.
//!
//! This module intentionally does not start a screen, audio, or camera producer.
//! It is the small piece of shared state those producers will eventually obey: a
//! single monotonic graph clock, ref-counted source demand, and auditable leases.

use chrono::{DateTime, Duration as ChronoDuration, Utc};
use serde::Serialize;
use std::collections::{BTreeMap, BTreeSet};
use std::fmt;
use std::sync::Mutex;
use std::time::{Duration, Instant};

/// The largest interval a caller may explicitly request from a prior buffer.
pub(crate) const MAX_RETROSPECTIVE_EXTENSION: Duration = Duration::from_secs(5 * 60);

#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum CaptureSource {
    Screen,
    SystemAudio,
    Microphone,
    Camera,
}

#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum CaptureConsumer {
    Rewind,
    Clip,
    Meeting,
    Transcription,
    VisualIndex,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum CoverageGapReason {
    PermissionDenied,
    ProducerUnavailable,
    UserPaused,
    PrivacyExclusion,
    SystemInterrupted,
    Unknown,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CaptureInterval {
    pub started_at: String,
    pub ended_at: String,
    pub started_elapsed_ms: u64,
    pub ended_elapsed_ms: u64,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ConsumerLeaseSnapshot {
    pub id: String,
    pub consumer: CaptureConsumer,
    pub sources: Vec<CaptureSource>,
    pub interval: CaptureInterval,
    pub retrospective_extension_ms: u64,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ClosedConsumerLease {
    pub lease: ConsumerLeaseSnapshot,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PinRecord {
    pub id: String,
    pub interval: CaptureInterval,
    pub label: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CoverageGap {
    pub id: String,
    pub source: CaptureSource,
    pub reason: CoverageGapReason,
    pub interval: CaptureInterval,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ActiveSourceStatus {
    pub source: CaptureSource,
    pub consumer_count: usize,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CaptureGraphStatus {
    pub graph_started_at: String,
    pub graph_elapsed_ms: u64,
    pub active_sources: Vec<ActiveSourceStatus>,
    pub active_consumers: Vec<ConsumerLeaseSnapshot>,
    pub coverage_gaps: Vec<CoverageGap>,
    pub pins: Vec<PinRecord>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) enum CaptureGraphError {
    UnknownLease(String),
    DuplicateLease(String),
    EmptySources,
    InvalidInterval,
    BeforeGraphStart,
    RetrospectiveExtensionTooLarge {
        requested: Duration,
        maximum: Duration,
    },
    RetrospectiveExtensionAlreadySet(String),
}

impl fmt::Display for CaptureGraphError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::UnknownLease(id) => write!(formatter, "unknown capture lease {id}"),
            Self::DuplicateLease(id) => write!(formatter, "capture lease {id} already exists"),
            Self::EmptySources => write!(
                formatter,
                "a capture lease must request at least one source"
            ),
            Self::InvalidInterval => write!(formatter, "capture interval ends before it starts"),
            Self::BeforeGraphStart => write!(formatter, "capture instant predates the graph clock"),
            Self::RetrospectiveExtensionTooLarge { requested, maximum } => write!(
                formatter,
                "retrospective extension of {}ms exceeds {}ms",
                requested.as_millis(),
                maximum.as_millis()
            ),
            Self::RetrospectiveExtensionAlreadySet(id) => {
                write!(
                    formatter,
                    "capture lease {id} already has a retrospective extension"
                )
            }
        }
    }
}

impl std::error::Error for CaptureGraphError {}

#[derive(Debug)]
struct Lease {
    id: String,
    consumer: CaptureConsumer,
    sources: BTreeSet<CaptureSource>,
    started_at: Instant,
    retrospective_extension: Option<Duration>,
}

/// In-memory source-demand graph. `Instant` is authoritative; wall clock values
/// are produced only at the serializable boundary.
#[derive(Debug)]
pub(crate) struct CaptureGraph {
    clock_started_at: Instant,
    epoch_started_at: DateTime<Utc>,
    active_leases: BTreeMap<String, Lease>,
    source_demand: BTreeMap<CaptureSource, usize>,
    coverage_gaps: Vec<CoverageGap>,
    pins: Vec<PinRecord>,
    next_lease_id: u64,
    next_gap_id: u64,
    next_pin_id: u64,
}

/// Tauri-managed holder. No command consumes this yet; keeping it managed makes
/// later producer integration share one coordinator rather than inventing a
/// second clock in each subsystem.
pub(crate) struct CaptureGraphState(pub Mutex<CaptureGraph>);

impl Default for CaptureGraphState {
    fn default() -> Self {
        Self(Mutex::new(CaptureGraph::new()))
    }
}

impl CaptureGraph {
    pub(crate) fn new() -> Self {
        Self::new_at(Instant::now(), Utc::now())
    }

    /// Stable identity for this in-memory monotonic clock. Persisted media may
    /// compare elapsed offsets only when this identity also matches; elapsed
    /// milliseconds restart from zero whenever the desktop app relaunches.
    pub(crate) fn epoch_id(&self) -> String {
        format_rfc3339_millis(self.epoch_started_at)
    }

    fn new_at(clock_started_at: Instant, epoch_started_at: DateTime<Utc>) -> Self {
        Self {
            clock_started_at,
            epoch_started_at,
            active_leases: BTreeMap::new(),
            source_demand: BTreeMap::new(),
            coverage_gaps: Vec::new(),
            pins: Vec::new(),
            next_lease_id: 1,
            next_gap_id: 1,
            next_pin_id: 1,
        }
    }

    /// Starts demand at `now`, never before it. Countdown handling belongs to a
    /// caller: it must invoke this only when the countdown has completed.
    pub(crate) fn start_consumer(
        &mut self,
        consumer: CaptureConsumer,
        sources: impl IntoIterator<Item = CaptureSource>,
    ) -> Result<ConsumerLeaseSnapshot, CaptureGraphError> {
        self.start_consumer_at(consumer, sources, Instant::now())
    }

    pub(crate) fn start_consumer_at(
        &mut self,
        consumer: CaptureConsumer,
        sources: impl IntoIterator<Item = CaptureSource>,
        now: Instant,
    ) -> Result<ConsumerLeaseSnapshot, CaptureGraphError> {
        self.require_graph_instant(now)?;
        let sources: BTreeSet<_> = sources.into_iter().collect();
        if sources.is_empty() {
            return Err(CaptureGraphError::EmptySources);
        }
        let id = format!("lease-{}", self.next_lease_id);
        self.next_lease_id += 1;
        self.start_consumer_with_id_at(id, consumer, sources, now)
    }

    fn start_consumer_with_id_at(
        &mut self,
        id: String,
        consumer: CaptureConsumer,
        sources: BTreeSet<CaptureSource>,
        now: Instant,
    ) -> Result<ConsumerLeaseSnapshot, CaptureGraphError> {
        if self.active_leases.contains_key(&id) {
            return Err(CaptureGraphError::DuplicateLease(id));
        }
        for source in &sources {
            *self.source_demand.entry(*source).or_default() += 1;
        }
        let lease = Lease {
            id: id.clone(),
            consumer,
            sources,
            started_at: now,
            retrospective_extension: None,
        };
        let snapshot = self.open_lease_snapshot(&lease, now)?;
        self.active_leases.insert(id, lease);
        Ok(snapshot)
    }

    /// Explicitly asks to include bounded buffered history. Starting a lease
    /// never calls this implicitly; actual producer coverage remains separate.
    pub(crate) fn extend_retrospectively(
        &mut self,
        lease_id: &str,
        duration: Duration,
    ) -> Result<ConsumerLeaseSnapshot, CaptureGraphError> {
        if duration > MAX_RETROSPECTIVE_EXTENSION {
            return Err(CaptureGraphError::RetrospectiveExtensionTooLarge {
                requested: duration,
                maximum: MAX_RETROSPECTIVE_EXTENSION,
            });
        }
        {
            let lease = self
                .active_leases
                .get_mut(lease_id)
                .ok_or_else(|| CaptureGraphError::UnknownLease(lease_id.to_owned()))?;
            if lease.retrospective_extension.is_some() {
                return Err(CaptureGraphError::RetrospectiveExtensionAlreadySet(
                    lease_id.to_owned(),
                ));
            }
            // Clamp at the graph epoch: a lease may not request time before its
            // only reliable clock anchor.
            let available = lease.started_at.duration_since(self.clock_started_at);
            lease.retrospective_extension = Some(duration.min(available));
        }
        let lease = self
            .active_leases
            .get(lease_id)
            .expect("lease just updated");
        self.open_lease_snapshot(lease, lease.started_at)
    }

    /// Explicitly extends a lease back to an absolute requested instant, such
    /// as a meeting's recorded start. Unlike `extend_retrospectively`, this is
    /// not subject to the short Rewind duration cap; it is clamped only to the
    /// graph clock because the coordinator cannot describe coverage before it.
    pub(crate) fn extend_retrospectively_to_start(
        &mut self,
        lease_id: &str,
        requested_start: Instant,
    ) -> Result<ConsumerLeaseSnapshot, CaptureGraphError> {
        let requested_start = requested_start.max(self.clock_started_at);
        {
            let lease = self
                .active_leases
                .get_mut(lease_id)
                .ok_or_else(|| CaptureGraphError::UnknownLease(lease_id.to_owned()))?;
            if lease.retrospective_extension.is_some() {
                return Err(CaptureGraphError::RetrospectiveExtensionAlreadySet(
                    lease_id.to_owned(),
                ));
            }
            let extension = lease.started_at.saturating_duration_since(requested_start);
            lease.retrospective_extension = Some(extension);
        }
        let lease = self
            .active_leases
            .get(lease_id)
            .expect("lease just updated");
        self.open_lease_snapshot(lease, lease.started_at)
    }

    pub(crate) fn end_consumer(
        &mut self,
        lease_id: &str,
    ) -> Result<ClosedConsumerLease, CaptureGraphError> {
        self.end_consumer_at(lease_id, Instant::now())
    }

    /// Ends a lease and returns its closed interval. This is the sole path that
    /// releases its ref-counted producer demand.
    pub(crate) fn end_consumer_at(
        &mut self,
        lease_id: &str,
        now: Instant,
    ) -> Result<ClosedConsumerLease, CaptureGraphError> {
        self.require_graph_instant(now)?;
        let lease = self
            .active_leases
            .remove(lease_id)
            .ok_or_else(|| CaptureGraphError::UnknownLease(lease_id.to_owned()))?;
        if now < lease.started_at {
            self.active_leases.insert(lease.id.clone(), lease);
            return Err(CaptureGraphError::InvalidInterval);
        }
        for source in &lease.sources {
            let no_remaining_demand = {
                let demand = self
                    .source_demand
                    .get_mut(source)
                    .expect("lease demand exists");
                *demand -= 1;
                *demand == 0
            };
            if no_remaining_demand {
                self.source_demand.remove(source);
            }
        }
        Ok(ClosedConsumerLease {
            lease: self.closed_lease_snapshot(&lease, now)?,
        })
    }

    pub(crate) fn record_coverage_gap_at(
        &mut self,
        source: CaptureSource,
        reason: CoverageGapReason,
        started_at: Instant,
        ended_at: Instant,
    ) -> Result<CoverageGap, CaptureGraphError> {
        let interval = self.interval(started_at, ended_at)?;
        let gap = CoverageGap {
            id: format!("gap-{}", self.next_gap_id),
            source,
            reason,
            interval,
        };
        self.next_gap_id += 1;
        self.coverage_gaps.push(gap.clone());
        Ok(gap)
    }

    pub(crate) fn pin_interval_at(
        &mut self,
        started_at: Instant,
        ended_at: Instant,
        label: Option<String>,
    ) -> Result<PinRecord, CaptureGraphError> {
        let pin = PinRecord {
            id: format!("pin-{}", self.next_pin_id),
            interval: self.interval(started_at, ended_at)?,
            label,
        };
        self.next_pin_id += 1;
        self.pins.push(pin.clone());
        Ok(pin)
    }

    /// Pins an already-serialized graph interval without reconstructing it
    /// through wall-clock time. This is the normal bridge from a closed
    /// consumer lease to retention-aware media materialization.
    pub(crate) fn pin_interval(
        &mut self,
        interval: &CaptureInterval,
        label: Option<String>,
    ) -> Result<PinRecord, CaptureGraphError> {
        let started_at = self
            .clock_started_at
            .checked_add(Duration::from_millis(interval.started_elapsed_ms))
            .ok_or(CaptureGraphError::InvalidInterval)?;
        let ended_at = self
            .clock_started_at
            .checked_add(Duration::from_millis(interval.ended_elapsed_ms))
            .ok_or(CaptureGraphError::InvalidInterval)?;
        self.pin_interval_at(started_at, ended_at, label)
    }

    /// Releases a retention pin after its bounded artifact has been copied to
    /// durable pending storage. Releasing an unknown pin is deliberately a
    /// no-op so cancellation and error cleanup can be idempotent.
    pub(crate) fn release_pin(&mut self, pin_id: &str) -> bool {
        let before = self.pins.len();
        self.pins.retain(|pin| pin.id != pin_id);
        self.pins.len() != before
    }

    pub(crate) fn status_at(&self, now: Instant) -> Result<CaptureGraphStatus, CaptureGraphError> {
        self.require_graph_instant(now)?;
        Ok(CaptureGraphStatus {
            graph_started_at: format_rfc3339_millis(self.epoch_started_at),
            graph_elapsed_ms: self.elapsed_ms(now)?,
            active_sources: self
                .source_demand
                .iter()
                .map(|(source, consumer_count)| ActiveSourceStatus {
                    source: *source,
                    consumer_count: *consumer_count,
                })
                .collect(),
            active_consumers: self
                .active_leases
                .values()
                .map(|lease| self.open_lease_snapshot(lease, now))
                .collect::<Result<Vec<_>, _>>()?,
            coverage_gaps: self.coverage_gaps.clone(),
            pins: self.pins.clone(),
        })
    }

    fn open_lease_snapshot(
        &self,
        lease: &Lease,
        now: Instant,
    ) -> Result<ConsumerLeaseSnapshot, CaptureGraphError> {
        let started_at = self.effective_start(lease)?;
        Ok(ConsumerLeaseSnapshot {
            id: lease.id.clone(),
            consumer: lease.consumer,
            sources: lease.sources.iter().copied().collect(),
            interval: self.interval(started_at, now)?,
            retrospective_extension_ms: lease
                .retrospective_extension
                .map(|duration| duration.as_millis() as u64)
                .unwrap_or_default(),
        })
    }

    fn closed_lease_snapshot(
        &self,
        lease: &Lease,
        ended_at: Instant,
    ) -> Result<ConsumerLeaseSnapshot, CaptureGraphError> {
        let started_at = self.effective_start(lease)?;
        Ok(ConsumerLeaseSnapshot {
            id: lease.id.clone(),
            consumer: lease.consumer,
            sources: lease.sources.iter().copied().collect(),
            interval: self.interval(started_at, ended_at)?,
            retrospective_extension_ms: lease
                .retrospective_extension
                .map(|duration| duration.as_millis() as u64)
                .unwrap_or_default(),
        })
    }

    fn effective_start(&self, lease: &Lease) -> Result<Instant, CaptureGraphError> {
        Ok(lease.started_at - lease.retrospective_extension.unwrap_or_default())
    }

    fn interval(
        &self,
        started_at: Instant,
        ended_at: Instant,
    ) -> Result<CaptureInterval, CaptureGraphError> {
        self.require_graph_instant(started_at)?;
        self.require_graph_instant(ended_at)?;
        if ended_at < started_at {
            return Err(CaptureGraphError::InvalidInterval);
        }
        Ok(CaptureInterval {
            started_at: self.timestamp(started_at)?,
            ended_at: self.timestamp(ended_at)?,
            started_elapsed_ms: self.elapsed_ms(started_at)?,
            ended_elapsed_ms: self.elapsed_ms(ended_at)?,
        })
    }

    fn require_graph_instant(&self, instant: Instant) -> Result<(), CaptureGraphError> {
        if instant < self.clock_started_at {
            Err(CaptureGraphError::BeforeGraphStart)
        } else {
            Ok(())
        }
    }

    fn elapsed_ms(&self, instant: Instant) -> Result<u64, CaptureGraphError> {
        self.require_graph_instant(instant)?;
        Ok(instant.duration_since(self.clock_started_at).as_millis() as u64)
    }

    fn timestamp(&self, instant: Instant) -> Result<String, CaptureGraphError> {
        let elapsed = self.elapsed_ms(instant)?;
        Ok(format_rfc3339_millis(
            self.epoch_started_at + ChronoDuration::milliseconds(elapsed as i64),
        ))
    }
}

fn format_rfc3339_millis(timestamp: DateTime<Utc>) -> String {
    timestamp.to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn graph() -> (CaptureGraph, Instant) {
        let start = Instant::now();
        (
            CaptureGraph::new_at(
                start,
                DateTime::parse_from_rfc3339("2026-07-14T12:00:00Z")
                    .unwrap()
                    .with_timezone(&Utc),
            ),
            start,
        )
    }

    #[test]
    fn refcounts_shared_source_demand() {
        let (mut graph, start) = graph();
        let first = graph
            .start_consumer_at(CaptureConsumer::Rewind, [CaptureSource::Screen], start)
            .unwrap();
        graph
            .start_consumer_at(
                CaptureConsumer::VisualIndex,
                [CaptureSource::Screen, CaptureSource::SystemAudio],
                start + Duration::from_millis(10),
            )
            .unwrap();
        let status = graph.status_at(start + Duration::from_millis(10)).unwrap();
        assert_eq!(status.active_sources[0].consumer_count, 2);
        assert_eq!(status.active_sources[1].consumer_count, 1);
        graph
            .end_consumer_at(&first.id, start + Duration::from_millis(20))
            .unwrap();
        let status = graph.status_at(start + Duration::from_millis(20)).unwrap();
        assert_eq!(
            status.active_sources,
            vec![
                ActiveSourceStatus {
                    source: CaptureSource::Screen,
                    consumer_count: 1
                },
                ActiveSourceStatus {
                    source: CaptureSource::SystemAudio,
                    consumer_count: 1
                }
            ]
        );
    }

    #[test]
    fn countdown_completion_starts_without_pre_roll() {
        let (mut graph, start) = graph();
        let countdown_completed = start + Duration::from_secs(3);
        let lease = graph
            .start_consumer_at(
                CaptureConsumer::Clip,
                [CaptureSource::Screen],
                countdown_completed,
            )
            .unwrap();
        assert_eq!(lease.interval.started_elapsed_ms, 3_000);
        assert_eq!(lease.retrospective_extension_ms, 0);
    }

    #[test]
    fn retrospective_extension_is_explicit_and_bounded() {
        let (mut graph, start) = graph();
        let lease = graph
            .start_consumer_at(
                CaptureConsumer::Rewind,
                [CaptureSource::Screen],
                start + Duration::from_secs(10),
            )
            .unwrap();
        let extended = graph
            .extend_retrospectively(&lease.id, Duration::from_secs(4))
            .unwrap();
        assert_eq!(extended.interval.started_elapsed_ms, 6_000);
        assert_eq!(extended.retrospective_extension_ms, 4_000);
        assert!(matches!(
            graph.extend_retrospectively(
                &lease.id,
                MAX_RETROSPECTIVE_EXTENSION + Duration::from_millis(1)
            ),
            Err(CaptureGraphError::RetrospectiveExtensionTooLarge { .. })
        ));
    }

    #[test]
    fn absolute_retrospective_start_clamps_only_to_graph_coverage() {
        let (mut graph, start) = graph();
        let lease = graph
            .start_consumer_at(
                CaptureConsumer::Meeting,
                [CaptureSource::Screen],
                start + Duration::from_secs(600),
            )
            .unwrap();
        let extended = graph
            .extend_retrospectively_to_start(&lease.id, start - Duration::from_secs(1))
            .unwrap();
        assert_eq!(extended.interval.started_elapsed_ms, 0);
        assert_eq!(extended.retrospective_extension_ms, 600_000);
    }

    #[test]
    fn replacement_lease_changes_rewind_source_demand_with_capture_mode() {
        let (mut graph, start) = graph();
        let visuals = graph
            .start_consumer_at(CaptureConsumer::Rewind, [CaptureSource::Screen], start)
            .unwrap();
        assert_eq!(
            graph.status_at(start).unwrap().active_sources,
            vec![ActiveSourceStatus {
                source: CaptureSource::Screen,
                consumer_count: 1,
            }]
        );

        graph
            .end_consumer_at(&visuals.id, start + Duration::from_millis(1))
            .unwrap();
        graph
            .start_consumer_at(
                CaptureConsumer::Rewind,
                [
                    CaptureSource::Screen,
                    CaptureSource::SystemAudio,
                    CaptureSource::Microphone,
                ],
                start + Duration::from_millis(1),
            )
            .unwrap();

        assert_eq!(
            graph
                .status_at(start + Duration::from_millis(1))
                .unwrap()
                .active_sources,
            vec![
                ActiveSourceStatus {
                    source: CaptureSource::Screen,
                    consumer_count: 1,
                },
                ActiveSourceStatus {
                    source: CaptureSource::SystemAudio,
                    consumer_count: 1,
                },
                ActiveSourceStatus {
                    source: CaptureSource::Microphone,
                    consumer_count: 1,
                },
            ]
        );
    }

    #[test]
    fn closing_a_lease_returns_a_closed_interval_and_releases_demand() {
        let (mut graph, start) = graph();
        let lease = graph
            .start_consumer_at(CaptureConsumer::Meeting, [CaptureSource::Microphone], start)
            .unwrap();
        let closed = graph
            .end_consumer_at(&lease.id, start + Duration::from_secs(2))
            .unwrap();
        assert_eq!(closed.lease.interval.ended_elapsed_ms, 2_000);
        assert!(graph
            .status_at(start + Duration::from_secs(2))
            .unwrap()
            .active_sources
            .is_empty());
    }

    #[test]
    fn coverage_gaps_preserve_source_reason_and_interval() {
        let (mut graph, start) = graph();
        let gap = graph
            .record_coverage_gap_at(
                CaptureSource::Screen,
                CoverageGapReason::PrivacyExclusion,
                start + Duration::from_secs(1),
                start + Duration::from_secs(2),
            )
            .unwrap();
        assert_eq!(gap.id, "gap-1");
        assert_eq!(gap.source, CaptureSource::Screen);
        assert_eq!(gap.reason, CoverageGapReason::PrivacyExclusion);
        assert_eq!(gap.interval.started_elapsed_ms, 1_000);
        assert_eq!(
            graph
                .status_at(start + Duration::from_secs(2))
                .unwrap()
                .coverage_gaps,
            vec![gap]
        );
    }

    #[test]
    fn pins_have_stable_ids_and_closed_intervals() {
        let (mut graph, start) = graph();
        let first = graph
            .pin_interval_at(start, start + Duration::from_millis(1), Some("keep".into()))
            .unwrap();
        let second = graph
            .pin_interval_at(
                start + Duration::from_millis(2),
                start + Duration::from_millis(3),
                None,
            )
            .unwrap();
        assert_eq!(first.id, "pin-1");
        assert_eq!(second.id, "pin-2");
        assert_eq!(second.interval.ended_elapsed_ms, 3);
    }

    #[test]
    fn closed_lease_intervals_can_be_pinned_and_released_idempotently() {
        let (mut graph, start) = graph();
        let lease = graph
            .start_consumer_at(CaptureConsumer::Clip, [CaptureSource::Screen], start)
            .unwrap();
        let closed = graph
            .end_consumer_at(&lease.id, start + Duration::from_secs(2))
            .unwrap();
        let pin = graph
            .pin_interval(&closed.lease.interval, Some("clip materialization".into()))
            .unwrap();

        assert_eq!(pin.interval, closed.lease.interval);
        assert!(graph.release_pin(&pin.id));
        assert!(!graph.release_pin(&pin.id));
        assert!(graph
            .status_at(start + Duration::from_secs(2))
            .unwrap()
            .pins
            .is_empty());
    }
}
