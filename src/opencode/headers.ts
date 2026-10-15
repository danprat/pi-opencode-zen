/**
 * OpenCode desktop identity, fingerprint headers, and session ID generation.
 */

import { CHARS, USER_AGENT_V1, USER_AGENT_V2 } from './types.ts';

export function createOpencodeId(descending: boolean, timestamp = Date.now()): string {
  // Pinned to counter 1 like the upstream OpenCode CLI; non-small counters trip 403 FreeTierError
  const current = BigInt(timestamp) * 0x1000n + 1n;
  const value = descending ? ~current & ((1n << 48n) - 1n) : current & ((1n << 48n) - 1n);
  let time = '';
  for (let i = 0; i < 6; i++) {
    const byte = Number((value >> BigInt(40 - 8 * i)) & 0xffn);
    time += byte.toString(16).padStart(2, '0');
  }
  const randomBytes = crypto.getRandomValues(new Uint8Array(14));
  let randomStr = '';
  for (let i = 0; i < 14; i++) {
    randomStr += CHARS[(randomBytes[i] ?? 0) % 62] ?? '0';
  }
  return time + randomStr;
}

const activeSessionId = 'ses_' + createOpencodeId(true);
const sessionMap = new Map<string, string>();

export function getSessionId(callerSessionId?: string): string {
  if (!callerSessionId) {
    return activeSessionId;
  }
  let existing = sessionMap.get(callerSessionId);
  if (!existing) {
    if (sessionMap.size >= 500) {
      const firstKey = sessionMap.keys().next().value;
      if (firstKey) sessionMap.delete(firstKey);
    }
    existing = 'ses_' + createOpencodeId(true);
    sessionMap.set(callerSessionId, existing);
  }
  return existing;
}

export function opencodeHeaders(sessionId?: string, isFree = true): Record<string, string> {
  const session = getSessionId(sessionId);
  if (isFree) {
    return {
      'User-Agent': USER_AGENT_V2,
      'x-opencode-client': 'cli',
      'x-opencode-session': session,
      'x-opencode-session-id': session,
      'x-session-affinity': session,
      'x-session-id': session,
      'x-opencode-project': 'global',
      Accept: 'text/event-stream',
    };
  }
  return {
    'User-Agent': USER_AGENT_V1,
    'x-opencode-client': 'desktop',
    'x-opencode-session': session,
    'x-opencode-session-id': session,
    'x-session-affinity': session,
    'x-session-id': session,
    'x-opencode-request': 'msg_' + createOpencodeId(false),
    'x-opencode-project': 'global',
    Accept: 'text/event-stream',
  };
}
