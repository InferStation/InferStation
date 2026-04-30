import { invoke } from '@tauri-apps/api/core';

// ─── Types (mirror Rust serde structs) ───────────────────────────────────────

export interface Settings {
  gateway_http?: string | null;
  gateway_wss?: string | null;
  username?: string | null;
  user_id?: number | null;
  role?: string | null;
  models_dir?: string | null;
  logs_dir?: string | null;
  tunnel_client_py?: string | null;
  vllm_exe?: string | null;
  llama_server_exe?: string | null;
}

export interface UserInfo { id: number; username: string; email?: string; role: string; }
export interface LoginResponse { access_token: string; token_type: string; user: UserInfo; }

export interface Backend {
  id: number;
  owner_id: number;
  name: string;
  mode: string;
  url?: string | null;
  models: string[];
  status: string;
  listing_status: string;
  enabled: number;
  is_public: number;
  deletion_status?: string | null;
  currency: string;
  input_price: number;
  output_price: number;
  cache_price?: number | null;
  client_info?: any;
  tags?: any;
  capabilities?: any;
  updated_at?: string | null;
}

export interface BackendStat {
  backend_id: number;
  name: string;
  status: string;
  model: string;
  subscriptions: number;
  requests_month: number;
  input_tokens_month: number;
  output_tokens_month: number;
  cached_tokens_month: number;
  revenue_month: number;
  currency: string;
}

export interface BackendDraft {
  name: string;
  mode: string;
  url?: string | null;
  models: string[];
  currency: string;
  input_price: number;
  output_price: number;
  cache_price?: number | null;
  is_public?: boolean;
  client_info?: any;
  tags?: any;
  capabilities?: any;
}

export interface TunnelConfig {
  backend_name: string;
  gateway?: string | null;
  token: string;
  local_url: string;
  tunnel_client_py?: string | null;
  stall_secs?: number | null;
}

export interface TunnelStatus {
  backend_name: string;
  running: boolean;
  pid?: number | null;
  last_started_at?: string | null;
  restart_count: number;
  last_progress_log?: string | null;
  last_progress_at?: string | null;
  log_path?: string | null;
  last_error?: string | null;
}

export type EngineKind = 'Vllm' | 'LlamaCpp' | 'Custom';

export interface EngineConfig {
  name: string;
  kind: EngineKind;
  program: string;
  args: string[];
  cwd?: string | null;
  env: [string, string][];
  host: string;
  port: number;
}

export interface EngineStatus {
  name: string;
  running: boolean;
  pid?: number | null;
  last_started_at?: string | null;
  log_path?: string | null;
  last_error?: string | null;
  healthy?: boolean | null;
}

export interface LocalModel { repo: string; abs_path: string; size_bytes: number; file_count: number; }

export interface DownloadRequest {
  repo_id: string;
  revision?: string | null;
  files: string[];
  dest_root: string;
  source: 'HuggingFace' | 'ModelScope';
  token?: string | null;
}

export interface DownloadProgress {
  repo_id: string;
  file: string;
  downloaded: number;
  total?: number | null;
  done: boolean;
  error?: string | null;
}

// ─── Wrappers ────────────────────────────────────────────────────────────────

export const api = {
  // settings
  getSettings: () => invoke<Settings>('get_settings'),
  updateSettings: (patch: Partial<Settings>) => invoke<Settings>('update_settings', { patch }),

  // auth
  authSendCode: (email: string) => invoke<void>('auth_send_code', { email }),
  authLogin: (login: string, password: string, code: string, remember = false) =>
    invoke<LoginResponse>('auth_login', { login, password, code, remember }),
  authLogout: () => invoke<void>('auth_logout'),
  authMe: () => invoke<UserInfo>('auth_me'),
  setApiKey: (key: string) => invoke<void>('set_api_key', { key }),
  hasApiKey: () => invoke<boolean>('has_api_key'),
  hasJwt: () => invoke<boolean>('has_jwt'),

  // backends
  backendsList: (mineOnly = true) => invoke<Backend[]>('backends_list', { mineOnly }),
  backendsGet: (name: string) => invoke<Backend>('backends_get', { name }),
  backendsCreate: (draft: BackendDraft) => invoke<Backend>('backends_create', { draft }),
  backendsUpdate: (name: string, patch: Record<string, any>) =>
    invoke<Backend>('backends_update', { name, patch }),
  backendsDelete: (name: string) => invoke<void>('backends_delete', { name }),
  backendsToggleListing: (name: string) => invoke<any>('backends_toggle_listing', { name }),
  backendsCheck: (name: string) => invoke<any>('backends_check', { name }),
  backendsStats: () => invoke<BackendStat[]>('backends_stats'),
  modelsV1: () => invoke<any>('models_v1'),

  // tunnels
  tunnelsList: () => invoke<TunnelStatus[]>('tunnels_list'),
  tunnelsStatus: (name: string) => invoke<TunnelStatus | null>('tunnels_status', { name }),
  tunnelsStart: (cfg: TunnelConfig) => invoke<TunnelStatus>('tunnels_start', { cfg }),
  tunnelsStop: (name: string) => invoke<void>('tunnels_stop', { name }),
  tunnelsTailLog: (name: string, maxLines = 200) =>
    invoke<string>('tunnels_tail_log', { name, maxLines }),

  // engines
  enginesList: () => invoke<EngineStatus[]>('engines_list'),
  enginesStart: (cfg: EngineConfig) => invoke<EngineStatus>('engines_start', { cfg }),
  enginesStop: (name: string) => invoke<void>('engines_stop', { name }),
  enginesStatus: (name: string) => invoke<EngineStatus | null>('engines_status', { name }),
  enginesHealth: (name: string) => invoke<boolean>('engines_health', { name }),
  enginesTailLog: (name: string, maxLines = 200) =>
    invoke<string>('engines_tail_log', { name, maxLines }),

  // local models
  localModelsList: (root: string) => invoke<LocalModel[]>('local_models_list', { root }),
  localModelsDelete: (path: string) => invoke<void>('local_models_delete', { path }),
  localModelsDiskUsage: (path: string) => invoke<number>('local_models_disk_usage', { path }),
  modelsDownload: (req: DownloadRequest) => invoke<void>('models_download', { req }),
};
