//! The small commands: what the page asks the shell for, one line each on
//! the page side (client/src/lib/platform/desktop.ts). Every argument here
//! came from the page and is treated accordingly, even though the page is
//! bundled: a URL is checked before it is opened, and a count is bounded.
//!
//! One command does touch the file system on the page's say, and it is worth
//! being explicit about rather than leaving to be discovered. `notify` writes
//! the sender's avatar to a file, because a Windows toast takes its image as a
//! path and nothing else. What keeps that narrow:
//!
//!   - Only a `data:image/png;base64,` string is accepted. Not a path, not a
//!     URL, not another scheme, so the page cannot name a file to read or a
//!     host to reach.
//!   - The shell chooses the name, from a hash of the bytes, and the
//!     directory, which is this app's own cache. The page influences neither.
//!   - The decoded image is size-capped, so a page that has somehow been
//!     replaced cannot fill the disk one notification at a time.

use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash as _, Hasher as _};
use std::path::PathBuf;
use std::sync::atomic::Ordering;

use base64::Engine as _;
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

/// The largest avatar worth accepting, decoded. The page sends a 96px PNG,
/// which is a few kilobytes; this is loose enough never to reject a real one
/// and tight enough that the cache cannot run away.
const MAX_ICON_BYTES: usize = 512 * 1024;

const ICON_PREFIX: &str = "data:image/png;base64,";

/// The sender's avatar on disk, as a path the toast can point at.
///
/// Returns None for anything it does not like, and the notification then goes
/// out without a picture, which is the behaviour this had before there were
/// pictures at all. Nothing here is worth failing a notification over.
fn icon_path(app: &AppHandle, data_url: &str) -> Option<PathBuf> {
    let encoded = data_url.strip_prefix(ICON_PREFIX)?;
    // Rough check before decoding, so an enormous string is refused rather
    // than allocated: base64 is 4 characters per 3 bytes.
    if encoded.len() / 4 * 3 > MAX_ICON_BYTES {
        return None;
    }

    let bytes = base64::engine::general_purpose::STANDARD.decode(encoded).ok()?;
    if bytes.len() > MAX_ICON_BYTES {
        return None;
    }

    // The name is the content, so the same avatar is written once and reused,
    // a changed one lands beside it, and the page has no say in either.
    let mut hasher = DefaultHasher::new();
    bytes.hash(&mut hasher);
    let dir = app.path().app_cache_dir().ok()?.join("notification-icons");
    let path = dir.join(format!("{:016x}.png", hasher.finish()));

    if !path.exists() {
        std::fs::create_dir_all(&dir).ok()?;
        std::fs::write(&path, &bytes).ok()?;
    }
    Some(path)
}

/// A native notification. The page has already decided whether one is
/// wanted and what it may say (lib/settings/desktopNotifications.ts); this only
/// hands the text to the operating system. Nothing is logged.
///
/// `icon` is the sender's avatar as a PNG data URL, already re-encoded and
/// scaled by the page (lib/platform/notificationIcon.ts). It becomes the
/// picture on the toast, beside the app's own name and logo, which Windows
/// draws from the bundle. Note that Windows only shows those two for an
/// *installed* build: the notification plugin sets the AppUserModel ID only
/// when the executable is not running out of target/debug or target/release,
/// so `cargo run` gets a toast attributed to something else entirely.
#[tauri::command]
pub fn notify(
    app: AppHandle,
    title: String,
    body: Option<String>,
    icon: Option<String>,
) -> Result<(), String> {
    let mut builder = app.notification().builder().title(title);
    if let Some(body) = body {
        builder = builder.body(body);
    }
    if let Some(path) = icon.as_deref().and_then(|data| icon_path(&app, data)) {
        builder = builder.icon(path.to_string_lossy().into_owned());
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
