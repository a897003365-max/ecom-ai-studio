import { Aperture, AtSign, KeyRound, LockKeyhole, Phone, ShieldCheck, UserRound } from "lucide-react";
import { useState, type FormEvent } from "react";
import { bootstrapAdmin, login } from "../services/authApi";
import type { AuthStatus, AuthUser } from "../types/auth";

interface LoginPageProps {
  status: AuthStatus;
  onAuthenticated: (user: AuthUser) => void;
}

export function LoginPage({ status, onAuthenticated }: LoginPageProps) {
  const setupMode = !status.configured;
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (setupMode && password !== confirmPassword) {
      setError("两次输入的密码不一致");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      const result = setupMode
        ? await bootstrapAdmin({ name, email, phone, password })
        : await login({ email, phone, password });
      onAuthenticated(result.user);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "暂时无法登录，请稍后重试");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="auth-shell">
      <section className="auth-story-panel" aria-label="系统说明">
        <div className="auth-brand"><span className="logo-dot"><Aperture size={15} /></span><b><span>ecom</span> AI Studio</b></div>
        <div className="auth-story-copy">
          <div className="auth-kicker"><ShieldCheck size={15} /> 本地账号与权限保护</div>
          <h1>让经营数据只对<br />正确的人可见。</h1>
          <p>登录同时校验邮箱、手机号与密码；管理员可为每位成员单独配置页面和操作权限。</p>
          <div className="auth-security-list">
            <span><LockKeyhole size={16} /> HttpOnly 本地会话</span>
            <span><ShieldCheck size={16} /> 服务端逐接口授权</span>
            <span><UserRound size={16} /> 账号可随时停用</span>
          </div>
        </div>
      </section>

      <section className="auth-form-panel">
        <form className="auth-form-card" onSubmit={handleSubmit}>
          <div className="auth-form-heading">
            <div className="auth-form-icon"><KeyRound size={20} /></div>
            <div>
              <h2>{setupMode ? "创建首位管理员" : "登录运营工作台"}</h2>
              <p>{setupMode ? "仅首次启动需要完成，提交后系统立即进入受保护状态。" : "邮箱与手机号必须属于同一个启用账号。"}</p>
            </div>
          </div>

          {setupMode && (
            <label className="auth-field">
              <span>管理员姓名</span>
              <div><UserRound size={16} /><input autoComplete="name" onChange={(event) => setName(event.target.value)} placeholder="例如：张经理" required value={name} /></div>
            </label>
          )}
          <label className="auth-field">
            <span>邮箱</span>
            <div><AtSign size={16} /><input autoComplete="email" onChange={(event) => setEmail(event.target.value)} placeholder="name@company.com" required type="email" value={email} /></div>
          </label>
          <label className="auth-field">
            <span>手机号</span>
            <div><Phone size={16} /><input autoComplete="tel" inputMode="tel" onChange={(event) => setPhone(event.target.value)} placeholder="请输入账号绑定手机号" required type="tel" value={phone} /></div>
          </label>
          <label className="auth-field">
            <span>密码</span>
            <div><LockKeyhole size={16} /><input autoComplete={setupMode ? "new-password" : "current-password"} minLength={10} onChange={(event) => setPassword(event.target.value)} placeholder="至少 10 位，包含字母和数字" required type="password" value={password} /></div>
          </label>
          {setupMode && (
            <label className="auth-field">
              <span>确认密码</span>
              <div><LockKeyhole size={16} /><input autoComplete="new-password" minLength={10} onChange={(event) => setConfirmPassword(event.target.value)} placeholder="再次输入密码" required type="password" value={confirmPassword} /></div>
            </label>
          )}

          {error && <div className="auth-error" role="alert">{error}</div>}
          <button className="auth-submit" disabled={submitting} type="submit">
            {submitting ? "正在验证…" : setupMode ? "创建管理员并进入系统" : "安全登录"}
          </button>
          <div className="auth-footnote">账号密码仅在本机校验，不会写入浏览器存储。</div>
        </form>
      </section>
    </main>
  );
}
