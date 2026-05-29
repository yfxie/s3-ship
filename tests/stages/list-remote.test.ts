import { describe, expect, test } from 'bun:test'
import type { ListObjectsV2Command } from '@aws-sdk/client-s3'
import type { S3Like } from '../../src/aws/s3-client.js'
import { listRemoteFiles } from '../../src/stages/list-remote.js'

interface SendCall {
  command: ListObjectsV2Command
}

function makeFakeClient(
  pages: Array<{
    Contents?: Array<{ Key: string; Size: number; ETag: string }>
    NextContinuationToken?: string
  }>,
): { client: S3Like; calls: SendCall[] } {
  const calls: SendCall[] = []
  let index = 0
  const client: S3Like = {
    send(command: unknown) {
      calls.push({ command: command as ListObjectsV2Command })
      const page = pages[index++]
      return Promise.resolve(page ?? { Contents: [] })
    },
  }
  return { client, calls }
}

describe('listRemoteFiles', () => {
  test('returns empty array when bucket is empty', async () => {
    const { client } = makeFakeClient([{ Contents: [] }])
    const result = await listRemoteFiles({ client, bucket: 'b', target: '' })
    expect(result).toEqual([])
  })

  test('calls ListObjectsV2 with bucket and prefix', async () => {
    const { client, calls } = makeFakeClient([{ Contents: [] }])
    await listRemoteFiles({ client, bucket: 'my-bucket', target: 'docs/v2' })
    expect(calls).toHaveLength(1)
    const input = (calls[0]?.command as ListObjectsV2Command).input
    expect(input.Bucket).toBe('my-bucket')
    expect(input.Prefix).toBe('docs/v2/')
  })

  test('empty target results in no Prefix or empty Prefix', async () => {
    const { client, calls } = makeFakeClient([{ Contents: [] }])
    await listRemoteFiles({ client, bucket: 'b', target: '' })
    const input = (calls[0]?.command as ListObjectsV2Command).input
    expect(input.Prefix === undefined || input.Prefix === '').toBe(true)
  })

  test('returns parsed entries with key, size, etag', async () => {
    const { client } = makeFakeClient([
      {
        Contents: [
          { Key: 'a.html', Size: 10, ETag: '"abc"' },
          { Key: 'b.css', Size: 20, ETag: '"def"' },
        ],
      },
    ])
    const result = await listRemoteFiles({ client, bucket: 'b', target: '' })
    expect(result).toEqual([
      { key: 'a.html', size: 10, etag: 'abc' },
      { key: 'b.css', size: 20, etag: 'def' },
    ])
  })

  test('strips wrapping double-quotes from ETag', async () => {
    const { client } = makeFakeClient([{ Contents: [{ Key: 'a', Size: 1, ETag: '"hashvalue"' }] }])
    const result = await listRemoteFiles({ client, bucket: 'b', target: '' })
    expect(result[0]?.etag).toBe('hashvalue')
  })

  test('paginates using NextContinuationToken', async () => {
    const { client, calls } = makeFakeClient([
      {
        Contents: [{ Key: 'a', Size: 1, ETag: '"a"' }],
        NextContinuationToken: 'page2',
      },
      { Contents: [{ Key: 'b', Size: 1, ETag: '"b"' }] },
    ])
    const result = await listRemoteFiles({ client, bucket: 'b', target: '' })
    expect(result).toHaveLength(2)
    expect(calls).toHaveLength(2)
    expect((calls[1]?.command as ListObjectsV2Command).input.ContinuationToken).toBe('page2')
  })

  test('normalizes target with trailing slash', async () => {
    const { client, calls } = makeFakeClient([{ Contents: [] }])
    await listRemoteFiles({ client, bucket: 'b', target: 'docs/' })
    expect((calls[0]?.command as ListObjectsV2Command).input.Prefix).toBe('docs/')
  })

  test('handles missing Contents in response', async () => {
    const { client } = makeFakeClient([{}])
    const result = await listRemoteFiles({ client, bucket: 'b', target: '' })
    expect(result).toEqual([])
  })
})
