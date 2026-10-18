//! The step guide as a PDF, laid out like Snagit 2026's step document.
//!
//! Letter pages, 612 by 792 points. The first page carries the title and the
//! byline; every step is a numbered instruction above its zoomed screenshot,
//! and a step never splits across pages. The geometry below was measured
//! from a Snagit export so the two documents read the same.

use std::io::Cursor;
use std::path::Path;

use super::guide::{
    visible_rect, GuideImage, GuideItem, PxRect, StepGuide, FRAME_HEIGHT, FRAME_WIDTH,
};

pub const PAGE_WIDTH: f64 = 612.0;
pub const PAGE_HEIGHT: f64 = 792.0;
/// The first page's header: title and byline.
const HEADER_HEIGHT: f64 = 96.0;
/// The top margin of every page after the first.
const PAGE_TOP: f64 = 48.0;
const PAGE_BOTTOM: f64 = 24.0;
/// A step with a screenshot: instruction, frame and the gap after it.
const STEP_HEIGHT: f64 = 348.0;
/// The space after an item; it may run past a page's bottom margin.
const ITEM_GAP: f64 = 28.0;
/// A step without a screenshot, and the padding around a note.
const TEXT_STEP_HEIGHT: f64 = 56.0;
const NOTE_PADDING: f64 = 24.0;
const MARGIN_LEFT: f64 = 27.0;
const MARGIN_RIGHT: f64 = 576.5;
const TEXT_LEFT: f64 = 73.3;
const TEXT_WIDTH: f64 = 482.0;
/// The screenshot inside its white border, relative to the step's top.
const IMAGE_LEFT: f64 = 57.0;
const IMAGE_TOP: f64 = 41.5;
const IMAGE_WIDTH: f64 = 498.0;
const BORDER: f64 = 2.0;
const HIGHLIGHT_DIAMETER: f64 = 48.0;
const BADGE_DIAMETER: f64 = 26.5;
const BADGE_CENTER_X: f64 = 45.0;
const BADGE_CENTER_Y: f64 = 19.75;

/// One item placed on a page, `top` in points from the page's top edge.
#[derive(Debug, Clone, PartialEq)]
pub struct Placed {
    pub item: usize,
    /// The step's number, or `None` for a note.
    pub number: Option<usize>,
    pub top: f64,
    pub height: f64,
}

/// Where every item goes: pages of placed items. `note_height` measures a
/// note's wrapped text, so layout stays testable without fonts.
pub fn paginate(guide: &StepGuide, note_height: impl Fn(&str) -> f64) -> Vec<Vec<Placed>> {
    let mut pages: Vec<Vec<Placed>> = vec![Vec::new()];
    let mut top = HEADER_HEIGHT;
    let mut number = 0;
    for (index, item) in guide.items.iter().enumerate() {
        let (height, step_number) = match item {
            GuideItem::Step { image, .. } => {
                number += 1;
                let height = if image.is_some() {
                    STEP_HEIGHT
                } else {
                    TEXT_STEP_HEIGHT
                };
                (height, Some(number))
            }
            GuideItem::Note { text, .. } => (note_height(text) + NOTE_PADDING, None),
        };
        let page_has_items = !pages.last().is_some_and(Vec::is_empty);
        if page_has_items && top + height - ITEM_GAP > PAGE_HEIGHT - PAGE_BOTTOM {
            pages.push(Vec::new());
            top = PAGE_TOP;
        }
        pages.last_mut().expect("a page").push(Placed {
            item: index,
            number: step_number,
            top,
            height,
        });
        top += height;
    }
    pages
}

/// The image rect a step's screenshot fills, in page points.
fn image_rect(top: f64) -> PxRect {
    PxRect {
        x: IMAGE_LEFT,
        y: top + IMAGE_TOP,
        width: IMAGE_WIDTH,
        height: IMAGE_WIDTH * FRAME_HEIGHT / FRAME_WIDTH,
    }
}

/// Points per screenshot pixel in a step's frame.
fn frame_scale(visible: &PxRect) -> f64 {
    IMAGE_WIDTH / visible.width
}

