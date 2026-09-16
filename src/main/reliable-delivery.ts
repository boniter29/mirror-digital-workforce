export class HttpDeliveryError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "HttpDeliveryError";
  }
}

export interface RetryDeliveryOptions {
  attempts?: number;
  delaysMs?: number[];
  sleep?: (delayMs: number) => Promise<void>;
  onRetry?: (error: unknown, nextAttempt: number) => void;
}

export async function retryDelivery<T>(
  operation: (attempt: number) => Promise<T>,
  options: RetryDeliveryOptions = {},
): Promise<T> {
  const attempts = Math.max(1, Math.round(options.attempts ?? 3));
  const delaysMs = options.delaysMs ?? [350, 1_000];
  const sleep = options.sleep ?? ((delayMs) => new Promise<void>((resolve) => setTimeout(resolve, delayMs)));
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation(attempt);
    } catch (error) {
      lastError = error;
      if (attempt >= attempts || !isRetryableDeliveryError(error)) throw error;
      options.onRetry?.(error, attempt + 1);
      await sleep(delaysMs[Math.min(attempt - 1, delaysMs.length - 1)] ?? 1_000);
    }
  }

  throw lastError;
}

export function isRetryableDeliveryError(error: unknown): boolean {
  if (error instanceof HttpDeliveryError) return error.status === 408 || error.status === 429 || error.status >= 500;
  if (!(error instanceof Error)) return false;
  const code = (error as Error & { code?: string }).code ?? "";
  return /ECONNRESET|ECONNREFUSED|EAI_AGAIN|ENETUNREACH|EHOSTUNREACH|UND_ERR_CONNECT_TIMEOUT/i.test(code)
    || /fetch failed|network connection|socket hang up/i.test(error.message);
}

/**
 * Serializes work within one DingTalk conversation while keeping different
 * conversations independent. This preserves reply order and avoids concurrent
 * access-token/session-webhook sends for the same group.
 */
export class KeyedSerialQueue {
  private readonly tails = new Map<string, Promise<unknown>>();

  run<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(operation);
    this.tails.set(key, current);
    void current.finally(() => {
      if (this.tails.get(key) === current) this.tails.delete(key);
    }).catch(() => undefined);
    return current;
  }

  clear(): void {
    this.tails.clear();
  }
}
