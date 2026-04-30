//! Persistent state: gateway URL, JWT (in OS keyring), API key, paths,
//! and per-tunnel/per-engine config (in tauri-plugin-store JSON).

use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::RwLock;

const KEYRING_SERVICE: &str = "tianshu-provider-client";
const KEYRING_USER_JWT: &str = "jwt";
const KEYRING_USER_APIKEY: &str = "apikey";

/// Default public gateway. Override in Settings page.
pub const DEFAULT_GATEWAY_HTTP: &str = "https://tianshu-gateway.cloud";
pub const DEFAULT_GATEWAY_WSS: &str = "wss://tianshu-gateway.cloud/ws/tunnel";

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Settings {
    pub gateway_http: Option<String>,
    pub gateway_wss: Option<String>,
    /// Logged-in user info (username/role/email cached after login)
    pub username: Option<String>,
    pub user_id: Option<i64>,
    pub role: Option<String>,
    /// Models root path, e.g. D:\models or ~/models
    pub models_dir: Option<PathBuf>,
    /// Where tunnel/engine logs go (defaults to data_dir/logs)
    pub logs_dir: Option<PathBuf>,
    /// Embedded tunnel_client.py path; if absent we extract a bundled copy
    pub tunnel_client_py: Option<PathBuf>,
    /// vLLM / llama.cpp executable paths (auto-detected on first run)
    pub vllm_exe: Option<PathBuf>,
    pub llama_server_exe: Option<PathBuf>,
}

impl Settings {
    pub fn gateway_http(&self) -> &str {
        self.gateway_http.as_deref().unwrap_or(DEFAULT_GATEWAY_HTTP)
    }
    pub fn gateway_wss(&self) -> &str {
        self.gateway_wss.as_deref().unwrap_or(DEFAULT_GATEWAY_WSS)
    }
}

pub struct AppState {
    pub settings: RwLock<Settings>,
    pub data_dir: PathBuf,
}

impl AppState {
    pub fn new(data_dir: PathBuf) -> Self {
        Self {
            settings: RwLock::new(Settings::default()),
            data_dir,
        }
    }

    pub fn settings_path(&self) -> PathBuf {
        self.data_dir.join("settings.json")
    }
    pub fn logs_dir(&self) -> PathBuf {
        let s = self.settings.read().unwrap();
        s.logs_dir
            .clone()
            .unwrap_or_else(|| self.data_dir.join("logs"))
    }

    pub fn load(&self) -> Result<()> {
        let p = self.settings_path();
        if p.exists() {
            let txt = std::fs::read_to_string(&p)?;
            let s: Settings = serde_json::from_str(&txt)?;
            *self.settings.write().unwrap() = s;
        }
        std::fs::create_dir_all(self.logs_dir())?;
        Ok(())
    }

    pub fn save(&self) -> Result<()> {
        let p = self.settings_path();
        if let Some(parent) = p.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let s = self.settings.read().unwrap().clone();
        std::fs::write(p, serde_json::to_string_pretty(&s)?)?;
        Ok(())
    }
}

// ─── OS keyring helpers ──────────────────────────────────────────────────────

pub fn save_jwt(token: &str) -> Result<()> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER_JWT)?;
    entry.set_password(token)?;
    Ok(())
}

pub fn load_jwt() -> Option<String> {
    keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER_JWT)
        .ok()
        .and_then(|e| e.get_password().ok())
}

pub fn clear_jwt() {
    if let Ok(e) = keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER_JWT) {
        let _ = e.delete_credential();
    }
}

pub fn save_api_key(key: &str) -> Result<()> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER_APIKEY)?;
    entry.set_password(key)?;
    Ok(())
}

pub fn load_api_key() -> Option<String> {
    keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER_APIKEY)
        .ok()
        .and_then(|e| e.get_password().ok())
}

pub fn clear_api_key() {
    if let Ok(e) = keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER_APIKEY) {
        let _ = e.delete_credential();
    }
}
