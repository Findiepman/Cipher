/**
 * The HTTP contract with server/.
 *
 * This file is the frontend's half of the agreement described in
 * backend-plan.md. Every field here is something the client either sends or
 * expects back. Where the backend plan named an endpoint but not its payload,
 * the shape below is a proposal. frontend-plan.md lists the open questions in
 * one place so they can be settled in a single pass rather than discovered
 * during integration.
 *
 * Two invariants this file exists to make visible:
 *   1. No request type carries a private key, a password or a recovery code.
 *      The server receives `authHash`, opaque wrapped blobs and hashes.
 *   2. No response type carries another user's wrapped private key. The key
 *      registry hands out public keys only (see PublicDeviceDto).
 */

export type UserRole = 'user' | 'admin';
export type AccountStatus = 'active' | 'disabled' | 'deleted';

/** The signed-in user's own account. */
export interface AccountDto {
  id: string;
  email: string;
  username: string;
  role: UserRole;
  status: AccountStatus;
  /** ISO-8601, or null while the address is unverified. */
  emailVerifiedAt: string | null;
  createdAt: string;
  lastLoginAt: string | null;
}

/**
 * Only issued in bearer mode (the desktop shell). In cookie mode the tokens
 * live in httpOnly cookies and never touch JavaScript, so this is absent.
 */
export interface TokenPair {
  accessToken: string;
  /** ISO-8601. Used to refresh proactively rather than waiting for a 401. */
  accessTokenExpiresAt: string;
  refreshToken: string;
}

/**
 * A device's key material as its *owner* sees it. The wrapped blobs are opaque
 * to the server; it stores and returns them without being able to open either.
 */
export interface DeviceDto {
  id: string;
  label: string;
  /** base64 X25519 public key. */
  publicKey: string;
  /** blob_A: the private key wrapped under the account password. */
  wrappedPrivateKey: string;
  /** blob_B: the same private key wrapped under the recovery code. */
  wrappedPrivateKeyRecovery: string;
  createdAt: string;
  revokedAt: string | null;
}

/**
 * A device as *everyone else* sees it. Deliberately has no wrapped-key fields:
 * GET /keys/user/:userId returning a blob_A would be a password-cracking
 * target handed out to any authenticated user.
 */
export interface PublicDeviceDto {
  id: string;
  userId: string;
  label: string;
  publicKey: string;
  createdAt: string;
  revokedAt: string | null;
}

export interface SessionDto {
  id: string;
  deviceLabel: string | null;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
  expiresAt: string;
  /** True for the session making the request, so the UI can say "this device". */
  current: boolean;
}

/* ------------------------------------------------------------------ auth --- */

/** What the client uploads at signup. Note what is absent: the password. */
export interface RegisterRequest {
  email: string;
  username: string;
  /** argon2id(password, salt derived from email, domain "auth"). */
  authHash: string;
  /** SHA-256 of the recovery code. The code itself never leaves the device. */
  recoveryCodeHash: string;
  device: DeviceRegistration;
}

export interface DeviceRegistration {
  label: string;
  publicKey: string;
  wrappedPrivateKey: string;
  wrappedPrivateKeyRecovery: string;
}

/**
 * Register and forgot-password always return this same generic shape whether or
 * not the account exists, so neither can be used to enumerate accounts.
 */
export interface AcknowledgedResponse {
  ok: true;
}

export interface LoginRequest {
  email: string;
  authHash: string;
  /** Shown in the user's session list, e.g. "Firefox on Windows". */
  deviceLabel?: string;
}

export interface LoginResponse {
  user: AccountDto;
  /** Bearer mode only. */
  tokens?: TokenPair;
  /**
   * The caller's own device record, returned inline so login can unwrap the
   * private key without a second round trip. Null for an account whose device
   * registration did not complete.
   */
  device: DeviceDto | null;
}

export interface RefreshRequest {
  /** Bearer mode only; in cookie mode the refresh cookie is the credential. */
  refreshToken?: string;
}

export interface RefreshResponse {
  tokens?: TokenPair;
}

export interface VerifyEmailRequest {
  token: string;
}

export interface ResendVerificationRequest {
  email: string;
}

export interface ForgotPasswordRequest {
  email: string;
}

