//! Tauri command handlers — thin glue between the React frontend and the
//! Rust modules. Each command returns `Result<T, String>` so it serializes
//! cleanly through IPC.

use std::path::PathBuf;
use std::sync::Arc;

use serde_json::Value;
use tauri::State;

use crate::engine::{EngineConfig, Engines, EngineStatus};
use crate::gateway;
use crate::models::{self, DownloadProgress, DownloadRequest, LocalModel};
use crate::state::{self as st, AppState, Settings};
use crate::tunnel::{TunnelConfig, TunnelStatus, Tunnels};

type Cmd<T> = Result<T, String>;

fn err<E: std::fmt::Display>(e: E) -> String {
    format!("{e:#}")
}

// ─── settings ────────────────────────────────────────────────────────────────

#[tauri::command]
pub fn get_settings(state: State<'_, Arc<AppState>>) -> Cmd<Settings> {
    Ok(state.settings.read().map_err(|e| err(e))?.clone())
}

#[tauri::command]
pub fn update_settings(
    state: State<'_, Arc<AppState>>,
    patch: Settings,
) -> Cmd<Settings> {
    {
        let mut s = state.settings.write().map_err(|e| err(e))?;
        if patch.gateway_http.is_some() { s.gateway_http = patch.gateway_http; }
        if patch.gateway_wss.is_some()  { s.gateway_wss  = patch.gateway_wss;  }
        if patch.models_dir.is_some()   { s.models_dir   = patch.models_dir;   }
        if patch.logs_dir.is_some()     { s.logs_dir     = patch.logs_dir;     }
        if patch.tunnel_client_py.is_some() { s.tunnel_client_py = patch.tunnel_client_py; }
        if patch.vllm_exe.is_some()     { s.vllm_exe     = patch.vllm_exe;     }
        if patch.llama_server_exe.is_some() { s.llama_server_exe = patch.llama_server_exe; }
    }
    state.save().map_err(err)?;
    Ok(state.settings.read().map_err(err)?.clone())
}

// ─── auth ────────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn auth_send_code(state: State<'_, Arc<AppState>>, email: String) -> Cmd<()> {
    gateway::send_login_code(&state, &email).await.map_err(err)
}

#[tauri::command]
pub async fn auth_login(
    state: State<'_, Arc<AppState>>,
    login: String,
    password: String,
    code: String,
    remember: bool,
) -> Cmd<gateway::LoginResponse> {
    gateway::login(&state, gateway::LoginRequest { login, password, code, remember })
        .await
        .map_err(err)
}

#[tauri::command]
pub fn auth_logout(state: State<'_, Arc<AppState>>) -> Cmd<()> {
    gateway::logout(&state).map_err(err)
}

#[tauri::command]
pub async fn auth_me(state: State<'_, Arc<AppState>>) -> Cmd<gateway::UserInfo> {
    gateway::me(&state).await.map_err(err)
}

#[tauri::command]
pub fn set_api_key(key: String) -> Cmd<()> {
    if key.is_empty() {
        st::clear_api_key();
        return Ok(());
    }
    st::save_api_key(&key).map_err(err)
}

#[tauri::command]
pub fn has_api_key() -> Cmd<bool> {
    Ok(st::load_api_key().is_some())
}

#[tauri::command]
pub fn has_jwt() -> Cmd<bool> {
    Ok(st::load_jwt().is_some())
}

// ─── backends ────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn backends_list(state: State<'_, Arc<AppState>>, mine_only: bool) -> Cmd<Vec<gateway::Backend>> {
    gateway::list_backends(&state, mine_only).await.map_err(err)
}

#[tauri::command]
pub async fn backends_get(state: State<'_, Arc<AppState>>, name: String) -> Cmd<gateway::Backend> {
    gateway::get_backend(&state, &name).await.map_err(err)
}

#[tauri::command]
pub async fn backends_create(state: State<'_, Arc<AppState>>, draft: gateway::BackendDraft) -> Cmd<gateway::Backend> {
    gateway::create_backend(&state, draft).await.map_err(err)
}

#[tauri::command]
pub async fn backends_update(state: State<'_, Arc<AppState>>, name: String, patch: Value) -> Cmd<gateway::Backend> {
    gateway::update_backend(&state, &name, patch).await.map_err(err)
}

