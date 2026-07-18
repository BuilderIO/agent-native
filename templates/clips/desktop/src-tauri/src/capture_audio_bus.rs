//! In-process fan-out for PCM already produced by the Rewind ScreenCaptureKit stream.
//!
//! The bus deliberately owns no hardware. A single producer advertises the
//! sources it has opened and publishes mono f32 buffers; consumers either
//! subscribe to that producer or, when none exists, may open their legacy
//! physical capture path. An existing producer that lacks a requested source
//! is a hard error, never permission to start a second recorder.

use std::collections::BTreeMap;
use std::fmt;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};

pub(crate) type AudioCallback = Arc<dyn Fn(&[f32], f64) + Send + Sync>;

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub(crate) struct AudioSources {
    pub microphone: bool,
    pub system: bool,
}

impl AudioSources {
    pub(crate) const fn new(microphone: bool, system: bool) -> Self {
        Self { microphone, system }
    }

    fn contains(self, requested: Self) -> bool {
        (!requested.microphone || self.microphone) && (!requested.system || self.system)
    }

    fn missing_names(self, requested: Self) -> Vec<&'static str> {
        let mut missing = Vec::new();
        if requested.microphone && !self.microphone {
            missing.push("microphone");
        }
        if requested.system && !self.system {
            missing.push("system");
        }
        missing
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum CapturePlan {
    OpenPhysicalCapture,
    SubscribeToSharedProducer,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) enum SubscribeError {
    ProducerLacksSources {
        available: AudioSources,
        requested: AudioSources,
    },
}

impl fmt::Display for SubscribeError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::ProducerLacksSources {
                available,
                requested,
            } => write!(
                formatter,
                "shared-audio-producer-lacks-sources:{}",
                available.missing_names(*requested).join(",")
            ),
        }
    }
}

impl std::error::Error for SubscribeError {}

pub(crate) fn capture_plan(
    available: Option<AudioSources>,
    requested: AudioSources,
) -> Result<CapturePlan, SubscribeError> {
    match available {
        None => Ok(CapturePlan::OpenPhysicalCapture),
        Some(available) if available.contains(requested) => {
            Ok(CapturePlan::SubscribeToSharedProducer)
        }
        Some(available) => Err(SubscribeError::ProducerLacksSources {
            available,
            requested,
        }),
    }
}

struct Subscriber {
    active: Arc<AtomicBool>,
    microphone: Option<AudioCallback>,
    system: Option<AudioCallback>,
}

struct ProducerState {
    id: u64,
    sources: AudioSources,
    subscribers: BTreeMap<u64, Subscriber>,
}

#[derive(Default)]
struct BusState {
    next_id: u64,
    producer: Option<ProducerState>,
}

fn bus() -> &'static Mutex<BusState> {
    static BUS: OnceLock<Mutex<BusState>> = OnceLock::new();
    BUS.get_or_init(|| Mutex::new(BusState::default()))
}

struct ProducerRegistration {
    id: u64,
    active: AtomicBool,
}

impl ProducerRegistration {
    fn deactivate(&self) {
        if !self.active.swap(false, Ordering::SeqCst) {
            return;
        }
        if let Ok(mut state) = bus().lock() {
            if state
                .producer
                .as_ref()
                .is_some_and(|producer| producer.id == self.id)
            {
                if let Some(producer) = state.producer.take() {
                    for subscriber in producer.subscribers.into_values() {
                        subscriber.active.store(false, Ordering::SeqCst);
                    }
                }
            }
        }
    }
}

impl Drop for ProducerRegistration {
    fn drop(&mut self) {
        self.deactivate();
    }
}

/// Cloneable producer handle. The registration remains live through stream
/// rebuilds until explicitly deactivated or the final clone is dropped.
#[derive(Clone)]
pub(crate) struct AudioProducer {
    registration: Arc<ProducerRegistration>,
}

impl AudioProducer {
    pub(crate) fn register(sources: AudioSources) -> Result<Self, String> {
        let mut state = bus().lock().map_err(|error| error.to_string())?;
        if state.producer.is_some() {
            return Err("shared-audio-producer-already-active".into());
        }
        state.next_id = state.next_id.saturating_add(1);
        let id = state.next_id;
        state.producer = Some(ProducerState {
            id,
            sources,
            subscribers: BTreeMap::new(),
        });
        Ok(Self {
            registration: Arc::new(ProducerRegistration {
                id,
                active: AtomicBool::new(true),
            }),
        })
    }

    pub(crate) fn deactivate(&self) {
        self.registration.deactivate();
    }

    pub(crate) fn publish_microphone(&self, samples: &[f32], sample_rate: f64) {
        self.publish(samples, sample_rate, true);
    }

    pub(crate) fn publish_system(&self, samples: &[f32], sample_rate: f64) {
        self.publish(samples, sample_rate, false);
    }

    fn publish(&self, samples: &[f32], sample_rate: f64, microphone: bool) {
        if samples.is_empty() || !self.registration.active.load(Ordering::SeqCst) {
            return;
        }
        let callbacks: Vec<(Arc<AtomicBool>, AudioCallback)> = bus()
            .lock()
            .ok()
            .and_then(|state| {
                state.producer.as_ref().and_then(|producer| {
                    (producer.id == self.registration.id).then(|| {
                        producer
                            .subscribers
                            .values()
                            .filter_map(|subscriber| {
                                let callback = if microphone {
                                    subscriber.microphone.as_ref()
                                } else {
                                    subscriber.system.as_ref()
                                }?;
                                Some((subscriber.active.clone(), callback.clone()))
                            })
                            .collect()
                    })
                })
            })
            .unwrap_or_default();
        // Never hold the bus lock while invoking client code. A callback may
        // stop its session and drop its own subscription.
        for (active, callback) in callbacks {
            if active.load(Ordering::SeqCst) {
                callback(samples, sample_rate);
            }
        }
    }
}

