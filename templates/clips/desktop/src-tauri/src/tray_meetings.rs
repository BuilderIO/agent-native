//! Upcoming-meetings section for the tray menu.
//!
//! Tauri 2 menu items don't carry arbitrary payloads — we encode the meeting
//! id directly in the menu item id (`meeting:<id>`) and `tray.rs` decodes it
//! when the click event fires. The submenu lists at most 3 events; clicking
//! one opens the main popover and emits `meetings:open` with the id so the
//! renderer can navigate to the meeting.

use chrono::{Datelike, Duration as ChronoDuration, Local, Timelike, Weekday};
use serde::{Deserialize, Serialize};
use tauri::{
    menu::{MenuItem, Submenu, SubmenuBuilder},
    AppHandle, Wry,
};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MeetingItem {
    pub id: String,
    pub title: String,
    /// RFC3339 string or preformatted display text — purely cosmetic for the
    /// menu label.
    #[serde(default)]
    pub when_label: Option<String>,
}

pub const MEETING_ID_PREFIX: &str = "meeting:";

/// Build the "Start Meeting Notes" submenu populated with up to 3 events. If
/// the list is empty, returns a submenu containing a single disabled "No
/// meetings ready" item — keeps the menu structure stable. Selecting a real
/// meeting starts live notes immediately.
pub fn build_meetings_section(
    app: &AppHandle,
    upcoming: Vec<MeetingItem>,
) -> Result<Submenu<Wry>, Box<dyn std::error::Error>> {
    let mut builder: SubmenuBuilder<'_, Wry, AppHandle> =
        SubmenuBuilder::new(app, "Start Meeting Notes");

    if upcoming.is_empty() {
        let placeholder = MenuItem::with_id(
            app,
            "meeting:none",
            "No meetings ready",
            false,
            None::<&str>,
        )?;
        builder = builder.item(&placeholder);
    } else {
        for m in upcoming.into_iter().take(3) {
            let label = match &m.when_label {
                Some(when) => format!("{} — {}", m.title, friendly_when_label(when)),
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
    // Only the recording pill should open — the popover's background listener
    // handles this event and shows the pill, so we must NOT show the popover
    // window itself here.
    let _ = app.emit(
        "meetings:start-transcription",
        serde_json::json!({ "meetingId": id, "joinUrl": null, "reason": "tray" }),
    );
    true
}

fn friendly_when_label(raw: &str) -> String {
    chrono::DateTime::parse_from_rfc3339(raw)
        .map(|start| {
            let local_start = start.with_timezone(&Local);
            format_friendly_meeting_time(local_start, Local::now().date_naive())
        })
        .unwrap_or_else(|_| raw.to_string())
}

fn format_friendly_meeting_time<Tz>(start: chrono::DateTime<Tz>, today: chrono::NaiveDate) -> String
where
    Tz: chrono::TimeZone,
{
    let date = start.date_naive();
    let time = format_clock_time(start.hour(), start.minute());

    if date == today {
        return format!("Today at {time}");
    }
    if date == today + ChronoDuration::days(1) {
        return format!("Tomorrow at {time}");
    }
    if date > today && date <= today + ChronoDuration::days(6) {
        return format!("{} at {time}", short_weekday(start.weekday()));
    }
    if date.year() == today.year() {
        return format!("{} {} at {time}", short_month(start.month()), date.day());
    }

    format!(
        "{} {}, {} at {time}",
        short_month(start.month()),
        date.day(),
        date.year()
    )
}

fn format_clock_time(hour: u32, minute: u32) -> String {
    let suffix = if hour < 12 { "AM" } else { "PM" };
    let hour_12 = match hour % 12 {
        0 => 12,
        value => value,
    };
    format!("{hour_12}:{minute:02} {suffix}")
}

fn short_weekday(weekday: Weekday) -> &'static str {
    match weekday {
        Weekday::Mon => "Mon",
        Weekday::Tue => "Tue",
        Weekday::Wed => "Wed",
        Weekday::Thu => "Thu",
        Weekday::Fri => "Fri",
        Weekday::Sat => "Sat",
        Weekday::Sun => "Sun",
    }
}

fn short_month(month: u32) -> &'static str {
    match month {
        1 => "Jan",
        2 => "Feb",
        3 => "Mar",
        4 => "Apr",
        5 => "May",
        6 => "Jun",
        7 => "Jul",
        8 => "Aug",
        9 => "Sep",
        10 => "Oct",
        11 => "Nov",
        12 => "Dec",
        _ => "",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::{FixedOffset, TimeZone};

    fn fixed_datetime(
        year: i32,
        month: u32,
        day: u32,
        hour: u32,
        minute: u32,
    ) -> chrono::DateTime<FixedOffset> {
        FixedOffset::west_opt(7 * 60 * 60)
            .unwrap()
            .with_ymd_and_hms(year, month, day, hour, minute, 0)
            .unwrap()
    }

    #[test]
    fn formats_today_meetings() {
        let today = fixed_datetime(2026, 5, 19, 8, 30).date_naive();
        let start = fixed_datetime(2026, 5, 19, 10, 45);

        assert_eq!(
            format_friendly_meeting_time(start, today),
            "Today at 10:45 AM"
        );
    }

    #[test]
    fn formats_tomorrow_meetings() {
        let today = fixed_datetime(2026, 5, 19, 8, 30).date_naive();
        let start = fixed_datetime(2026, 5, 20, 15, 0);

        assert_eq!(
            format_friendly_meeting_time(start, today),
            "Tomorrow at 3:00 PM"
        );
    }

    #[test]
    fn formats_near_future_meetings_with_weekday() {
        let today = fixed_datetime(2026, 5, 19, 8, 30).date_naive();
        let start = fixed_datetime(2026, 5, 22, 9, 5);

        assert_eq!(format_friendly_meeting_time(start, today), "Fri at 9:05 AM");
    }

    #[test]
    fn formats_later_meetings_with_date() {
        let today = fixed_datetime(2026, 5, 19, 8, 30).date_naive();
        let same_year = fixed_datetime(2026, 6, 4, 12, 0);
        let next_year = fixed_datetime(2027, 1, 7, 0, 15);

        assert_eq!(
            format_friendly_meeting_time(same_year, today),
            "Jun 4 at 12:00 PM"
        );
        assert_eq!(
            format_friendly_meeting_time(next_year, today),
            "Jan 7, 2027 at 12:15 AM"
        );
    }
}