/// Cut the visible part out of a screenshot, keeping its colour profile.
pub fn crop_png(bytes: &[u8], rect: PxRect) -> Result<Vec<u8>, String> {
    let mut decoder = png::Decoder::new(Cursor::new(bytes));
    decoder.set_transformations(png::Transformations::EXPAND | png::Transformations::STRIP_16);
    let mut reader = decoder
        .read_info()
        .map_err(|error| format!("could not read the screenshot: {error}"))?;
    let mut buffer = vec![0; reader.output_buffer_size().unwrap_or(0)];
    let frame = reader
        .next_frame(&mut buffer)
        .map_err(|error| format!("could not decode the screenshot: {error}"))?;
    let channels = match frame.color_type {
        png::ColorType::Rgb => 3,
        png::ColorType::Rgba => 4,
        png::ColorType::Grayscale => 1,
        png::ColorType::GrayscaleAlpha => 2,
        png::ColorType::Indexed => return Err("unexpected indexed screenshot".into()),
    };
    let (width, height) = (frame.width as f64, frame.height as f64);
    let left = rect.x.clamp(0.0, width).round() as usize;
    let top = rect.y.clamp(0.0, height).round() as usize;
    let right = (rect.x + rect.width).clamp(0.0, width).round() as usize;
    let bottom = (rect.y + rect.height).clamp(0.0, height).round() as usize;
    if right <= left || bottom <= top {
        return Err("the visible area is empty".into());
    }
    let stride = frame.line_size;
    let mut pixels = Vec::with_capacity((right - left) * (bottom - top) * channels);
    for row in top..bottom {
        let start = row * stride + left * channels;
        pixels.extend_from_slice(&buffer[start..start + (right - left) * channels]);
    }
    let source = reader.info();
    let mut info = png::Info::with_size((right - left) as u32, (bottom - top) as u32);
    info.color_type = frame.color_type;
    info.bit_depth = png::BitDepth::Eight;
    info.icc_profile = source.icc_profile.clone();
    info.srgb = source.srgb;
    let mut out = Vec::new();
    {
        let encoder = png::Encoder::with_info(&mut out, info)
            .map_err(|error| format!("could not encode the screenshot: {error}"))?;
        let mut writer = encoder
            .write_header()
            .map_err(|error| format!("could not encode the screenshot: {error}"))?;
        writer
            .write_image_data(&pixels)
            .map_err(|error| format!("could not encode the screenshot: {error}"))?;
        writer
            .finish()
            .map_err(|error| format!("could not encode the screenshot: {error}"))?;
    }
    Ok(out)
}

/// A step's screenshot prepared for the page: the cropped picture and where
/// the click, the drag end and the cursor land in page points.
struct PreparedImage {
    png: Vec<u8>,
    rect: PxRect,
    click: (f64, f64),
    drag_to: Option<(f64, f64)>,
    cursor: Option<(Vec<u8>, PxRect)>,
}

fn prepare_image(directory: &Path, image: &GuideImage, top: f64) -> Result<PreparedImage, String> {
    let path = directory.join(&image.file_name);
    let bytes = std::fs::read(&path)
        .map_err(|error| format!("could not read {}: {error}", path.display()))?;
    let visible = visible_rect(image);
    let rect = image_rect(top);
    let scale = frame_scale(&visible);
    let place = |x: f64, y: f64| {
        (
            rect.x + (x - visible.x) * scale,
            rect.y + (y - visible.y) * scale,
        )
    };
    let click = place(image.click.x, image.click.y);
    let cursor = image.cursor.as_ref().and_then(|cursor| {
        let bytes = std::fs::read(directory.join(&cursor.file_name)).ok()?;
        Some((
            bytes,
            PxRect {
                x: click.0 - cursor.hotspot.x * scale,
                y: click.1 - cursor.hotspot.y * scale,
                width: cursor.width * scale,
                height: cursor.height * scale,
            },
        ))
    });
    Ok(PreparedImage {
        png: crop_png(&bytes, visible)?,
        rect,
        click,
        drag_to: image.drag_to.map(|to| place(to.x, to.y)),
        cursor,
    })
}

/// Write the guide to `output` as a PDF.
pub fn export_pdf(directory: &Path, guide: &StepGuide, output: &Path) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        macos::render(directory, guide, output)
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (directory, guide, output);
        Err("PDF export is only available on macOS".into())
    }
}

