//! Dim the Mac's sound while dictation is live, like Wispr Flow's "mute music
//! while dictating".
//!
//! The VPIO engine's own other-audio ducking stays off on purpose (recordings
//! must keep system audio at full level, see `native_speech.rs`), so this
//! mutes the system output instead (Core Audio, so it is immediate) when the
//! dictation shortcut goes live, and unmutes it when dictation ends. A device
//! without a mute control is lowered to a fifth of its volume instead.
//! "Lower" was first a fifth for every device, but some USB audio interfaces
//! (a Behringer UMC202HD) barely get quieter that way: mute works
//! the same on every output. It follows the same "dictation active" edge that arms
//! the Escape shortcut, so push-to-talk dims while the key is held and
//! hands-free dims for the whole session.
//!
//! Restoring only happens when the output is still the way the dim left it
//! (still muted, or still exactly the lowered volume read back after the
//! write): when the user changed it during dictation, their change wins.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};

use tauri::AppHandle;

/// What the latest dictation edge asked for. Every edge spawns a reconcile
/// that reads this, so a burst of quick taps settles on the last state.
static WANT_DIMMED: AtomicBool = AtomicBool::new(false);

/// Whether a dictation session is live, so a settings change mid-session can
/// dim or restore without waiting for the next dictation edge.
static DICTATION_LIVE: AtomicBool = AtomicBool::new(false);

/// A device stores its volume as a 0.0–1.0 scalar. Values we wrote and read
/// back are bit-for-bit stable, so this only absorbs float noise; one press of
/// a volume key moves it by 1/16 (0.0625), far more than this.
const SCALAR_EPSILON: f32 = 0.001;

#[derive(Debug, Clone, Copy, PartialEq)]
struct Dimmed {
    /// The output device that was dimmed. A switch to other speakers or
    /// headphones mid-dictation restores this device, not the new one.
    device: u32,
    original: f32,
    /// The volume the device read back after the dim. A dim whose readback
    /// fails is undone at once, so this is an observed value unless
    /// `pending_undo` is set.
    dimmed_to: f32,
    /// That undo failed too: the volume is lowered and nothing observed is
    /// known, so the next restore always runs.
    pending_undo: bool,
    /// The dim muted the device (the volume was left alone): the restore
    /// unmutes it, unless the user already did.
    via_mute: bool,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct OutputVolume {
    pub device: u32,
    pub scalar: f32,
    pub muted: bool,
}

/// Holds the dimmed state and serialises every volume change.
fn slot() -> &'static Mutex<Option<Dimmed>> {
    static SLOT: OnceLock<Mutex<Option<Dimmed>>> = OnceLock::new();
    SLOT.get_or_init(|| Mutex::new(None))
}

/// Called on every dictation-active edge. Never blocks the caller (it can be a
/// hotkey callback): the volume change runs on a worker thread.
pub fn set_active(app: &AppHandle, active: bool) {
    DICTATION_LIVE.store(active, Ordering::SeqCst);
    let want = active && crate::config::feature_config(app).voice_dim_audio_enabled;
    WANT_DIMMED.store(want, Ordering::SeqCst);
    std::thread::spawn(reconcile);
}

/// The "Lower sound while dictating" setting changed: apply it right away to
/// a live session (turning it off mid-dictation restores the volume).
pub fn setting_changed(enabled: bool) {
    let want = enabled && DICTATION_LIVE.load(Ordering::SeqCst);
    WANT_DIMMED.store(want, Ordering::SeqCst);
    std::thread::spawn(reconcile);
}

/// Put the volume back right now (app quit). Synchronous on purpose.
pub fn restore_now() {
    WANT_DIMMED.store(false, Ordering::SeqCst);
    reconcile();
}

