import { createVisibleReadController } from '../visibleReadController.js';

export const LIVE_READ_INTERVALS = Object.freeze({ arbitration: 30_000, match: 5000, tournament: 10_000 });

/** Read-only polling; no commands, cached bodies or independent retry timers. */
export function createLiveReadLoop({ intervalMs = 0, initial = true, setTimer = setInterval,
  clearTimer = clearInterval, ...options }) {
  const controller = createVisibleReadController({ retryMs: intervalMs || 5000, ...options });
  let started = false, timer;
  return {
    start() {
      if (started) return; started = true;
      if (initial) void controller.run();
      if (intervalMs) timer = setTimer(() => void controller.run(), intervalMs);
    },
    load: ({ quiet = false } = {}) => controller.run({ manual: !quiet }),
    cancel: () => controller.cancel(),
    visibilityChanged() {
      if (!options.visible()) controller.cancel();
      else if (initial) void controller.run({ manual: true });
    },
    stop() { started = false; clearTimer(timer); controller.dispose(); },
  };
}
