//! Tianshu gateway REST client.
//!
//! Uses JWT preferentially (`Authorization: Bearer <jwt>`); falls back to API
//! key if no JWT is set. The OpenAI `/v1/*` paths use API key only.

use anyhow::{anyhow, Result};
use reqwest::{Client, Method, RequestBuilder};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::state::{self, AppState};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct LoginRequest {
    pub login: String,
    pub password: String,
    pub code: String,
    #[serde(default)]
    pub remember: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct LoginResponse {
    pub access_token: String,
    pub token_type: String,
    pub user: UserInfo,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct UserInfo {
    pub id: i64,
    pub username: String,
    #[serde(default)]
    pub email: Option<String>,
    pub role: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Backend {
    pub id: i64,
    pub owner_id: i64,
    pub name: String,
    pub mode: String, // "tunnel" | "direct"
    pub url: Option<String>,
    pub models: Vec<String>,
    pub status: String,           // "online" / "offline" / etc
    pub listing_status: String,   // listed / pending / offline
    pub enabled: i64,
    pub is_public: i64,
    pub deletion_status: Option<String>,
    pub currency: String,
    pub input_price: f64,
    pub output_price: f64,
    #[serde(default)]
    pub cache_price: Option<f64>,
    #[serde(default)]
    pub client_info: Option<Value>,
    #[serde(default)]
    pub tags: Option<Value>,
    #[serde(default)]
    pub capabilities: Option<Value>,
    #[serde(default)]
    pub updated_at: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct BackendStat {
    pub backend_id: i64,
    pub name: String,
    pub status: String,
    pub model: String,
    #[serde(default)]
    pub subscriptions: i64,
    #[serde(default)]
    pub requests_month: i64,
    #[serde(default)]
    pub input_tokens_month: i64,
    #[serde(default)]
    pub output_tokens_month: i64,
    #[serde(default)]
    pub cached_tokens_month: i64,
    #[serde(default)]
    pub revenue_month: f64,
    #[serde(default)]
    pub currency: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct BackendDraft {
    pub name: String,
    pub mode: String,
    pub url: Option<String>,
    pub models: Vec<String>,
    pub currency: String,
    pub input_price: f64,
    pub output_price: f64,
    #[serde(default)]
    pub cache_price: Option<f64>,
    #[serde(default)]
    pub is_public: bool,
    #[serde(default)]
    pub client_info: Option<Value>,
    #[serde(default)]
    pub tags: Option<Value>,
    #[serde(default)]
    pub capabilities: Option<Value>,
}

// ─── HTTP helpers ────────────────────────────────────────────────────────────

fn http_client() -> Result<Client> {
    Ok(Client::builder()
        .user_agent(format!("tianshu-provider-client/{}", env!("CARGO_PKG_VERSION")))
        .timeout(std::time::Duration::from_secs(30))
        .build()?)
}

fn auth(req: RequestBuilder) -> RequestBuilder {
    if let Some(jwt) = state::load_jwt() {
        return req.bearer_auth(jwt);
    }
    if let Some(key) = state::load_api_key() {
        return req.bearer_auth(key);
    }
    req
}

fn url(state: &AppState, path: &str) -> String {
    let base = state.settings.read().unwrap().gateway_http().to_string();
    format!("{}{}", base.trim_end_matches('/'), path)
}

async fn check_status(resp: reqwest::Response) -> Result<reqwest::Response> {
    if resp.status().is_success() {
        return Ok(resp);
    }
    let code = resp.status();
    let body = resp.text().await.unwrap_or_default();
    Err(anyhow!("HTTP {}: {}", code, body))
}

// ─── Endpoints ───────────────────────────────────────────────────────────────

pub async fn send_login_code(state: &AppState, email: &str) -> Result<()> {
    let body = serde_json::json!({ "email": email, "purpose": "login" });
    let resp = http_client()?
        .post(url(state, "/api/auth/send-code"))
        .json(&body)
        .send()
        .await?;
    check_status(resp).await?;
    Ok(())
}

pub async fn login(state: &AppState, req: LoginRequest) -> Result<LoginResponse> {
    let resp = http_client()?
        .post(url(state, "/api/auth/login"))
        .json(&req)
        .send()
        .await?;
    let resp = check_status(resp).await?;
    let parsed: LoginResponse = resp.json().await?;

    state::save_jwt(&parsed.access_token)?;
    {
        let mut s = state.settings.write().unwrap();
        s.username = Some(parsed.user.username.clone());
        s.user_id = Some(parsed.user.id);
        s.role = Some(parsed.user.role.clone());
    }
    state.save()?;
    Ok(parsed)
}

pub fn logout(state: &AppState) -> Result<()> {
    state::clear_jwt();
    let mut s = state.settings.write().unwrap();
    s.username = None;
    s.user_id = None;
    s.role = None;
    drop(s);
    state.save()?;
    Ok(())
}

pub async fn me(state: &AppState) -> Result<UserInfo> {
    let resp = auth(http_client()?.get(url(state, "/api/auth/me"))).send().await?;
    let resp = check_status(resp).await?;
    Ok(resp.json().await?)
}

pub async fn list_backends(state: &AppState, mine_only: bool) -> Result<Vec<Backend>> {
    let path = if mine_only { "/api/backends?mine=1" } else { "/api/backends" };
    let resp = auth(http_client()?.get(url(state, path))).send().await?;
    let resp = check_status(resp).await?;
    Ok(resp.json().await?)
}

pub async fn get_backend(state: &AppState, name: &str) -> Result<Backend> {
    let resp = auth(http_client()?.get(url(state, &format!("/api/backends/{}", name)))).send().await?;
    let resp = check_status(resp).await?;
    Ok(resp.json().await?)
}

pub async fn create_backend(state: &AppState, draft: BackendDraft) -> Result<Backend> {
    let resp = auth(http_client()?.post(url(state, "/api/backends")).json(&draft))
        .send().await?;
    let resp = check_status(resp).await?;
    Ok(resp.json().await?)
}

pub async fn update_backend(state: &AppState, name: &str, patch: Value) -> Result<Backend> {
    let resp = auth(http_client()?
        .request(Method::PATCH, url(state, &format!("/api/backends/{}", name)))
        .json(&patch))
        .send().await?;
    let resp = check_status(resp).await?;
    Ok(resp.json().await?)
}

pub async fn delete_backend(state: &AppState, name: &str) -> Result<()> {
    let resp = auth(http_client()?
        .request(Method::DELETE, url(state, &format!("/api/backends/{}", name))))
        .send().await?;
    check_status(resp).await?;
    Ok(())
}

pub async fn toggle_listing(state: &AppState, name: &str) -> Result<Value> {
    let resp = auth(http_client()?
        .request(Method::PUT, url(state, &format!("/api/backends/{}/toggle", name))))
        .send().await?;
    let resp = check_status(resp).await?;
    Ok(resp.json().await?)
}

pub async fn check_backend(state: &AppState, name: &str) -> Result<Value> {
    let resp = auth(http_client()?.post(url(state, &format!("/api/backends/{}/check", name))))
        .send().await?;
    let resp = check_status(resp).await?;
    Ok(resp.json().await?)
}

pub async fn stats(state: &AppState) -> Result<Vec<BackendStat>> {
    let resp = auth(http_client()?.get(url(state, "/api/backends/stats"))).send().await?;
    let resp = check_status(resp).await?;
    Ok(resp.json().await?)
}

pub async fn list_models_v1(state: &AppState) -> Result<Value> {
    let resp = auth(http_client()?.get(url(state, "/v1/models"))).send().await?;
    let resp = check_status(resp).await?;
    Ok(resp.json().await?)
}