fn reconcile() {
    let mut dimmed = match slot().lock() {
        Ok(g) => g,
        Err(poisoned) => poisoned.into_inner(),
    };
    let want = WANT_DIMMED.load(Ordering::SeqCst);
    match (want, *dimmed) {
        (true, None) => {
            let Some(current) = platform::read_default_output() else {
                return;
            };
            if current.muted || current.scalar <= SCALAR_EPSILON {
                return;
            }
            if platform::set_device_mute(current.device, true) {
                if platform::read_device_volume(current.device).is_some_and(|now| now.muted) {
                    *dimmed = Some(Dimmed {
                        device: current.device,
                        original: current.scalar,
                        dimmed_to: current.scalar,
                        pending_undo: false,
                        via_mute: true,
                    });
                    eprintln!("[clips-tray] dictation dim: output muted (device {})", current.device);
                    return;
                }
                // The write was accepted but the device does not read back as
                // muted: undo it and lower the volume instead. When the undo
                // fails too, keep the mute on record so the end of dictation
                // (or app quit) retries the unmute instead of forgetting it.
                if !platform::set_device_mute(current.device, false) {
                    *dimmed = Some(Dimmed {
                        device: current.device,
                        original: current.scalar,
                        dimmed_to: current.scalar,
                        pending_undo: false,
                        via_mute: true,
                    });
                    eprintln!(
                        "[clips-tray] dictation dim: mute did not read back and could not be undone on device {}; retrying the unmute when dictation ends",
                        current.device
                    );
                    return;
                }
            }
            let Some(target) = dim_target(current) else {
                return;
            };
            if platform::set_device_volume(current.device, target) {
                // Remember what the device actually holds now (it may snap
                // the scalar to its own steps), so the restore check below
                // can compare exactly.
                let Some(dimmed_to) =
                    platform::read_device_volume(current.device).map(|now| now.scalar)
                else {
                    // Without an observed value there is no safe way to tell
                    // a later user change from device rounding, so skip the
                    // dim for this dictation instead of guessing.
                    if platform::set_device_volume(current.device, current.scalar) {
                        eprintln!(
                            "[clips-tray] dictation dim: could not read the volume back; put it back and not dimming this dictation"
                        );
                    } else {
                        // Keep a record so the end of dictation or app quit
                        // retries the restore instead of leaving it lowered.
                        *dimmed = Some(Dimmed {
                            device: current.device,
                            original: current.scalar,
                            dimmed_to: target,
                            pending_undo: true,
                            via_mute: false,
                        });
                        eprintln!(
                            "[clips-tray] dictation dim: could not read the volume back or put it back; it stays lowered until the next try"
                        );
                    }
                    return;
                };
                *dimmed = Some(Dimmed {
                    device: current.device,
                    original: current.scalar,
                    dimmed_to,
                    pending_undo: false,
                    via_mute: false,
                });
                eprintln!(
                    "[clips-tray] dictation dim: output volume {:.3} -> {dimmed_to:.3} (device {})",
                    current.scalar, current.device
                );
            } else {
                eprintln!(
                    "[clips-tray] dictation dim: could not lower the output volume; system audio stays at its current level during this dictation"
                );
            }
        }
        (false, Some(state)) if state.via_mute => {
            match platform::read_device_volume(state.device) {
                // The read failed: the device may be gone, or the read hit a
                // transient error. Try the unmute anyway. The record is only
                // dropped once the unmute lands or the device is confirmed
                // gone (missing from the system's device list); otherwise the
                // next dictation edge or app quit retries.
                None => {
                    if platform::set_device_mute(state.device, false) {
                        *dimmed = None;
                        eprintln!("[clips-tray] dictation dim: output unmuted (device {})", state.device);
                    } else if platform::device_exists(state.device) == Some(false) {
                        *dimmed = None;
                        eprintln!(
                            "[clips-tray] dictation dim: muted output device {} is gone, nothing to restore",
                            state.device
                        );
                    } else {
                        eprintln!(
                            "[clips-tray] dictation dim: could not unmute device {}; it stays muted until the next try",
                            state.device
                        );
                    }
                }
                Some(now) if !now.muted => {
                    *dimmed = None;
                    eprintln!(
                        "[clips-tray] dictation dim: output was unmuted during dictation, leaving it"
                    );
                }
                Some(_) => {
                    if platform::set_device_mute(state.device, false) {
                        *dimmed = None;
                        eprintln!("[clips-tray] dictation dim: output unmuted");
                    } else {
                        eprintln!(
                            "[clips-tray] dictation dim: could not unmute device {}; it stays muted until the next try",
                            state.device
                        );
                    }
                }
            }
        }
        (false, Some(state)) => {
            let current = platform::read_device_volume(state.device);
            if !should_restore(state, current) {
                *dimmed = None;
                eprintln!(
                    "[clips-tray] dictation dim: volume changed during dictation, leaving it"
                );
                return;
            }
            if platform::set_device_volume(state.device, state.original) {
                *dimmed = None;
                eprintln!(
                    "[clips-tray] dictation dim: output volume restored to {:.3}",
                    state.original
                );
            } else if current.is_none() {
                // The device is gone (unplugged headphones): nothing left to
                // restore, and retrying forever would only spam the log.
                *dimmed = None;
                eprintln!(
                    "[clips-tray] dictation dim: dimmed output device is gone, nothing to restore"
                );
            } else {
                // Keep the saved volume so the next dictation edge or app
                // quit can try the restore again.
                eprintln!(
                    "[clips-tray] dictation dim: could not restore the output volume; it stays lowered until the next try"
                );
            }
        }
        _ => {}
    }
}