#[tauri::command]
pub async fn backends_delete(state: State<'_, Arc<AppState>>, name: String) -> Cmd<()> {
    gateway::delete_backend(&state, &name).await.map_err(err)
}

#[tauri::command]
pub async fn backends_toggle_listing(state: State<'_, Arc<AppState>>, name: String) -> Cmd<Value> {
    gateway::toggle_listing(&state, &name).await.map_err(err)
}

#[tauri::command]
pub async fn backends_check(state: State<'_, Arc<AppState>>, name: String) -> Cmd<Value> {
    gateway::check_backend(&state, &name).await.map_err(err)
}

#[tauri::command]
pub async fn backends_stats(state: State<'_, Arc<AppState>>) -> Cmd<Vec<gateway::BackendStat>> {
    gateway::stats(&state).await.map_err(err)
}

#[tauri::command]
pub async fn models_v1(state: State<'_, Arc<AppState>>) -> Cmd<Value> {
    gateway::list_models_v1(&state).await.map_err(err)
}

// ─── tunnels ─────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn tunnels_list(tunnels: State<'_, Arc<Tunnels>>) -> Cmd<Vec<TunnelStatus>> {
    Ok(tunnels.list().await)
}

#[tauri::command]
pub async fn tunnels_status(tunnels: State<'_, Arc<Tunnels>>, name: String) -> Cmd<Option<TunnelStatus>> {
    Ok(tunnels.status(&name).await)
}

#[tauri::command]
pub async fn tunnels_start(
    state: State<'_, Arc<AppState>>,
    tunnels: State<'_, Arc<Tunnels>>,
    cfg: TunnelConfig,
) -> Cmd<TunnelStatus> {
    tunnels.start(state.inner().clone(), cfg).await.map_err(err)
}

#[tauri::command]
pub async fn tunnels_stop(tunnels: State<'_, Arc<Tunnels>>, name: String) -> Cmd<()> {
    tunnels.stop(&name).await.map_err(err)
}

#[tauri::command]
pub async fn tunnels_tail_log(tunnels: State<'_, Arc<Tunnels>>, name: String, max_lines: usize) -> Cmd<String> {
    tunnels.tail_log(&name, max_lines).await.map_err(err)
}

// ─── engines ─────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn engines_list(engines: State<'_, Arc<Engines>>) -> Cmd<Vec<EngineStatus>> {
    Ok(engines.list().await)
}

#[tauri::command]
pub async fn engines_start(
    state: State<'_, Arc<AppState>>,
    engines: State<'_, Arc<Engines>>,
    cfg: EngineConfig,
) -> Cmd<EngineStatus> {
    engines.start(state.inner().clone(), cfg).await.map_err(err)
}

#[tauri::command]
pub async fn engines_stop(engines: State<'_, Arc<Engines>>, name: String) -> Cmd<()> {
    engines.stop(&name).await.map_err(err)
}

#[tauri::command]
pub async fn engines_status(engines: State<'_, Arc<Engines>>, name: String) -> Cmd<Option<EngineStatus>> {
    Ok(engines.status(&name).await)
}

#[tauri::command]
pub async fn engines_health(engines: State<'_, Arc<Engines>>, name: String) -> Cmd<bool> {
    engines.health(&name).await.map_err(err)
}

#[tauri::command]
pub async fn engines_tail_log(engines: State<'_, Arc<Engines>>, name: String, max_lines: usize) -> Cmd<String> {
    engines.tail_log(&name, max_lines).await.map_err(err)
}

// ─── models ──────────────────────────────────────────────────────────────────

#[tauri::command]
pub fn local_models_list(root: PathBuf) -> Cmd<Vec<LocalModel>> {
    models::list_local(&root).map_err(err)
}

#[tauri::command]
pub fn local_models_delete(path: PathBuf) -> Cmd<()> {
    models::delete_local(&path).map_err(err)
}

#[tauri::command]
pub fn local_models_disk_usage(path: PathBuf) -> Cmd<u64> {
    models::disk_usage(&path).map_err(err)
}

#[tauri::command]
pub async fn models_download(
    app: tauri::AppHandle,
    req: DownloadRequest,
) -> Cmd<()> {
    use tauri::Emitter;
    let app_clone = app.clone();
    models::download(req, move |progress: DownloadProgress| {
        let _ = app_clone.emit("model-download", progress);
    })
    .await
    .map_err(err)
}
