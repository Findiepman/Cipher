/**
 * Who is calling whom, held in memory.
 *
 * A call is signalling state and nothing else: the media runs browser to
 * browser over DTLS-SRTP and never touches this process. What the server has
 * to know is small and short-lived, so it lives in a Map rather than a table,
 * exactly like presence. That makes it per-process: correct on one box, wrong
 * the day there are two, and both break together (voice-plan.md, stage 1).
 *
 * Each side of a call is owned by one socket, not by a user. A user's other
 * tabs ring and hear the outcome, but they are not parties: closing one of
 * them must not end a call it was never in, and closing the one that is in the
 * call must, or the other person keeps talking to nobody and both stay "busy"
 * until the process restarts.
 */
import { conflict, notFound } from '../../lib/errors.js';

export type CallState = 'ringing' | 'connected';

/// Why a call ended. `hangup` covers a caller cancelling their own ring as well
/// as either side leaving a connected call; the client tells them apart by
/// what state it was in when the word arrived.
export type EndReason = 'hangup' | 'rejected' | 'no_answer' | 'disconnected';

export interface ActiveCall {
  id: string;
  conversationId: string;
  callerId: string;
  calleeId: string;
  state: CallState;
  /// The socket that placed the call.
  callerSocketId: string;
  /// The socket that answered it. Null while ringing: every tab of the callee
  /// rings, and none of them is a party until one of them picks up.
  calleeSocketId: string | null;
}

export interface CallRegistryOptions {
  /// How long a ring lasts before the registry gives up on it.
  ringTimeoutMs: number;
  /// Fired when a ring expires. The call has already been removed by the time
  /// this runs; the callback's job is to tell both sides.
  onExpire: (call: ActiveCall) => void;
}

export class CallRegistry {
  private readonly calls = new Map<string, ActiveCall>();
  private readonly ringTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(private readonly options: CallRegistryOptions) {}

  get(callId: string): ActiveCall | undefined {
    return this.calls.get(callId);
  }

  /// In any call at all, ringing or connected, as either side. One call per
  /// person: a second ring for somebody already talking is refused, not queued.
  isBusy(userId: string): boolean {
    for (const call of this.calls.values()) {
      if (call.callerId === userId || call.calleeId === userId) return true;
    }
    return false;
  }

  offer(input: {
    callId: string;
    conversationId: string;
    callerId: string;
    calleeId: string;
    socketId: string;
  }): ActiveCall {
    if (this.calls.has(input.callId)) {
      throw conflict('call_exists', 'That call id is already in use.');
    }
    // The caller is checked first. Their own other tab being mid-call is a
    // different situation from the callee's phone being engaged, and the
    // client says different things about the two.
    if (this.isBusy(input.callerId)) {
      throw conflict('in_call', 'You are already in a call.');
    }
    if (this.isBusy(input.calleeId)) {
      throw conflict('busy', 'They are in another call.');
    }

    const call: ActiveCall = {
      id: input.callId,
      conversationId: input.conversationId,
      callerId: input.callerId,
      calleeId: input.calleeId,
      state: 'ringing',
      callerSocketId: input.socketId,
      calleeSocketId: null,
    };
    this.calls.set(call.id, call);

    const timer = setTimeout(() => {
      this.ringTimers.delete(call.id);
      if (this.calls.delete(call.id)) this.options.onExpire(call);
    }, this.options.ringTimeoutMs);
    timer.unref?.();
    this.ringTimers.set(call.id, timer);

    return call;
  }

  /// Only the person being called can answer, and only while it is ringing.
  /// The same 404 for "no such call" and "not your call", for the same reason
  /// conversations do it: a 403 would confirm the id names a live call.
  answer(callId: string, userId: string, socketId: string): ActiveCall {
    const call = this.calls.get(callId);
    if (!call || call.calleeId !== userId) {
      throw notFound('call_not_found', 'No such call.');
    }
    if (call.state !== 'ringing') {
      throw conflict('call_not_ringing', 'That call has already been answered.');
    }

    call.state = 'connected';
    call.calleeSocketId = socketId;
    this.clearRingTimer(callId);
    return call;
  }

  /// A call the user is a party to, or a 404 that says nothing about whether
  /// the id exists.
  require(callId: string, userId: string): ActiveCall {
    const call = this.calls.get(callId);
    if (!call || (call.callerId !== userId && call.calleeId !== userId)) {
      throw notFound('call_not_found', 'No such call.');
    }
    return call;
  }

  /// Removes the call. Returns it so the caller can tell both sides, or
  /// undefined when it was already gone, which is normal: hangups race.
  end(callId: string): ActiveCall | undefined {
    const call = this.calls.get(callId);
    if (!call) return undefined;
    this.calls.delete(callId);
    this.clearRingTimer(callId);
    return call;
  }

  /// Every call this socket was a party to. Ended and returned, so a
  /// disconnect can be turned into a `call:ended` for whoever is left.
  endForSocket(socketId: string): ActiveCall[] {
    const ended: ActiveCall[] = [];
    for (const call of [...this.calls.values()]) {
      if (call.callerSocketId === socketId || call.calleeSocketId === socketId) {
        const removed = this.end(call.id);
        if (removed) ended.push(removed);
      }
    }
    return ended;
  }

  /// The other side of a call, for relaying.
  static otherParty(call: ActiveCall, userId: string): string {
    return call.callerId === userId ? call.calleeId : call.callerId;
  }

  close(): void {
    for (const timer of this.ringTimers.values()) clearTimeout(timer);
    this.ringTimers.clear();
    this.calls.clear();
  }

  private clearRingTimer(callId: string): void {
    const timer = this.ringTimers.get(callId);
    if (timer) clearTimeout(timer);
    this.ringTimers.delete(callId);
  }
}
