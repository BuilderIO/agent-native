//! The box that shows where a step's click landed.
//!
//! Each uploaded step gets one red box around the click, saved the way the
//! screenshot editor saves a box: the unmarked capture stays the base, the
//! box is stored as a movable annotation, and the served picture has it drawn
//! in. Opening the step in the editor shows the box as an ordinary mark, so it
//! can be moved, recoloured or deleted like one drawn by hand.
//!
//! Sizes follow `app/lib/screenshot-annotations.ts` (`annotationLineWidth`,
//! a thick box in the first palette colour) so the drawn box matches what the
//! editor redraws on its next save. Both must change together.

use std::io::Cursor;

use super::StepCaptureStep;

/// `MARK_COLORS[0]` in `app/lib/tokens/screenshot-colors.ts`.
const MARK_COLOR_HEX: &str = "#ef4444";
const MARK_COLOR_RGB: [u8; 3] = [0xef, 0x44, 0x44];

/// Image pixels, origin top-left.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ClickMarker {
    pub x: u32,
    pub y: u32,
    pub width: u32,
    pub height: u32,
}

fn longest_edge(width: u32, height: u32) -> u32 {
    width.max(height)
}

/// `annotationLineWidth` doubled, as the editor does for a thick box.
pub fn marker_line_width(width: u32, height: u32) -> u32 {
    let thin = ((longest_edge(width, height) as f64) / 420.0).round() as u32;
    thin.max(2) * 2
}

/// The box side: big enough to frame an ordinary control on a Retina
/// display (about 84 points at 2x), never tiny on a small capture.
fn marker_side(width: u32, height: u32) -> u32 {
    (((longest_edge(width, height) as f64) / 18.0).round() as u32).max(40)
}

/// Where the click landed in the step's own image, or `None` when the
/// display is unknown or the point falls outside the picture. A drag is
/// marked where it started.
pub fn click_marker(step: &StepCaptureStep, width: u32, height: u32) -> Option<ClickMarker> {
    let display = step.display.as_ref()?;
    if width == 0 || height == 0 || !(display.scale.is_finite() && display.scale > 0.0) {
        return None;
    }
    let x = (step.location.x - display.frame.x) * display.scale;
    let y = (step.location.y - display.frame.y) * display.scale;
    if !(x.is_finite() && y.is_finite()) || x < 0.0 || y < 0.0 {
        return None;
    }
    let (x, y) = (x.floor() as u32, y.floor() as u32);
    if x >= width || y >= height {
        return None;
    }
    let side = marker_side(width, height).min(width).min(height);
    let half = side / 2;
    // Kept whole inside the picture, so a click on the edge still gets a
    // full box rather than one cut in half.
    let left = x.saturating_sub(half).min(width - side);
    let top = y.saturating_sub(half).min(height - side);
    Some(ClickMarker {
        x: left,
        y: top,
        width: side,
        height: side,
    })
}

/// The box as a `BoxAnnotation` in `app/lib/screenshot-annotations.ts`.
pub fn marker_annotation(marker: &ClickMarker) -> serde_json::Value {
    serde_json::json!({
        "kind": "box",
        "id": "step-click",
        "x": marker.x,
        "y": marker.y,
        "width": marker.width,
        "height": marker.height,
        "color": MARK_COLOR_HEX,
        "thickness": "thick",
    })
}

/// Whether pixel `(px, py)` is under a `strokeRect` of `marker` with round
/// joins: within half the line of an edge, with the outer corners rounded.
fn in_stroke(marker: &ClickMarker, line_width: u32, px: u32, py: u32) -> bool {
    let half = line_width as f64 / 2.0;
    // Pixel centres, against the rectangle's edges in canvas coordinates.
    let (cx, cy) = (px as f64 + 0.5, py as f64 + 0.5);
    let (left, top) = (marker.x as f64, marker.y as f64);
    let (right, bottom) = (left + marker.width as f64, top + marker.height as f64);
    let within_x = cx >= left - half && cx <= right + half;
    let within_y = cy >= top - half && cy <= bottom + half;
    if !(within_x && within_y) {
        return false;
    }
    let inside = cx > left + half && cx < right - half && cy > top + half && cy < bottom - half;
    if inside {
        return false;
    }
    // Beyond a corner on both axes: inside only within the round join.
    let corner_x = if cx < left { Some(left) } else if cx > right { Some(right) } else { None };
    let corner_y = if cy < top { Some(top) } else if cy > bottom { Some(bottom) } else { None };
    match (corner_x, corner_y) {
        (Some(x), Some(y)) => (cx - x).powi(2) + (cy - y).powi(2) <= half * half,
        _ => true,
    }
}

