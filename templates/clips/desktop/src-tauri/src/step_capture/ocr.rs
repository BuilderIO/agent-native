//! Names what a step clicked from the screenshot itself. When Clips has no
//! Accessibility trust, or an app exposes no label, the text under the
//! pointer still says what was clicked: `Click on "Applications"`, as Snagit
//! writes it.

use super::guide::{PxPoint, PxRect};

/// The strip read around a click, in screenshot pixels. Wide enough for a
/// sidebar row whose label sits beside its icon, short enough to stay on
/// the clicked line.
const READ_WIDTH: f64 = 900.0;
const READ_HEIGHT: f64 = 140.0;
/// How far a label may sit from the click on the same line.
const MAX_GAP: f64 = 180.0;
/// How far above or below the click a line still counts as clicked.
const LINE_SLACK: f64 = 10.0;
const MIN_CONFIDENCE: f32 = 0.45;
const MAX_LABEL_CHARS: usize = 48;
/// How far left of a click a menu item's label may start: the whole row of
/// an open menu is the item.
const MENU_ROW_GAP: f64 = 450.0;
/// A one-character "word" whose ink is at least this wide for its height is
/// an icon Vision misread, such as Finder's Applications glyph read as `4`.
const ICON_ASPECT: f64 = 0.75;
/// A gap wider than this many text heights starts a new phrase.
const PHRASE_GAP: f64 = 0.75;
/// How far a pixel's brightness must differ from a word box's background to
/// count as ink.
const INK_CONTRAST: i16 = 48;

/// One line of text found in the read strip, in screenshot pixels.
#[derive(Debug, Clone, PartialEq)]
pub struct TextLine {
    pub text: String,
    pub rect: PxRect,
    pub confidence: f32,
}

/// Joins the words of one line into phrases, splitting where the gap is
/// wider than a space: `File  Edit  View` are three menu titles, while
/// `Outbox & audit` is one label.
pub fn phrases(words: &[TextLine]) -> Vec<TextLine> {
    let mut out: Vec<TextLine> = Vec::new();
    for word in words {
        let joined = out.last_mut().filter(|last| {
            let gap = word.rect.x - (last.rect.x + last.rect.width);
            gap <= PHRASE_GAP * last.rect.height.max(word.rect.height)
        });
        match joined {
            Some(last) => {
                let right = (word.rect.x + word.rect.width).max(last.rect.x + last.rect.width);
                let top = last.rect.y.min(word.rect.y);
                let bottom = (last.rect.y + last.rect.height).max(word.rect.y + word.rect.height);
                last.text = format!("{} {}", last.text, word.text);
                last.rect = PxRect {
                    x: last.rect.x,
                    y: top,
                    width: right - last.rect.x,
                    height: bottom - top,
                };
                last.confidence = last.confidence.min(word.confidence);
            }
            None => out.push(word.clone()),
        }
    }
    out
}

/// Grey pixels of a strip, row by row.
pub struct Luma {
    pub width: usize,
    pub height: usize,
    pub pixels: Vec<u8>,
}

impl Luma {
    fn decode(png: &[u8]) -> Option<Self> {
        let mut decoder = png::Decoder::new(std::io::Cursor::new(png));
        decoder.set_transformations(png::Transformations::EXPAND | png::Transformations::STRIP_16);
        let mut reader = decoder.read_info().ok()?;
        let mut buffer = vec![0; reader.output_buffer_size()?];
        let frame = reader.next_frame(&mut buffer).ok()?;
        let channels = match frame.color_type {
            png::ColorType::Rgb => 3,
            png::ColorType::Rgba => 4,
            png::ColorType::Grayscale => 1,
            png::ColorType::GrayscaleAlpha => 2,
            png::ColorType::Indexed => return None,
        };
        let (width, height) = (frame.width as usize, frame.height as usize);
        let mut pixels = Vec::with_capacity(width * height);
        for row in 0..height {
            let line = &buffer[row * frame.line_size..];
            for column in 0..width {
                let px = &line[column * channels..];
                let grey = if channels >= 3 {
                    (u32::from(px[0]) * 3 + u32::from(px[1]) * 6 + u32::from(px[2])) / 10
                } else {
                    u32::from(px[0])
                };
                pixels.push(grey as u8);
            }
        }
        Some(Self {
            width,
            height,
            pixels,
        })
    }
}

