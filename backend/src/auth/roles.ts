export const CANONICAL_ROLES_CLAIM = 'roles';

export const MVP_ROLES = ['user', 'sysadmin'] as const;

export type MvpRole = (typeof MVP_ROLES)[number];

export function isMvpRole(value: string): value is MvpRole {
  return value === 'user' || value === 'sysadmin';
}

export function parseMvpRoles(values: unknown): MvpRole[] | null {
  if (!Array.isArray(values) || values.length === 0) {
    return null;
  }

  const parsed: MvpRole[] = [];
  for (const value of values) {
    if (typeof value !== 'string' || !isMvpRole(value)) {
      return null;
    }

    parsed.push(value);
  }

  return parsed;
}
