/**
 * What the HTTP routes may ask of the socket layer.
 *
 * The routes are registered before the socket server exists (it needs the
 * HTTP server the routes live on), so they cannot import it. They get these
 * as plugin options instead, bound late by index.ts, exactly as `deliver` is.
 * Each is optional so the HTTP API can be built and tested with no socket at
 * all, in which case the call is a no-op.
 */
export interface RealtimeHooks {
  /// Somebody changed the presence they chose. The socket layer works out
  /// what their friends should now see and tells them.
  presenceChanged(userId: string): void;
  /// These sessions were just revoked. Drop their sockets now rather than on
  /// the next sweep: "I do not recognise this device" should not keep
  /// receiving for another minute.
  disconnectSessions(sessionIds: readonly string[]): void;
}