/// Paint the box into packed 8-bit pixels with `channels` per pixel (3 or 4).
pub fn draw_marker(
    pixels: &mut [u8],
    width: u32,
    height: u32,
    channels: usize,
    marker: &ClickMarker,
) {
    let line_width = marker_line_width(width, height);
    let reach = line_width / 2 + 1;
    let x0 = marker.x.saturating_sub(reach);
    let y0 = marker.y.saturating_sub(reach);
    let x1 = (marker.x + marker.width + reach).min(width);
    let y1 = (marker.y + marker.height + reach).min(height);
    for py in y0..y1 {
        for px in x0..x1 {
            if !in_stroke(marker, line_width, px, py) {
                continue;
            }
            let offset = (py as usize * width as usize + px as usize) * channels;
            if let Some(pixel) = pixels.get_mut(offset..offset + 3) {
                pixel.copy_from_slice(&MARK_COLOR_RGB);
            }
            if channels == 4 {
                if let Some(alpha) = pixels.get_mut(offset + 3) {
                    *alpha = 255;
                }
            }
        }
    }
}

/// The step's PNG with the box drawn in, keeping its colour profile.
pub fn mark_png(png_bytes: &[u8], marker: &ClickMarker) -> Result<Vec<u8>, String> {
    let mut decoder = png::Decoder::new(Cursor::new(png_bytes));
    decoder.set_transformations(png::Transformations::EXPAND | png::Transformations::STRIP_16);
    let mut reader = decoder
        .read_info()
        .map_err(|error| format!("could not read the step image: {error}"))?;
    let size = reader
        .output_buffer_size()
        .ok_or_else(|| "the step image is too large to mark".to_string())?;
    let mut pixels = vec![0; size];
    let frame = reader
        .next_frame(&mut pixels)
        .map_err(|error| format!("could not decode the step image: {error}"))?;
    let channels = match frame.color_type {
        png::ColorType::Rgb => 3,
        png::ColorType::Rgba => 4,
        other => return Err(format!("unsupported step image colour type {other:?}")),
    };
    pixels.truncate(frame.buffer_size());
    draw_marker(&mut pixels, frame.width, frame.height, channels, marker);

    let source = reader.info();
    let mut info = png::Info::with_size(frame.width, frame.height);
    info.color_type = frame.color_type;
    info.bit_depth = png::BitDepth::Eight;
    info.icc_profile = source.icc_profile.clone();
    info.srgb = source.srgb;
    let mut out = Vec::with_capacity(png_bytes.len());
    let encoder = png::Encoder::with_info(&mut out, info)
        .map_err(|error| format!("could not encode the marked image: {error}"))?;
    let mut writer = encoder
        .write_header()
        .map_err(|error| format!("could not encode the marked image: {error}"))?;
    writer
        .write_image_data(&pixels)
        .map_err(|error| format!("could not encode the marked image: {error}"))?;
    writer
        .finish()
        .map_err(|error| format!("could not encode the marked image: {error}"))?;
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::step_capture::{
        StepClickType, StepDisplay, StepImage, StepPoint, StepRect, StepTarget,
        StepTargetUnavailableReason, StepWindow,
    };

    fn step(location: StepPoint, display: Option<StepDisplay>) -> StepCaptureStep {
        StepCaptureStep {
            step: 1,
            captured_at: "2026-10-18T09:00:00.000Z".to_string(),
            click_type: StepClickType::Left,
            location,
            drag_to: None,
            display,
            image: StepImage::Captured {
                file_name: "step-001.png".to_string(),
                width: 3024,
                height: 1964,
            },
            window: StepWindow::None,
            target: StepTarget::Unavailable {
                reason: StepTargetUnavailableReason::NoElement,
                code: None,
            },
        }
    }

    fn display(x: f64, y: f64, scale: f64) -> Option<StepDisplay> {
        Some(StepDisplay {
            id: 1,
            frame: StepRect {
                x,
                y,
                width: 1512.0,
                height: 982.0,
            },
            scale,
        })
    }

    #[test]
    fn marks_the_click_in_image_pixels_on_a_retina_display() {
        let marker = click_marker(
            &step(StepPoint { x: 700.0, y: 400.0 }, display(0.0, 0.0, 2.0)),
            3024,
            1964,
        )
        .unwrap();
        // 3024 / 18 = 168px, centred on (1400, 800).
        assert_eq!(
            marker,
            ClickMarker {
                x: 1316,
                y: 716,
                width: 168,
                height: 168
            }
        );
        assert_eq!(marker_line_width(3024, 1964), 14);
    }

    #[test]
    fn measures_from_the_clicked_display_not_the_primary_one() {
        let marker = click_marker(
            &step(StepPoint { x: -1000.0, y: 120.0 }, display(-1512.0, 100.0, 1.0)),
            1512,
            982,
        )
        .unwrap();
        assert_eq!((marker.x + marker.width / 2, marker.y), (512, 0));
    }

    #[test]
    fn keeps_a_click_on_the_edge_inside_the_picture() {
        let marker = click_marker(
            &step(StepPoint { x: 1511.0, y: 981.0 }, display(0.0, 0.0, 1.0)),
            1512,
            982,
        )
        .unwrap();
        assert_eq!(marker.x + marker.width, 1512);
        assert_eq!(marker.y + marker.height, 982);
    }

    #[test]
    fn leaves_a_step_unmarked_when_the_click_cannot_be_placed() {
        let location = StepPoint { x: 10.0, y: 10.0 };
        assert_eq!(click_marker(&step(location, None), 100, 100), None);
        assert_eq!(
            click_marker(&step(location, display(50.0, 50.0, 1.0)), 100, 100),
            None
        );
        assert_eq!(
            click_marker(&step(StepPoint { x: 500.0, y: 10.0 }, display(0.0, 0.0, 1.0)), 100, 100),
            None
        );
    }

    #[test]
    fn annotation_matches_the_editor_box_format() {
        let annotation = marker_annotation(&ClickMarker {
            x: 1,
            y: 2,
            width: 3,
            height: 4,
        });
        assert_eq!(annotation["kind"], "box");
        assert_eq!(annotation["color"], "#ef4444");
        assert_eq!(annotation["thickness"], "thick");
        assert_eq!(annotation["width"], 3);
    }

    #[test]
    fn draws_only_the_outline_with_rounded_outer_corners() {
        let (width, height) = (200, 200);
        let marker = ClickMarker {
            x: 50,
            y: 50,
            width: 100,
            height: 100,
        };
        let mut pixels = vec![0u8; width as usize * height as usize * 4];
        draw_marker(&mut pixels, width, height, 4, &marker);
        let at = |x: usize, y: usize| {
            let offset = (y * width as usize + x) * 4;
            pixels[offset..offset + 4].to_vec()
        };
        let red = vec![0xef, 0x44, 0x44, 255];
        // The line is 4px (thin 2px, doubled), centred on each edge.
        assert_eq!(at(50, 100), red);
        assert_eq!(at(48, 100), red);
        assert_eq!(at(51, 100), red);
        assert_eq!(at(47, 100), vec![0, 0, 0, 0]);
        assert_eq!(at(52, 100), vec![0, 0, 0, 0]);
        // Inside stays untouched.
        assert_eq!(at(100, 100), vec![0, 0, 0, 0]);
        // The very corner of the stroke's square is cut off by the round join.
        assert_eq!(at(48, 48), vec![0, 0, 0, 0]);
        assert_eq!(at(49, 49), red);
    }

    #[test]
    fn marks_a_png_and_keeps_its_size() {
        let (width, height) = (64u32, 48u32);
        let mut source = Vec::new();
        {
            let mut encoder = png::Encoder::new(&mut source, width, height);
            encoder.set_color(png::ColorType::Rgba);
            encoder.set_depth(png::BitDepth::Eight);
            let mut writer = encoder.write_header().unwrap();
            writer
                .write_image_data(&vec![255; (width * height * 4) as usize])
                .unwrap();
        }
        let marker = ClickMarker {
            x: 10,
            y: 10,
            width: 40,
            height: 30,
        };
        let marked = mark_png(&source, &marker).unwrap();
        let mut reader = png::Decoder::new(Cursor::new(&marked)).read_info().unwrap();
        let mut pixels = vec![0; reader.output_buffer_size().unwrap()];
        let frame = reader.next_frame(&mut pixels).unwrap();
        assert_eq!((frame.width, frame.height), (width, height));
        let offset = ((20 * width + 10) * 4) as usize;
        assert_eq!(&pixels[offset..offset + 4], &[0xef, 0x44, 0x44, 255]);
        let inside = ((25 * width + 30) * 4) as usize;
        assert_eq!(&pixels[inside..inside + 4], &[255, 255, 255, 255]);
    }
}
