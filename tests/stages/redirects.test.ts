import { describe, expect, test } from 'bun:test'
import type { PutObjectCommand } from '@aws-sdk/client-s3'
import type { S3Like } from '../../src/aws/s3-client.js'
import { putRedirect } from '../../src/stages/redirects.js'

function makeClient(behavior?: (n: number) => unknown): {
  client: S3Like
  calls: PutObjectCommand[]
} {
  const calls: PutObjectCommand[] = []
  let count = 0
  return {
    client: {
      async send(command: unknown) {
        calls.push(command as PutObjectCommand)
        count++
        return behavior ? behavior(count) : {}
      },
    },
    calls,
  }
}

describe('putRedirect', () => {
  test('puts empty body with WebsiteRedirectLocation header', async () => {
    const { client, calls } = makeClient()
    await putRedirect({
      client,
      bucket: 'b',
      redirect: { from: 'old', to: '/new', fullKey: 'old' },
      retry: { attempts: 1, baseMs: 1 },
    })
    const input = calls[0]?.input
    expect(input?.Bucket).toBe('b')
    expect(input?.Key).toBe('old')
    expect(input?.WebsiteRedirectLocation).toBe('/new')
    expect(input?.Body === '' || input?.Body === undefined).toBe(true)
  })

  test('uses fullKey (target-prefixed) as the S3 Key', async () => {
    const { client, calls } = makeClient()
    await putRedirect({
      client,
      bucket: 'b',
      redirect: { from: 'old', to: '/new', fullKey: 'docs/old' },
      retry: { attempts: 1, baseMs: 1 },
    })
    expect(calls[0]?.input.Key).toBe('docs/old')
  })

  test('retries on failure', async () => {
    const { client, calls } = makeClient((n) => {
      if (n === 1) throw new Error('blip')
      return {}
    })
    await putRedirect({
      client,
      bucket: 'b',
      redirect: { from: 'a', to: '/b', fullKey: 'a' },
      retry: { attempts: 3, baseMs: 1 },
    })
    expect(calls.length).toBe(2)
  })

  test('sets ChecksumAlgorithm to avoid SDK chunked-streaming warning', async () => {
    const { client, calls } = makeClient()
    await putRedirect({
      client,
      bucket: 'b',
      redirect: { from: 'a', to: '/b', fullKey: 'a' },
      retry: { attempts: 1, baseMs: 1 },
    })
    expect(calls[0]?.input.ChecksumAlgorithm).toBe('CRC32')
  })

  test('sets ContentType to text/html for browser compatibility', async () => {
    const { client, calls } = makeClient()
    await putRedirect({
      client,
      bucket: 'b',
      redirect: { from: 'old.html', to: '/new', fullKey: 'old.html' },
      retry: { attempts: 1, baseMs: 1 },
    })
    expect(calls[0]?.input.ContentType).toContain('text/html')
  })
})
