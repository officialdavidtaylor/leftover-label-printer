export const MVP_ROLES = ['user', 'sysadmin'] as const;

export type MvpRole = (typeof MVP_ROLES)[number];

export type PrintJobOperation = 'createPrintJob' | 'getPrintJob';

export type AuthorizationRequest = {
  operation: PrintJobOperation;
  subjectUserId: string;
  subjectRoles: readonly string[];
  resourceOwnerUserId?: string;
};

export type AuthorizationDecision =
  | { allowed: true }
  | { allowed: false; reason: 'missing_role' | 'operation_not_allowed' | 'ownership_mismatch' };

type ErrorResponse = {
  code: string;
  message: string;
  traceId?: string;
};

const ROLE_POLICY: Record<MvpRole, ReadonlySet<PrintJobOperation>> = {
  user: new Set<PrintJobOperation>(['createPrintJob', 'getPrintJob']),
  sysadmin: new Set<PrintJobOperation>(['createPrintJob', 'getPrintJob']),
};

export function authorizePrintJobOperation(request: AuthorizationRequest): AuthorizationDecision {
  const recognizedRoles = request.subjectRoles.filter(isMvpRole);

  if (recognizedRoles.length === 0) {
    return { allowed: false, reason: 'missing_role' };
  }

  const anyRoleAllowsOperation = recognizedRoles.some((role) => ROLE_POLICY[role].has(request.operation));
  if (!anyRoleAllowsOperation) {
    return { allowed: false, reason: 'operation_not_allowed' };
  }

  const isSysadmin = recognizedRoles.includes('sysadmin');
  const ownershipCheckRequired = request.operation === 'getPrintJob';
  if (!isSysadmin && ownershipCheckRequired) {
    if (!request.resourceOwnerUserId || request.resourceOwnerUserId !== request.subjectUserId) {
      return { allowed: false, reason: 'ownership_mismatch' };
    }
  }

  return { allowed: true };
}

export function buildForbiddenError(traceId?: string): ErrorResponse {
  return {
    code: 'forbidden',
    message: 'Forbidden',
    ...(traceId ? { traceId } : {}),
  };
}

function isMvpRole(value: string): value is MvpRole {
  return value === 'user' || value === 'sysadmin';
}
