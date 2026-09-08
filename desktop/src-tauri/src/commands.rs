//! The small commands: what the page asks the shell for, one line each on
//! the page side (client/src/lib/platform/desktop.ts). Every argument here
//! came from the page and is treated accordingly, even though the page is
//! bundled: a URL is checked before it is opened, a count is bounded, and
//! nothing here can reach the file system or the network on the page's say.

use std::sync::atomic::Ordering;

use serde::Serialize;
use tauri::{AppHandle, Manager, UserAttentionType};
use tauri_plugin_autostart::ManagerExt as _;
use tauri_plugin_notification::NotificationExt as _;
use tauri_plugin_opener::OpenerExt as _;

use crate::{main_window, Prefs};

#[derive(Serialize)]
pub struct ShellInfo {
    version: String,
    os: &'static str,
    arch: &'static str,
}

#[tauri::command]
pub fn shell_info(app: AppHandle) -> ShellInfo {
    ShellInfo {
        version: app.package_info().version.to_string(),
        os: if cfg!(target_os = "windows") {
            "windows"
        } else if cfg!(target_os = "macos") {
            "macos"
        } else {
            "linux"
        },
        arch: std::env::consts::ARCH,
    }
}

/// Shows the window, brings it out of the tray or from behind other windows
/// and gives it focus. Every path that wants the app in front goes through
/// here: the tray, a second launch, a notification the page reacts to.
pub fn show_main(app: &AppHandle) {
    let Some(window) = main_window(app) else {
        return;
    };
    let _ = window.show();
    let _ = window.unminimize();
    let _ = window.set_focus();
}

#[tauri::command]
pub fn show_window(app: AppHandle) {
    show_main(&app);
}

/// Flashes the taskbar entry (Windows, Linux) or bounces the dock icon
/// (macOS). `urgent` keeps it going until the window is focused; otherwise
/// it is a single nudge. The window itself stays where it is: stealing
/// focus is what this exists to avoid.
#[tauri::command]
pub fn request_attention(app: AppHandle, urgent: bool) {
    if let Some(window) = main_window(&app) {
        let kind = if urgent {
            UserAttentionType::Critical
        } else {
            UserAttentionType::Informational
        };
        let _ = window.request_user_attention(Some(kind));
    }
}

/// The unread count on the app's icon. macOS and Linux (where the desktop
/// supports it) can draw a number; Windows only offers an overlay icon, so
/// there it is a dot, drawn here as pixels rather than shipped as a file.
#[tauri::command]
pub fn set_badge(app: AppHandle, count: u32) -> Result<(), String> {
    let Some(window) = main_window(&app) else {
        return Ok(());
    };

    #[cfg(target_os = "windows")]
    {
        let overlay = if count > 0 { Some(unread_dot()) } else { None };
        window.set_overlay_icon(overlay).map_err(|err| err.to_string())
    }

    #[cfg(not(target_os = "windows"))]
    {
        let badge = if count > 0 { Some(i64::from(count)) } else { None };
        window.set_badge_count(badge).map_err(|err| err.to_string())
    }
}

/// A 16 by 16 red disc with a soft edge, as RGBA. The taskbar overlay is
/// drawn at that size whatever it is handed, so there is nothing to gain
/// from a larger image, and a number would not be legible in it anyway.
#[cfg(target_os = "windows")]
fn unread_dot() -> tauri::image::Image<'static> {
    const SIZE: u32 = 16;
    let centre = (SIZE as f32 - 1.0) / 2.0;
    let radius = SIZE as f32 / 2.0 - 0.5;
    let mut rgba = Vec::with_capacity((SIZE * SIZE * 4) as usize);
    for y in 0..SIZE {
        for x in 0..SIZE {
            let dx = x as f32 - centre;
            let dy = y as f32 - centre;
            let distance = (dx * dx + dy * dy).sqrt();
            // One pixel of anti-aliasing at the rim, opaque inside.
            let coverage = (radius - distance + 0.5).clamp(0.0, 1.0);
            // The palette's --red, so the dot matches the badge in the app.
            rgba.extend_from_slice(&[0xe5, 0x48, 0x4d, (coverage * 255.0) as u8]);
        }
    }
    tauri::image::Image::new_owned(rgba, SIZE, SIZE)
}

/// A native notification. The page has already decided whether one is
/// wanted and what it may say (lib/platform/notifications.ts); this only
/// hands the text to the operating system. Nothing is logged.
#[tauri::command]
pub fn notify(app: AppHandle, title: String, body: Option<String>) -> Result<(), String> {
    let mut builder = app.notification().builder().title(title);
    if let Some(body) = body {
        builder = builder.body(body);
    }
    builder.show().map_err(|err| err.to_string())
}

/// Opens a web link in the system browser. Only http and https: the page
/// has no business launching anything else through this process.
#[tauri::command]
pub fn open_external(app: AppHandle, url: String) -> Result<(), String> {
    let parsed = tauri::Url::parse(&url).map_err(|err| err.to_string())?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err(format!("refusing to open a {} link", parsed.scheme()));
    }
    app.opener()
        .open_url(parsed.as_str(), None::<&str>)
        .map_err(|err| err.to_string())
}

/// The page's copy of the preference is the one that persists; this is the
/// shell being told what it currently is, at start and on every change.
#[tauri::command]
pub fn set_close_to_tray(app: AppHandle, enabled: bool) {
    app.state::<Prefs>()
        .close_to_tray
        .store(enabled, Ordering::Relaxed);
}

#[tauri::command]
pub fn autostart_enabled(app: AppHandle) -> Result<bool, String> {
    app.autolaunch().is_enabled().map_err(|err| err.to_string())
}

/// A registry entry on Windows, a launch agent on macOS, a desktop file on
/// Linux. The entry carries `--minimized`, so a login-time start stays in
/// the tray.
#[tauri::command]
pub fn set_autostart(app: AppHandle, enabled: bool) -> Result<(), String> {
    let launcher = app.autolaunch();
    if enabled {
        launcher.enable()
    } else {
        launcher.disable()
    }
    .map_err(|err| err.to_string())
}
