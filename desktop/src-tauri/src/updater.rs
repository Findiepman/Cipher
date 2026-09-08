//! Auto-update, the shell's half.
//!
//! The shell checks the release manifest on its own: once shortly after
//! start, then every few hours for as long as it runs. Whatever it finds is
//! held here and announced to the page (`update:available`), which shows a
//! banner. Nothing is downloaded until the page calls `install_update`,
//! which is a button a person pressed. The plugin verifies the minisign
//! signature against the public key in tauri.conf.json before a byte is
//! written, and a package that fails that check is never installed.
//!
//! A failed check is not an error anyone is told about: offline, no release
//! yet, GitHub down. The page can ask by hand (`check_for_updates`) and
//! gets the reason then. desktop/UPDATES.md is the release side of this.

use std::sync::Mutex;
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_updater::{Update, UpdaterExt};

/// How long after start the first check runs. Long enough for the page to
/// be up and listening, short enough that a person who just opened the app
/// to see the update hears about it.
const FIRST_CHECK: Duration = Duration::from_secs(8);
/// The app can stay open for weeks. This is how stale it may get.
const CHECK_INTERVAL: Duration = Duration::from_secs(4 * 60 * 60);

#[derive(Default)]
pub struct UpdateState {
    /// The newest update found and not yet installed.
    pending: Mutex<Option<Update>>,
}

/// What the page is shown about an update. Not the download URL, not the
/// signature: those are the plugin's business.
#[derive(Serialize, Clone)]
pub struct UpdateInfo {
    version: String,
    notes: Option<String>,
    date: Option<String>,
}

impl UpdateInfo {
    fn from(update: &Update) -> Self {
        Self {
            version: update.version.clone(),
            notes: update.body.clone().filter(|notes| !notes.trim().is_empty()),
            date: update.date.map(|date| date.to_string()),
        }
    }
}

#[derive(Serialize)]
#[serde(tag = "status", rename_all = "lowercase")]
pub enum UpdateCheck {
    /// A debug build. There is nothing installed for it to replace.
    Disabled,
    None,
    Available { update: UpdateInfo },
    Error { message: String },
}

#[derive(Serialize, Clone)]
struct Progress {
    downloaded: u64,
    total: Option<u64>,
}

pub fn start_background_checks(app: AppHandle) {
    if cfg!(debug_assertions) {
        return;
    }
    tauri::async_runtime::spawn(async move {
        tokio_sleep(FIRST_CHECK).await;
        loop {
            match check(&app).await {
                Ok(Some(info)) => {
                    let _ = app.emit("update:available", info);
                }
                Ok(None) => {}
                Err(err) => eprintln!("update check skipped: {err}"),
            }
            tokio_sleep(CHECK_INTERVAL).await;
        }
    });
}

/// Asks the endpoint, remembers what it said. Only a strictly newer version
/// comes back as `Some`; the plugin never offers a downgrade.
async fn check(app: &AppHandle) -> tauri_plugin_updater::Result<Option<UpdateInfo>> {
    let found = app.updater()?.check().await?;
    let state = app.state::<UpdateState>();
    let mut pending = state.pending.lock().expect("update state poisoned");
    let info = found.as_ref().map(UpdateInfo::from);
    *pending = found;
    Ok(info)
}

#[tauri::command]
pub async fn check_for_updates(app: AppHandle) -> Result<UpdateCheck, String> {
    if cfg!(debug_assertions) {
        return Ok(UpdateCheck::Disabled);
    }
    Ok(match check(&app).await {
        Ok(Some(update)) => UpdateCheck::Available { update },
        Ok(None) => UpdateCheck::None,
        Err(err) => UpdateCheck::Error {
            message: err.to_string(),
        },
    })
}

#[tauri::command]
pub fn pending_update(state: State<'_, UpdateState>) -> Option<UpdateInfo> {
    state
        .pending
        .lock()
        .expect("update state poisoned")
        .as_ref()
        .map(UpdateInfo::from)
}

/// Downloads, verifies, installs and restarts. Progress goes to the page as
/// `update:progress`. Returning `Ok` at all means the restart did not
/// happen, which the page reports as a failure.
#[tauri::command]
pub async fn install_update(app: AppHandle) -> Result<(), String> {
    let update = {
        let state = app.state::<UpdateState>();
        let pending = state.pending.lock().expect("update state poisoned");
        pending.clone()
    };
    let Some(update) = update else {
        return Err("There is no update to install. Check for updates first.".into());
    };

    let progress_app = app.clone();
    let mut downloaded: u64 = 0;
    let mut last_reported: u64 = 0;
    update
        .download_and_install(
            move |chunk, total| {
                downloaded += chunk as u64;
                // Every 256 KB, not every chunk: the page redraws on each one.
                if downloaded - last_reported >= 256 * 1024 || Some(downloaded) == total {
                    last_reported = downloaded;
                    let _ = progress_app.emit("update:progress", Progress { downloaded, total });
                }
            },
            || {},
        )
        .await
        .map_err(|err| err.to_string())?;

    // Installed. The old process is this one; the new one starts in its place.
    app.restart();
}

/// Tauri's async runtime is tokio, so tokio's timer is the one to use.
async fn tokio_sleep(duration: Duration) {
    tokio::time::sleep(duration).await;
}
