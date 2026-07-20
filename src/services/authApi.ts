import type { AccountInput, AuthStatus, AuthUser, PermissionDefinition, UserInput, UserUpdateInput } from "../types/auth";

interface ApiErrorBody {
  error?: string | { code?: string; message?: string; details?: unknown };
}

async function authRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });
  const payload = await response.json() as T & ApiErrorBody;
  if (!response.ok) {
    const message = typeof payload.error === "string" ? payload.error : payload.error?.message;
    throw new Error(message || `账号服务请求失败：${response.status}`);
  }
  return payload;
}

export function getAuthStatus() {
  return authRequest<AuthStatus>("/api/auth/status");
}

export function bootstrapAdmin(input: AccountInput) {
  return authRequest<{ user: AuthUser; expiresAt: string }>("/api/auth/bootstrap", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function login(input: Omit<AccountInput, "name">) {
  return authRequest<{ user: AuthUser; expiresAt: string }>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function logout() {
  return authRequest<{ ok: boolean }>("/api/auth/logout", { method: "POST" });
}

export function listUsers() {
  return authRequest<{ users: AuthUser[]; permissionCatalog: PermissionDefinition[] }>("/api/admin/users");
}

export function createUser(input: UserInput) {
  return authRequest<{ user: AuthUser }>("/api/admin/users", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateUser(userId: string, input: UserUpdateInput) {
  return authRequest<{ user: AuthUser }>(`/api/admin/users/${encodeURIComponent(userId)}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}
