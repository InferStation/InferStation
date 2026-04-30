import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';

type Tab = 'account' | 'apikey';

export default function Login() {
  const nav = useNavigate();
  const [tab, setTab] = useState<Tab>('account');

  // account tab
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [remember, setRemember] = useState(true);
  const [sentCode, setSentCode] = useState(false);

  // apikey tab
  const [apiKey, setApiKey] = useState('');

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const sendCode = async () => {
    setErr(null);
    if (!login.includes('@')) {
      setErr('"账号"在登录时既可填邮箱也可填用户名,但发送验证码必须用邮箱。');
      return;
    }
    setBusy(true);
    try {
      await api.authSendCode(login);
      setSentCode(true);
    } catch (e: any) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  };

  const doLogin = async () => {
    setErr(null);
    setBusy(true);
    try {
      await api.authLogin(login, password, code, remember);
      nav('/dashboard', { replace: true });
    } catch (e: any) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  };

  const useApiKey = async () => {
    setErr(null);
    setBusy(true);
    try {
      await api.setApiKey(apiKey.trim());
      nav('/dashboard', { replace: true });
    } catch (e: any) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-card">
        <h1 className="login-title">天枢 Provider</h1>
        <div className="login-tabs">
          <button className={tab === 'account' ? 'tab active' : 'tab'} onClick={() => setTab('account')}>账号登录</button>
          <button className={tab === 'apikey' ? 'tab active' : 'tab'} onClick={() => setTab('apikey')}>API Key</button>
        </div>

        {tab === 'account' && (
          <div className="form">
            <label>邮箱 / 用户名</label>
            <input value={login} onChange={(e) => setLogin(e.target.value)} placeholder="you@example.com" />
            <label>密码</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
            <label>邮箱验证码</label>
            <div className="row">
              <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="6 位验证码" />
              <button className="btn" disabled={busy} onClick={sendCode}>{sentCode ? '重新发送' : '获取验证码'}</button>
            </div>
            <label className="checkbox">
              <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} /> 记住登录
            </label>
            <button className="btn btn-primary" disabled={busy} onClick={doLogin}>登录</button>
          </div>
        )}

        {tab === 'apikey' && (
          <div className="form">
            <p className="hint">直接用网站签发的 API Key 登录。Key 会保存在系统密钥库中。</p>
            <label>API Key</label>
            <input value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="sk-..." />
            <button className="btn btn-primary" disabled={busy || !apiKey} onClick={useApiKey}>使用此 Key</button>
          </div>
        )}

        {err && <div className="err">{err}</div>}
      </div>
    </div>
  );
}
