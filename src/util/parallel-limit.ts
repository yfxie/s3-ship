export async function parallelLimit<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<Array<{ ok: true; value: R; item: T } | { ok: false; error: unknown; item: T }>> {
  const results: Array<{ ok: true; value: R; item: T } | { ok: false; error: unknown; item: T }> =
    new Array(items.length)
  let cursor = 0

  async function next(): Promise<void> {
    while (true) {
      const index = cursor++
      if (index >= items.length) return
      const item = items[index]!
      try {
        const value = await worker(item, index)
        results[index] = { ok: true, value, item }
      } catch (error) {
        results[index] = { ok: false, error, item }
      }
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, () => next())
  await Promise.all(workers)
  return results
}
