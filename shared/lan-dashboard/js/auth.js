/**
 * LAN board auth / command gates (#80).
 */

import { isClientAuthorized } from './pairing.js';
import { receiveCommand } from '../../companion-sync/js/protocol.js';

/**
 * Read-only tokens must never Start.
 */
export function authorizeBoardCommand(registry, clientId, command, ctx = {}) {
  const needRole = command?.type === 'stop' || command?.type === 'start' ? 'control' : 'readonly';
  const auth = isClientAuthorized(registry, clientId, needRole);
  if (!auth.ok) {
    return { ack: 'rejected', reason: auth.reason, apply: false };
  }
  if (needRole === 'readonly' && (command?.type === 'start' || command?.type === 'stop')) {
    return { ack: 'rejected', reason: 'Read-only token cannot control', apply: false };
  }
  if (command?.type === 'start' && auth.client?.role !== 'control') {
    return { ack: 'rejected', reason: 'Read-only token cannot Start', apply: false };
  }
  return receiveCommand(command, {
    ...ctx,
    paired: true,
    authenticated: true,
    userStopLatched: ctx.userStopLatched
  });
}

/**
 * Present stop delivery honestly.
 */
export function presentStopDelivery(ack) {
  switch (ack) {
    case 'accepted':
      return { label: 'Accepted by host', pretendStopped: false };
    case 'completed':
      return { label: 'Completed', pretendStopped: true };
    case 'undelivered':
      return { label: 'Undelivered — not stopped', pretendStopped: false };
    case 'expired':
      return { label: 'Expired before delivery', pretendStopped: false };
    default:
      return { label: 'Rejected', pretendStopped: false };
  }
}
