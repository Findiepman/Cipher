// The Cipher desktop app.
//
// The web client from `client/` is bundled into this binary and served from
// the app's own origin; there is no app logic here, only what a browser tab
// cannot do. In order of how often somebody will notice: a window of its own
// that remembers where it was, a tray icon that keeps the app running when
// the window is closed, native notifications and an unread badge, one
// instance at a time, starting with the computer, and signed auto-updates
// that the page announces and the person approves.
//
// Two files hold the parts that talk to the page: `commands.rs` for the
// small things, `updater.rs` for the update flow. `tray.rs` is the tray.
// Everything the page can call is a command here, so every argument that
// crosses that boundary is checked on this side.

// No console window behind the app on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod tray;
mod updater;

use std::sync::atomic::{AtomicBool, Ordering};

use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder, WindowEvent};
use tauri_plugin_autostart::MacosLauncher;
use tauri_plugin_opener::OpenerExt;
use tauri_plugin_window_state::StateFlags;

/// The one window. Commands and the tray find it by this label.
pub const MAIN_WINDOW: &str = "main";

/// Passed by the autostart entry so a login-time launch stays in the tray
/// instead of putting a window on a desktop nobody has looked at yet.
pub const MINIMIZED_FLAG: &str = "--minimized";

/// Extra WebView2 switches, Windows only.
///
/// Close-to-tray leaves the app running with a hidden window, and a hidden
/// window is a background window: Chromium clamps its timers and can freeze
/// the renderer outright. That would leave the app resident and deaf, which
/// is the opposite of the point, so the three backgrounding behaviours are
/// turned off.
///
/// The first switch is not ours. It is what Tauri passes by default, and
/// `additional_browser_args` replaces that default rather than adding to it,
/// so dropping it would quietly change unrelated WebView2 behaviour.
#[cfg(windows)]
const BROWSER_ARGS: &str = concat!(
    "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection",
    " --disable-background-timer-throttling",
    " --disable-renderer-backgrounding",
    " --disable-backgrounding-occluded-windows",
);

/// Preferences the page pushes into the shell (see `set_close_to_tray`).
/// They default to the safer behaviour so a close before the page has loaded
/// does the same thing as a close after it.
pub struct Prefs {
    pub close_to_tray: AtomicBool,
}

fn main() {
    tauri::Builder::default()
        // First, so a second launch is caught before this one builds a window.
        // The second process hands its arguments over and exits; this one
        // brings its window forward.
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            commands::show_main(app);
        }))
        // Size and position survive a restart. Visibility is left out: whether
        // the window shows at start is decided below, by the flag, not by
        // whether it happened to be hidden in the tray when the app last quit.
        .plugin(
            tauri_plugin_window_state::Builder::new()
                .with_state_flags(StateFlags::all() & !StateFlags::VISIBLE)
                .build(),
        )
        // Links with target=_blank open in the system browser (the plugin
        // intercepts the click on the page side), and `open_external` uses it
        // from here for the same thing on demand.
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            Some(vec![MINIMIZED_FLAG]),
        ))
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(Prefs {
            close_to_tray: AtomicBool::new(true),
        })
        .manage(updater::UpdateState::default())
        .invoke_handler(tauri::generate_handler![
            commands::shell_info,
            commands::show_window,
            commands::request_attention,
            commands::set_badge,
            commands::notify,
            commands::open_external,
            commands::set_close_to_tray,
            commands::autostart_enabled,
            commands::set_autostart,
            updater::check_for_updates,
            updater::pending_update,
            updater::install_update,
        ])
        .setup(|app| {
            let handle = app.handle().clone();
            #[allow(unused_mut)]
            let mut builder = WebviewWindowBuilder::new(app, MAIN_WINDOW, WebviewUrl::default())
                .title("Cipher")
                .inner_size(1180.0, 760.0)
                .min_inner_size(720.0, 480.0)
                // Painted before the page is, so the first frame is the
                // app's own dark ground rather than a white flash.
                .background_color(tauri::window::Color(0x10, 0x0d, 0x0c, 0xff))
                // Shown below, once the saved size and position are on it.
                .visible(false)
                // The page is bundled and has no links out of itself, so a
                // navigation to anywhere but its own origin is either a bug
                // or an attempt. Either way it opens in the browser, not here.
                .on_navigation(move |target| {
                    if is_app_origin(target) {
                        return true;
                    }
                    if let Err(err) = handle.opener().open_url(target.as_str(), None::<&str>) {
                        eprintln!("could not open {target} in the browser: {err}");
                    }
                    false
                });

            #[cfg(windows)]
            {
                builder = builder.additional_browser_args(BROWSER_ARGS);
            }

            let window = builder.build()?;

            tray::install(app.handle())?;

            let started_minimized = std::env::args().any(|arg| arg == MINIMIZED_FLAG);
            if !started_minimized {
                window.show()?;
            }

            updater::start_background_checks(app.handle().clone());
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                if window.label() != MAIN_WINDOW {
                    return;
                }
                // macOS keeps an app alive with no windows as a matter of
                // course and the dock icon brings it back, so there the close
                // button always hides. Elsewhere it is the preference.
                let keep_running = cfg!(target_os = "macos")
                    || window
                        .state::<Prefs>()
                        .close_to_tray
                        .load(Ordering::Relaxed);
                if keep_running {
                    api.prevent_close();
                    if let Err(err) = window.hide() {
                        eprintln!("could not hide the window: {err}");
                    }
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("failed to start the Cipher desktop app")
        .run(|app, event| {
            // The dock icon on macOS, when the window is hidden.
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen { .. } = event {
                commands::show_main(app);
            }
            let _ = (app, &event);
        });
}

/// Whether a navigation stays inside the app.
///
/// The bundled page lives at `tauri://localhost` (macOS, Linux) or
/// `http://tauri.localhost` (Windows), and in development at the Vite dev
/// server. Nothing else is the app.
fn is_app_origin(url: &tauri::Url) -> bool {
    match url.scheme() {
        "tauri" => true,
        "http" | "https" => {
            let host = url.host_str().unwrap_or("");
            host == "tauri.localhost"
                || (cfg!(debug_assertions) && (host == "localhost" || host == "127.0.0.1"))
        }
        _ => false,
    }
}

/// Used by the tray and the single-instance hook, which have an `AppHandle`
/// and no window.
pub fn main_window(app: &AppHandle) -> Option<tauri::WebviewWindow> {
    app.get_webview_window(MAIN_WINDOW)
}