pub(crate) enum SubscriptionAttempt {
    NoProducer,
    Subscribed(AudioSubscription),
}

pub(crate) struct AudioSubscription {
    producer_id: u64,
    subscriber_id: u64,
    active: Arc<AtomicBool>,
}

impl Drop for AudioSubscription {
    fn drop(&mut self) {
        self.active.store(false, Ordering::SeqCst);
        if let Ok(mut state) = bus().lock() {
            if let Some(producer) = state.producer.as_mut() {
                if producer.id == self.producer_id {
                    producer.subscribers.remove(&self.subscriber_id);
                }
            }
        }
    }
}

pub(crate) fn try_subscribe(
    requested: AudioSources,
    microphone: Option<AudioCallback>,
    system: Option<AudioCallback>,
) -> Result<SubscriptionAttempt, SubscribeError> {
    let mut state = bus().lock().expect("capture audio bus lock poisoned");
    let available = state.producer.as_ref().map(|producer| producer.sources);
    match capture_plan(available, requested)? {
        CapturePlan::OpenPhysicalCapture => Ok(SubscriptionAttempt::NoProducer),
        CapturePlan::SubscribeToSharedProducer => {
            state.next_id = state.next_id.saturating_add(1);
            let subscriber_id = state.next_id;
            let producer = state
                .producer
                .as_mut()
                .expect("capture plan observed an active producer");
            let producer_id = producer.id;
            let active = Arc::new(AtomicBool::new(true));
            producer.subscribers.insert(
                subscriber_id,
                Subscriber {
                    active: active.clone(),
                    microphone,
                    system,
                },
            );
            Ok(SubscriptionAttempt::Subscribed(AudioSubscription {
                producer_id,
                subscriber_id,
                active,
            }))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::MutexGuard;

    fn test_guard() -> MutexGuard<'static, ()> {
        static TEST_LOCK: OnceLock<Mutex<()>> = OnceLock::new();
        TEST_LOCK
            .get_or_init(|| Mutex::new(()))
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    fn reset() {
        *bus().lock().unwrap() = BusState::default();
    }

    #[test]
    fn routes_sources_to_independent_subscribers() {
        let _guard = test_guard();
        reset();
        let producer = AudioProducer::register(AudioSources::new(true, true)).unwrap();
        let mic_frames = Arc::new(AtomicUsize::new(0));
        let sys_frames = Arc::new(AtomicUsize::new(0));
        let mic_seen = mic_frames.clone();
        let sys_seen = sys_frames.clone();
        let _subscription = match try_subscribe(
            AudioSources::new(true, true),
            Some(Arc::new(move |samples, rate| {
                assert_eq!(rate, 44_100.0);
                mic_seen.fetch_add(samples.len(), Ordering::SeqCst);
            })),
            Some(Arc::new(move |samples, rate| {
                assert_eq!(rate, 48_000.0);
                sys_seen.fetch_add(samples.len(), Ordering::SeqCst);
            })),
        )
        .unwrap()
        {
            SubscriptionAttempt::Subscribed(subscription) => subscription,
            SubscriptionAttempt::NoProducer => panic!("producer disappeared"),
        };
        producer.publish_microphone(&[0.1, 0.2], 44_100.0);
        producer.publish_system(&[0.3, 0.4, 0.5], 48_000.0);
        assert_eq!(mic_frames.load(Ordering::SeqCst), 2);
        assert_eq!(sys_frames.load(Ordering::SeqCst), 3);
    }

    #[test]
    fn clone_refcount_and_subscription_drop_keep_teardown_safe() {
        let _guard = test_guard();
        reset();
        let producer = AudioProducer::register(AudioSources::new(true, false)).unwrap();
        let producer_clone = producer.clone();
        drop(producer);
        assert_eq!(
            capture_plan(
                bus().lock().unwrap().producer.as_ref().map(|p| p.sources),
                AudioSources::new(true, false)
            ),
            Ok(CapturePlan::SubscribeToSharedProducer)
        );

        let calls = Arc::new(AtomicUsize::new(0));
        let seen = calls.clone();
        let subscription = match try_subscribe(
            AudioSources::new(true, false),
            Some(Arc::new(move |_, _| {
                seen.fetch_add(1, Ordering::SeqCst);
            })),
            None,
        )
        .unwrap()
        {
            SubscriptionAttempt::Subscribed(subscription) => subscription,
            SubscriptionAttempt::NoProducer => panic!("producer disappeared"),
        };
        producer_clone.publish_microphone(&[0.1], 48_000.0);
        drop(subscription);
        producer_clone.publish_microphone(&[0.2], 48_000.0);
        assert_eq!(calls.load(Ordering::SeqCst), 1);

        drop(producer_clone);
        assert!(bus().lock().unwrap().producer.is_none());
    }

    #[test]
    fn existing_producer_without_sources_fails_closed() {
        let _guard = test_guard();
        reset();
        assert_eq!(
            capture_plan(
                Some(AudioSources::new(true, false)),
                AudioSources::new(true, true)
            ),
            Err(SubscribeError::ProducerLacksSources {
                available: AudioSources::new(true, false),
                requested: AudioSources::new(true, true),
            })
        );
    }
}