/// The scalar to dim to, or `None` when there is nothing to dim (muted, or
/// already silent).
pub(crate) fn dim_target(current: OutputVolume) -> Option<f32> {
    if current.muted || current.scalar <= SCALAR_EPSILON {
        return None;
    }
    Some(current.scalar / 5.0)
}

fn should_restore(state: Dimmed, current: Option<OutputVolume>) -> bool {
    if state.pending_undo {
        return true;
    }
    match current {
        Some(now) => (now.scalar - state.dimmed_to).abs() <= SCALAR_EPSILON,
        // Could not read it: try the restore rather than leave the Mac quiet.
        None => true,
    }
}

#[cfg(target_os = "macos")]
mod platform {
    //! Direct Core Audio calls on the default output device. An `osascript`
    //! round trip took ~0.5 s, long enough for the music to talk over the
    //! first words; these return in well under a millisecond.
    use super::OutputVolume;
    use std::ffi::c_void;

    #[repr(C)]
    struct PropertyAddress {
        selector: u32,
        scope: u32,
        element: u32,
    }

    const fn fourcc(code: &[u8; 4]) -> u32 {
        u32::from_be_bytes(*code)
    }

    const SYSTEM_OBJECT: u32 = 1;
    const SCOPE_GLOBAL: u32 = fourcc(b"glob");
    const SCOPE_OUTPUT: u32 = fourcc(b"outp");
    const ELEMENT_MAIN: u32 = 0;
    const DEFAULT_OUTPUT_DEVICE: u32 = fourcc(b"dOut");
    const DEVICE_MUTE: u32 = fourcc(b"mute");
    // kAudioHardwarePropertyDevices.
    const HARDWARE_DEVICES: u32 = fourcc(b"dev#");
    // kAudioHardwareServiceDeviceProperty_VirtualMainVolume: the same volume
    // the menu bar slider and the volume keys move, on any channel layout.
    const VIRTUAL_MAIN_VOLUME: u32 = fourcc(b"vmvc");

