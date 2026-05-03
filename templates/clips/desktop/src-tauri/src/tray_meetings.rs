//! Upcoming-meetings section for the tray menu.
//!
//! Tauri 2 menu items don't carry arbitrary payloads — we encode the meeting
//! id directly in the menu item id (`meeting:<id>`) and `tray.rs` decodes it
//! when the click event fires. The submenu lists at most 3 events; clicking
//! one opens the main popover and emits `meetings:open` with the id so the
//! renderer can navigate to the meeting.

use serde::{Deserialize, Serialize};
use tauri::{
    menu::{MenuItem, Submenu, SubmenuBuilder},
    AppHandle, Manager, Wry,
};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MeetingItem {
    pub id: String,
    pub title: String,
    /// RFC3339 string — purely cosmetic for the menu label.
    #[serde(default)]
    pub when_label: Option<String>,
}

pub const MEETING_ID_PREFIX: &str = "meeting:";

/// Build the "Upcoming Meetings" submenu populated with up to 3 events. If
/// the list is empty, returns a submenu containing a single disabled "No
/// upcoming meetings" item — keeps the menu structure stable.
pub fn build_meetings_section(
    app: &AppHandle,
    upcoming: Vec<MeetingItem>,
) -> Result<Submenu<Wry>, Box<dyn std::error::Error>> {
    let mut builder: SubmenuBuilder<'_, Wry, AppHandle> =
        SubmenuBuilder::new(app, "Upcoming Meetings");

    if upcoming.is_empty() {
        let placeholder = MenuItem::with_id(
            app,
            "meeting:none",
            "No upcoming meetings",
            false,
            None::<&str>,
        )?;
        builder = builder.item(&placeholder);
    } else {
        for m in upcoming.into_iter().take(3) {
            let label = match &m.when_label {
                Some(when) => format!("{} — {}", m.title, when),
                None => m.title.clone(),
            };
            let id = format!("{}{}", MEETING_ID_PREFIX, m.id);
            let item = MenuItem::with_id(app, id, label, true, None::<&str>)?;
            builder = builder.item(&item);
        }
    }

    Ok(builder.build()?)
}

/// Helper used from the tray's on-menu-event handler. Decodes the meeting id
/// from a menu item id of the form `meeting:<id>` and emits the event the
/// renderer listens for. Returns `true` if the id matched.
pub fn handle_meeting_menu_click(app: &AppHandle, menu_id: &str) -> bool {
    let Some(id) = menu_id.strip_prefix(MEETING_ID_PREFIX) else {
        return false;
    };
    if id.is_empty() || id == "none" {
        return false;
    }
    use tauri::Emitter;
    if let Some(window) = app.get_webview_window("popover") {
        let _ = window.show();
        let _ = window.set_focus();
    }
    let _ = app.emit(
        "meetings:open",
        serde_json::json!({ "meetingId": id }),
    );
    true
}
