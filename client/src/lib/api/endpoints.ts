/**
 * Thin, typed wrappers over the endpoints in backend-plan.md. No logic beyond
 * shaping the call. The orchestration (derive, wrap, store) lives in
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
  BacklogResponse,
  BlockedUserDto,
  ChangeEmailRequest,
  ChangePasswordRequest,
  ConfirmEmailChangeRequest,
  ConversationDto,
  DeleteAccountRequest,
  DeviceDto,
  DeviceRegistration,
  ForgotPasswordRequest,
  FriendDto,
  FriendRequestsResponse,
  LoginRequest,
  LoginResponse,
  MarkReadRequest,
  MessageDto,
  Paginated,
  PublicDeviceDto,
  RegenerateRecoveryCodeRequest,
  RegisterRequest,
  ResendVerificationRequest,
  ResetContextRequest,
  ResetContextResponse,
  ResetPasswordRequest,
  ReadStateDto,
  SendFriendRequestRequest,
  SendFriendRequestResponse,
  SendMessageRequest,
  SessionDto,
  SetNicknameResponse,
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
    /** See ResetContextRequest: this one still needs adding server-side. */
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
     * The public-key registry. Returns public keys only. If a response here
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

export function createFriendsApi(client: ApiClient) {
  return {
    list() {
      return client.get<{ friends: FriendDto[] }>('/friends');
    },
    requests() {
      return client.get<FriendRequestsResponse>('/friends/requests');
    },
    blocked() {
      return client.get<{ blocked: BlockedUserDto[] }>('/friends/blocked');
    },
    /** Exact username. The server caps this per account, not per address. */
    sendRequest(body: SendFriendRequestRequest) {
      return client.post<SendFriendRequestResponse>('/friends/requests', body);
    },
    accept(id: string) {
      return client.post<AcknowledgedResponse>(
        `/friends/requests/${encodeURIComponent(id)}/accept`,
      );
    },
    decline(id: string) {
      return client.post<AcknowledgedResponse>(
        `/friends/requests/${encodeURIComponent(id)}/decline`,
      );
    },
    /**
     * Withdrawing a request you sent. Deliberately not `decline`: the server
     * refuses the requester on that path, because the person who asked cannot
     * also answer.
     */
    cancel(id: string) {
      return client.post<AcknowledgedResponse>(
        `/friends/requests/${encodeURIComponent(id)}/cancel`,
      );
    },
    remove(userId: string) {
      return client.delete<AcknowledgedResponse>(`/friends/${encodeURIComponent(userId)}`);
    },
    /** Your own private label for someone. Sending null clears it. */
    setNickname(userId: string, nickname: string) {
      return client.patch<SetNicknameResponse>(
        `/friends/${encodeURIComponent(userId)}/nickname`,
        { nickname },
      );
    },
    clearNickname(userId: string) {
      return client.delete<AcknowledgedResponse>(
        `/friends/${encodeURIComponent(userId)}/nickname`,
      );
    },
    block(userId: string) {
      return client.post<AcknowledgedResponse>(`/friends/${encodeURIComponent(userId)}/block`);
    },
    unblock(userId: string) {
      return client.delete<AcknowledgedResponse>(`/friends/${encodeURIComponent(userId)}/block`);
    },
  };
}

export function createConversationsApi(client: ApiClient) {
  return {
    list() {
      return client.get<{ conversations: ConversationDto[] }>('/conversations');
    },
    /** Get-or-create. Opening the same DM twice returns the same conversation. */
    openDm(userId: string) {
      return client.post<ConversationDto>('/conversations/dm', { userId });
    },
    /**
     * `after` is this client's own last-seen message id. The server cannot say
     * what is new in a conversation it cannot read, so the cursor is ours.
     */
    messages(conversationId: string, after?: string, limit?: number) {
      return client.get<BacklogResponse>(
        `/conversations/${encodeURIComponent(conversationId)}/messages`,
        { query: { after, limit } },
      );
    },
    /**
     * How far this client has read. A message id for the same reason a cursor
     * is one: the server orders messages but cannot read them, so "up to here"
     * is the only thing either side can say about them.
     */
    markRead(conversationId: string, messageId: string) {
      const body: MarkReadRequest = { messageId };
      return client.post<ReadStateDto>(
        `/conversations/${encodeURIComponent(conversationId)}/read`,
        body,
      );
    },
    /** The fallback for when the socket is down; the socket is the normal path. */
    send(conversationId: string, body: SendMessageRequest) {
      return client.post<MessageDto>(
        `/conversations/${encodeURIComponent(conversationId)}/messages`,
        body,
      );
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
export const friendsApi = createFriendsApi(api);
export const conversationsApi = createConversationsApi(api);
export const adminApi = createAdminApi(api);