    #[link(name = "CoreAudio", kind = "framework")]
    extern "C" {
        fn AudioObjectGetPropertyData(
            object: u32,
            address: *const PropertyAddress,
            qualifier_size: u32,
            qualifier: *const c_void,
            data_size: *mut u32,
            data: *mut c_void,
        ) -> i32;
        fn AudioObjectGetPropertyDataSize(
            object: u32,
            address: *const PropertyAddress,
            qualifier_size: u32,
            qualifier: *const c_void,
            data_size: *mut u32,
        ) -> i32;
        fn AudioObjectSetPropertyData(
            object: u32,
            address: *const PropertyAddress,
            qualifier_size: u32,
            qualifier: *const c_void,
            data_size: u32,
            data: *const c_void,
        ) -> i32;
    }

    #[link(name = "AudioToolbox", kind = "framework")]
    extern "C" {
        fn AudioHardwareServiceGetPropertyData(
            object: u32,
            address: *const PropertyAddress,
            qualifier_size: u32,
            qualifier: *const c_void,
            data_size: *mut u32,
            data: *mut c_void,
        ) -> i32;
        fn AudioHardwareServiceSetPropertyData(
            object: u32,
            address: *const PropertyAddress,
            qualifier_size: u32,
            qualifier: *const c_void,
            data_size: u32,
            data: *const c_void,
        ) -> i32;
    }

    fn default_output_device() -> Option<u32> {
        let address = PropertyAddress {
            selector: DEFAULT_OUTPUT_DEVICE,
            scope: SCOPE_GLOBAL,
            element: ELEMENT_MAIN,
        };
        let mut device: u32 = 0;
        let mut size = std::mem::size_of::<u32>() as u32;
        let status = unsafe {
            AudioObjectGetPropertyData(
                SYSTEM_OBJECT,
                &address,
                0,
                std::ptr::null(),
                &mut size,
                (&mut device as *mut u32).cast(),
            )
        };
        (status == 0 && device != 0).then_some(device)
    }

    fn volume_address() -> PropertyAddress {
        PropertyAddress {
            selector: VIRTUAL_MAIN_VOLUME,
            scope: SCOPE_OUTPUT,
            element: ELEMENT_MAIN,
        }
    }

    fn is_muted(device: u32) -> bool {
        let address = PropertyAddress {
            selector: DEVICE_MUTE,
            scope: SCOPE_OUTPUT,
            element: ELEMENT_MAIN,
        };
        let mut muted: u32 = 0;
        let mut size = std::mem::size_of::<u32>() as u32;
        let status = unsafe {
            AudioObjectGetPropertyData(
                device,
                &address,
                0,
                std::ptr::null(),
                &mut size,
                (&mut muted as *mut u32).cast(),
            )
        };
        status == 0 && muted != 0
    }

    /// The default output device's volume. `None` when there is no output
    /// device or it has no volume control (some HDMI and USB outputs).
    pub fn read_default_output() -> Option<OutputVolume> {
        read_device_volume(default_output_device()?)
    }

    pub fn read_device_volume(device: u32) -> Option<OutputVolume> {
        let mut scalar: f32 = 0.0;
        let mut size = std::mem::size_of::<f32>() as u32;
        let status = unsafe {
            AudioHardwareServiceGetPropertyData(
                device,
                &volume_address(),
                0,
                std::ptr::null(),
                &mut size,
                (&mut scalar as *mut f32).cast(),
            )
        };
        if status != 0 || !scalar.is_finite() {
            return None;
        }
        Some(OutputVolume {
            device,
            scalar: scalar.clamp(0.0, 1.0),
            muted: is_muted(device),
        })
    }

