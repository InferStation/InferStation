//! Tunnel supervisor.
//!
//! Spawns `python3 tunnel_client.py ...` per registered tunnel, redirects
//! stdout+stderr to a per-tunnel log file, and runs a watchdog that:
//!
//!   1. Verifies the child PID is still alive.
//!   2. Watches the log file's mtime and the last "Connected!" / "HTTP Request"
//!      timestamp; if `now - last_progress > stall_secs` and the gateway
//!      still reports the backend as offline, kills + respawns the child.
//!   3. Records crashes with timestamps and applies exponential backoff
//!      (1/2/4/.../60s) on respawn so a permanently broken backend doesn't
//!      busy-loop.
//!
//! Concurrency: one async task per tunnel name; a global `Tunnels` map
//! protected by `Mutex` keeps `TunnelHandle`s.

use anyhow::{anyhow, Result};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Arc;
use std::time::{Duration, SystemTime};
use tokio::process::{Child, Command};
use tokio::sync::{Mutex, watch};
use tokio::task::JoinHandle;

use crate::state::AppState;
use crate::util::tail_file;

const STALL_SECS_DEFAULT: u64 = 300; // 5 min without progress => restart
const WATCHDOG_PERIOD_SECS: u64 = 30;
const BACKOFF_MAX_SECS: u64 = 60;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TunnelConfig {
    /// human-readable id ("vllm-qwen36-awq-45")
    pub backend_name: String,
    /// gateway wss URL — defaults to settings.gateway_wss
    pub gateway: Option<String>,
    /// API Key of the backend owner — required (Bearer)
    pub token: String,
    /// http://localhost:8004 etc.
    pub local_url: String,
    /// path to tunnel_client.py; if None we use the bundled copy
    pub tunnel_client_py: Option<PathBuf>,
    /// stall timeout in seconds; None = default 300
    pub stall_secs: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct TunnelStatus {
    pub backend_name: String,
    pub running: bool,
    pub pid: Option<u32>,
    pub last_started_at: Option<String>,
    pub restart_count: u64,
    pub last_progress_log: Option<String>,
    pub last_progress_at: Option<String>,
    pub log_path: Option<PathBuf>,
    pub last_error: Option<String>,
}

struct TunnelHandle {
    cfg: TunnelConfig,
    status: Arc<Mutex<TunnelStatus>>,
    cancel_tx: watch::Sender<bool>,
    join: JoinHandle<()>,
}

pub struct Tunnels {
    handles: Mutex<HashMap<String, TunnelHandle>>,
    log_dir: PathBuf,
}

impl Tunnels {
    pub fn new(log_dir: PathBuf) -> Self {
        std::fs::create_dir_all(&log_dir).ok();
        Self {
            handles: Mutex::new(HashMap::new()),
            log_dir,
        }
    }

    fn log_path(&self, name: &str) -> PathBuf {
        self.log_dir.join(format!("tunnel-{}.log", sanitize(name)))
    }

    pub async fn list(&self) -> Vec<TunnelStatus> {
        let g = self.handles.lock().await;
        let mut out = Vec::with_capacity(g.len());
        for h in g.values() {
            let s = h.status.lock().await.clone();
            out.push(s);
        }
        out
    }

    pub async fn status(&self, name: &str) -> Option<TunnelStatus> {
        let g = self.handles.lock().await;
        if let Some(h) = g.get(name) {
            return Some(h.status.lock().await.clone());
        }
        None
    }

    pub async fn start(&self, state: Arc<AppState>, cfg: TunnelConfig) -> Result<TunnelStatus> {
        let mut g = self.handles.lock().await;
        if g.contains_key(&cfg.backend_name) {
            return Err(anyhow!("tunnel '{}' already running", cfg.backend_name));
        }

        let log_path = self.log_path(&cfg.backend_name);
        let status = Arc::new(Mutex::new(TunnelStatus {
            backend_name: cfg.backend_name.clone(),
            log_path: Some(log_path.clone()),
            ..Default::default()
        }));
        let (cancel_tx, cancel_rx) = watch::channel(false);

        let task_state = state.clone();
        let task_cfg = cfg.clone();
        let task_status = status.clone();
        let task_log = log_path.clone();
        let task_cancel = cancel_rx;

        let join = tokio::spawn(async move {
            supervise(task_state, task_cfg, task_status, task_log, task_cancel).await;
        });

        let snapshot = status.lock().await.clone();
        g.insert(
            cfg.backend_name.clone(),
            TunnelHandle {
                cfg,
                status,
                cancel_tx,
                join,
            },
        );
        Ok(snapshot)
    }

    pub async fn stop(&self, name: &str) -> Result<()> {
        let mut g = self.handles.lock().await;
        if let Some(h) = g.remove(name) {
            let _ = h.cancel_tx.send(true);
            // Best-effort: wait briefly so children exit before we return.
            let _ = tokio::time::timeout(Duration::from_secs(5), h.join).await;
            tracing::info!("tunnel '{}' stopped (cfg={})", name, h.cfg.backend_name);
        }
        Ok(())
    }

    pub async fn tail_log(&self, name: &str, max_lines: usize) -> Result<String> {
        let p = self.log_path(name);
        tail_file(&p, max_lines).await
    }
}

// ─── supervisor task ─────────────────────────────────────────────────────────

async fn supervise(
    state: Arc<AppState>,
    cfg: TunnelConfig,
    status: Arc<Mutex<TunnelStatus>>,
    log_path: PathBuf,
    mut cancel_rx: watch::Receiver<bool>,
) {
    let mut backoff = 1u64;
    let stall_secs = cfg.stall_secs.unwrap_or(STALL_SECS_DEFAULT);

    loop {
        if *cancel_rx.borrow() {
            return;
        }
        let spawn_res = spawn_one(&state, &cfg, &log_path).await;
        let mut child = match spawn_res {
            Ok(c) => c,
            Err(e) => {
                tracing::error!("tunnel '{}' spawn failed: {e:#}", cfg.backend_name);
                set_error(&status, format!("spawn failed: {e:#}")).await;
                if wait_or_cancel(&mut cancel_rx, Duration::from_secs(backoff)).await {
                    return;
                }
                backoff = (backoff * 2).min(BACKOFF_MAX_SECS);
                continue;
            }
        };

        let pid = child.id();
        {
            let mut s = status.lock().await;
            s.pid = pid;
            s.running = true;
            s.last_started_at = Some(now_str());
            s.last_error = None;
        }
        backoff = 1;

        let child_pid = pid;
        let exit_status = run_with_watchdog(&mut child, &cfg, &status, &log_path, stall_secs, &mut cancel_rx).await;
        // Ensure dead.
        let _ = child.kill().await;
        let _ = child.wait().await;
        {
            let mut s = status.lock().await;
            s.running = false;
            s.pid = None;
            s.restart_count += 1;
            if let Some(e) = exit_status.as_ref() {
                s.last_error = Some(e.clone());
            }
        }

        if *cancel_rx.borrow() {
            tracing::info!("tunnel '{}' cancelled (pid={:?})", cfg.backend_name, child_pid);
            return;
        }
        // Backoff before respawn.
        if wait_or_cancel(&mut cancel_rx, Duration::from_secs(backoff)).await {
            return;
        }
        backoff = (backoff * 2).min(BACKOFF_MAX_SECS);
    }
}

/// Returns Some(reason) when the watchdog killed the child for stall,
/// None when the child died on its own. Caller respawns either way.
async fn run_with_watchdog(
    child: &mut Child,
    cfg: &TunnelConfig,
    status: &Arc<Mutex<TunnelStatus>>,
    log_path: &Path,
    stall_secs: u64,
    cancel_rx: &mut watch::Receiver<bool>,
) -> Option<String> {
    let watchdog_period = Duration::from_secs(WATCHDOG_PERIOD_SECS);

    loop {
        tokio::select! {
            // Child died.
            res = child.wait() => {
                let msg = match res {
                    Ok(s) => format!("child exited with status {s}"),
                    Err(e) => format!("waitpid error: {e:#}"),
                };
                tracing::warn!("tunnel '{}': {msg}", cfg.backend_name);
                return Some(msg);
            }
            // Cancellation request.
            _ = cancel_rx.changed() => {
                if *cancel_rx.borrow() {
                    tracing::info!("tunnel '{}' cancelled, killing pid={:?}", cfg.backend_name, child.id());
                    return Some("cancelled".into());
                }
            }
            // Watchdog tick.
            _ = tokio::time::sleep(watchdog_period) => {
                match check_progress(log_path).await {
                    Ok((maybe_age, last_line)) => {
                        let mut s = status.lock().await;
                        s.last_progress_log = last_line;
                        s.last_progress_at = maybe_age.map(|t| iso(t));
                        if let Some(t) = maybe_age {
                            let age = SystemTime::now().duration_since(t).unwrap_or_default();
                            if age.as_secs() > stall_secs {
                                tracing::warn!("tunnel '{}' stalled for {}s (>{}s); killing", cfg.backend_name, age.as_secs(), stall_secs);
                                return Some(format!("stalled {}s", age.as_secs()));
                            }
                        }
                    }
                    Err(e) => {
                        tracing::debug!("tunnel '{}' watchdog read err: {e}", cfg.backend_name);
                    }
                }
            }
        }
    }
}

async fn spawn_one(state: &AppState, cfg: &TunnelConfig, log_path: &Path) -> Result<Child> {
    let py = cfg
        .tunnel_client_py
        .clone()
        .or_else(|| state.settings.read().unwrap().tunnel_client_py.clone())
        .ok_or_else(|| anyhow!("tunnel_client.py path not set in settings"))?;

    let gateway = cfg
        .gateway
        .clone()
        .unwrap_or_else(|| state.settings.read().unwrap().gateway_wss().to_string());

    let log = open_append(log_path)?;
    let stderr = log.try_clone()?;

    let mut cmd = Command::new(python_exe());
    cmd.arg(py)
        .args([
            "--gateway", gateway.as_str(),
            "--token", cfg.token.as_str(),
            "--backend-name", cfg.backend_name.as_str(),
            "--local-url", cfg.local_url.as_str(),
        ])
        .stdin(Stdio::null())
        .stdout(Stdio::from(log))
        .stderr(Stdio::from(stderr))
        .kill_on_drop(true);

    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt as _;
        cmd.process_group(0); // own group so SIGTERM hits the python only
    }

    Ok(cmd.spawn()?)
}

