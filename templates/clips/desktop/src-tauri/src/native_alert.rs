//! A native macOS alert for decisions that block an action started outside
//! the popover, such as the record shortcut once free clips are used up.

use tauri::AppHandle;

/// Shows an app-modal alert and returns the index of the button pressed, in
/// the order `buttons` were given (the first is the default, on Return).
#[tauri::command]
pub async fn show_native_alert(
    app: AppHandle,
    title: String,
    message: String,
    buttons: Vec<String>,
) -> Result<usize, String> {
    if buttons.is_empty() {
        return Err("A native alert needs at least one button.".into());
    }
    run_alert(app, title, message, buttons).await
}

#[cfg(target_os = "macos")]
async fn run_alert(
    app: AppHandle,
    title: String,
    message: String,
    buttons: Vec<String>,
) -> Result<usize, String> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    // NSAlert is AppKit UI, so it runs on the main thread; the command waits
    // for the answer without blocking it.
    app.run_on_main_thread(move || {
        use objc2::MainThreadMarker;
        use objc2_app_kit::{NSAlert, NSApplication};
        use objc2_foundation::NSString;

        let Some(mtm) = MainThreadMarker::new() else {
            let _ = tx.send(Err("Native alert ran off the main thread.".to_string()));
            return;
        };
        // A menu bar app is not frontmost, and the alert would open behind
        // whatever the user is working in.
        #[allow(deprecated)]
        NSApplication::sharedApplication(mtm).activateIgnoringOtherApps(true);
        let alert = NSAlert::new(mtm);
        alert.setMessageText(&NSString::from_str(&title));
        alert.setInformativeText(&NSString::from_str(&message));
        for button in &buttons {
            alert.addButtonWithTitle(&NSString::from_str(button));
        }
        // NSAlertFirstButtonReturn is 1000; later buttons count up from it.
        let response = alert.runModal() - 1000;
        let index = usize::try_from(response)
            .ok()
            .filter(|index| *index < buttons.len());
        let _ = tx.send(index.ok_or_else(|| {
            format!("Native alert returned an unknown response: {response}")
        }));
    })
    .map_err(|err| format!("Native alert could not start: {err}"))?;
    rx.await
        .map_err(|_| "Native alert closed without an answer.".to_string())?
}

#[cfg(not(target_os = "macos"))]
async fn run_alert(
    _app: AppHandle,
    _title: String,
    _message: String,
    _buttons: Vec<String>,
) -> Result<usize, String> {
    Err("Native alerts are only available on macOS.".into())
}
