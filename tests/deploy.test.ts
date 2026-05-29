import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { type CloudFrontClient, CreateInvalidationCommand } from '@aws-sdk/client-cloudfront'
import {
  DeleteObjectsCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  type S3Client,
} from '@aws-sdk/client-s3'
import { deploy } from '../src/deploy.js'

let dir: string
let listResponses: Array<{
  Contents?: Array<{ Key: string; Size: number; ETag: string }>
  NextContinuationToken?: string
}>

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 's3ship-deploy-'))
  listResponses = [{ Contents: [] }]
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

function makeFactories() {
  const s3Calls: unknown[] = []
  const cfCalls: unknown[] = []
  let listIdx = 0
  const s3 = {
    async send(cmd: unknown) {
      s3Calls.push(cmd)
      if (cmd instanceof ListObjectsV2Command) {
        return listResponses[listIdx++] ?? { Contents: [] }
      }
      return {}
    },
  } as unknown as S3Client
  const cf = {
    async send(cmd: unknown) {
      cfCalls.push(cmd)
      return { Invalidation: { Id: 'INV1' } }
    },
  } as unknown as CloudFrontClient
  return {
    s3Calls,
    cfCalls,
    s3ClientFactory: () => s3,
    cfClientFactory: () => cf,
  }
}