    /// Whether the device still exists, from the system's list of audio
    /// devices: an unplugged device drops out of that list, while a property
    /// read on the device itself can also fail for a transient reason. `None`
    /// when the list itself could not be read.
    pub fn device_exists(device: u32) -> Option<bool> {
        let address = PropertyAddress {
            selector: HARDWARE_DEVICES,
            scope: SCOPE_GLOBAL,
            element: ELEMENT_MAIN,
        };
        let mut size: u32 = 0;
        let status = unsafe {
            AudioObjectGetPropertyDataSize(SYSTEM_OBJECT, &address, 0, std::ptr::null(), &mut size)
        };
        if status != 0 {
            return None;
        }
        let mut ids = vec![0u32; size as usize / std::mem::size_of::<u32>()];
        let status = unsafe {
            AudioObjectGetPropertyData(
                SYSTEM_OBJECT,
                &address,
                0,
                std::ptr::null(),
                &mut size,
                ids.as_mut_ptr().cast(),
            )
        };
        if status != 0 {
            return None;
        }
        ids.truncate(size as usize / std::mem::size_of::<u32>());
        Some(ids.contains(&device))
    }

    /// Mute or unmute the device's main output. False when the device has no
    /// mute control or refused the write.
    pub fn set_device_mute(device: u32, muted: bool) -> bool {
        let address = PropertyAddress {
            selector: DEVICE_MUTE,
            scope: SCOPE_OUTPUT,
            element: ELEMENT_MAIN,
        };
        let value: u32 = u32::from(muted);
        let status = unsafe {
            AudioObjectSetPropertyData(
                device,
                &address,
                0,
                std::ptr::null(),
                std::mem::size_of::<u32>() as u32,
                (&value as *const u32).cast(),
            )
        };
        status == 0
    }

    pub fn set_device_volume(device: u32, scalar: f32) -> bool {
        let scalar = scalar.clamp(0.0, 1.0);
        let status = unsafe {
            AudioHardwareServiceSetPropertyData(
                device,
                &volume_address(),
                0,
                std::ptr::null(),
                std::mem::size_of::<f32>() as u32,
                (&scalar as *const f32).cast(),
            )
        };
        status == 0
    }
}

#[cfg(not(target_os = "macos"))]
mod platform {
    use super::OutputVolume;

    pub fn read_default_output() -> Option<OutputVolume> {
        None
    }

    pub fn read_device_volume(_device: u32) -> Option<OutputVolume> {
        None
    }

    pub fn set_device_volume(_device: u32, _scalar: f32) -> bool {
        false
    }

    pub fn set_device_mute(_device: u32, _muted: bool) -> bool {
        false
    }

    pub fn device_exists(_device: u32) -> Option<bool> {
        Some(false)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn out(scalar: f32, muted: bool) -> OutputVolume {
        OutputVolume {
            device: 7,
            scalar,
            muted,
        }
    }

    #[test]
    fn dims_to_a_fifth_and_skips_muted_or_silent_output() {
        assert_eq!(dim_target(out(0.5, false)), Some(0.1));
        assert_eq!(dim_target(out(1.0, false)), Some(0.2));
        assert_eq!(dim_target(out(0.8125, false)), Some(0.1625));
        assert_eq!(dim_target(out(0.0, false)), None);
        assert_eq!(dim_target(out(0.6, true)), None);
    }

    #[test]
    fn restores_only_when_the_user_did_not_change_the_volume() {
        let state = Dimmed {
            device: 7,
            original: 0.8125,
            dimmed_to: 0.1625,
            pending_undo: false,
            via_mute: false,
        };
        assert!(should_restore(state, Some(out(0.1625, false))));
        assert!(should_restore(state, Some(out(0.16255, false))), "float noise");
        assert!(
            !should_restore(state, Some(out(0.1625 + 0.0625, false))),
            "one volume-key step up"
        );
        assert!(
            !should_restore(state, Some(out(0.1625 + 0.015625, false))),
            "one fine Option+Shift step up"
        );
        assert!(!should_restore(state, Some(out(0.0, false))), "user turned it off");
        assert!(should_restore(state, None));
    }

    #[test]
    fn a_failed_undo_always_restores() {
        let state = Dimmed {
            device: 7,
            original: 0.8125,
            dimmed_to: 0.1625,
            pending_undo: true,
            via_mute: false,
        };
        assert!(should_restore(state, Some(out(0.5, false))));
        assert!(should_restore(state, None));
    }
}
