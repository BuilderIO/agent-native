use std::sync::atomic::Ordering;

const AUDIO_OUTPUT_SAMPLE_RATE: u32 = 48_000;

fn bytes_to_f32_vec(bytes: &[u8]) -> Vec<f32> {
    bytes
        .chunks_exact(4)
        .map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]]))
        .collect()
}

const K_AUDIO_FLAG_IS_FLOAT: u32 = 1 << 0;
const K_AUDIO_FLAG_IS_SIGNED_INT: u32 = 1 << 2;

fn source_asbd(
    sample: &screencapturekit::cm::CMSampleBuffer,
) -> Option<AudioStreamBasicDescription> {
    let format = sample.format_description()?;
    let asbd = unsafe { CMAudioFormatDescriptionGetStreamBasicDescription(format.as_ptr()) };
    if asbd.is_null() {
        return None;
    }
    Some(unsafe { std::ptr::read(asbd) })
}

fn decode_samples_to_f32(bytes: &[u8], is_float: bool, bits: u32) -> Vec<f32> {
    match (is_float, bits) {
        (true, 32) => bytes_to_f32_vec(bytes),
        (true, 64) => bytes
            .chunks_exact(8)
            .map(|c| f64::from_le_bytes(c.try_into().unwrap()) as f32)
            .collect(),
        (false, 16) => bytes
            .chunks_exact(2)
            .map(|c| i16::from_le_bytes([c[0], c[1]]) as f32 / 32768.0)
            .collect(),
        (false, 24) => bytes
            .chunks_exact(3)
            .map(|c| {
                let raw = (c[0] as i32) | ((c[1] as i32) << 8) | ((c[2] as i32) << 16);
                let signed = if raw & 0x800000 != 0 {
                    raw | !0x00FF_FFFFi32
                } else {
                    raw
                };
                signed as f32 / 8_388_608.0
            })
            .collect(),
        (false, 32) => bytes
            .chunks_exact(4)
            .map(|c| i32::from_le_bytes(c.try_into().unwrap()) as f32 / 2_147_483_648.0)
            .collect(),
        _ => bytes_to_f32_vec(bytes),
    }
}

fn resample_interleaved_stereo(input: &[f32], src_rate: f64, dst_rate: f64) -> Vec<f32> {
    let in_frames = input.len() / 2;
    if in_frames == 0 || src_rate <= 0.0 || dst_rate <= 0.0 || (src_rate - dst_rate).abs() < 1.0 {
        return input.to_vec();
    }
    let ratio = dst_rate / src_rate;
    let out_frames = ((in_frames as f64) * ratio).round() as usize;
    if out_frames == 0 {
        return Vec::new();
    }
    let mut out = vec![0.0_f32; out_frames * 2];
    let step = src_rate / dst_rate;
    for f in 0..out_frames {
        let pos = f as f64 * step;
        let i = pos.floor() as usize;
        let frac = (pos - i as f64) as f32;
        let i1 = (i + 1).min(in_frames - 1);
        for ch in 0..2 {
            let a = input[i * 2 + ch];
            let b = input[i1 * 2 + ch];
            out[f * 2 + ch] = a + (b - a) * frac;
        }
    }
    out
}

pub(crate) fn extract_interleaved_stereo(
    sample: &screencapturekit::cm::CMSampleBuffer,
    label: &str,
) -> Option<(Vec<f32>, f64)> {
    let frames = sample.num_samples();
    if frames == 0 {
        return None;
    }
    let timing = sample.sample_timing_info(0).ok()?;
    let pts_seconds = timing.presentation_time_stamp.as_seconds()?;
    let abl = sample.audio_buffer_list()?;
    let num_buffers = abl.num_buffers();
    if num_buffers == 0 {
        return None;
    }

    let asbd = source_asbd(sample);
    let (is_float, bits, src_rate) = match asbd {
        Some(a) => {
            let is_float = a.format_flags & K_AUDIO_FLAG_IS_FLOAT != 0
                || a.format_flags & K_AUDIO_FLAG_IS_SIGNED_INT == 0;
            (is_float, a.bits_per_channel, a.sample_rate)
        }
        None => (true, 32, AUDIO_OUTPUT_SAMPLE_RATE as f64),
    };

    log_audio_format_once(label, &asbd, num_buffers, &abl, frames);

    let mut out = vec![0.0_f32; frames * 2];
    if num_buffers >= 2 {
        let left = decode_samples_to_f32(abl.get(0)?.data(), is_float, bits);
        let right = decode_samples_to_f32(abl.get(1)?.data(), is_float, bits);
        let n = frames.min(left.len()).min(right.len());
        for i in 0..n {
            out[i * 2] = left[i];
            out[i * 2 + 1] = right[i];
        }
    } else {
        let buf = abl.get(0)?;
        let channels = buf.number_channels.max(1) as usize;
        let decoded = decode_samples_to_f32(buf.data(), is_float, bits);
        if channels >= 2 {
            let n = frames.min(decoded.len() / channels);
            for i in 0..n {
                out[i * 2] = decoded[i * channels];
                out[i * 2 + 1] = decoded[i * channels + 1];
            }
        } else {
            let n = frames.min(decoded.len());
            for i in 0..n {
                out[i * 2] = decoded[i];
                out[i * 2 + 1] = decoded[i];
            }
        }
    }

    out = resample_interleaved_stereo(&out, src_rate, AUDIO_OUTPUT_SAMPLE_RATE as f64);
    log_decoded_audio_signal_once(label, &out);
    Some((out, pts_seconds))
}

