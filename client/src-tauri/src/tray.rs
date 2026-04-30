//! Tray icon + menu.
//!
//! Menu:
//!   - Open / Show window
//!   - Tunnels:  N running
//!   - Engines:  N running
//!   - ───────────
//!   - Quit
//!
//! Click on the icon also restores the main window.

use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, Runtime,
};

pub fn setup_tray<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    let open_i = MenuItem::with_id(app, "open", "打开主界面", true, None::<&str>)?;
    let tunnels_i = MenuItem::with_id(app, "tunnels", "通道: 0", false, None::<&str>)?;
    let engines_i = MenuItem::with_id(app, "engines", "引擎: 0", false, None::<&str>)?;
    let sep = PredefinedMenuItem::separator(app)?;
    let quit_i = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;

    let menu = Menu::with_items(app, &[&open_i, &tunnels_i, &engines_i, &sep, &quit_i])?;

    let _ = TrayIconBuilder::with_id("main")
        .menu(&menu)
        .tooltip("天枢 Provider")
        .icon(app.default_window_icon().cloned().unwrap())
        .on_menu_event(|app, event| match event.id.as_ref() {
            "open" => show_main(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::DoubleClick { .. } = event {
                show_main(tray.app_handle());
            }
        })
        .build(app)?;

    Ok(())
}

fn show_main<R: Runtime>(app: &AppHandle<R>) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.set_focus();
        let _ = w.unminimize();
    }
}
