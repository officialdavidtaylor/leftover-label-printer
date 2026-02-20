export const CANONICAL_ROLES_CLAIM = 'roles';

export const MVP_ROLES = ['user', 'sysadmin'] as const;

type Role = (typeof MVP_ROLES)[number];

export type FrontendOidcClientConfig = {
  issuerUrl: string;
  clientId: string;
  audience: string;
  responseType: string;
  pkceRequired: boolean;
};

export type BackendOidcValidationConfig = {
  issuerUrl: string;
  audience: string;
  jwksUrl: string;
  rolesClaim: string;
};

export function validateFrontendOidcClientConfig(config: FrontendOidcClientConfig): string[] {
  const errors: string[] = [];

  if (!isAbsoluteHttpUrl(config.issuerUrl)) {
    errors.push('issuerUrl must be an absolute http(s) URL');
  }

  if (config.clientId.trim() === '') {
    errors.push('clientId must be set');
  }

  if (config.audience.trim() === '') {
    errors.push('audience must be set');
  }

  if (config.responseType !== 'code') {
    errors.push('responseType must be code for Authorization Code + PKCE');
  }

  if (!config.pkceRequired) {
    errors.push('pkceRequired must be true');
  }

  return errors;
}

export function validateBackendOidcValidationConfig(config: BackendOidcValidationConfig): string[] {
  const errors: string[] = [];

  if (!isAbsoluteHttpUrl(config.issuerUrl)) {
    errors.push('issuerUrl must be an absolute http(s) URL');
  }

  if (config.audience.trim() === '') {
    errors.push('audience must be set');
  }

  if (!isAbsoluteHttpUrl(config.jwksUrl)) {
    errors.push('jwksUrl must be an absolute http(s) URL');
  }

  if (config.rolesClaim !== CANONICAL_ROLES_CLAIM) {
    errors.push(`rolesClaim must be ${CANONICAL_ROLES_CLAIM}`);
  }

  return errors;
}

export function parseCanonicalRolesClaim(
  claims: Record<string, unknown>,
  claimName: string = CANONICAL_ROLES_CLAIM
): Role[] | null {
  const rawRoles = claims[claimName];

  if (!Array.isArray(rawRoles) || rawRoles.length === 0) {
    return null;
  }

  const roles: Role[] = [];
  for (const role of rawRoles) {
    if (role !== 'user' && role !== 'sysadmin') {
      return null;
    }

    roles.push(role);
  }

  return roles;
}

function isAbsoluteHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}
