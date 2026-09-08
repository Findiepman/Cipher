//! The tray icon: the thing that keeps the app reachable once the window is
//! closed. A left click brings the window back, the menu has the two things
//! a tray menu needs and nothing else. Quitting from here is the only way to
//! quit while "keep running when the window is closed" is on.

use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle,
};

use crate::commands::show_main;

const OPEN: &str = "open";
const QUIT: &str = "quit";

pub fn install(app: &AppHandle) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, OPEN, "Open Cipher", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, QUIT, "Quit Cipher", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &quit])?;

    let mut tray = TrayIconBuilder::with_id("main")
        .menu(&menu)
        .tooltip("Cipher")
        // Left click opens the window; the menu is for the right button.
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            OPEN => show_main(app),
            // Past the close-to-tray handler on purpose: this is the quit.
            QUIT => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main(tray.app_handle());
            }
        });

    // The same mark as the window and the installer, from the bundle icons.
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }

    tray.build(app)?;
    Ok(())
}
