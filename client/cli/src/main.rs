//! `tianshu` — provider CLI (headless mode).
//!
//! Same backend as the Tauri GUI; talks to the Tianshu gateway and
//! supervises tunnels / engines locally.

use std::path::PathBuf;
use std::sync::Arc;

use anyhow::{anyhow, Result};
use clap::{Args, Parser, Subcommand, ValueEnum};
use serde_json::Value;
use tianshu_provider_core::engine::{EngineConfig, EngineKind, Engines};
use tianshu_provider_core::gateway::{self, BackendDraft, LoginRequest};
use tianshu_provider_core::state::{self, AppState};
use tianshu_provider_core::tunnel::{TunnelConfig, Tunnels};

#[derive(Parser)]
#[command(name = "tianshu", version, about = "Tianshu provider CLI")]
struct Cli {
    /// Override gateway base URL (default: settings or https://tianshu-gateway.cloud)
    #[arg(long, env = "TIANSHU_GATEWAY")]
    gateway: Option<String>,
    #[command(subcommand)]
    cmd: Cmd,
}

#[derive(Subcommand)]
enum Cmd {
    /// Show effective settings & paths.
    Info,
    /// Persist a setting (gateway URL, models dir, tunnel_client.py, etc.).
    Set(SetArgs),

    // ─── auth ───
    /// Send email verification code.
    SendCode { email: String },
    /// Login with username/email + password + email code; stores JWT in keyring.
    Login(LoginArgs),
    /// Forget JWT & API key.
    Logout,
    /// Save an API key (sk-...) to the keyring (alternative to Login).
    SetKey {
        /// API key; if omitted, prompted from stdin (hidden).
        #[arg(long)]
        key: Option<String>,
    },
    /// Print current /api/auth/me.
    Whoami,

    // ─── backends ───
    /// List my backends (or all with --all).
    #[command(name = "backends")]
    Backends(BackendsArgs),
    /// Register a new backend.
    BackendCreate(BackendCreateArgs),
    /// Update fields of a backend (provide a JSON patch).
    BackendUpdate {
        name: String,
        /// JSON patch, e.g. '{"input_price":0.5}'
        patch: String,
    },
    /// Delete a backend.
    BackendDelete { name: String },
    /// Toggle public/listed status.
    BackendToggle { name: String },
    /// Run server-side health check.
    BackendCheck { name: String },
    /// Print monthly stats from /api/backends/stats.
    Stats,

    // ─── tunnels ───
    /// Start a tunnel and **block in foreground** with watchdog.
    /// Use `nohup` / `systemd-run` if you need it detached.
    TunnelRun(TunnelRunArgs),

    // ─── engines (one-shot foreground) ───
    /// Start an engine in the foreground (Ctrl+C to stop).
    EngineRun(EngineRunArgs),
}

#[derive(Args)]
struct SetArgs {
    /// gateway HTTP base URL
    #[arg(long)]
    gateway_http: Option<String>,
    /// gateway WSS URL
    #[arg(long)]
    gateway_wss: Option<String>,
    /// path to tunnel_client.py
    #[arg(long)]
    tunnel_client_py: Option<PathBuf>,
    /// vLLM executable path
    #[arg(long)]
    vllm_exe: Option<PathBuf>,
    /// llama.cpp server executable path
    #[arg(long)]
    llama_server_exe: Option<PathBuf>,
    /// local models root directory
    #[arg(long)]
    models_dir: Option<PathBuf>,
    /// logs directory
    #[arg(long)]
    logs_dir: Option<PathBuf>,
}

#[derive(Args)]
struct LoginArgs {
    /// username or email
    login: String,
    /// password (prompted if absent)
    #[arg(long)]
    password: Option<String>,
    /// 6-digit email code
    #[arg(long)]
    code: String,
    #[arg(long)]
    remember: bool,
}

#[derive(Args)]
struct BackendsArgs {
    /// show all (admin) instead of mine-only
    #[arg(long)]
    all: bool,
    /// emit JSON
    #[arg(long)]
    json: bool,
}

