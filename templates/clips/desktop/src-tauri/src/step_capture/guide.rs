//! The step guide: the editable document a finished step capture becomes.
//!
//! The model is Snagit 2026's step document: a title, a byline
//! (`author | N steps | N minutes`) with the date, and one numbered step per
//! click with an instruction and a zoomed screenshot that shows the click
//! highlighted. Notes can sit between steps.
//!
//! `guide.json` sits next to `manifest.json` in the session folder. The
//! manifest stays the raw record of what was captured; the guide is what the
//! user edits and exports, so it is built from the manifest once and saved
//! from then on. Geometry is kept in image pixels so the editor and the PDF
//! renderer agree on every crop without knowing about displays.

use serde::{Deserialize, Serialize};
use std::path::Path;

use super::{
    StepCaptureSession, StepCaptureStep, StepClickType, StepImage, StepTarget, StepWindow,
};

pub const GUIDE_FILE: &str = "guide.json";
pub const GUIDE_SCHEMA_VERSION: u32 = 1;

/// The screenshot frame in a step, in PDF points (Snagit's layout).
pub const FRAME_WIDTH: f64 = 500.4;
pub const FRAME_HEIGHT: f64 = 278.0;
/// How far a step's screenshot is zoomed past fitting the capture area.
pub const DEFAULT_ZOOM: f64 = 2.0;
pub const MIN_ZOOM: f64 = 1.0;
pub const MAX_ZOOM: f64 = 4.0;
/// The frame never shows fewer pixels across than this, so a Retina still is
/// drawn at 2 px per point or better and stays sharp.
const MIN_VISIBLE_WIDTH: f64 = 1000.0;
/// A window smaller than this share of the display (a menu, a tooltip, a
/// popover) is not a useful capture area; the whole display is used instead.
const MIN_WINDOW_SHARE: f64 = 0.2;
const MAX_LABEL_CHARS: usize = 60;
/// The menu bar's height in points, generous for displays with a notch.
const MENU_BAR_HEIGHT: f64 = 40.0;
/// Where an open menu hangs, in points from its title's click: a little to
/// the left of the title and up to a wide menu's width to the right.
const MENU_REACH_LEFT: f64 = 60.0;
const MENU_REACH_RIGHT: f64 = 420.0;
/// How far the Dock reaches up from the bottom of the display, in points.
const DOCK_HEIGHT: f64 = 100.0;
/// Owners that are part of the system rather than an app the guide is about.
const SYSTEM_OWNERS: &[&str] = &[
    "Dock",
    "Window Server",
    "SystemUIServer",
    "Control Center",
    "Notification Center",
    "Spotlight",
];

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
pub struct PxPoint {
    pub x: f64,
    pub y: f64,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
pub struct PxRect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GuideCursor {
    pub file_name: String,
    /// The cursor's size and hot spot, in screenshot pixels.
    pub width: f64,
    pub height: f64,
    pub hotspot: PxPoint,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GuideImage {
    pub file_name: String,
    pub width: u32,
    pub height: u32,
    /// The capture area: the clicked window, or the whole display.
    pub crop: PxRect,
    pub click: PxPoint,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub drag_to: Option<PxPoint>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cursor: Option<GuideCursor>,
    pub zoom: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum GuideItem {
    Step {
        id: String,
        text: String,
        image: Option<GuideImage>,
    },
    Note {
        id: String,
        text: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StepGuide {
    pub schema_version: u32,
    pub session_id: String,
    pub title: String,
    pub author: String,
    pub date: String,
    pub duration: String,
    pub items: Vec<GuideItem>,
}

impl StepGuide {
    pub fn step_count(&self) -> usize {
        self.items
            .iter()
            .filter(|item| matches!(item, GuideItem::Step { .. }))
            .count()
    }

    /// `Dimo Uzunov | 6 steps | 1 minute`, the line under the title.
    pub fn byline(&self) -> String {
        let count = self.step_count();
        let steps = if count == 1 {
            "1 step".to_string()
        } else {
            format!("{count} steps")
        };
        [self.author.as_str(), steps.as_str(), self.duration.as_str()]
            .iter()
            .filter(|part| !part.is_empty())
            .copied()
            .collect::<Vec<_>>()
            .join(" | ")
    }
}

/// The part of the screenshot the frame shows: the capture area fitted to
/// cover the frame, zoomed, centred on the click and kept inside the area.
pub fn visible_rect(image: &GuideImage) -> PxRect {
    let crop = image.crop;
    let aspect = FRAME_WIDTH / FRAME_HEIGHT;
    let zoom = image.zoom.clamp(MIN_ZOOM, MAX_ZOOM);
    // Covering the frame at zoom 1 shows the full width or the full height.
    let (base_width, _) = if crop.width / crop.height > aspect {
        (crop.height * aspect, crop.height)
    } else {
        (crop.width, crop.width / aspect)
    };
    let mut width = base_width / zoom;
    let floor = MIN_VISIBLE_WIDTH.min(base_width);
    if width < floor {
        width = floor;
    }
    let height = width / aspect;
    let x = (image.click.x - width / 2.0).clamp(crop.x, crop.x + crop.width - width);
    let y = (image.click.y - height / 2.0).clamp(crop.y, crop.y + crop.height - height);
    PxRect {
        x,
        y,
        width,
        height,
    }
}

fn verb(click_type: StepClickType) -> &'static str {
    match click_type {
        StepClickType::Left => "Click",
        StepClickType::Right => "Right-click",
        StepClickType::Double => "Double-click",
        StepClickType::Drag => "Drag",
    }
}

fn role_noun(role: &str) -> Option<&'static str> {
    Some(match role {
        "AXButton" => "button",
        "AXCheckBox" => "checkbox",
        "AXLink" => "link",
        "AXMenuBarItem" | "AXMenuButton" | "AXPopUpButton" => "menu",
        "AXMenuItem" => "menu item",
        "AXRadioButton" => "option",
        "AXTab" | "AXTabButton" => "tab",
        "AXTextField" | "AXTextArea" | "AXComboBox" => "field",
        "AXSearchField" => "search field",
        "AXSecureTextField" => "password field",
        "AXSlider" => "slider",
        "AXDisclosureTriangle" => "disclosure triangle",
        "AXImage" => "image",
        "AXCell" | "AXRow" => "item",
        _ => return None,
    })
}

fn short_label(label: &str) -> String {
    let label = label.split_whitespace().collect::<Vec<_>>().join(" ");
    if label.chars().count() <= MAX_LABEL_CHARS {
        return label;
    }
    let mut short = label.chars().take(MAX_LABEL_CHARS - 1).collect::<String>();
    short = short.trim_end().to_string();
    short.push('…');
    short
}

fn owner_of(step: &StepCaptureStep) -> Option<&str> {
    match &step.window {
        StepWindow::Found {
            owner_name: Some(owner),
            ..
        } if !owner.trim().is_empty() => Some(owner.trim()),
        _ => None,
    }
}

/// The instruction a step starts with, from what was clicked. Snagit writes
/// `Click here` when it knows nothing; this names the control and the app.
#[cfg(test)]
pub fn default_step_text(step: &StepCaptureStep) -> String {
    step_text(step, None)
}

/// The instruction a step starts with, with `read` being the text the screenshot
/// shows under the click, used when Accessibility named nothing.
pub fn step_text(step: &StepCaptureStep, read: Option<&str>) -> String {
    let verb = verb(step.click_type);
    let owner = owner_of(step);
    let in_dock = owner == Some("Dock");
    let read = read
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .map(short_label);
    match &step.target {
        StepTarget::Labeled { role, label } if !label.trim().is_empty() => {
            let label = short_label(label);
            if in_dock || role == "AXDockItem" {
                return format!("{verb} the \"{label}\" icon in the Dock");
            }
            return match role_noun(role) {
                Some(noun) => format!("{verb} the \"{label}\" {noun}"),
                None => format!("{verb} on \"{label}\""),
            };
        }
        _ if read.is_some() => {
            let read = read.unwrap_or_default();
            if in_dock {
                return format!("{verb} the \"{read}\" icon in the Dock");
            }
            return format!("{verb} on \"{read}\"");
        }
        StepTarget::Labeled { role, .. }
        | StepTarget::Unlabeled { role }
        | StepTarget::Redacted { role } => {
            if let Some(noun) = role_noun(role) {
                return match owner {
                    Some(owner) if !in_dock => format!("{verb} the {noun} in {owner}"),
                    _ => format!("{verb} the {noun}"),
                };
            }
        }
        StepTarget::Unavailable { .. } => {}
    }
    match owner {
        Some("Dock") => format!("{verb} in the Dock"),
        Some(owner) => format!("{verb} in the {owner} window"),
        None => format!("{verb} here"),
    }
}

/// Where a click landed when no app window was under it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Place {
    Window,
    MenuBar,
    Menu,
    Dock,
}

fn place_of(step: &StepCaptureStep, previous: Option<(Place, &StepCaptureStep)>) -> Place {
    if owner_of(step) == Some("Dock") {
        return Place::Dock;
    }
    let Some(display) = step.display.as_ref() else {
        return Place::Window;
    };
    let y = step.location.y - display.frame.y;
    // A menu opened from the menu bar lies over whatever window is beneath
    // it, so the click below its title picks an item even when a window was
    // found under the pointer.
    if let Some((Place::MenuBar, title)) = previous {
        let x = step.location.x - title.location.x;
        if y > MENU_BAR_HEIGHT
            && y < display.frame.height - DOCK_HEIGHT
            && (-MENU_REACH_LEFT..=MENU_REACH_RIGHT).contains(&x)
        {
            return Place::Menu;
        }
    }
    if !matches!(step.window, StepWindow::None) {
        return Place::Window;
    }
    if y <= MENU_BAR_HEIGHT {
        Place::MenuBar
    } else if y >= display.frame.height - DOCK_HEIGHT {
        Place::Dock
    } else if matches!(previous, Some((Place::MenuBar | Place::Menu, _))) {
        Place::Menu
    } else {
        Place::Window
    }
}

/// The text of a click in the menu bar, an open menu or the Dock. `name` is
/// what was clicked, `menu` the title of the open menu and `next_app` the
/// app the following step happened in, which a Dock click usually opened.
fn place_text(
    step: &StepCaptureStep,
    place: Place,
    name: Option<&str>,
    menu: Option<&str>,
    next_app: Option<&str>,
) -> String {
    let verb = verb(step.click_type);
    let name = name
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .map(short_label);
    match (place, name, menu) {
        (Place::MenuBar, Some(name), _) => format!("{verb} the \"{name}\" menu"),
        (Place::MenuBar, None, _) => format!("{verb} in the menu bar"),
        (Place::Menu, Some(name), Some(menu)) => {
            format!("{verb} \"{name}\" in the \"{}\" menu", short_label(menu))
        }
        (Place::Menu, Some(name), None) => format!("{verb} on \"{name}\""),
        (Place::Menu, None, Some(menu)) => {
            format!("{verb} an item in the \"{}\" menu", short_label(menu))
        }
        (Place::Menu, None, None) => format!("{verb} the menu item"),
        (Place::Dock, name, _) => match name.or_else(|| next_app.map(short_label)) {
            Some(name) => format!("{verb} the \"{name}\" icon in the Dock"),
            None => format!("{verb} in the Dock"),
        },
        (Place::Window, name, _) => step_text(step, name.as_deref()),
    }
}

/// `Finder and TextEdit`: the apps the steps happened in, in order.
pub fn default_title(session: &StepCaptureSession) -> String {
    let mut apps: Vec<&str> = Vec::new();
    for step in &session.steps {
        if let Some(owner) = owner_of(step) {
            if !SYSTEM_OWNERS.contains(&owner) && !apps.contains(&owner) {
                apps.push(owner);
            }
        }
    }
    match apps.as_slice() {
        [] => "Step capture".to_string(),
        [one] => one.to_string(),
        [rest @ .., last] => format!("{} and {last}", rest.join(", ")),
    }
}

/// `1 minute`, `3 minutes`: the session length rounded up, as Snagit does.
pub fn duration_text(started_at: &str, ended_at: Option<&str>) -> String {
    let parse = |text: &str| chrono::DateTime::parse_from_rfc3339(text).ok();
    let minutes = match (parse(started_at), ended_at.and_then(parse)) {
        (Some(start), Some(end)) => {
            let seconds = (end - start).num_seconds().max(0);
            ((seconds + 59) / 60).max(1)
        }
        _ => 1,
    };
    if minutes == 1 {
        "1 minute".to_string()
    } else {
        format!("{minutes} minutes")
    }
}

/// `15 October 2026`, in local time.
pub fn date_text(started_at: &str) -> String {
    chrono::DateTime::parse_from_rfc3339(started_at)
        .map(|at| at.with_timezone(&chrono::Local))
        .unwrap_or_else(|_| {
            chrono::Local::now()
                .fixed_offset()
                .with_timezone(&chrono::Local)
        })
        .format("%-d %B %Y")
        .to_string()
}

fn to_pixels(step: &StepCaptureStep, x: f64, y: f64) -> Option<PxPoint> {
    let display = step.display.as_ref()?;
    Some(PxPoint {
        x: (x - display.frame.x) * display.scale,
        y: (y - display.frame.y) * display.scale,
    })
}

/// The window under the click, in pixels, when it is big enough to frame the
/// step; otherwise the whole screenshot.
fn capture_area(step: &StepCaptureStep, width: f64, height: f64) -> PxRect {
    let full = PxRect {
        x: 0.0,
        y: 0.0,
        width,
        height,
    };
    let (StepWindow::Found { frame, .. }, Some(display)) = (&step.window, step.display.as_ref())
    else {
        return full;
    };
    if owner_of(step) == Some("Dock") {
        return full;
    }
    let scale = display.scale;
    let left = ((frame.x - display.frame.x) * scale).max(0.0);
    let top = ((frame.y - display.frame.y) * scale).max(0.0);
    let right = ((frame.x + frame.width - display.frame.x) * scale).min(width);
    let bottom = ((frame.y + frame.height - display.frame.y) * scale).min(height);
    let area = PxRect {
        x: left,
        y: top,
        width: right - left,
        height: bottom - top,
    };
    let share = (area.width * area.height) / (width * height);
    if area.width <= 0.0 || area.height <= 0.0 || share < MIN_WINDOW_SHARE {
        return full;
    }
    area
}

/// The step's picture. A click in an open menu shows the whole screen, so the
/// menu's title stays in view rather than the window beneath the menu.
fn guide_image(step: &StepCaptureStep, in_menu: bool) -> Option<GuideImage> {
    let StepImage::Captured {
        file_name,
        width,
        height,
    } = &step.image
    else {
        return None;
    };
    let (w, h) = (f64::from(*width), f64::from(*height));
    let click = to_pixels(step, step.location.x, step.location.y)
        .map(|point| PxPoint {
            x: point.x.clamp(0.0, w),
            y: point.y.clamp(0.0, h),
        })
        .unwrap_or(PxPoint {
            x: w / 2.0,
            y: h / 2.0,
        });
    let drag_to = step
        .drag_to
        .and_then(|to| to_pixels(step, to.x, to.y))
        .map(|point| PxPoint {
            x: point.x.clamp(0.0, w),
            y: point.y.clamp(0.0, h),
        });
    let scale = step.display.as_ref().map_or(1.0, |display| display.scale);
    let cursor = step.cursor.as_ref().map(|cursor| GuideCursor {
        file_name: cursor.file_name.clone(),
        width: cursor.size.x * scale,
        height: cursor.size.y * scale,
        hotspot: PxPoint {
            x: cursor.hotspot.x * scale,
            y: cursor.hotspot.y * scale,
        },
    });
    Some(GuideImage {
        file_name: file_name.clone(),
        width: *width,
        height: *height,
        crop: if in_menu {
            PxRect {
                x: 0.0,
                y: 0.0,
                width: w,
                height: h,
            }
        } else {
            capture_area(step, w, h)
        },
        click,
        drag_to,
        cursor,
        zoom: DEFAULT_ZOOM,
    })
}

pub fn author_name() -> String {
    std::process::Command::new("id")
        .arg("-F")
        .output()
        .ok()
        .filter(|output| output.status.success())
        .and_then(|output| String::from_utf8(output.stdout).ok())
        .map(|name| name.trim().to_string())
        .filter(|name| !name.is_empty())
        .or_else(|| std::env::var("USER").ok())
        .unwrap_or_default()
}

/// The guide for a finished session. With the session `directory`, steps that
/// Accessibility could not name are named from their screenshot's text.
pub fn build_guide(
    session: &StepCaptureSession,
    author: String,
    directory: Option<&Path>,
) -> StepGuide {
    let mut places: Vec<Place> = Vec::with_capacity(session.steps.len());
    for (index, step) in session.steps.iter().enumerate() {
        let previous = places
            .last()
            .map(|place| (*place, &session.steps[index - 1]));
        places.push(place_of(step, previous));
    }
    let images = session
        .steps
        .iter()
        .zip(&places)
        .map(|(step, place)| guide_image(step, *place == Place::Menu))
        .collect::<Vec<_>>();
    // What each step clicked: its Accessibility label, else the text under it.
    let names = session
        .steps
        .iter()
        .zip(&images)
        .zip(&places)
        .map(
            |((step, image), place)| match (&step.target, image, directory) {
                (StepTarget::Labeled { label, .. }, _, _) if !label.trim().is_empty() => {
                    Some(label.trim().to_string())
                }
                (_, Some(image), Some(directory)) => {
                    std::fs::read(directory.join(&image.file_name))
                        .ok()
                        .and_then(|png| {
                            super::ocr::read_label(
                                &png,
                                f64::from(image.width),
                                f64::from(image.height),
                                image.click,
                                match place {
                                    Place::MenuBar => super::ocr::ReadAt::MenuBar,
                                    Place::Menu => super::ocr::ReadAt::MenuItem,
                                    _ => super::ocr::ReadAt::Window,
                                },
                            )
                        })
                }
                _ => None,
            },
        )
        .collect::<Vec<_>>();
    let mut items = Vec::with_capacity(session.steps.len());
    let mut menu: Option<&str> = None;
    for (index, (step, image)) in session.steps.iter().zip(images).enumerate() {
        let place = places[index];
        let name = names[index].as_deref();
        let next_app = session
            .steps
            .get(index + 1)
            .and_then(owner_of)
            .filter(|owner| !SYSTEM_OWNERS.contains(owner));
        let text = match place {
            Place::Window => step_text(step, name),
            _ => place_text(step, place, name, menu, next_app),
        };
        match place {
            Place::MenuBar => menu = name,
            Place::Menu => {}
            _ => menu = None,
        }
        items.push(GuideItem::Step {
            id: format!("step-{}", step.step),
            text,
            image,
        });
    }
    StepGuide {
        schema_version: GUIDE_SCHEMA_VERSION,
        session_id: session.session_id.clone(),
        title: default_title(session),
        author,
        date: date_text(&session.started_at),
        duration: duration_text(&session.started_at, session.ended_at.as_deref()),
        items,
    }
}

pub fn read_guide(directory: &Path) -> Result<Option<StepGuide>, String> {
    let path = directory.join(GUIDE_FILE);
    match std::fs::read(&path) {
        Ok(bytes) => serde_json::from_slice(&bytes)
            .map(Some)
            .map_err(|error| format!("could not read {}: {error}", path.display())),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(format!("could not read {}: {error}", path.display())),
    }
}

pub fn write_guide(directory: &Path, guide: &StepGuide) -> Result<(), String> {
    let json = serde_json::to_vec_pretty(guide)
        .map_err(|error| format!("could not encode the step guide: {error}"))?;
    let path = directory.join(GUIDE_FILE);
    let temporary = directory.join(format!("{GUIDE_FILE}.tmp"));
    std::fs::write(&temporary, json)
        .map_err(|error| format!("could not write {}: {error}", temporary.display()))?;
    std::fs::rename(&temporary, &path)
        .map_err(|error| format!("could not replace {}: {error}", path.display()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::step_capture::{
        StepCursor, StepDisplay, StepPoint, StepRect, StepTargetUnavailableReason,
        STEP_CAPTURE_SCHEMA_VERSION,
    };

    fn display() -> StepDisplay {
        StepDisplay {
            id: 1,
            frame: StepRect {
                x: 0.0,
                y: 0.0,
                width: 1512.0,
                height: 982.0,
            },
            scale: 2.0,
        }
    }

    fn window(owner: &str, frame: StepRect) -> StepWindow {
        StepWindow::Found {
            id: 1,
            frame,
            owner_name: Some(owner.into()),
            owner_pid: None,
            title: None,
        }
    }

    fn step(target: StepTarget, window: StepWindow) -> StepCaptureStep {
        StepCaptureStep {
            step: 1,
            captured_at: "2026-10-18T09:00:01.000Z".into(),
            click_type: StepClickType::Left,
            location: StepPoint { x: 100.0, y: 900.0 },
            drag_to: None,
            display: Some(display()),
            image: StepImage::Captured {
                file_name: "step-001.png".into(),
                width: 3024,
                height: 1964,
            },
            window,
            target,
            cursor: Some(StepCursor {
                file_name: "step-001-cursor.png".into(),
                size: StepPoint { x: 17.0, y: 23.0 },
                hotspot: StepPoint { x: 4.0, y: 4.0 },
            }),
        }
    }

    fn labeled(role: &str, label: &str) -> StepTarget {
        StepTarget::Labeled {
            role: role.into(),
            label: label.into(),
        }
    }

    #[test]
    fn step_text_falls_back_to_the_text_under_the_click() {
        let unavailable = || StepTarget::Unavailable {
            reason: StepTargetUnavailableReason::NotTrusted,
            code: None,
        };
        let finder = window("Finder", display().frame);
        assert_eq!(
            step_text(&step(unavailable(), finder.clone()), Some(" Applications ")),
            "Click on \"Applications\""
        );
        assert_eq!(
            step_text(
                &step(unavailable(), window("Dock", display().frame)),
                Some("Finder")
            ),
            "Click the \"Finder\" icon in the Dock"
        );
        assert_eq!(
            step_text(
                &step(labeled("AXButton", "Save"), finder.clone()),
                Some("Cancel")
            ),
            "Click the \"Save\" button"
        );
        assert_eq!(
            step_text(&step(unavailable(), finder), Some("  ")),
            "Click in the Finder window"
        );
    }

    #[test]
    fn clicks_outside_windows_name_the_menu_bar_menus_and_dock() {
        let unavailable = || StepTarget::Unavailable {
            reason: StepTargetUnavailableReason::NotTrusted,
            code: None,
        };
        let at = |target: StepTarget, window: StepWindow, y: f64| {
            let mut step = step(target, window);
            step.location.y = y;
            step
        };
        let finder = window("Finder", display().frame);
        let session = StepCaptureSession {
            schema_version: STEP_CAPTURE_SCHEMA_VERSION,
            session_id: "s".into(),
            started_at: "2026-10-18T09:00:00.000Z".into(),
            ended_at: None,
            steps: vec![
                at(unavailable(), StepWindow::None, 960.0),
                at(labeled("AXStaticText", "Documents"), finder.clone(), 300.0),
                at(labeled("AXMenuBarItem", "Go"), StepWindow::None, 12.0),
                at(labeled("AXMenuItem", "Downloads"), StepWindow::None, 240.0),
                at(unavailable(), StepWindow::None, 12.0),
                at(unavailable(), StepWindow::None, 960.0),
                at(unavailable(), StepWindow::None, 500.0),
            ],
        };
        let texts = build_guide(&session, "Dimo Uzunov".into(), None)
            .items
            .into_iter()
            .map(|item| match item {
                GuideItem::Step { text, .. } => text,
                other => panic!("unexpected {other:?}"),
            })
            .collect::<Vec<_>>();
        assert_eq!(
            texts,
            [
                "Click the \"Finder\" icon in the Dock",
                "Click on \"Documents\"",
                "Click the \"Go\" menu",
                "Click \"Downloads\" in the \"Go\" menu",
                "Click in the menu bar",
                "Click in the Dock",
                "Click here",
            ]
        );
    }

    #[test]
    fn a_menu_item_over_a_window_is_still_in_the_menu() {
        let at = |target: StepTarget, window: StepWindow, x: f64, y: f64| {
            let mut step = step(target, window);
            step.location = StepPoint { x, y };
            step
        };
        let finder = window("Finder", display().frame);
        let session = StepCaptureSession {
            schema_version: STEP_CAPTURE_SCHEMA_VERSION,
            session_id: "s".into(),
            started_at: "2026-10-18T09:00:00.000Z".into(),
            ended_at: None,
            steps: vec![
                at(
                    labeled("AXMenuBarItem", "Go"),
                    StepWindow::None,
                    261.0,
                    15.0,
                ),
                at(
                    labeled("AXStaticText", "Utilities"),
                    finder.clone(),
                    450.0,
                    395.0,
                ),
                at(
                    labeled("AXStaticText", "Notes"),
                    finder.clone(),
                    450.0,
                    395.0,
                ),
                at(
                    labeled("AXMenuBarItem", "Edit"),
                    StepWindow::None,
                    181.0,
                    15.0,
                ),
                at(labeled("AXStaticText", "Name"), finder, 900.0, 395.0),
            ],
        };
        let guide = build_guide(&session, "Dimo Uzunov".into(), None);
        let texts = guide
            .items
            .iter()
            .map(|item| match item {
                GuideItem::Step { text, .. } => text.as_str(),
                other => panic!("unexpected {other:?}"),
            })
            .collect::<Vec<_>>();
        assert_eq!(
            texts,
            [
                "Click the \"Go\" menu",
                "Click \"Utilities\" in the \"Go\" menu",
                "Click on \"Notes\"",
                "Click the \"Edit\" menu",
                "Click on \"Name\"",
            ]
        );
        let GuideItem::Step {
            image: Some(image), ..
        } = &guide.items[1]
        else {
            panic!("no image");
        };
        assert_eq!((image.crop.x, image.crop.y), (0.0, 0.0));
    }

    /// Rebuilds a recorded session's guide with screenshot labels:
    /// `STEP_GUIDE_SAMPLE_DIR=<session folder> cargo test relabel_sample_guide -- --ignored`
    #[test]
    #[ignore]
    fn relabel_sample_guide() {
        let Ok(directory) = std::env::var("STEP_GUIDE_SAMPLE_DIR") else {
            return;
        };
        let directory = std::path::PathBuf::from(directory);
        let session: StepCaptureSession =
            serde_json::from_slice(&std::fs::read(directory.join("manifest.json")).unwrap())
                .unwrap();
        let guide = build_guide(&session, author_name(), Some(&directory));
        for item in &guide.items {
            if let GuideItem::Step { text, .. } = item {
                println!("STEP {text}");
            }
        }
        write_guide(&directory, &guide).unwrap();
    }

    #[test]
    fn step_text_names_the_control_and_the_app() {
        let finder = window(
            "Finder",
            StepRect {
                x: 0.0,
                y: 0.0,
                width: 900.0,
                height: 600.0,
            },
        );
        assert_eq!(
            default_step_text(&step(labeled("AXButton", "Save"), finder.clone())),
            "Click the \"Save\" button"
        );
        assert_eq!(
            default_step_text(&step(labeled("AXStaticText", "Documents"), finder.clone())),
            "Click on \"Documents\""
        );
        assert_eq!(
            default_step_text(&step(
                labeled("AXDockItem", "Finder"),
                window("Dock", display().frame)
            )),
            "Click the \"Finder\" icon in the Dock"
        );
        assert_eq!(
            default_step_text(&step(
                StepTarget::Unlabeled {
                    role: "AXButton".into()
                },
                finder.clone()
            )),
            "Click the button in Finder"
        );
        assert_eq!(
            default_step_text(&step(
                StepTarget::Unlabeled {
                    role: "AXGroup".into()
                },
                finder
            )),
            "Click in the Finder window"
        );
        assert_eq!(
            default_step_text(&step(
                StepTarget::Unavailable {
                    reason: StepTargetUnavailableReason::NotTrusted,
                    code: None
                },
                StepWindow::None
            )),
            "Click here"
        );
        let mut double = step(labeled("AXCell", "Report.pdf"), StepWindow::None);
        double.click_type = StepClickType::Double;
        assert_eq!(
            default_step_text(&double),
            "Double-click the \"Report.pdf\" item"
        );
    }

    #[test]
    fn long_labels_are_shortened() {
        let label = "word ".repeat(30);
        let text = default_step_text(&step(labeled("AXButton", &label), StepWindow::None));
        assert!(text.contains('…'));
        assert!(text.chars().count() < 90);
    }

    #[test]
    fn title_lists_the_apps_without_system_owners() {
        let mut session = StepCaptureSession {
            schema_version: STEP_CAPTURE_SCHEMA_VERSION,
            session_id: "s".into(),
            started_at: "2026-10-18T09:00:00.000Z".into(),
            ended_at: Some("2026-10-18T09:01:30.000Z".into()),
            steps: Vec::new(),
        };
        assert_eq!(default_title(&session), "Step capture");
        for owner in ["Dock", "Finder", "TextEdit", "Finder"] {
            session.steps.push(step(
                labeled("AXButton", "x"),
                window(owner, display().frame),
            ));
        }
        assert_eq!(default_title(&session), "Finder and TextEdit");
        assert_eq!(
            duration_text(&session.started_at, session.ended_at.as_deref()),
            "2 minutes"
        );
        assert_eq!(duration_text(&session.started_at, None), "1 minute");
    }

    #[test]
    fn a_big_window_frames_the_step_and_a_menu_does_not() {
        let big = step(
            labeled("AXButton", "x"),
            window(
                "Finder",
                StepRect {
                    x: 10.0,
                    y: 20.0,
                    width: 900.0,
                    height: 600.0,
                },
            ),
        );
        let image = guide_image(&big, false).unwrap();
        assert_eq!(
            image.crop,
            PxRect {
                x: 20.0,
                y: 40.0,
                width: 1800.0,
                height: 1200.0
            }
        );
        assert_eq!(
            image.click,
            PxPoint {
                x: 200.0,
                y: 1800.0
            }
        );
        let cursor = image.cursor.unwrap();
        assert_eq!((cursor.width, cursor.hotspot.x), (34.0, 8.0));

        let menu = step(
            labeled("AXMenuItem", "x"),
            window(
                "Finder",
                StepRect {
                    x: 10.0,
                    y: 20.0,
                    width: 200.0,
                    height: 300.0,
                },
            ),
        );
        assert_eq!(guide_image(&menu, false).unwrap().crop.width, 3024.0);
    }

    #[test]
    fn the_visible_rect_is_zoomed_centred_and_clamped() {
        let mut image = GuideImage {
            file_name: "step-001.png".into(),
            width: 3024,
            height: 1964,
            crop: PxRect {
                x: 0.0,
                y: 0.0,
                width: 3024.0,
                height: 1964.0,
            },
            click: PxPoint {
                x: 1512.0,
                y: 982.0,
            },
            drag_to: None,
            cursor: None,
            zoom: 2.0,
        };
        let rect = visible_rect(&image);
        let aspect = FRAME_WIDTH / FRAME_HEIGHT;
        assert!((rect.width / rect.height - aspect).abs() < 1e-9);
        assert!((rect.width - 1512.0).abs() < 1e-9);
        assert!((rect.x + rect.width / 2.0 - 1512.0).abs() < 1e-9);

        // A click at the bottom edge pins the view to the bottom.
        image.click = PxPoint { x: 10.0, y: 1960.0 };
        let rect = visible_rect(&image);
        assert_eq!(rect.x, 0.0);
        assert!((rect.y + rect.height - 1964.0).abs() < 1e-9);

        // Zooming never shows fewer than 1000 px across.
        image.zoom = 4.0;
        assert_eq!(visible_rect(&image).width, 1000.0);

        // Zoom 1 covers the frame with the whole width of a taller area.
        image.zoom = 1.0;
        assert_eq!(visible_rect(&image).width, 3024.0);
    }

    #[test]
    fn the_guide_round_trips_through_json() {
        let session = StepCaptureSession {
            schema_version: STEP_CAPTURE_SCHEMA_VERSION,
            session_id: "s".into(),
            started_at: "2026-10-18T09:00:00.000Z".into(),
            ended_at: Some("2026-10-18T09:00:30.000Z".into()),
            steps: vec![step(labeled("AXButton", "Save"), StepWindow::None)],
        };
        let mut guide = build_guide(&session, "Dimo Uzunov".into(), None);
        guide.items.push(GuideItem::Note {
            id: "note-1".into(),
            text: "Done.".into(),
        });
        assert_eq!(guide.byline(), "Dimo Uzunov | 1 step | 1 minute");
        assert_eq!(guide.date, "18 October 2026");
        let json = serde_json::to_string(&guide).unwrap();
        assert!(json.contains("\"kind\":\"note\""));
        let back: StepGuide = serde_json::from_str(&json).unwrap();
        assert_eq!(back, guide);
    }
}