#[cfg(target_os = "macos")]
mod macos {
    use super::*;
    use objc2::rc::{autoreleasepool, Retained};
    use objc2::runtime::AnyObject;
    use objc2::AnyThread;
    use objc2_app_kit::{
        NSAttributedStringNSExtendedStringDrawing, NSAttributedStringNSStringDrawing, NSBezierPath,
        NSColor, NSCompositingOperation, NSFont, NSFontAttributeName,
        NSForegroundColorAttributeName, NSGraphicsContext, NSImage, NSImageInterpolation,
        NSLineBreakMode, NSMutableParagraphStyle, NSParagraphStyleAttributeName, NSShadow,
        NSStringDrawingOptions,
    };
    use objc2_core_foundation::{CGPoint, CGRect, CGSize, CFURL};
    use objc2_core_graphics::{
        CGContext, CGPDFContextBeginPage, CGPDFContextClose, CGPDFContextCreateWithURL,
        CGPDFContextEndPage,
    };
    use objc2_foundation::{NSAttributedString, NSData, NSDictionary, NSString};

    const TEXT_GRAY: f64 = 0x51 as f64 / 255.0;

    fn rect(x: f64, y: f64, width: f64, height: f64) -> CGRect {
        CGRect::new(CGPoint::new(x, y), CGSize::new(width, height))
    }

    fn color(red: f64, green: f64, blue: f64, alpha: f64) -> Retained<NSColor> {
        NSColor::colorWithSRGBRed_green_blue_alpha(red, green, blue, alpha)
    }

    fn text_color() -> Retained<NSColor> {
        color(TEXT_GRAY, TEXT_GRAY, TEXT_GRAY, 1.0)
    }

    fn font(name: &str, size: f64, bold: bool) -> Retained<NSFont> {
        NSFont::fontWithName_size(&NSString::from_str(name), size).unwrap_or_else(|| {
            if bold {
                NSFont::boldSystemFontOfSize(size)
            } else {
                NSFont::systemFontOfSize(size)
            }
        })
    }

    fn attributed(
        text: &str,
        font: &NSFont,
        color: &NSColor,
        wrap: bool,
    ) -> Retained<NSAttributedString> {
        let style = NSMutableParagraphStyle::new();
        style.setLineBreakMode(if wrap {
            NSLineBreakMode::ByWordWrapping
        } else {
            NSLineBreakMode::ByTruncatingTail
        });
        // SAFETY: the attribute keys are immutable AppKit constants, and the
        // values match the types AppKit expects for them.
        unsafe {
            let keys = [
                NSFontAttributeName,
                NSForegroundColorAttributeName,
                NSParagraphStyleAttributeName,
            ];
            let values: [&AnyObject; 3] = [font.as_ref(), color.as_ref(), style.as_ref()];
            let attributes = NSDictionary::from_slices(&keys, &values);
            NSAttributedString::new_with_attributes(&NSString::from_str(text), &attributes)
        }
    }

    /// Draw text with its first baseline `baseline` points below `top`'s line
    /// origin, wrapping inside `width`; returns the height it used.
    fn draw_text(
        text: &NSAttributedString,
        x: f64,
        baseline: f64,
        width: f64,
        font: &NSFont,
    ) -> f64 {
        let options = NSStringDrawingOptions::UsesLineFragmentOrigin;
        let bounds =
            text.boundingRectWithSize_options_context(CGSize::new(width, 10_000.0), options, None);
        let top = baseline - font.ascender();
        text.drawWithRect_options_context(
            rect(x, top, width, bounds.size.height.ceil()),
            options,
            None,
        );
        bounds.size.height
    }

    fn measure(text: &str, size: f64, width: f64) -> f64 {
        let font = font("Arial", size, false);
        let text = attributed(text, &font, &text_color(), true);
        text.boundingRectWithSize_options_context(
            CGSize::new(width, 10_000.0),
            NSStringDrawingOptions::UsesLineFragmentOrigin,
            None,
        )
        .size
        .height
    }

