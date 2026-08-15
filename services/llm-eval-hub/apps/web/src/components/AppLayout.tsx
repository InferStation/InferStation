import {
  Activity,
  Braces,
  Database,
  Gauge,
  KeyRound,
  Menu,
  Play,
  Server,
  X,
} from "lucide-react";
import { useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { getApiKey, setApiKey } from "../api/client";
import { Modal } from "./Modal";

const navItems = [
  { to: "/", label: "概览", icon: Gauge, end: true },
  { to: "/endpoints", label: "Endpoints", icon: Server },
  { to: "/datasets", label: "数据集", icon: Database },
  { to: "/evaluations/new", label: "新建测评", icon: Play },
  { to: "/runs", label: "运行记录", icon: Activity },
];

export function AppLayout() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [keyOpen, setKeyOpen] = useState(false);
  const [apiKey, updateApiKey] = useState(getApiKey());

  const saveKey = () => {
    setApiKey(apiKey.trim());
    setKeyOpen(false);
    window.location.reload();
  };

  return (
    <div className="app-shell">
      <aside className={menuOpen ? "sidebar sidebar-open" : "sidebar"}>
        <div className="brand">
          <span className="brand-mark"><Braces size={18} /></span>
          <div><strong>LLM Eval Hub</strong><small>Internal Quality Lab</small></div>
          <button className="icon-button mobile-close" onClick={() => setMenuOpen(false)} title="关闭导航">
            <X size={18} />
          </button>
        </div>
        <nav>
          {navItems.map(({ to, label, icon: Icon, end }) => (
            <NavLink key={to} to={to} end={end} onClick={() => setMenuOpen(false)}>
              <Icon size={17} /><span>{label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-footer">
          <span className="environment-dot" />
          <div><strong>本地环境</strong><small>Phase 1 · v0.1.0</small></div>
        </div>
      </aside>
      {menuOpen && <button className="sidebar-scrim" aria-label="关闭导航" onClick={() => setMenuOpen(false)} />}
      <div className="content-shell">
        <header className="topbar">
          <button className="icon-button mobile-menu" onClick={() => setMenuOpen(true)} title="打开导航">
            <Menu size={19} />
          </button>
          <span className="topbar-context">模型 API 测评控制台</span>
          <button className="quiet-button" onClick={() => setKeyOpen(true)}>
            <KeyRound size={15} /> API 凭据
          </button>
        </header>
        <main><Outlet /></main>
      </div>
      <Modal title="API 凭据" open={keyOpen} onClose={() => setKeyOpen(false)}>
        <div className="form-stack">
          <label>内部管理密钥<input type="password" value={apiKey} onChange={(e) => updateApiKey(e.target.value)} /></label>
          <div className="form-actions"><button className="primary-button" onClick={saveKey}>保存</button></div>
        </div>
      </Modal>
    </div>
  );
}