/// Shrinks a word box, in strip pixels, to the columns that hold ink. Vision
/// pads a word's box up to the next word, so a sidebar icon read as `4`
/// reaches its label and the two would join into `4 Applications`.
pub fn trim_to_ink(luma: &Luma, rect: PxRect) -> PxRect {
    let left = rect.x.max(0.0).floor() as usize;
    let right = ((rect.x + rect.width).ceil() as usize).min(luma.width);
    let top = rect.y.max(0.0).floor() as usize;
    let bottom = ((rect.y + rect.height).ceil() as usize).min(luma.height);
    if right <= left || bottom <= top {
        return rect;
    }
    // The background is the commonest brightness in the box.
    let mut counts = [0usize; 32];
    for row in top..bottom {
        for column in left..right {
            counts[usize::from(luma.pixels[row * luma.width + column] / 8)] += 1;
        }
    }
    let common = (0..32).max_by_key(|bucket| counts[*bucket]).unwrap_or(0);
    let background = (common * 8 + 4) as i16;
    let inked = |column: usize| {
        (top..bottom).any(|row| {
            (i16::from(luma.pixels[row * luma.width + column]) - background).abs() > INK_CONTRAST
        })
    };
    let Some(first) = (left..right).find(|column| inked(*column)) else {
        return rect;
    };
    let last = (left..right)
        .rev()
        .find(|column| inked(*column))
        .unwrap_or(first);
    PxRect {
        x: first as f64,
        width: (last + 1 - first) as f64,
        ..rect
    }
}

/// The strip of the screenshot to read for a click.
pub fn read_area(click: PxPoint, width: f64, height: f64) -> PxRect {
    let w = READ_WIDTH.min(width);
    let h = READ_HEIGHT.min(height);
    PxRect {
        x: (click.x - w / 2.0).clamp(0.0, width - w),
        y: (click.y - h / 2.0).clamp(0.0, height - h),
        width: w,
        height: h,
    }
}

/// What kind of place a click is read in.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReadAt {
    /// A window: words join into labels.
    Window,
    /// The menu bar: every word is its own menu title.
    MenuBar,
    /// An open menu: the label may sit far left of the click on its row.
    MenuItem,
}

/// Whether a word is an icon Vision read as a character.
pub fn is_icon(word: &TextLine) -> bool {
    let mut chars = word.text.trim().chars();
    matches!((chars.next(), chars.next()), (Some(c), None) if !c.is_alphabetic())
        && word.rect.width >= ICON_ASPECT * word.rect.height
}

/// The line the click landed on, or the nearest one beside it on its row.
pub fn label_at(lines: &[TextLine], click: PxPoint) -> Option<String> {
    label_within(lines, click, MAX_GAP)
}

/// A menu item's label: on the clicked row and starting left of the click,
/// else whatever `label_at` finds.
pub fn menu_item_at(lines: &[TextLine], click: PxPoint) -> Option<String> {
    let left = lines
        .iter()
        .filter(|line| line.rect.x <= click.x)
        .cloned()
        .collect::<Vec<_>>();
    label_within(&left, click, MENU_ROW_GAP).or_else(|| label_at(lines, click))
}

fn label_within(lines: &[TextLine], click: PxPoint, max_gap: f64) -> Option<String> {
    let usable = lines.iter().filter(|line| {
        let text = line.text.trim();
        line.confidence >= MIN_CONFIDENCE
            && text.chars().count() >= 2
            && text.chars().count() <= MAX_LABEL_CHARS
            && text.chars().any(char::is_alphanumeric)
    });
    let on_row = |line: &&TextLine| {
        click.y >= line.rect.y - LINE_SLACK
            && click.y <= line.rect.y + line.rect.height + LINE_SLACK
    };
    let gap = |line: &TextLine| {
        if click.x < line.rect.x {
            line.rect.x - click.x
        } else if click.x > line.rect.x + line.rect.width {
            click.x - line.rect.x - line.rect.width
        } else {
            0.0
        }
    };
    usable
        .filter(on_row)
        .map(|line| (gap(line), line))
        .filter(|(gap, _)| *gap <= max_gap)
        .min_by(|a, b| a.0.total_cmp(&b.0))
        .map(|(_, line)| clean(&line.text))
}

fn clean(text: &str) -> String {
    text.trim()
        .trim_end_matches(['>', '›', '…', ':'])
        .trim()
        .to_string()
}

