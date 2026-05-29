import { describe, expect, test } from 'bun:test'
import type { DeleteObjectsCommand } from '@aws-sdk/client-s3'
import type { S3Like } from '../../src/aws/s3-client.js'
import { deleteStale } from '../../src/stages/delete-stale.js'

function makeClient(): { client: S3Like; calls: DeleteObjectsCommand[] } {
  const calls: DeleteObjectsCommand[] = []
  return {
    client: {
      async send(command: unknown) {
        calls.push(command as DeleteObjectsCommand)
        return { Deleted: [] }
      },
    },
    calls,
  }
}

describe('deleteStale', () => {
  test('no-op when keys array is empty', async () => {
    const { client, calls } = makeClient()
    await deleteStale({
      client,
      bucket: 'b',
      keys: [],
      retry: { attempts: 1, baseMs: 1 },
    })
    expect(calls).toHaveLength(0)
  })

  test('sends single DeleteObjects command for under 1000 keys', async () => {
    const { client, calls } = makeClient()
    await deleteStale({
      client,
      bucket: 'b',
      keys: ['a', 'b', 'c'],
      retry: { attempts: 1, baseMs: 1 },
    })
    expect(calls).toHaveLength(1)
    expect(calls[0]?.input.Bucket).toBe('b')
    expect(calls[0]?.input.Delete?.Objects).toEqual([{ Key: 'a' }, { Key: 'b' }, { Key: 'c' }])
  })

  test('batches into chunks of 1000', async () => {
    const { client, calls } = makeClient()
    const keys = Array.from({ length: 2500 }, (_, i) => `k${i}`)
    await deleteStale({
      client,
      bucket: 'b',
      keys,
      retry: { attempts: 1, baseMs: 1 },
    })
    expect(calls).toHaveLength(3)
    expect(calls[0]?.input.Delete?.Objects).toHaveLength(1000)
    expect(calls[1]?.input.Delete?.Objects).toHaveLength(1000)
    expect(calls[2]?.input.Delete?.Objects).toHaveLength(500)
  })

  test('retries failing batch', async () => {
    let count = 0
    const client: S3Like = {
      async send() {
        count++
        if (count === 1) throw new Error('blip')
        return { Deleted: [] }
      },
    }
    await deleteStale({
      client,
      bucket: 'b',
      keys: ['a'],
      retry: { attempts: 3, baseMs: 1 },
    })
    expect(count).toBe(2)
  })
})