    fn draw_header(guide: &StepGuide) {
        let title_font = font("Arial-BoldMT", 24.0, true);
        let title = attributed(&guide.title, &title_font, &text_color(), false);
        draw_text(
            &title,
            MARGIN_LEFT,
            37.5,
            MARGIN_RIGHT - MARGIN_LEFT,
            &title_font,
        );
        let meta_font = font("ArialMT", 12.0, false);
        let date = attributed(&guide.date, &meta_font, &text_color(), false);
        let date_width = date.size().width;
        let byline = attributed(&guide.byline(), &meta_font, &text_color(), false);
        draw_text(
            &byline,
            MARGIN_LEFT,
            72.0,
            MARGIN_RIGHT - MARGIN_LEFT - date_width - 16.0,
            &meta_font,
        );
        draw_text(
            &date,
            MARGIN_RIGHT - date_width,
            72.0,
            date_width + 1.0,
            &meta_font,
        );
    }

    fn draw_badge(number: usize, top: f64) {
        let (cx, cy) = (BADGE_CENTER_X, top + BADGE_CENTER_Y);
        let radius = BADGE_DIAMETER / 2.0;
        color(
            0xE1 as f64 / 255.0,
            0x09 as f64 / 255.0,
            0x92 as f64 / 255.0,
            1.0,
        )
        .setFill();
        NSBezierPath::bezierPathWithOvalInRect(rect(
            cx - radius,
            cy - radius,
            BADGE_DIAMETER,
            BADGE_DIAMETER,
        ))
        .fill();
        let digits_font = font("ArialMT", 17.0, false);
        let digits = attributed(
            &number.to_string(),
            &digits_font,
            &NSColor::whiteColor(),
            false,
        );
        let width = digits.size().width;
        // Centre the digits' cap height on the circle.
        let baseline = cy + digits_font.capHeight() / 2.0 + 0.5;
        draw_text(
            &digits,
            cx - width / 2.0,
            baseline,
            width + 1.0,
            &digits_font,
        );
    }

    fn draw_image(image: &PreparedImage) -> Result<(), String> {
        let r = image.rect;
        let outer = rect(
            r.x - BORDER,
            r.y - BORDER,
            r.width + BORDER * 2.0,
            r.height + BORDER * 2.0,
        );
        let radius = 3.0;
        let frame = NSBezierPath::bezierPathWithRoundedRect_xRadius_yRadius(outer, radius, radius);

        NSGraphicsContext::saveGraphicsState_class();
        let shadow = NSShadow::new();
        // Shadow offsets are in device space, which stays unflipped, so a
        // negative height moves the shadow down the page.
        shadow.setShadowOffset(CGSize::new(3.0, -3.5));
        shadow.setShadowBlurRadius(8.0);
        shadow.setShadowColor(Some(&color(0.0, 0.0, 0.0, 0.17)));
        shadow.set();
        NSColor::whiteColor().setFill();
        frame.fill();
        NSGraphicsContext::restoreGraphicsState_class();

        let picture = NSImage::initWithData(NSImage::alloc(), &NSData::with_bytes(&image.png))
            .ok_or("could not load the cropped screenshot")?;
        NSGraphicsContext::saveGraphicsState_class();
        NSBezierPath::bezierPathWithRoundedRect_xRadius_yRadius(
            rect(r.x, r.y, r.width, r.height),
            radius - 1.0,
            radius - 1.0,
        )
        .addClip();
        // SAFETY: the image and rect are valid; no hints are passed.
        unsafe {
            picture.drawInRect_fromRect_operation_fraction_respectFlipped_hints(
                rect(r.x, r.y, r.width, r.height),
                CGRect::ZERO,
                NSCompositingOperation::SourceOver,
                1.0,
                true,
                None,
            );
        }

        let ring = |x: f64, y: f64| {
            let d = HIGHLIGHT_DIAMETER;
            let circle =
                NSBezierPath::bezierPathWithOvalInRect(rect(x - d / 2.0, y - d / 2.0, d, d));
            color(1.0, 1.0, 0.0, 0.4).setFill();
            circle.fill();
            let edge = NSBezierPath::bezierPathWithOvalInRect(rect(
                x - d / 2.0 + 1.0,
                y - d / 2.0 + 1.0,
                d - 2.0,
                d - 2.0,
            ));
            edge.setLineWidth(2.0);
            color(1.0, 1.0, 0.0, 1.0).setStroke();
            edge.stroke();
        };
        if let Some((x, y)) = image.drag_to {
            let line = NSBezierPath::new();
            line.moveToPoint(CGPoint::new(image.click.0, image.click.1));
            line.lineToPoint(CGPoint::new(x, y));
            line.setLineWidth(3.0);
            color(1.0, 1.0, 0.0, 1.0).setStroke();
            line.stroke();
            ring(x, y);
        }
        ring(image.click.0, image.click.1);

        if let Some((bytes, place)) = &image.cursor {
            if let Some(cursor) =
                NSImage::initWithData(NSImage::alloc(), &NSData::with_bytes(bytes))
            {
                // SAFETY: as above.
                unsafe {
                    cursor.drawInRect_fromRect_operation_fraction_respectFlipped_hints(
                        rect(place.x, place.y, place.width, place.height),
                        CGRect::ZERO,
                        NSCompositingOperation::SourceOver,
                        1.0,
                        true,
                        None,
                    );
                }
            }
        }
        NSGraphicsContext::restoreGraphicsState_class();

        NSColor::whiteColor().setStroke();
        let border = NSBezierPath::bezierPathWithRoundedRect_xRadius_yRadius(
            rect(
                outer.origin.x + BORDER / 2.0,
                outer.origin.y + BORDER / 2.0,
                outer.size.width - BORDER,
                outer.size.height - BORDER,
            ),
            radius - BORDER / 2.0,
            radius - BORDER / 2.0,
        );
        border.setLineWidth(BORDER);
        border.stroke();
        Ok(())
    }

