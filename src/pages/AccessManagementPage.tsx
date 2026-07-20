import { Check, Plus, RefreshCw, Save, ShieldCheck, UserRound, UserRoundCog } from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Card } from "../components/Card";
import { PageHeader } from "../components/PageHeader";
import { StatusTag } from "../components/StatusTag";
import { createUser, listUsers, updateUser } from "../services/authApi";
import type { AuthUser, PermissionDefinition, UserRole } from "../types/auth";
import { clsx } from "../utils/format";

interface AccessManagementPageProps {
  currentUser: AuthUser;
  onCurrentUserChange: (user: AuthUser) => void;
  onAction: (title: string, detail?: string) => void;
}

interface UserDraft {
  name: string;
  email: string;
  phone: string;
  password: string;
  role: UserRole;
  active: boolean;
  permissions: string[];
}

const emptyDraft: UserDraft = {
  name: "",
  email: "",
  phone: "",
  password: "",
  role: "user",
  active: true,
  permissions: ["dashboard.view"],
};

function draftFromUser(user: AuthUser): UserDraft {
  return {
    name: user.name,
    email: user.email,
    phone: user.phone,
    password: "",
    role: user.role,
    active: user.active,
    permissions: user.permissions,
  };
}

export function AccessManagementPage({ currentUser, onCurrentUserChange, onAction }: AccessManagementPageProps) {
  const [users, setUsers] = useState<AuthUser[]>([]);
  const [permissionCatalog, setPermissionCatalog] = useState<PermissionDefinition[]>([]);
  const [selectedId, setSelectedId] = useState("new");
  const [draft, setDraft] = useState<UserDraft>(emptyDraft);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const selectedUser = users.find((user) => user.id === selectedId) ?? null;
  const editablePermissions = useMemo(
    () => permissionCatalog.filter((permission) => permission.id !== "admin.users"),
    [permissionCatalog],
  );
  const permissionGroups = useMemo(
    () => Array.from(new Set(editablePermissions.map((permission) => permission.group))),
    [editablePermissions],
  );

  async function load(selectId?: string) {
    setLoading(true);
    setError("");
    try {
      const result = await listUsers();
      setUsers(result.users);
      setPermissionCatalog(result.permissionCatalog);
      if (selectId) {
        const user = result.users.find((item) => item.id === selectId);
        if (user) {
          setSelectedId(user.id);
          setDraft(draftFromUser(user));
        }
      }
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "无法读取用户列表");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load(currentUser.id);
  }, [currentUser.id]);

  function startCreate() {
    setSelectedId("new");
    setDraft(emptyDraft);
    setError("");
  }

  function selectUser(user: AuthUser) {
    setSelectedId(user.id);
    setDraft(draftFromUser(user));
    setError("");
  }

  function togglePermission(permission: string) {
    setDraft((current) => ({
      ...current,
      permissions: current.permissions.includes(permission)
        ? current.permissions.filter((item) => item !== permission)
        : [...current.permissions, permission],
    }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      if (selectedId === "new") {
        const result = await createUser(draft);
        onAction("用户已创建", `${result.user.name} 已可使用邮箱、手机号和密码登录`);
        await load(result.user.id);
      } else {
        const result = await updateUser(selectedId, {
          name: draft.name,
          email: draft.email,
          phone: draft.phone,
          role: draft.role,
          active: draft.active,
          permissions: draft.permissions,
          ...(draft.password ? { password: draft.password } : {}),
        });
        setUsers((current) => current.map((user) => user.id === result.user.id ? result.user : user));
        setDraft(draftFromUser(result.user));
        if (result.user.id === currentUser.id) onCurrentUserChange(result.user);
        onAction("权限已保存", `${result.user.name} 的访问范围已立即生效`);
      }
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "保存失败，请稍后重试");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="用户与权限"
        subtitle="为每位成员独立设置页面访问、操作权限和账号状态；所有校验均在服务端执行。"
        actions={<button className="btn-primary" onClick={startCreate} type="button"><Plus size={15} /> 新建用户</button>}
      />

      <div className="access-layout">
        <Card
          className="access-user-list"
          title="成员账号"
          action={<button aria-label="刷新用户" className="icon-btn" disabled={loading} onClick={() => void load(selectedId)} type="button"><RefreshCw className={loading ? "animate-spin" : ""} size={15} /></button>}
        >
          <button className={clsx("access-user-card", selectedId === "new" && "is-active")} onClick={startCreate} type="button">
            <span className="access-user-avatar is-new"><Plus size={17} /></span>
            <span><b>创建新成员</b><small>配置登录信息与权限</small></span>
          </button>
          {users.map((user) => (
            <button className={clsx("access-user-card", selectedId === user.id && "is-active", !user.active && "is-disabled")} key={user.id} onClick={() => selectUser(user)} type="button">
              <span className="access-user-avatar"><UserRound size={16} /></span>
              <span className="min-w-0"><b>{user.name}</b><small>{user.email}</small></span>
              <StatusTag label={user.active ? (user.role === "admin" ? "管理员" : "启用") : "已停用"} tone={user.active ? (user.role === "admin" ? "purple" : "green") : "muted"} />
            </button>
          ))}
        </Card>

        <form onSubmit={handleSubmit}>
          <Card
            title={selectedUser ? `编辑 ${selectedUser.name}` : "创建成员账号"}
            action={<StatusTag label={draft.role === "admin" ? "全部权限" : `${draft.permissions.length} 项权限`} tone={draft.role === "admin" ? "purple" : "blue"} dot />}
          >
            <div className="access-section-heading"><UserRoundCog size={17} /><div><b>登录与账号状态</b><span>邮箱、手机号和密码三项同时匹配才可登录</span></div></div>
            <div className="grid gap-3 md:grid-cols-2">
              <label className="form-field"><span>姓名</span><input className="input-field" maxLength={80} onChange={(event) => setDraft({ ...draft, name: event.target.value })} required value={draft.name} /></label>
              <label className="form-field"><span>账号角色</span><select className="input-field" onChange={(event) => setDraft({ ...draft, role: event.target.value as UserRole })} value={draft.role}><option value="user">普通用户</option><option value="admin">管理员（全部权限）</option></select></label>
              <label className="form-field"><span>邮箱</span><input className="input-field" onChange={(event) => setDraft({ ...draft, email: event.target.value })} required type="email" value={draft.email} /></label>
              <label className="form-field"><span>手机号</span><input className="input-field" onChange={(event) => setDraft({ ...draft, phone: event.target.value })} required type="tel" value={draft.phone} /></label>
              <label className="form-field md:col-span-2"><span>{selectedUser ? "重置密码（留空则不修改）" : "初始密码"}</span><input className="input-field" minLength={10} onChange={(event) => setDraft({ ...draft, password: event.target.value })} placeholder="至少 10 位，包含字母和数字" required={!selectedUser} type="password" value={draft.password} /></label>
            </div>
            <label className="access-active-toggle">
              <input checked={draft.active} onChange={(event) => setDraft({ ...draft, active: event.target.checked })} type="checkbox" />
              <span><b>允许登录</b><small>关闭后该用户的现有会话会立即失效</small></span>
              <span className={clsx("toggle-track", draft.active && "is-on")}><i /></span>
            </label>

            <div className="access-divider" />
            <div className="access-section-heading"><ShieldCheck size={17} /><div><b>访问权限</b><span>{draft.role === "admin" ? "管理员自动拥有全部权限" : "可按页面和操作能力逐项分配"}</span></div></div>
            <div className="permission-groups">
              {permissionGroups.map((group) => (
                <section className="permission-group" key={group}>
                  <h3>{group}</h3>
                  <div>
                    {editablePermissions.filter((permission) => permission.group === group).map((permission) => {
                      const checked = draft.role === "admin" || draft.permissions.includes(permission.id);
                      return (
                        <label className={clsx("permission-option", checked && "is-checked")} key={permission.id}>
                          <input checked={checked} disabled={draft.role === "admin"} onChange={() => togglePermission(permission.id)} type="checkbox" />
                          <span className="permission-check">{checked && <Check size={13} />}</span>
                          <span><b>{permission.label}</b><small>{permission.description}</small></span>
                        </label>
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>

            {error && <div className="auth-error mt-4" role="alert">{error}</div>}
            <div className="access-actions">
              <span>{selectedUser?.id === currentUser.id ? "你正在编辑自己的管理员账号" : "保存后立即应用到下一次接口请求"}</span>
              <button className="btn-primary" disabled={saving} type="submit"><Save size={15} /> {saving ? "保存中…" : "保存账号与权限"}</button>
            </div>
          </Card>
        </form>
      </div>
    </div>
  );
}