#[derive(Args)]
struct BackendCreateArgs {
    /// unique name
    #[arg(long)]
    name: String,
    #[arg(long, default_value = "tunnel")]
    mode: String,
    /// for direct mode
    #[arg(long)]
    url: Option<String>,
    /// comma-separated model names
    #[arg(long)]
    models: String,
    #[arg(long, default_value = "CNY")]
    currency: String,
    #[arg(long, default_value_t = 0.0)]
    input_price: f64,
    #[arg(long, default_value_t = 0.0)]
    output_price: f64,
    #[arg(long)]
    cache_price: Option<f64>,
    #[arg(long)]
    public: bool,
}

#[derive(Args)]
struct TunnelRunArgs {
    /// backend_name (must already be registered)
    #[arg(long)]
    name: String,
    /// API key for tunnel auth (Bearer); falls back to keyring API key.
    #[arg(long)]
    token: Option<String>,
    /// local backend URL (e.g. http://localhost:8000)
    #[arg(long)]
    local_url: String,
    /// override gateway wss
    #[arg(long)]
    gateway_wss: Option<String>,
    /// override stall threshold (seconds, default 300)
    #[arg(long)]
    stall_secs: Option<u64>,
    /// override tunnel_client.py path
    #[arg(long)]
    tunnel_client_py: Option<PathBuf>,
}

#[derive(Args)]
struct EngineRunArgs {
    #[arg(long)]
    name: String,
    #[arg(long, value_enum, default_value_t = EngineKindArg::Vllm)]
    kind: EngineKindArg,
    /// program path (e.g. vllm, llama-server, python)
    #[arg(long)]
    program: PathBuf,
    /// extra args after `--`
    #[arg(last = true)]
    args: Vec<String>,
    #[arg(long, default_value = "127.0.0.1")]
    host: String,
    #[arg(long, default_value_t = 8000)]
    port: u16,
}

#[derive(Clone, ValueEnum)]
enum EngineKindArg { Vllm, LlamaCpp, Custom }
impl From<EngineKindArg> for EngineKind {
    fn from(v: EngineKindArg) -> Self {
        match v {
            EngineKindArg::Vllm => EngineKind::Vllm,
            EngineKindArg::LlamaCpp => EngineKind::LlamaCpp,
            EngineKindArg::Custom => EngineKind::Custom,
        }
    }
}

// ─── main ────────────────────────────────────────────────────────────────────

fn data_dir() -> PathBuf {
    if let Ok(p) = std::env::var("TIANSHU_DATA_DIR") {
        return PathBuf::from(p);
    }
    let base = dirs::data_dir()
        .or_else(dirs::home_dir)
        .unwrap_or_else(|| PathBuf::from("."));
    base.join("tianshu-provider")
}

fn build_state(cli: &Cli) -> Result<Arc<AppState>> {
    let dir = data_dir();
    std::fs::create_dir_all(&dir)?;
    let s = AppState::new(dir);
    let _ = s.load();
    if let Some(g) = cli.gateway.as_ref() {
        s.settings.write().unwrap().gateway_http = Some(g.clone());
    }
    Ok(Arc::new(s))
}

