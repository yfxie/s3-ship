import { describe, expect, test } from 'bun:test'
import type { CreateInvalidationCommand } from '@aws-sdk/client-cloudfront'
import type { CloudFrontLike } from '../../src/aws/cloudfront-client.js'
import { invalidateCloudFront } from '../../src/stages/invalidate.js'

function makeClient(): {
  client: CloudFrontLike
  calls: CreateInvalidationCommand[]
} {
  const calls: CreateInvalidationCommand[] = []
  return {
    client: {
      async send(command: unknown) {
        calls.push(command as CreateInvalidationCommand)
        return { Invalidation: { Id: 'INV1' } }
      },
    },
    calls,
  }
}

describe('invalidateCloudFront', () => {
  test('sends CreateInvalidationCommand with distributionId and paths', async () => {
    const { client, calls } = makeClient()
    await invalidateCloudFront({
      client,
      distributionId: 'E123',
      paths: ['/*'],
    })
    expect(calls).toHaveLength(1)
    expect(calls[0]?.input.DistributionId).toBe('E123')
    expect(calls[0]?.input.InvalidationBatch?.Paths?.Quantity).toBe(1)
    expect(calls[0]?.input.InvalidationBatch?.Paths?.Items).toEqual(['/*'])
  })

  test('returns the invalidation id', async () => {
    const { client } = makeClient()
    const id = await invalidateCloudFront({
      client,
      distributionId: 'E1',
      paths: ['/*'],
    })
    expect(id).toBe('INV1')
  })

  test('supports multiple paths', async () => {
    const { client, calls } = makeClient()
    await invalidateCloudFront({
      client,
      distributionId: 'E1',
      paths: ['/index.html', '/blog/*'],
    })
    expect(calls[0]?.input.InvalidationBatch?.Paths?.Quantity).toBe(2)
    expect(calls[0]?.input.InvalidationBatch?.Paths?.Items).toEqual(['/index.html', '/blog/*'])
  })

  test('uses unique CallerReference per call', async () => {
    const { client, calls } = makeClient()
    await invalidateCloudFront({ client, distributionId: 'E1', paths: ['/*'] })
    await invalidateCloudFront({ client, distributionId: 'E1', paths: ['/*'] })
    const a = calls[0]?.input.InvalidationBatch?.CallerReference
    const b = calls[1]?.input.InvalidationBatch?.CallerReference
    expect(a).toBeDefined()
    expect(b).toBeDefined()
    expect(a).not.toBe(b)
  })
})
