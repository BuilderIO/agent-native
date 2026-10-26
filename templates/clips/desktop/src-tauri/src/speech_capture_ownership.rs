use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub(crate) enum SpeechCaptureOwner {
    Dictation,
    Meeting,
}

impl SpeechCaptureOwner {
    fn busy_error(self) -> &'static str {
        match self {
            Self::Dictation => "speech-engine-busy-dictation",
            Self::Meeting => "speech-engine-busy-meeting",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub(crate) enum SpeechCaptureEngine {
    Native,
    Whisper,
}

#[derive(Default)]
struct OwnershipRegistry {
    next_id: u64,
    claims: HashMap<(SpeechCaptureEngine, u64), SpeechCaptureOwner>,
}

fn registry() -> &'static Mutex<OwnershipRegistry> {
    static REGISTRY: OnceLock<Mutex<OwnershipRegistry>> = OnceLock::new();
    REGISTRY.get_or_init(|| Mutex::new(OwnershipRegistry::default()))
}

fn conflicting_owner(
    registry: &OwnershipRegistry,
    requested: SpeechCaptureOwner,
) -> Option<SpeechCaptureOwner> {
    registry
        .claims
        .values()
        .copied()
        .find(|active_owner| *active_owner != requested)
}

pub(crate) struct SpeechCaptureLease {
    engine: SpeechCaptureEngine,
    id: u64,
}

impl std::fmt::Debug for SpeechCaptureLease {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("SpeechCaptureLease")
            .field("engine", &self.engine)
            .field("id", &self.id)
            .finish()
    }
}

pub(crate) fn claim(
    owner: SpeechCaptureOwner,
    engine: SpeechCaptureEngine,
) -> Result<SpeechCaptureLease, &'static str> {
    let mut registry = registry()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    if let Some(active_owner) = conflicting_owner(&registry, owner) {
        return Err(active_owner.busy_error());
    }

    let id = loop {
        registry.next_id = registry.next_id.wrapping_add(1);
        if !registry.claims.contains_key(&(engine, registry.next_id)) {
            break registry.next_id;
        }
    };
    registry.claims.insert((engine, id), owner);
    Ok(SpeechCaptureLease { engine, id })
}

impl Drop for SpeechCaptureLease {
    fn drop(&mut self) {
        let mut registry = registry()
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        registry.claims.remove(&(self.engine, self.id));
    }
}

#[cfg(test)]
mod tests {
    use super::{
        claim, conflicting_owner, OwnershipRegistry, SpeechCaptureEngine, SpeechCaptureOwner,
    };
    use std::sync::Mutex;

    static TEST_LOCK: Mutex<()> = Mutex::new(());

    #[test]
    fn native_and_whisper_captures_share_one_owner_boundary() {
        let _lock = TEST_LOCK
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let _native_dictation = claim(SpeechCaptureOwner::Dictation, SpeechCaptureEngine::Native)
            .expect("native dictation should claim the shared slot");

        assert_eq!(
            claim(SpeechCaptureOwner::Meeting, SpeechCaptureEngine::Whisper)
                .err()
                .as_deref(),
            Some("speech-engine-busy-dictation")
        );
    }

    #[test]
    fn failed_start_releases_its_claim_without_releasing_a_same_owner_session() {
        let _lock = TEST_LOCK
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let active = claim(SpeechCaptureOwner::Dictation, SpeechCaptureEngine::Native)
            .expect("native dictation should claim the shared slot");
        let failed_start = claim(SpeechCaptureOwner::Dictation, SpeechCaptureEngine::Whisper)
            .expect("the same owner may prepare a replacement");
        drop(failed_start);

        assert_eq!(
            claim(SpeechCaptureOwner::Meeting, SpeechCaptureEngine::Whisper)
                .err()
                .as_deref(),
            Some("speech-engine-busy-dictation")
        );

        drop(active);
        assert!(claim(SpeechCaptureOwner::Meeting, SpeechCaptureEngine::Whisper).is_ok());
    }

    #[test]
    fn failed_start_releases_the_owner_slot() {
        let _lock = TEST_LOCK
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let failed_start = claim(SpeechCaptureOwner::Dictation, SpeechCaptureEngine::Whisper)
            .expect("Whisper should claim the shared slot");
        drop(failed_start);

        assert!(claim(SpeechCaptureOwner::Meeting, SpeechCaptureEngine::Native).is_ok());
    }

    #[test]
    fn conflicting_owner_scan_checks_every_engine_claim() {
        let mut registry = OwnershipRegistry::default();
        registry.claims.insert(
            (SpeechCaptureEngine::Native, 1),
            SpeechCaptureOwner::Dictation,
        );
        registry.claims.insert(
            (SpeechCaptureEngine::Whisper, 2),
            SpeechCaptureOwner::Meeting,
        );

        assert_eq!(
            conflicting_owner(&registry, SpeechCaptureOwner::Dictation),
            Some(SpeechCaptureOwner::Meeting)
        );
    }
}