pub(crate) fn extract_mono_audio(
    sample: &screencapturekit::cm::CMSampleBuffer,
    label: &str,
) -> Option<Vec<f32>> {
    let (interleaved, _) = extract_interleaved_stereo(sample, label)?;
    Some(
        interleaved
            .chunks_exact(2)
            .map(|channels| (channels[0] + channels[1]) * 0.5)
            .collect(),
    )
}

fn log_decoded_audio_signal_once(label: &str, samples: &[f32]) {
    use std::sync::atomic::AtomicBool;
    static SYS_SIGNAL_LOGGED: AtomicBool = AtomicBool::new(false);
    static MIC_SIGNAL_LOGGED: AtomicBool = AtomicBool::new(false);
    let peak = samples
        .iter()
        .copied()
        .map(f32::abs)
        .fold(0.0_f32, f32::max);
    if peak <= 0.000_01 {
        return;
    }
    let flag = if label.contains("mic") {
        &MIC_SIGNAL_LOGGED
    } else {
        &SYS_SIGNAL_LOGGED
    };
    if flag.swap(true, Ordering::SeqCst) {
        return;
    }
    let rms = if samples.is_empty() {
        0.0
    } else {
        (samples
            .iter()
            .map(|sample| (*sample as f64) * (*sample as f64))
            .sum::<f64>()
            / samples.len() as f64)
            .sqrt()
    };
    crate::logfile::diagnostic(&format!(
        "[capture-health] decoded {label} PCM: samples={} peak={peak:.6} rms={rms:.6}",
        samples.len()
    ));
}

fn log_audio_format_once(
    label: &str,
    asbd: &Option<AudioStreamBasicDescription>,
    num_buffers: usize,
    abl: &screencapturekit::cm::AudioBufferList,
    frames: usize,
) {
    use std::sync::atomic::AtomicBool;
    static SYS_LOGGED: AtomicBool = AtomicBool::new(false);
    static MIC_LOGGED: AtomicBool = AtomicBool::new(false);
    let flag = if label == "mic" {
        &MIC_LOGGED
    } else {
        &SYS_LOGGED
    };
    if flag.swap(true, Ordering::SeqCst) {
        return;
    }
    let ch0 = abl.get(0).map(|b| (b.number_channels, b.data_byte_size()));
    let ch1 = abl.get(1).map(|b| (b.number_channels, b.data_byte_size()));
    eprintln!(
        "[mixer] {label} format: asbd={asbd:?} num_buffers={num_buffers} frames={frames} buf0={ch0:?} buf1={ch1:?}"
    );
}

#[repr(C)]
#[derive(Copy, Clone, Debug)]
pub(crate) struct AudioStreamBasicDescription {
    pub(crate) sample_rate: f64,
    pub(crate) format_id: u32,
    pub(crate) format_flags: u32,
    pub(crate) bytes_per_packet: u32,
    pub(crate) frames_per_packet: u32,
    pub(crate) bytes_per_frame: u32,
    pub(crate) channels_per_frame: u32,
    pub(crate) bits_per_channel: u32,
    pub(crate) reserved: u32,
}

#[link(name = "CoreMedia", kind = "framework")]
extern "C" {
    fn CMAudioFormatDescriptionGetStreamBasicDescription(
        format_description: *mut std::ffi::c_void,
    ) -> *const AudioStreamBasicDescription;
}
