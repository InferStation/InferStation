pub mod commands;
pub mod tray;

// Re-export core modules for the Tauri commands.
pub use tianshu_provider_core::{engine, gateway, models, state, tunnel, util};

use std::sync::Arc;

use tauri::Manager;
use tauri_plugin_autostart::MacosLauncher;
use tracing_subscriber::{fmt, EnvFilter};

use tianshu_provider_core::engine::Engines;
use tianshu_provider_core::state::AppState;
use tianshu_provider_core::tunnel::Tunnels;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let _ = fmt()
        .with_env_filter(
            EnvFilter::try_from_env("TIANSHU_LOG").unwrap_or_else(|_| EnvFilter::new("info")),
        )
        .with_target(false)
        .try_init();

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            Some(vec!["--minimized"]),
        ))
        .setup(|app| {
            let data_dir = app
                .path()
                .app_data_dir()
                .expect("app_data_dir resolvable");
            std::fs::create_dir_all(&data_dir).ok();

            let app_state = Arc::new(AppState::new(data_dir.clone()));
            if let Err(e) = app_state.load() {
                tracing::warn!("settings load failed: {e:#}");
            }

            let logs_dir = app_state.logs_dir();
            let tunnels = Arc::new(Tunnels::new(logs_dir.clone()));
            let engines = Arc::new(Engines::new(logs_dir));

            app.manage(app_state);
            app.manage(tunnels);
            app.manage(engines);

            if let Err(e) = tray::setup_tray(app.handle()) {
                tracing::warn!("tray setup failed: {e:#}");
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_settings,
            commands::update_settings,
            commands::auth_send_code,
            commands::auth_login,
            commands::auth_logout,
            commands::auth_me,
            commands::set_api_key,
            commands::has_api_key,
            commands::has_jwt,
            commands::backends_list,
            commands::backends_get,
            commands::backends_create,
            commands::backends_update,
            commands::backends_delete,
            commands::backends_toggle_listing,
            commands::backends_check,
            commands::backends_stats,
            commands::models_v1,
            commands::tunnels_list,
            commands::tunnels_status,
            commands::tunnels_start,
            commands::tunnels_stop,
            commands::tunnels_tail_log,
            commands::engines_list,
            commands::engines_start,
            commands::engines_stop,
            commands::engines_status,
            commands::engines_health,
            commands::engines_tail_log,
            commands::local_models_list,
            commands::local_models_delete,
            commands::local_models_disk_usage,
            commands::models_download,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
