import { NavLink } from 'react-router-dom';
import { api } from '../api';

const items = [
  { to: '/dashboard', label: '仪表盘' },
  { to: '/services', label: '后端服务' },
  { to: '/tunnels', label: '通道' },
  { to: '/engines', label: '推理引擎' },
  { to: '/models', label: '本地模型' },
  { to: '/settings', label: '设置' },
];

export default function Sidebar() {
  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-name">天枢 Provider</div>
        <div className="brand-version">v0.1.0</div>
      </div>
      <nav>
        {items.map((it) => (
          <NavLink key={it.to} to={it.to} className={({ isActive }) => (isActive ? 'nav-item active' : 'nav-item')}>
            {it.label}
          </NavLink>
        ))}
      </nav>
      <div className="sidebar-footer">
        <button
          className="btn btn-ghost"
          onClick={async () => {
            await api.authLogout();
            await api.setApiKey('');
            location.hash = '#/login';
          }}
        >
          退出登录
        </button>
      </div>
    </aside>
  );
}
