export interface RetryOptions {
  attempts: number
  baseMs: number
}

export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions): Promise<T> {
  let lastErr: unknown
  for (let i = 0; i < options.attempts; i++) {
    try {
      return await fn()
    } catch (err) {
      lastErr = err
      if (i < options.attempts - 1) {
        await new Promise((resolve) => setTimeout(resolve, options.baseMs * 4 ** i))
      }
    }
  }
  throw lastErr
}