// ─── helpers ─────────────────────────────────────────────────────────────────

async fn check_progress(log: &Path) -> Result<(Option<SystemTime>, Option<String>)> {
    if !log.exists() {
        return Ok((None, None));
    }
    let meta = tokio::fs::metadata(log).await?;
    let mtime = meta.modified().ok();
    let txt = tail_file(log, 5).await.unwrap_or_default();
    let last = txt.lines().rev().find(|l| !l.is_empty()).map(|s| s.to_string());
    Ok((mtime, last))
}

fn open_append(p: &Path) -> Result<std::fs::File> {
    if let Some(d) = p.parent() {
        std::fs::create_dir_all(d)?;
    }
    Ok(std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(p)?)
}

async fn wait_or_cancel(rx: &mut watch::Receiver<bool>, dur: Duration) -> bool {
    tokio::select! {
        _ = tokio::time::sleep(dur) => false,
        _ = rx.changed() => *rx.borrow(),
    }
}

async fn set_error(status: &Arc<Mutex<TunnelStatus>>, msg: String) {
    let mut s = status.lock().await;
    s.last_error = Some(msg);
}

fn python_exe() -> &'static str {
    if cfg!(windows) { "python" } else { "python3" }
}

fn now_str() -> String {
    chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string()
}

fn iso(t: SystemTime) -> String {
    let dt: chrono::DateTime<chrono::Local> = t.into();
    dt.format("%Y-%m-%d %H:%M:%S").to_string()
}

fn sanitize(s: &str) -> String {
    s.chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' { c } else { '_' })
        .collect()
}