#[tokio::main]
async fn main() -> Result<()> {
    let _ = tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_env("TIANSHU_LOG")
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .with_target(false)
        .try_init();

    let cli = Cli::parse();
    let app = build_state(&cli)?;

    match cli.cmd {
        Cmd::Info => cmd_info(&app),
        Cmd::Set(a) => cmd_set(&app, a),

        Cmd::SendCode { email } => {
            gateway::send_login_code(&app, &email).await?;
            println!("verification code sent to {email}");
            Ok(())
        }
        Cmd::Login(a) => cmd_login(&app, a).await,
        Cmd::Logout => {
            gateway::logout(&app)?;
            state::clear_api_key();
            println!("logged out");
            Ok(())
        }
        Cmd::SetKey { key } => {
            let key = match key {
                Some(k) => k,
                None => rpassword::prompt_password("API Key: ")?,
            };
            state::save_api_key(&key)?;
            println!("API key saved to keyring");
            Ok(())
        }
        Cmd::Whoami => {
            let me = gateway::me(&app).await?;
            println!("{}", serde_json::to_string_pretty(&me)?);
            Ok(())
        }

        Cmd::Backends(a) => cmd_backends(&app, a).await,
        Cmd::BackendCreate(a) => cmd_backend_create(&app, a).await,
        Cmd::BackendUpdate { name, patch } => {
            let v: Value = serde_json::from_str(&patch)?;
            let b = gateway::update_backend(&app, &name, v).await?;
            println!("{}", serde_json::to_string_pretty(&b)?);
            Ok(())
        }
        Cmd::BackendDelete { name } => {
            gateway::delete_backend(&app, &name).await?;
            println!("deleted {name}");
            Ok(())
        }
        Cmd::BackendToggle { name } => {
            let r = gateway::toggle_listing(&app, &name).await?;
            println!("{}", serde_json::to_string_pretty(&r)?);
            Ok(())
        }
        Cmd::BackendCheck { name } => {
            let r = gateway::check_backend(&app, &name).await?;
            println!("{}", serde_json::to_string_pretty(&r)?);
            Ok(())
        }
        Cmd::Stats => {
            let s = gateway::stats(&app).await?;
            println!("{}", serde_json::to_string_pretty(&s)?);
            Ok(())
        }

        Cmd::TunnelRun(a) => cmd_tunnel_run(app, a).await,
        Cmd::EngineRun(a) => cmd_engine_run(app, a).await,
    }
}

// ─── implementations ─────────────────────────────────────────────────────────

fn cmd_info(app: &Arc<AppState>) -> Result<()> {
    let s = app.settings.read().unwrap().clone();
    println!("data_dir       : {}", app.data_dir.display());
    println!("logs_dir       : {}", app.logs_dir().display());
    println!("gateway_http   : {}", s.gateway_http());
    println!("gateway_wss    : {}", s.gateway_wss());
    println!("user           : {} (id={:?}, role={:?})",
        s.username.as_deref().unwrap_or("(anonymous)"), s.user_id, s.role);
    println!("models_dir     : {:?}", s.models_dir);
    println!("tunnel_client  : {:?}", s.tunnel_client_py);
    println!("vllm_exe       : {:?}", s.vllm_exe);
    println!("llama_server   : {:?}", s.llama_server_exe);
    println!("has_jwt        : {}", state::load_jwt().is_some());
    println!("has_api_key    : {}", state::load_api_key().is_some());
    Ok(())
}

fn cmd_set(app: &Arc<AppState>, a: SetArgs) -> Result<()> {
    {
        let mut s = app.settings.write().unwrap();
        if a.gateway_http.is_some() { s.gateway_http = a.gateway_http; }
        if a.gateway_wss.is_some()  { s.gateway_wss  = a.gateway_wss;  }
        if a.tunnel_client_py.is_some() { s.tunnel_client_py = a.tunnel_client_py; }
        if a.vllm_exe.is_some() { s.vllm_exe = a.vllm_exe; }
        if a.llama_server_exe.is_some() { s.llama_server_exe = a.llama_server_exe; }
        if a.models_dir.is_some() { s.models_dir = a.models_dir; }
        if a.logs_dir.is_some() { s.logs_dir = a.logs_dir; }
    }
    app.save()?;
    println!("settings saved → {}", app.settings_path().display());
    Ok(())
}

async fn cmd_login(app: &Arc<AppState>, a: LoginArgs) -> Result<()> {
    let password = match a.password {
        Some(p) => p,
        None => rpassword::prompt_password("Password: ")?,
    };
    let resp = gateway::login(app, LoginRequest {
        login: a.login,
        password,
        code: a.code,
        remember: a.remember,
    }).await?;
    println!("logged in as {} (id={}, role={})", resp.user.username, resp.user.id, resp.user.role);
    Ok(())
}

