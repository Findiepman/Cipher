// The Cipher desktop shell.
//
// One native window, no browser chrome, showing the deployed web app. There is
// no app logic here on purpose: `client/` is the one UI codebase (root
// AGENTS.md) and this binary only provides what a browser tab cannot: a
// window of its own, a dock or taskbar entry and signed auto-updates.
//
// The page is loaded from a remote origin, so it gets no IPC access: Tauri's
// ACL grants commands to `tauri://` content only, and nothing in
// `capabilities/` opens that up. The updater therefore runs entirely on the
// Rust side, and a compromised site cannot reach the file system through this
// shell any more than it could through a browser.

// No console window behind the app on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::{AppHandle, Url, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};
use tauri_plugin_opener::OpenerExt;
use tauri_plugin_updater::UpdaterExt;

/// Where a release build points unless told otherwise.
const PRODUCTION_URL: &str = "https://cipher.findiepman.dev";

/// Where a debug build (`npm run dev` in desktop/) points unless told
/// otherwise: the Vite dev server from `npm run dev` at the repo root.
const DEVELOPMENT_URL: &str = "http://localhost:5173";

/// The site the window shows.
///
/// `CIPHER_DESKTOP_URL` in the environment at build time wins. Otherwise a
/// debug build shows the dev server and a release build shows the deployed
/// site. The value is compiled in rather than read at run time, so a shipped
/// binary cannot be pointed at another origin by editing a file next to it.
fn app_url() -> Url {
    let configured = option_env!("CIPHER_DESKTOP_URL").filter(|value| !value.trim().is_empty());
    let raw = configured.unwrap_or(if cfg!(debug_assertions) {
        DEVELOPMENT_URL
    } else {
        PRODUCTION_URL
    });
    Url::parse(raw).unwrap_or_else(|err| panic!("CIPHER_DESKTOP_URL is not a URL ({raw}): {err}"))
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            let url = app_url();
            let origin = url.origin();
            let handle = app.handle().clone();

            WebviewWindowBuilder::new(app, "main", WebviewUrl::External(url))
                .title("Cipher")
                .inner_size(1180.0, 760.0)
                .min_inner_size(720.0, 480.0)
                // A window with no address bar and no back button must not
                // wander off. Anything outside the app's origin opens in the
                // system browser instead of replacing the app.
                .on_navigation(move |target| {
                    if target.origin() == origin {
                        return true;
                    }
                    if let Err(err) = handle.opener().open_url(target.as_str(), None::<&str>) {
                        eprintln!("could not open {target} in the browser: {err}");
                    }
                    false
                })
                .build()?;

            // Only a release build checks: a debug build is not installed
            // anywhere an update could replace, and the endpoint answers with
            // whatever the last real release was.
            if !cfg!(debug_assertions) {
                let handle = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    if let Err(err) = offer_update(handle).await {
                        // Offline, no release yet or a bad manifest: none of
                        // it is worth interrupting the user for.
                        eprintln!("update check skipped: {err}");
                    }
                });
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("failed to start the Cipher desktop shell");
}

/// Ask the updater endpoint whether a newer signed build exists and, if the
/// user agrees, install it and restart. The plugin verifies the minisign
/// signature against the public key in `tauri.conf.json` before anything is
/// written, which is what the "auto-update must verify signatures" rule in
/// AGENTS.md asks for.
async fn offer_update(app: AppHandle) -> tauri_plugin_updater::Result<()> {
    let Some(update) = app.updater()?.check().await? else {
        return Ok(());
    };

    let question = format!(
        "Cipher {} is available (you have {}). Install it and restart now?",
        update.version, update.current_version
    );
    let dialog = app.clone();
    // A blocking dialog may not run on the main thread, and the async runtime
    // should not be held up by a person reading a message box either.
    let accepted = tauri::async_runtime::spawn_blocking(move || {
        dialog
            .dialog()
            .message(question)
            .title("Update available")
            .buttons(MessageDialogButtons::OkCancelCustom(
                "Install and restart".into(),
                "Not now".into(),
            ))
            .blocking_show()
    })
    .await
    .unwrap_or(false);

    if !accepted {
        return Ok(());
    }

    update.download_and_install(|_chunk, _total| {}, || {}).await?;
    app.restart()
}
