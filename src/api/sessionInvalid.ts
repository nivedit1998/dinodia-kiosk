// Centralized session invalidation trigger for platformFetch
let handler: (() => Promise<void> | void) | null = null;
let fired = false;

export function setOnSessionInvalid(fn: () => Promise<void> | void) {
  handler = fn;
}

export async function triggerSessionInvalidOnce() {
  if (fired) return;
  fired = true;
  if (handler) {
    try {
      await handler();
    } catch {
      // swallow
    }
  }
}

export function resetSessionInvalidGuard() {
  fired = false;
}