/// Reads the text around `click` in a step screenshot. Menu bar titles are
/// read as single words: closely spaced titles such as `Image Video` are
/// often no further apart than the words of one label.
pub fn read_label(
    png: &[u8],
    width: f64,
    height: f64,
    click: PxPoint,
    at: ReadAt,
) -> Option<String> {
    let area = read_area(click, width, height);
    let strip = super::pdf::crop_png(png, area).ok()?;
    let luma = Luma::decode(&strip);
    let lines = platform::recognize(&strip)?
        .into_iter()
        .flat_map(|words| {
            let words = words
                .into_iter()
                .map(|word| {
                    let local = PxRect {
                        x: word.rect.x * area.width,
                        y: word.rect.y * area.height,
                        width: word.rect.width * area.width,
                        height: word.rect.height * area.height,
                    };
                    let local = luma.as_ref().map_or(local, |luma| trim_to_ink(luma, local));
                    TextLine {
                        rect: PxRect {
                            x: area.x + local.x,
                            y: area.y + local.y,
                            ..local
                        },
                        ..word
                    }
                })
                .filter(|word| !is_icon(word))
                .collect::<Vec<_>>();
            if at == ReadAt::MenuBar {
                words
            } else {
                phrases(&words)
            }
        })
        .collect::<Vec<_>>();
    match at {
        ReadAt::MenuItem => menu_item_at(&lines, click),
        _ => label_at(&lines, click),
    }
}

#[cfg(target_os = "macos")]
mod platform {
    use super::{PxRect, TextLine};
    use objc2::rc::{autoreleasepool, Allocated, Retained};
    use objc2::runtime::AnyObject;
    use objc2::{class, msg_send};
    use objc2_core_foundation::CGRect;
    use objc2_foundation::{NSArray, NSData, NSDictionary, NSError, NSRange, NSString};

    #[link(name = "Vision", kind = "framework")]
    extern "C" {}

    // Vision boxes are normalised with a bottom-left origin.
    fn word_line(text: &str, bounds: CGRect, confidence: f32) -> TextLine {
        TextLine {
            text: text.to_string(),
            rect: PxRect {
                x: bounds.origin.x,
                y: 1.0 - bounds.origin.y - bounds.size.height,
                width: bounds.size.width,
                height: bounds.size.height,
            },
            confidence,
        }
    }

    /// The words of each text line in a PNG, with rects as fractions of it,
    /// top-left origin.
    pub fn recognize(png: &[u8]) -> Option<Vec<Vec<TextLine>>> {
        autoreleasepool(|_| unsafe {
            let request: Retained<AnyObject> = msg_send![class!(VNRecognizeTextRequest), new];
            // VNRequestTextRecognitionLevelAccurate
            let _: () = msg_send![&request, setRecognitionLevel: 0isize];
            let _: () = msg_send![&request, setUsesLanguageCorrection: true];
            let data = NSData::with_bytes(png);
            let options = NSDictionary::<NSString, AnyObject>::new();
            let handler: Allocated<AnyObject> = msg_send![class!(VNImageRequestHandler), alloc];
            let handler: Retained<AnyObject> =
                msg_send![handler, initWithData: &*data, options: &*options];
            let requests = NSArray::from_retained_slice(&[request.clone()]);
            let mut error: *mut NSError = std::ptr::null_mut();
            let ok: bool = msg_send![&handler, performRequests: &*requests, error: &mut error];
            if !ok {
                return None;
            }
            let results: Option<Retained<NSArray<AnyObject>>> = msg_send![&request, results];
            let mut lines = Vec::new();
            for observation in results?.iter() {
                let candidates: Retained<NSArray<AnyObject>> =
                    msg_send![&observation, topCandidates: 1usize];
                let Some(best) = candidates.iter().next() else {
                    continue;
                };
                let text: Retained<NSString> = msg_send![&best, string];
                let confidence: f32 = msg_send![&best, confidence];
                let text = text.to_string();
                // One box per word, so a menu bar reads as separate titles.
                let mut words = Vec::new();
                let mut offset = 0usize;
                for word in text.split(' ') {
                    let length = word.encode_utf16().count();
                    if length > 0 {
                        let range = NSRange::new(offset, length);
                        let mut error: *mut NSError = std::ptr::null_mut();
                        let found: Option<Retained<AnyObject>> =
                            msg_send![&best, boundingBoxForRange: range, error: &mut error];
                        if let Some(found) = found {
                            let bounds: CGRect = msg_send![&found, boundingBox];
                            words.push(word_line(word, bounds, confidence));
                        }
                    }
                    offset += length + 1;
                }
                if words.is_empty() {
                    let bounds: CGRect = msg_send![&observation, boundingBox];
                    words.push(word_line(&text, bounds, confidence));
                }
                lines.push(words);
            }
            Some(lines)
        })
    }
}

