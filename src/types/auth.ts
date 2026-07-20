export type UserRole = "admin" | "user";

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  phone: string;
  role: UserRole;
  permissions: string[];
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PermissionDefinition {
  id: string;
  group: string;
  label: string;
  description: string;
}

export interface AuthStatus {
  configured: boolean;
  enforcementEnabled: boolean;
  userCount: number;
  user: AuthUser | null;
  permissionCatalog: PermissionDefinition[];
}

export interface AccountInput {
  name: string;
  email: string;
  phone: string;
  password: string;
}

export interface UserInput extends AccountInput {
  role: UserRole;
  permissions: string[];
  active?: boolean;
}

export interface UserUpdateInput {
  name?: string;
  email?: string;
  phone?: string;
  password?: string;
  role?: UserRole;
  permissions?: string[];
  active?: boolean;
}
