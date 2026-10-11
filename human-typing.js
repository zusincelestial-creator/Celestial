"use strict";

/**
 * ECLIPSE Human Typing
 * --------------------
 * Owns only the Messenger typing-indicator lifecycle. It deliberately has
 * no text-generation or delay-calculation logic.
 *
 * Besides the low-level start/stop/withTyping helpers, this module also
 * exposes `simulateTypingIndicator` (one "Typing... -> Sent!" cycle) and
 * `createTypingLoop` (repeating cycles with a random gap, stoppable).
 */

// Some FCA builds return a stop function from sendTypingIndicator().
// Keep it per thread so stopTyping() can really end the indicator.
const activeStops = new Map();

function startTyping(api, threadID) {
  if (!api || !threadID) return false;
  const key = String(threadID);
  try {
    if (typeof api.sendTypingIndicator === "function") {
      const stop = api.sendTypingIndicator(threadID, (error) => {
        if (error) {
          console.warn("[HUMAN-TYPING] Typing indicator failed:", error?.message || error);
        }
      });
      if (typeof stop === "function") activeStops.set(key, stop);
      return true;
    }
    if (typeof api.sendTyping === "function") {
      api.sendTyping(threadID, true);
      return true;
    }
  } catch (error) {
    console.warn("[HUMAN-TYPING] Unable to start typing indicator:", error?.message || error);
  }
  return false;
}

function stopTyping(api, threadID) {
  if (!api || !threadID) return false;
  const key = String(threadID);
  try {
    const stop = activeStops.get(key);
    if (typeof stop === "function") {
      activeStops.delete(key);
      stop();
      return true;
    }
    if (typeof api.sendTyping === "function") {
      api.sendTyping(threadID, false);
      return true;
    }
  } catch (error) {
    activeStops.delete(key);
    console.warn("[HUMAN-TYPING] Unable to stop typing indicator:", error?.message || error);
  }
  return false;
}

function withTyping(api, threadID, durationMs, send) {
  const duration = Math.max(0, Number(durationMs) || 0);
  startTyping(api, threadID);

  return new Promise((resolve, reject) => {
    setTimeout(async () => {
      try {
        const result = await send();
        stopTyping(api, threadID);
        resolve(result);
      } catch (error) {
        stopTyping(api, threadID);
        reject(error);
      }
    }, duration);
  });
}

function randomBetween(min, max) {
  const low = Math.min(min, max);
  const high = Math.max(min, max);
  return low + Math.random() * (high - low);
}

function sleep(ms, signal) {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const timer = setTimeout(done, Math.max(0, ms));
    function done() {
      signal?.removeEventListener?.("abort", done);
      clearTimeout(timer);
      resolve();
    }
    signal?.addEventListener?.("abort", done, { once: true });
  });
}

/**
 * One typing cycle: show "typing" for a random 1-3s (configurable), then run
 * the optional `send` callback and stop the indicator.
 *
 * Replaces the console `print('Typing...') / print('Sent!')` demo with the
 * real Messenger indicator.
 *
 * @returns {Promise<{typingMs: number, result: any}>}
 */
async function simulateTypingIndicator(api, threadID, options = {}) {
  const { minMs = 1000, maxMs = 3000, send = async () => true } = options;
  const typingMs = randomBetween(minMs, maxMs);
  const result = await withTyping(api, threadID, typingMs, send);
  return { typingMs, result };
}

/**
 * Repeats simulateTypingIndicator with a random pause between cycles.
 * Unlike `while True`, it never blocks the event loop and can be stopped:
 *
 *   const loop = createTypingLoop(api, threadID, { send: () => ... });
 *   loop.start();
 *   loop.stop();
 */
function createTypingLoop(api, threadID, options = {}) {
  const { minGapMs = 2000, maxGapMs = 5000, onError = (e) => console.warn("[HUMAN-TYPING] loop error:", e?.message || e) } = options;
  let controller = null;

  async function run(signal) {
    while (!signal.aborted) {
      try {
        await simulateTypingIndicator(api, threadID, options);
      } catch (error) {
        onError(error);
      }
      await sleep(randomBetween(minGapMs, maxGapMs), signal);
    }
    stopTyping(api, threadID);
  }

  return {
    start() {
      if (controller && !controller.signal.aborted) return false;
      controller = new AbortController();
      run(controller.signal);
      return true;
    },
    stop() {
      if (!controller || controller.signal.aborted) return false;
      controller.abort();
      stopTyping(api, threadID);
      return true;
    },
    get running() {
      return Boolean(controller && !controller.signal.aborted);
    },
  };
}

module.exports = {
  startTyping,
  stopTyping,
  withTyping,
  simulateTypingIndicator,
  createTypingLoop,
};