    pub fn render(directory: &Path, guide: &StepGuide, output: &Path) -> Result<(), String> {
        autoreleasepool(|_| render_pages(directory, guide, output))
    }

    fn render_pages(directory: &Path, guide: &StepGuide, output: &Path) -> Result<(), String> {
        let pages = paginate(guide, |text| measure(text, 14.0, TEXT_WIDTH));
        let temporary = output.with_extension("pdf.tmp");
        let url = CFURL::from_file_path(&temporary).ok_or("could not address the PDF file")?;
        let media = rect(0.0, 0.0, PAGE_WIDTH, PAGE_HEIGHT);
        // SAFETY: the URL and media box outlive the call; no auxiliary info.
        let context = unsafe { CGPDFContextCreateWithURL(Some(&url), &media, None) }
            .ok_or("could not create the PDF")?;
        let ns_context = NSGraphicsContext::graphicsContextWithCGContext_flipped(&context, true);
        let previous = NSGraphicsContext::currentContext();
        NSGraphicsContext::setCurrentContext(Some(&ns_context));
        ns_context.setImageInterpolation(NSImageInterpolation::High);

        let mut result = Ok(());
        let step_font = font("ArialMT", 14.0, false);
        for (index, page) in pages.iter().enumerate() {
            // SAFETY: the context is a live PDF context; no page info.
            unsafe { CGPDFContextBeginPage(Some(&context), None) };
            CGContext::save_g_state(Some(&context));
            CGContext::translate_ctm(Some(&context), 0.0, PAGE_HEIGHT);
            CGContext::scale_ctm(Some(&context), 1.0, -1.0);
            if index == 0 {
                draw_header(guide);
            }
            for placed in page {
                match &guide.items[placed.item] {
                    GuideItem::Step { text, image, .. } => {
                        draw_badge(placed.number.unwrap_or(0), placed.top);
                        let label = attributed(text, &step_font, &text_color(), true);
                        draw_text(&label, TEXT_LEFT, placed.top + 23.5, TEXT_WIDTH, &step_font);
                        if let Some(image) = image {
                            if let Err(error) = prepare_image(directory, image, placed.top)
                                .and_then(|prepared| draw_image(&prepared))
                            {
                                result = Err(error);
                            }
                        }
                    }
                    GuideItem::Note { text, .. } => {
                        let label = attributed(text, &step_font, &text_color(), true);
                        draw_text(
                            &label,
                            MARGIN_LEFT + 4.0,
                            placed.top + NOTE_PADDING / 2.0 + step_font.ascender(),
                            TEXT_WIDTH + 42.0,
                            &step_font,
                        );
                    }
                }
            }
            CGContext::restore_g_state(Some(&context));
            CGPDFContextEndPage(Some(&context));
        }
        CGPDFContextClose(Some(&context));
        NSGraphicsContext::setCurrentContext(previous.as_deref());
        drop(ns_context);
        drop(context);
        result?;
        std::fs::rename(&temporary, output)
            .map_err(|error| format!("could not write {}: {error}", output.display()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::step_capture::guide::{GuideImage, PxPoint, GUIDE_SCHEMA_VERSION};

    fn guide(items: Vec<GuideItem>) -> StepGuide {
        StepGuide {
            schema_version: GUIDE_SCHEMA_VERSION,
            session_id: "s".into(),
            title: "Finder and TextEdit".into(),
            author: "Dimo Uzunov".into(),
            date: "18 October 2026".into(),
            duration: "1 minute".into(),
            items,
        }
    }

    fn image() -> GuideImage {
        GuideImage {
            file_name: "step.png".into(),
            width: 400,
            height: 300,
            crop: PxRect {
                x: 0.0,
                y: 0.0,
                width: 400.0,
                height: 300.0,
            },
            click: PxPoint { x: 100.0, y: 100.0 },
            drag_to: None,
            cursor: None,
            zoom: 1.0,
        }
    }

    fn step(id: &str, with_image: bool) -> GuideItem {
        GuideItem::Step {
            id: id.into(),
            text: "Click here".into(),
            image: with_image.then(image),
        }
    }

    #[test]
    fn two_steps_fit_under_the_header_then_two_per_page() {
        let items = (0..5).map(|i| step(&i.to_string(), true)).collect();
        let pages = paginate(&guide(items), |_| 20.0);
        let tops: Vec<Vec<f64>> = pages
            .iter()
            .map(|page| page.iter().map(|placed| placed.top).collect())
            .collect();
        assert_eq!(tops, vec![vec![96.0, 444.0], vec![48.0, 396.0], vec![48.0]]);
        assert_eq!(pages[2][0].number, Some(5));
    }

    #[test]
    fn notes_are_not_numbered_and_never_split() {
        let items = vec![
            step("a", true),
            GuideItem::Note {
                id: "n".into(),
                text: "Note".into(),
            },
            step("b", true),
        ];
        let pages = paginate(&guide(items), |_| 40.0);
        assert_eq!(pages[0][1].number, None);
        assert_eq!(pages[0][1].height, 64.0);
        assert_eq!(pages.len(), 2);
        assert_eq!(pages[1][0].number, Some(2));
    }

    #[test]
    fn crop_keeps_the_requested_pixels() {
        let (width, height) = (8u32, 6u32);
        let mut source = Vec::new();
        {
            let mut encoder = png::Encoder::new(&mut source, width, height);
            encoder.set_color(png::ColorType::Rgb);
            encoder.set_depth(png::BitDepth::Eight);
            let mut writer = encoder.write_header().unwrap();
            let data: Vec<u8> = (0..width * height)
                .flat_map(|i| [(i % width) as u8, (i / width) as u8, 0])
                .collect();
            writer.write_image_data(&data).unwrap();
        }
        let cropped = crop_png(
            &source,
            PxRect {
                x: 2.0,
                y: 1.0,
                width: 3.0,
                height: 2.0,
            },
        )
        .unwrap();
        let mut reader = png::Decoder::new(Cursor::new(&cropped))
            .read_info()
            .unwrap();
        let mut buffer = vec![0; reader.output_buffer_size().unwrap()];
        let frame = reader.next_frame(&mut buffer).unwrap();
        assert_eq!((frame.width, frame.height), (3, 2));
        assert_eq!(&buffer[..3], &[2, 1, 0]);
    }

    /// Renders a sample guide from `STEP_GUIDE_SAMPLE_DIR` (a folder with a
    /// `guide.json`) to `guide.pdf` inside it, for comparing with Snagit.
    #[test]
    #[ignore]
    fn render_sample_guide() {
        let Ok(directory) = std::env::var("STEP_GUIDE_SAMPLE_DIR") else {
            return;
        };
        let directory = std::path::PathBuf::from(directory);
        let guide = super::super::guide::read_guide(&directory)
            .unwrap()
            .unwrap();
        export_pdf(&directory, &guide, &directory.join("guide.pdf")).unwrap();
    }
}
