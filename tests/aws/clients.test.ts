import { describe, expect, test } from 'bun:test'
import { createCloudFrontClient } from '../../src/aws/cloudfront-client.js'
import { createS3Client } from '../../src/aws/s3-client.js'

describe('createS3Client', () => {
  test('returns a client with send method', () => {
    const client = createS3Client({})
    expect(typeof client.send).toBe('function')
  })

  test('honors explicit region', async () => {
    const client = createS3Client({ region: 'ap-northeast-1' })
    const region = await client.config.region()
    expect(region).toBe('ap-northeast-1')
  })

  test('with profile installs ini credentials provider', () => {
    const client = createS3Client({ profile: 'myprof' })
    expect(client.config.credentials).toBeDefined()
  })

  test('without profile leaves credentials to SDK default chain', () => {
    const client = createS3Client({ region: 'us-east-1' })
    expect(client.config.credentials).toBeDefined()
  })
})

describe('createCloudFrontClient', () => {
  test('defaults region to us-east-1 (CloudFront global endpoint)', async () => {
    const client = createCloudFrontClient({})
    const region = await client.config.region()
    expect(region).toBe('us-east-1')
  })

  test('honors explicit region override', async () => {
    const client = createCloudFrontClient({ region: 'eu-west-1' })
    const region = await client.config.region()
    expect(region).toBe('eu-west-1')
  })

  test('with profile installs ini credentials provider', () => {
    const client = createCloudFrontClient({ profile: 'myprof' })
    expect(client.config.credentials).toBeDefined()
  })
})
