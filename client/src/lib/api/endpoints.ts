/**
 * Thin, typed wrappers over the endpoints in backend-plan.md. No logic beyond
 * shaping the call — the orchestration (derive, wrap, store) lives in
 * src/lib/session, and the crypto lives in packages/crypto.
 *
 * Everything is built from a factory taking an ApiClient so tests can drive the
 * same code against a fake fetch.
 */
import { ApiClient, api } from './client';
import type {
  AccountDto,
  AcknowledgedResponse,
  AdminUserDto,
  AdminUserListQuery,
  AuditLogEntry,
  ChangeEmailRequest,
  ChangePasswordRequest,
  ConfirmEmailChangeRequest,
  DeleteAccountRequest,
  DeviceDto,
  DeviceRegistration,
  ForgotPasswordRequest,
  LoginRequest,
  LoginResponse,
  Paginated,
  PublicDeviceDto,
  RegenerateRecoveryCodeRequest,
  RegisterRequest,
  ResendVerificationRequest,
  ResetContextRequest,
  ResetContextResponse,
  ResetPasswordRequest,
  SessionDto,
  UpdateProfileRequest,
  VerifyEmailRequest,
} from './types';

export function createAuthApi(client: ApiClient) {
  return {
    register(body: RegisterRequest) {
      return client.post<AcknowledgedResponse>('/auth/register', body);
    },
    verifyEmail(body: VerifyEmailRequest) {
      return client.post<AcknowledgedResponse>('/auth/verify-email', body);
    },
    resendVerification(body: ResendVerificationRequest) {
      return client.post<AcknowledgedResponse>('/auth/resend-verification', body);
    },
    login(body: LoginRequest) {
      return client.post<LoginResponse>('/auth/login', body);
    },
    logout() {
      return client.post<void>('/auth/logout');
    },
    logoutAll() {
      return client.post<void>('/auth/logout-all');
    },
    forgotPassword(body: ForgotPasswordRequest) {
      return client.post<AcknowledgedResponse>('/auth/forgot-password', body);
    },
    /** See ResetContextRequest — this one still needs adding server-side. */
    resetContext(body: ResetContextRequest) {
      return client.post<ResetContextResponse>('/auth/reset-password/context', body);
    },
    resetPassword(body: ResetPasswordRequest) {
      return client.post<AcknowledgedResponse>('/auth/reset-password', body);
    },
  };
}

export function createAccountApi(client: ApiClient) {
  return {
    me() {
      return client.get<AccountDto>('/account/me');
    },
    updateProfile(body: UpdateProfileRequest) {
      return client.patch<AccountDto>('/account/me', body);
    },
    changePassword(body: ChangePasswordRequest) {
      return client.post<AcknowledgedResponse>('/account/change-password', body);
    },
    changeEmail(body: ChangeEmailRequest) {
      return client.post<AcknowledgedResponse>('/account/change-email', body);
    },
    confirmEmailChange(body: ConfirmEmailChangeRequest) {
      return client.post<AcknowledgedResponse>('/account/change-email/confirm', body);
    },
    sessions() {
      return client.get<SessionDto[]>('/account/sessions');
    },
    revokeSession(id: string) {
      return client.delete<void>(`/account/sessions/${encodeURIComponent(id)}`);
    },
    revokeAllSessions() {
      return client.delete<void>('/account/sessions');
    },
    regenerateRecoveryCode(body: RegenerateRecoveryCodeRequest) {
      return client.post<AcknowledgedResponse>('/account/recovery-code', body);
    },
    deleteAccount(body: DeleteAccountRequest) {
      return client.delete<void>('/account', body);
    },
  };
}

export function createKeysApi(client: ApiClient) {
  return {
    registerDevice(body: DeviceRegistration) {
      return client.post<DeviceDto>('/keys/device', body);
    },
    /**
     * The public-key registry. Returns public keys only — if a response here
     * ever contained a wrapped private key, that would be a server bug worth
     * stopping for, so the type deliberately cannot express one.
     */
    devicesForUser(userId: string) {
      return client.get<PublicDeviceDto[]>(`/keys/user/${encodeURIComponent(userId)}`);
    },
    revokeDevice(id: string) {
      return client.delete<void>(`/keys/device/${encodeURIComponent(id)}`);
    },
  };
}

export function createAdminApi(client: ApiClient) {
  return {
    listUsers(query: AdminUserListQuery = {}) {
      return client.get<Paginated<AdminUserDto>>('/admin/users', { query: { ...query } });
    },
    getUser(id: string) {
      return client.get<AdminUserDto>(`/admin/users/${encodeURIComponent(id)}`);
    },
    disableUser(id: string) {
      return client.post<AcknowledgedResponse>(`/admin/users/${encodeURIComponent(id)}/disable`);
    },
    enableUser(id: string) {
      return client.post<AcknowledgedResponse>(`/admin/users/${encodeURIComponent(id)}/enable`);
    },
    forceLogout(id: string) {
      return client.post<AcknowledgedResponse>(
        `/admin/users/${encodeURIComponent(id)}/force-logout`,
      );
    },
    resendVerification(id: string) {
      return client.post<AcknowledgedResponse>(
        `/admin/users/${encodeURIComponent(id)}/resend-verify`,
      );
    },
    auditLog(page = 1) {
      return client.get<Paginated<AuditLogEntry>>('/admin/audit-log', { query: { page } });
    },
  };
}

export const authApi = createAuthApi(api);
export const accountApi = createAccountApi(api);
export const keysApi = createKeysApi(api);
export const adminApi = createAdminApi(api);