async fn cmd_backends(app: &Arc<AppState>, a: BackendsArgs) -> Result<()> {
    let list = gateway::list_backends(app, !a.all).await?;
    if a.json {
        println!("{}", serde_json::to_string_pretty(&list)?);
        return Ok(());
    }
    println!("{:<28} {:<8} {:<10} {:<10} {}", "name", "mode", "status", "listing", "models");
    for b in list {
        println!("{:<28} {:<8} {:<10} {:<10} {}",
            b.name, b.mode, b.status, b.listing_status, b.models.join(","));
    }
    Ok(())
}

async fn cmd_backend_create(app: &Arc<AppState>, a: BackendCreateArgs) -> Result<()> {
    let draft = BackendDraft {
        name: a.name,
        mode: a.mode,
        url: a.url,
        models: a.models.split(',').map(|s| s.trim().to_string()).filter(|s| !s.is_empty()).collect(),
        currency: a.currency,
        input_price: a.input_price,
        output_price: a.output_price,
        cache_price: a.cache_price,
        is_public: a.public,
        client_info: None,
        tags: None,
        capabilities: None,
    };
    let b = gateway::create_backend(app, draft).await?;
    println!("created: {}", serde_json::to_string_pretty(&b)?);
    Ok(())
}

async fn cmd_tunnel_run(app: Arc<AppState>, a: TunnelRunArgs) -> Result<()> {
    // Resolve token: arg > keyring api key.
    let token = a.token.or_else(state::load_api_key).ok_or_else(|| {
        anyhow!("no token: pass --token sk-... or run `tianshu set-key` first")
    })?;
    if let Some(g) = a.gateway_wss {
        app.settings.write().unwrap().gateway_wss = Some(g);
    }
    if let Some(p) = a.tunnel_client_py {
        app.settings.write().unwrap().tunnel_client_py = Some(p);
    }

    let logs_dir = app.logs_dir();
    let tunnels = Arc::new(Tunnels::new(logs_dir));
    let cfg = TunnelConfig {
        backend_name: a.name.clone(),
        gateway: None,
        token,
        local_url: a.local_url,
        tunnel_client_py: None,
        stall_secs: a.stall_secs,
    };
    tunnels.start(app.clone(), cfg).await?;

    println!("[cli] tunnel '{}' started; ctrl-c to stop. Log: {}",
        a.name,
        app.logs_dir().join(format!("tunnel-{}.log", sanitize(&a.name))).display());
    print_status_loop(tunnels.clone(), &a.name).await
}

async fn cmd_engine_run(app: Arc<AppState>, a: EngineRunArgs) -> Result<()> {
    let logs_dir = app.logs_dir();
    let engines = Arc::new(Engines::new(logs_dir));
    let cfg = EngineConfig {
        name: a.name.clone(),
        kind: a.kind.into(),
        program: a.program,
        args: a.args,
        cwd: None,
        env: vec![],
        host: a.host,
        port: a.port,
    };
    engines.start(app.clone(), cfg).await?;
    println!("[cli] engine '{}' started; ctrl-c to stop.", a.name);

    // wait for ctrl-c, then stop.
    tokio::signal::ctrl_c().await?;
    println!("\n[cli] stopping engine '{}'...", a.name);
    let _ = engines.stop(&a.name).await;
    Ok(())
}

async fn print_status_loop(tunnels: Arc<Tunnels>, name: &str) -> Result<()> {
    let n = name.to_string();
    let t = tunnels.clone();
    tokio::spawn(async move {
        let _ = tokio::signal::ctrl_c().await;
        println!("\n[cli] stopping tunnel '{n}'...");
        let _ = t.stop(&n).await;
        std::process::exit(0);
    });

    loop {
        tokio::time::sleep(std::time::Duration::from_secs(15)).await;
        if let Some(s) = tunnels.status(name).await {
            println!("[cli] {} running={} pid={:?} restarts={} last_progress={:?}",
                s.backend_name, s.running, s.pid, s.restart_count, s.last_progress_at);
        } else {
            println!("[cli] tunnel disappeared; exiting");
            return Ok(());
        }
    }
}

fn sanitize(s: &str) -> String {
    s.chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' { c } else { '_' })
        .collect()
}

