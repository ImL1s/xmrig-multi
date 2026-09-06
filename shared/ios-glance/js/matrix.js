/**
 * iOS glance support matrix (#78). Do not claim every iPhone stays bright.
 */

export const SCHEMA_VERSION = 1;

/**
 * @param {object} [input]
 * @param {number} [input.iosMajor]
 * @param {boolean} [input.isIpad]
 * @param {boolean} [input.standByEligibleDevice] charging + landscape capable flag from OS
 */
export function glanceSupportMatrix(input = {}) {
  const iosMajor = Number(input.iosMajor) > 0 ? Number(input.iosMajor) : 16;
  const isIpad = input.isIpad === true;

  const widgetKit = {
    state: iosMajor >= 14 ? 'available' : 'unsupported',
    families: ['systemSmall', 'systemMedium', 'accessoryRectangular', 'accessoryInline', 'accessoryCircular'],
    reasons: [
      'WidgetKit timeline updates — not a continuous CPU miner',
      'Accessory families need Lock Screen / StandBy capable devices'
    ]
  };

  const standBy = {
    state: !isIpad && iosMajor >= 17 ? 'available' : 'unsupported',
    reasons: [
      isIpad
        ? 'StandBy is iPhone-oriented — do not claim iPad StandBy mining glance'
        : iosMajor >= 17
          ? 'StandBy (iOS 17+) when charging + landscape; not every iPhone stays bright'
          : 'StandBy requires iOS 17+',
      'Official StandBy clock alone does not enable miner glance'
    ]
  };

  const liveActivity = {
    state: iosMajor >= 16 ? 'available' : 'unsupported',
    reasons: [
      'ActivityKit presents snapshots; Live Activity is not a network poller or mining host',
      'Remote push updates require explicit user consent and protected credentials'
    ]
  };

  return {
    schemaVersion: SCHEMA_VERSION,
    iosMajor,
    widgetKit,
    standBy,
    liveActivity,
    claims: {
      alwaysOnDisplay: false,
      continuousHashrate: false,
      backgroundMiningViaWidget: false
    }
  };
}
