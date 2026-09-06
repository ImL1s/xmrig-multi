/**
 * Read-only LAN board presenter for old devices (#80).
 * Never loads RandomX — display + pairing helpers only.
 */

export {
  createPairingChallenge,
  completePairing,
  revokeClient,
  isClientAuthorized
} from '../../shared/lan-dashboard/js/pairing.js';
export { authorizeBoardCommand, presentStopDelivery } from '../../shared/lan-dashboard/js/auth.js';
export { aggregateBoard } from '../../shared/lan-dashboard/js/aggregate.js';
export { presentDeviceCard } from '../../shared/lan-dashboard/js/board.js';
