//! `clips://` control links, one per Stream Deck button.
//!
//! - `clips://pause` toggles pause; `?state=on` pauses, `?state=off` resumes
//! - `clips://stop` stops the running recording
//! - `clips://dictate?mode=hands-free` starts dictation that keeps going until
//!   the next press (of this link, the dictation key or Escape)
//! - `clips://dictate?mode=push&state=down|up` is push-to-talk: dictation runs
//!   between the two links (a button that sends one URL on press and one on
//!   release)
//!
//! Control links act without opening the popover, so the app in front keeps
//! focus and dictation pastes into it.

use tauri::{AppHandle, Emitter};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DictateLink {
    HandsFree,
    PushDown,
    PushUp,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ControlLink {
    /// `None` toggles; `Some(true)` pauses; `Some(false)` resumes.
    Pause(Option<bool>),
    Stop,
    Dictate(DictateLink),
}

fn state_param(url: &url::Url) -> Result<Option<bool>, ()> {
    match url
        .query_pairs()
        .find(|(key, _)| key == "state")
        .map(|(_, value)| value.into_owned())
        .as_deref()
    {
        None => Ok(None),
        Some("on") => Ok(Some(true)),
        Some("off") => Ok(Some(false)),
        Some(_) => Err(()),
    }
}

/// The control link `raw` asks for, or `None` for any other link (which
/// keeps the old behaviour: open the popover and let it read the link).
pub fn parse_control_link(raw: &str) -> Option<ControlLink> {
    let url = url::Url::parse(raw).ok()?;
    if url.scheme() != "clips" {
        return None;
    }
    let param = |name: &str| {
        url.query_pairs()
            .find(|(key, _)| key == name)
            .map(|(_, value)| value.into_owned())
    };
    match url.host_str()? {
        "pause" => state_param(&url).ok().map(ControlLink::Pause),
        "stop" => Some(ControlLink::Stop),
        "dictate" => match (param("mode").as_deref(), param("state").as_deref()) {
            (Some("hands-free"), None) => Some(ControlLink::Dictate(DictateLink::HandsFree)),
            (Some("push"), Some("down")) => Some(ControlLink::Dictate(DictateLink::PushDown)),
            (Some("push"), Some("up")) => Some(ControlLink::Dictate(DictateLink::PushUp)),
            _ => None,
        },
        _ => None,
    }
}

/// Acts on a control link.
pub fn handle_control_link(app: &AppHandle, link: ControlLink) {
    match link {
        ControlLink::Pause(state) => {
            let event = match state {
                None => "clips:recorder-toggle-pause",
                Some(true) => "clips:recorder-pause",
                Some(false) => "clips:recorder-resume",
            };
            let _ = app.emit(event, ());
        }
        ControlLink::Stop => {
            crate::tray::stop_recording_from_link(app);
        }
        ControlLink::Dictate(action) => {
            crate::shortcuts::dictate_from_link(app, action);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_pause_and_stop() {
        assert_eq!(
            parse_control_link("clips://pause"),
            Some(ControlLink::Pause(None))
        );
        assert_eq!(
            parse_control_link("clips://pause?state=on"),
            Some(ControlLink::Pause(Some(true)))
        );
        assert_eq!(
            parse_control_link("clips://pause?state=off"),
            Some(ControlLink::Pause(Some(false)))
        );
        assert_eq!(parse_control_link("clips://pause?state=maybe"), None);
        assert_eq!(parse_control_link("clips://stop"), Some(ControlLink::Stop));
    }

    #[test]
    fn parses_dictation_modes() {
        assert_eq!(
            parse_control_link("clips://dictate?mode=hands-free"),
            Some(ControlLink::Dictate(DictateLink::HandsFree))
        );
        assert_eq!(
            parse_control_link("clips://dictate?mode=push&state=down"),
            Some(ControlLink::Dictate(DictateLink::PushDown))
        );
        assert_eq!(
            parse_control_link("clips://dictate?mode=push&state=up"),
            Some(ControlLink::Dictate(DictateLink::PushUp))
        );
        assert_eq!(parse_control_link("clips://dictate?mode=push"), None);
        assert_eq!(parse_control_link("clips://dictate"), None);
    }

    #[test]
    fn other_links_are_left_alone() {
        for raw in [
            "clips://record?source=window",
            "clips://camera",
            "https://pause",
            "clips://somewhere-else",
            "not a url",
        ] {
            assert_eq!(parse_control_link(raw), None, "{raw}");
        }
    }
}