/**
 * Both reset paths from backend-plan.md land here.
 *
 * With the recovery code (`identityReset: false`): the client unwrapped blob_B
 * locally, re-wrapped it under the new password and sends the new blob_A. The
 * keypair, and therefore the message history, survives.
 *
 * Without it (`identityReset: true`): the client generated a brand new keypair.
 * Old ciphertext stays on the server permanently unreadable, and contacts must
 * be shown a "security number changed" warning.
 */
/**
 * Exchanging a reset token for the material needed to recover the identity.
 *
 * This endpoint is NOT in backend-plan.md and has to be added: a password reset
 * happens while signed out, often on a new device, so the client has no way to
 * reach blob_B, and without blob_B the recovery code cannot save the identity,
 * which is the entire point of having one. Handing out blob_B in exchange for a
 * valid, unexpired, single-use reset token leaks nothing: it is opaque without
 * the recovery code, which the server has never seen.
 */
export interface ResetContextRequest {
  token: string;
}

export interface ResetContextResponse {
  /** Echoed back so the client derives the new authHash under the right salt. */
  email: string;
  deviceId: string;
  publicKey: string;
  /** blob_B. Useless to anyone without the recovery code. */
  wrappedPrivateKeyRecovery: string;
}

export interface ResetPasswordRequest {
  token: string;
  authHash: string;
  identityReset: boolean;
  wrappedPrivateKey: string;
  /** Present only on an identity reset, where a fresh keypair was generated. */
  publicKey?: string;
  wrappedPrivateKeyRecovery?: string;
  recoveryCodeHash?: string;
}

/* --------------------------------------------------------------- account --- */

export interface UpdateProfileRequest {
  username?: string;
}

export interface ChangePasswordRequest {
  currentAuthHash: string;
  newAuthHash: string;
  /** blob_A re-wrapped under the new password. blob_B is untouched. */
  wrappedPrivateKey: string;
}

export interface ChangeEmailRequest {
  newEmail: string;
  /** Re-authentication, derived under the *current* email's salt. */
  authHash: string;
}

/**
 * Confirming an email change needs a freshly derived authHash, because the auth
 * salt is derived from the email (see packages/crypto/src/kdf.ts). The wrapped
 * key blobs are unaffected: they carry their own random salts.
 */
export interface ConfirmEmailChangeRequest {
  token: string;
  newAuthHash: string;
}

export interface RegenerateRecoveryCodeRequest {
  authHash: string;
  recoveryCodeHash: string;
  /** blob_B re-wrapped under the new code, invalidating the old one. */
  wrappedPrivateKeyRecovery: string;
}

export interface DeleteAccountRequest {
  authHash: string;
}

/* --------------------------------------------------------------- friends --- */

/** An accepted friend. `publicKey` rides along so opening a DM is one call. */
export interface FriendDto {
  id: string;
  username: string;
  /** base64 X25519 public key, or null for an account with no active device. */
  publicKey: string | null;
  /**
   * What you call this person. Yours alone: they are never told, and nobody
   * else is ever shown it. Null means you have not renamed them.
   */
  nickname: string | null;
  friendsSince: string;
}

export interface SetNicknameResponse {
  nickname: string;
}

/**
 * Someone you have blocked.
 *
 * Only ever your own blocks. There is no endpoint that answers "who has blocked
 * me", and there should not be: that list is useful to exactly one person, and
 * it is the one working around it.
 */
export interface BlockedUserDto {
  id: string;
  username: string;
  blockedAt: string;
}

export interface FriendRequestDto {
  id: string;
  direction: 'incoming' | 'outgoing';
  user: { id: string; username: string };
  createdAt: string;
}

export interface FriendRequestsResponse {
  incoming: FriendRequestDto[];
  outgoing: FriendRequestDto[];
}

/**
 * Adding by exact username, never by email. An email lookup would turn this
 * into a "does this person have an account here" oracle, which is the one
 * question the auth design refuses to answer everywhere else.
 */
export interface SendFriendRequestRequest {
  username: string;
}

/**
 * `accepted` comes back when the other person had already asked: both parties
 * saying yes is consent, not a second request. `already_friends` is not an
 * error either, so the UI does not need a catch for the common cases.
 */
export interface SendFriendRequestResponse {
  status: 'pending' | 'accepted' | 'already_friends';
  user: { id: string; username: string };
}