describe('deploy', () => {
  test('runs full pipeline and returns plan + report', async () => {
    await writeFile(join(dir, 's3-ship.config.json'), JSON.stringify({ bucket: 'b' }))
    const src = join(dir, 'dist')
    await mkdir(src, { recursive: true })
    await writeFile(join(src, 'index.html'), '<html></html>')

    const factories = makeFactories()
    const result = await deploy({
      cwd: dir,
      envVars: {},
      ...factories,
    })
    expect(result.plan.toUpload).toHaveLength(1)
    expect(result.report?.uploaded).toBe(1)
    expect(result.dryRun).toBe(false)
  })

  test('dry-run skips execute, no Put calls', async () => {
    await writeFile(join(dir, 's3-ship.config.json'), JSON.stringify({ bucket: 'b' }))
    const src = join(dir, 'dist')
    await mkdir(src, { recursive: true })
    await writeFile(join(src, 'index.html'), '<html></html>')

    const factories = makeFactories()
    const result = await deploy({
      cwd: dir,
      envVars: {},
      dryRun: true,
      ...factories,
    })
    expect(result.dryRun).toBe(true)
    expect(result.report).toBeUndefined()
    const puts = factories.s3Calls.filter((c) => c instanceof PutObjectCommand)
    expect(puts).toHaveLength(0)
    const lists = factories.s3Calls.filter((c) => c instanceof ListObjectsV2Command)
    expect(lists.length).toBeGreaterThan(0)
  })

  test('respects --env override', async () => {
    await writeFile(
      join(dir, 's3-ship.config.json'),
      JSON.stringify({
        bucket: 'default',
        environments: { prod: { bucket: 'prod-bucket' } },
      }),
    )
    const src = join(dir, 'dist')
    await mkdir(src, { recursive: true })

    const factories = makeFactories()
    const result = await deploy({
      cwd: dir,
      envVars: {},
      env: 'prod',
      ...factories,
    })
    expect(result.resolvedConfig.bucket).toBe('prod-bucket')
    expect(result.resolvedConfig.environment).toBe('prod')
  })

  test('throws on validation error with helpful path', async () => {
    await writeFile(join(dir, 's3-ship.config.json'), JSON.stringify({ source: 123 }))
    const factories = makeFactories()
    await expect(deploy({ cwd: dir, envVars: {}, ...factories })).rejects.toThrow(/config/i)
  })

  test('uses CLI source override over config', async () => {
    await writeFile(
      join(dir, 's3-ship.config.json'),
      JSON.stringify({ bucket: 'b', source: 'dist' }),
    )
    const build = join(dir, 'build')
    await mkdir(build, { recursive: true })
    await writeFile(join(build, 'page.html'), 'x')

    const factories = makeFactories()
    const result = await deploy({
      cwd: dir,
      envVars: {},
      source: 'build',
      ...factories,
    })
    expect(result.plan.toUpload).toHaveLength(1)
    expect(result.plan.toUpload[0]?.key).toBe('page.html')
  })

  test('triggers cloudfront invalidation when configured', async () => {
    await writeFile(
      join(dir, 's3-ship.config.json'),
      JSON.stringify({
        bucket: 'b',
        cloudfront: { distributionId: 'E1' },
      }),
    )
    const src = join(dir, 'dist')
    await mkdir(src, { recursive: true })
    await writeFile(join(src, 'a.html'), 'x')

    const factories = makeFactories()
    const result = await deploy({ cwd: dir, envVars: {}, ...factories })
    const inv = factories.cfCalls.filter((c) => c instanceof CreateInvalidationCommand)
    expect(inv).toHaveLength(1)
    expect(result.report?.invalidationId).toBe('INV1')
  })

  test('skipInvalidate prevents cloudfront call', async () => {
    await writeFile(
      join(dir, 's3-ship.config.json'),
      JSON.stringify({
        bucket: 'b',
        cloudfront: { distributionId: 'E1' },
      }),
    )
    const src = join(dir, 'dist')
    await mkdir(src, { recursive: true })
    await writeFile(join(src, 'a.html'), 'x')

    const factories = makeFactories()
    await deploy({
      cwd: dir,
      envVars: {},
      skipInvalidate: true,
      ...factories,
    })
    expect(factories.cfCalls).toHaveLength(0)
  })

  test('sync-delete=true removes stale remote keys', async () => {
    await writeFile(join(dir, 's3-ship.config.json'), JSON.stringify({ bucket: 'b' }))
    const src = join(dir, 'dist')
    await mkdir(src, { recursive: true })
    await writeFile(join(src, 'a.html'), 'x')

    listResponses = [
      {
        Contents: [
          { Key: 'a.html', Size: 1, ETag: '"local"' },
          { Key: 'stale.html', Size: 1, ETag: '"old"' },
        ],
      },
    ]

    const factories = makeFactories()
    await deploy({ cwd: dir, envVars: {}, syncDelete: true, ...factories })
    const deletes = factories.s3Calls.filter((c) => c instanceof DeleteObjectsCommand)
    expect(deletes).toHaveLength(1)
    expect((deletes[0] as DeleteObjectsCommand).input.Delete?.Objects).toEqual([
      { Key: 'stale.html' },
    ])
  })

  test('applies cacheControl rules during upload', async () => {
    await writeFile(
      join(dir, 's3-ship.config.json'),
      JSON.stringify({
        bucket: 'b',
        cacheControl: [{ match: '*.html', cacheControl: 'no-cache' }],
      }),
    )
    const src = join(dir, 'dist')
    await mkdir(src, { recursive: true })
    await writeFile(join(src, 'page.html'), 'x')

    const factories = makeFactories()
    await deploy({ cwd: dir, envVars: {}, ...factories })
    const puts = factories.s3Calls.filter((c) => c instanceof PutObjectCommand)
    expect((puts[0] as PutObjectCommand).input.CacheControl).toBe('no-cache')
  })

  test('AWS_PROFILE env var reaches s3ClientFactory when no profile in config/CLI', async () => {
    await writeFile(join(dir, 's3-ship.config.json'), JSON.stringify({ bucket: 'b' }))
    const src = join(dir, 'dist')
    await mkdir(src, { recursive: true })

    let captured: { region?: string; profile?: string } | undefined
    const base = makeFactories()
    await deploy({
      cwd: dir,
      envVars: { AWS_PROFILE: 'env-profile', AWS_REGION: 'eu-west-2' },
      s3ClientFactory: (opts) => {
        captured = opts
        return (base.s3ClientFactory as () => unknown)() as never
      },
      cfClientFactory: base.cfClientFactory,
    })
    expect(captured?.profile).toBe('env-profile')
    expect(captured?.region).toBe('eu-west-2')
  })

  test('config profile/region beat AWS_* env vars at factory boundary', async () => {
    await writeFile(
      join(dir, 's3-ship.config.json'),
      JSON.stringify({ bucket: 'b', profile: 'cfg-profile', region: 'ap-northeast-1' }),
    )
    const src = join(dir, 'dist')
    await mkdir(src, { recursive: true })

    let captured: { region?: string; profile?: string } | undefined
    const base = makeFactories()
    await deploy({
      cwd: dir,
      envVars: { AWS_PROFILE: 'env-profile', AWS_REGION: 'eu-west-2' },
      s3ClientFactory: (opts) => {
        captured = opts
        return (base.s3ClientFactory as () => unknown)() as never
      },
      cfClientFactory: base.cfClientFactory,
    })
    expect(captured?.profile).toBe('cfg-profile')
    expect(captured?.region).toBe('ap-northeast-1')
  })

  test('CLI profile override beats both config and env var at factory boundary', async () => {
    await writeFile(
      join(dir, 's3-ship.config.json'),
      JSON.stringify({ bucket: 'b', profile: 'cfg-profile' }),
    )
    const src = join(dir, 'dist')
    await mkdir(src, { recursive: true })

    let captured: { profile?: string } | undefined
    const base = makeFactories()
    await deploy({
      cwd: dir,
      envVars: { AWS_PROFILE: 'env-profile' },
      profile: 'cli-profile',
      s3ClientFactory: (opts) => {
        captured = opts
        return (base.s3ClientFactory as () => unknown)() as never
      },
      cfClientFactory: base.cfClientFactory,
    })
    expect(captured?.profile).toBe('cli-profile')
  })

  test('cfClientFactory not constructed when cloudfront not configured', async () => {
    await writeFile(join(dir, 's3-ship.config.json'), JSON.stringify({ bucket: 'b' }))
    const src = join(dir, 'dist')
    await mkdir(src, { recursive: true })

    let cfCalled = false
    const base = makeFactories()
    await deploy({
      cwd: dir,
      envVars: {},
      s3ClientFactory: base.s3ClientFactory,
      cfClientFactory: () => {
        cfCalled = true
        return (base.cfClientFactory as () => unknown)() as never
      },
    })
    expect(cfCalled).toBe(false)
  })

  test('throws when environment not found', async () => {
    await writeFile(
      join(dir, 's3-ship.config.json'),
      JSON.stringify({ bucket: 'b', environments: { staging: { bucket: 's' } } }),
    )
    const factories = makeFactories()
    await expect(
      deploy({ cwd: dir, envVars: {}, env: 'production', ...factories }),
    ).rejects.toThrow(/production/)
  })
})