#[cfg(not(target_os = "macos"))]
mod platform {
    use super::TextLine;

    pub fn recognize(_png: &[u8]) -> Option<Vec<Vec<TextLine>>> {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn line(text: &str, x: f64, y: f64, width: f64) -> TextLine {
        TextLine {
            text: text.into(),
            rect: PxRect {
                x,
                y,
                width,
                height: 28.0,
            },
            confidence: 0.9,
        }
    }

    #[test]
    fn picks_the_line_under_the_click() {
        let lines = [
            line("Desktop", 100.0, 60.0, 120.0),
            line("Applications", 100.0, 100.0, 180.0),
        ];
        assert_eq!(
            label_at(&lines, PxPoint { x: 150.0, y: 112.0 }).as_deref(),
            Some("Applications")
        );
    }

    #[test]
    fn takes_a_label_beside_a_clicked_icon() {
        let lines = [line("Downloads", 140.0, 100.0, 150.0)];
        assert_eq!(
            label_at(&lines, PxPoint { x: 90.0, y: 114.0 }).as_deref(),
            Some("Downloads")
        );
        assert_eq!(label_at(&lines, PxPoint { x: 900.0, y: 114.0 }), None);
    }

    #[test]
    fn ignores_other_rows_and_noise() {
        let lines = [
            line("Recents", 100.0, 20.0, 120.0),
            line("•", 100.0, 100.0, 10.0),
        ];
        assert_eq!(label_at(&lines, PxPoint { x: 105.0, y: 112.0 }), None);
    }

    #[test]
    fn splits_menu_titles_but_keeps_labels_together() {
        let words = [
            line("Image", 100.0, 0.0, 70.0),
            line("Video", 214.0, 0.0, 66.0),
            line("Outbox", 400.0, 0.0, 80.0),
            line("&", 488.0, 0.0, 14.0),
            line("audit", 510.0, 0.0, 60.0),
        ];
        let texts = phrases(&words)
            .into_iter()
            .map(|p| p.text)
            .collect::<Vec<_>>();
        assert_eq!(texts, ["Image", "Video", "Outbox & audit"]);
    }

    #[test]
    fn trims_padded_word_boxes_to_their_ink() {
        // Dark sidebar: an icon at 10..40 and a label at 80..200.
        let (width, height) = (240, 30);
        let mut pixels = vec![30u8; width * height];
        for row in 5..25 {
            for column in (10..40).chain(80..200) {
                pixels[row * width + column] = 230;
            }
        }
        let luma = Luma {
            width,
            height,
            pixels,
        };
        let padded = PxRect {
            x: 8.0,
            y: 0.0,
            width: 70.0,
            height: 30.0,
        };
        let icon = trim_to_ink(&luma, padded);
        assert_eq!((icon.x, icon.width), (10.0, 30.0));
        let words = [
            TextLine {
                text: "4".into(),
                rect: icon,
                confidence: 0.9,
            },
            TextLine {
                text: "Applications".into(),
                rect: PxRect {
                    x: 80.0,
                    y: 0.0,
                    width: 120.0,
                    height: 30.0,
                },
                confidence: 0.9,
            },
        ];
        let texts = phrases(&words)
            .into_iter()
            .map(|p| p.text)
            .collect::<Vec<_>>();
        assert_eq!(texts, ["4", "Applications"]);
        assert!(is_icon(&words[0]));
        assert!(!is_icon(&words[1]));
        assert!(!is_icon(&line("4", 0.0, 0.0, 16.0)));
    }

    #[test]
    fn a_menu_item_is_named_from_anywhere_on_its_row() {
        let lines = [
            line("Utilities", 560.0, 778.0, 88.0),
            line("Applications", 560.0, 732.0, 150.0),
            line("⌘U", 1000.0, 778.0, 40.0),
        ];
        let click = PxPoint { x: 901.0, y: 790.0 };
        assert_eq!(label_at(&lines, click).as_deref(), Some("⌘U"));
        assert_eq!(menu_item_at(&lines, click).as_deref(), Some("Utilities"));
    }

    #[test]
    fn keeps_the_read_strip_inside_the_screenshot() {
        let area = read_area(PxPoint { x: 10.0, y: 2150.0 }, 3840.0, 2160.0);
        assert_eq!((area.x, area.y), (0.0, 2160.0 - READ_HEIGHT));
    }
}