/* --------------------------------------------------- conversations --- */

export interface ConversationParticipantDto {
  id: string;
  username: string;
  publicKey: string | null;
}

export interface ConversationDto {
  id: string;
  kind: 'dm';
  /** Everyone in it, the caller included. */
  participants: ConversationParticipantDto[];
  /**
   * The newest message's id and time, not a preview. The server holds only
   * ciphertext, so it has no readable text to summarise; the preview in the
   * conversation list is rendered from this client's own decrypted history.
   */
  lastMessage: { id: string; authorId: string; sentAt: string } | null;
  /**
   * Where *you* have read up to and how many messages by anyone else sit
   * after it. Both are the caller's own: the other participant's position is
   * theirs and never comes down here.
   *
   * The count rides along with the list so drawing twenty unread dots costs
   * one request rather than twenty-one.
   */
  lastReadMessageId: string | null;
  unread: number;
  createdAt: string;
}

/** What POST /conversations/:id/read sends: how far the caller has read. */
export interface MarkReadRequest {
  messageId: string;
}

/** The caller's read position after marking and what is still unread. */
export interface ReadStateDto {
  conversationId: string;
  lastReadMessageId: string;
  unread: number;
}

/** A stored message, carrying the single envelope addressed to this caller. */
export interface MessageDto {
  id: string;
  conversationId: string;
  authorId: string;
  clientId: string;
  sentAt: string;
  ciphertext: string;
}

export interface BacklogResponse {
  messages: MessageDto[];
  /** The last id in this page, to pass back as `after`. Null when caught up. */
  cursor: string | null;
}

/**
 * One sealed copy per participant, the sender included. See the note on
 * `Envelope` in lib/transport/types.ts for why the sender's own copy is not
 * optional.
 */
export interface SendMessageRequest {
  clientId: string;
  envelopes: { recipientUserId: string; ciphertext: string }[];
}

/* ----------------------------------------------------------------- admin --- */

export interface Paginated<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

export interface AdminUserListQuery {
  q?: string;
  status?: AccountStatus;
  page?: number;
}

export interface AdminUserDto extends AccountDto {
  failedLoginCount: number;
  lockedUntil: string | null;
  sessionCount: number;
}

export interface AuditLogEntry {
  id: string;
  actorUserId: string | null;
  targetUserId: string | null;
  action: string;
  ip: string | null;
  meta: Record<string, unknown> | null;
  createdAt: string;
}

/* ---------------------------------------------------------------- errors --- */

/** Error envelope. Fastify's default is `{ statusCode, error, message }`;
 *  this adds a stable machine-readable `code` the UI can branch on. */
export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

/**
 * Error codes the UI needs to distinguish. Anything else is shown as a generic
 * failure, so an unknown code degrades gracefully rather than throwing.
 */
export const API_ERROR_CODES = {
  invalidCredentials: 'invalid_credentials',
  emailNotVerified: 'email_not_verified',
  accountLocked: 'account_locked',
  accountDisabled: 'account_disabled',
  emailInUse: 'email_in_use',
  usernameInUse: 'username_in_use',
  weakPassword: 'weak_password',
  invalidToken: 'invalid_token',
  expiredToken: 'expired_token',
  rateLimited: 'rate_limited',
  csrfFailed: 'csrf_failed',
  unauthorized: 'unauthorized',
  forbidden: 'forbidden',
  notFound: 'not_found',
  validation: 'validation_failed',
  /** Client-side only: the request never reached the server. */
  network: 'network_error',
  /** Client-side only: the request was aborted or timed out. */
  timeout: 'timeout',
} as const;

export type ApiErrorCode = (typeof API_ERROR_CODES)[keyof typeof API_ERROR_CODES] | string;

/* ---------------------------------------------------------------- calls --- */

/**
 * What RTCPeerConnection is handed for a call. Minted by the server per call
 * from a Cloudflare TURN key that never reaches the client; the credentials in
 * here expire after `ttlSeconds`, so this is fetched when a call starts and
 * never cached across one.
 */
export interface IceServersDto {
  iceServers: RTCIceServer[];
  ttlSeconds: number;
  /** False means STUN only: no relay, so two NATs will not connect. */
  relay: boolean;
}
