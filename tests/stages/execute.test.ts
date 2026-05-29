import { describe, expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { type CloudFrontClient, CreateInvalidationCommand } from '@aws-sdk/client-cloudfront'
import { DeleteObjectsCommand, PutObjectCommand, type S3Client } from '@aws-sdk/client-s3'
import type { UploadPlan } from '../../src/stages/diff.js'
import { executePlan } from '../../src/stages/execute.js'

interface CallLog {
  s3: unknown[]
  cf: unknown[]
}

function makeClients(behavior?: (cmd: unknown, n: number) => unknown): {
  s3: S3Client
  cf: CloudFrontClient
  calls: CallLog
} {
  const calls: CallLog = { s3: [], cf: [] }
  let count = 0
  const s3 = {
    async send(cmd: unknown) {
      calls.s3.push(cmd)
      count++
      return behavior ? behavior(cmd, count) : {}
    },
  } as unknown as S3Client
  const cf = {
    async send(cmd: unknown) {
      calls.cf.push(cmd)
      return { Invalidation: { Id: 'INV1' } }
    },
  } as unknown as CloudFrontClient
  return { s3, cf, calls }
}

function makePlan(overrides: Partial<UploadPlan> = {}): UploadPlan {
  return {
    bucket: 'b',
    target: '',
    toUpload: [],
    toUpdate: [],
    toSkip: [],
    toDelete: [],
    redirects: [],
    ...overrides,
  }
}

describe('executePlan', () => {
  test('empty plan -> no calls, zero counts', async () => {
    const { s3, cf, calls } = makeClients()
    const report = await executePlan({
      plan: makePlan(),
      s3Client: s3,
      cfClient: cf,
      cacheControlFor: () => undefined,
      retry: { attempts: 1, baseMs: 1 },
      concurrency: 2,
    })
    expect(calls.s3).toHaveLength(0)
    expect(calls.cf).toHaveLength(0)
    expect(report.uploaded).toBe(0)
    expect(report.failures).toEqual([])
  })

  test('uploads files in plan.toUpload', async () => {
    const dir = await mkdtemp(join(tmpdir(), 's3ship-exec-'))
    const path = join(dir, 'a.html')
    await writeFile(path, 'x')
    const { s3, cf, calls } = makeClients()
    const report = await executePlan({
      plan: makePlan({
        toUpload: [{ key: 'a.html', localPath: path, hash: 'h', size: 1 }],
      }),
      s3Client: s3,
      cfClient: cf,
      cacheControlFor: () => undefined,
      retry: { attempts: 1, baseMs: 1 },
      concurrency: 2,
    })
    const puts = calls.s3.filter((c) => c instanceof PutObjectCommand)
    expect(puts).toHaveLength(1)
    expect(report.uploaded).toBe(1)
    await rm(dir, { recursive: true, force: true })
  })

  test('uploads files in plan.toUpdate', async () => {
    const dir = await mkdtemp(join(tmpdir(), 's3ship-exec-'))
    const path = join(dir, 'a.html')
    await writeFile(path, 'x')
    const { s3, cf } = makeClients()
    const report = await executePlan({
      plan: makePlan({
        toUpdate: [{ key: 'a.html', localPath: path, hash: 'h', size: 1 }],
      }),
      s3Client: s3,
      cfClient: cf,
      cacheControlFor: () => undefined,
      retry: { attempts: 1, baseMs: 1 },
      concurrency: 2,
    })
    expect(report.updated).toBe(1)
    await rm(dir, { recursive: true, force: true })
  })

  test('counts toSkip without uploading', async () => {
    const { s3, cf, calls } = makeClients()
    const report = await executePlan({
      plan: makePlan({
        toSkip: [
          { key: 'a.html', localPath: '/abs/a', hash: 'h', size: 1 },
          { key: 'b.html', localPath: '/abs/b', hash: 'h', size: 1 },
        ],
      }),
      s3Client: s3,
      cfClient: cf,
      cacheControlFor: () => undefined,
      retry: { attempts: 1, baseMs: 1 },
      concurrency: 2,
    })
    expect(calls.s3).toHaveLength(0)
    expect(report.skipped).toBe(2)
  })

  test('puts redirects in plan', async () => {
    const { s3, cf } = makeClients()
    const report = await executePlan({
      plan: makePlan({
        redirects: [{ from: 'old', to: '/new', fullKey: 'old' }],
      }),
      s3Client: s3,
      cfClient: cf,
      cacheControlFor: () => undefined,
      retry: { attempts: 1, baseMs: 1 },
      concurrency: 2,
    })
    expect(report.redirected).toBe(1)
  })

  test('deletes stale keys', async () => {
    const { s3, cf, calls } = makeClients()
    const report = await executePlan({
      plan: makePlan({ toDelete: ['gone1', 'gone2'] }),
      s3Client: s3,
      cfClient: cf,
      cacheControlFor: () => undefined,
      retry: { attempts: 1, baseMs: 1 },
      concurrency: 2,
    })
    const deletes = calls.s3.filter((c) => c instanceof DeleteObjectsCommand)
    expect(deletes).toHaveLength(1)
    expect(report.deleted).toBe(2)
  })

  test('triggers cloudfront invalidation when configured', async () => {
    const { s3, cf, calls } = makeClients()
    const report = await executePlan({
      plan: makePlan({
        toUpload: [],
        cloudfront: { distributionId: 'E1', invalidationPaths: ['/*'] },
      }),
      s3Client: s3,
      cfClient: cf,
      cacheControlFor: () => undefined,
      retry: { attempts: 1, baseMs: 1 },
      concurrency: 2,
    })
    expect(calls.cf.filter((c) => c instanceof CreateInvalidationCommand)).toHaveLength(1)
    expect(report.invalidationId).toBe('INV1')
  })

  test('skips invalidation when --no-invalidate', async () => {
    const { s3, cf, calls } = makeClients()
    await executePlan({
      plan: makePlan({
        cloudfront: { distributionId: 'E1', invalidationPaths: ['/*'] },
      }),
      s3Client: s3,
      cfClient: cf,
      cacheControlFor: () => undefined,
      retry: { attempts: 1, baseMs: 1 },
      concurrency: 2,
      skipInvalidate: true,
    })
    expect(calls.cf).toHaveLength(0)
  })

  test('failed upload recorded in failures and does not stop other uploads', async () => {
    const dir = await mkdtemp(join(tmpdir(), 's3ship-exec-'))
    const a = join(dir, 'a.html')
    const b = join(dir, 'b.html')
    await writeFile(a, 'x')
    await writeFile(b, 'y')
    const { s3, cf } = makeClients((cmd, _n) => {
      if (cmd instanceof PutObjectCommand && cmd.input.Key === 'a.html') {
        throw new Error('fail-a')
      }
      return {}
    })
    const report = await executePlan({
      plan: makePlan({
        toUpload: [
          { key: 'a.html', localPath: a, hash: 'h', size: 1 },
          { key: 'b.html', localPath: b, hash: 'h', size: 1 },
        ],
      }),
      s3Client: s3,
      cfClient: cf,
      cacheControlFor: () => undefined,
      retry: { attempts: 1, baseMs: 1 },
      concurrency: 2,
    })
    expect(report.uploaded).toBe(1)
    expect(report.failures).toHaveLength(1)
    expect(report.failures[0]?.key).toBe('a.html')
    await rm(dir, { recursive: true, force: true })
  })

  test('skips delete when toDelete is empty', async () => {
    const { s3, cf, calls } = makeClients()
    await executePlan({
      plan: makePlan(),
      s3Client: s3,
      cfClient: cf,
      cacheControlFor: () => undefined,
      retry: { attempts: 1, baseMs: 1 },
      concurrency: 2,
    })
    const deletes = calls.s3.filter((c) => c instanceof DeleteObjectsCommand)
    expect(deletes).toHaveLength(0)
  })

  test('multiple concurrent upload failures all recorded', async () => {
    const dir = await mkdtemp(join(tmpdir(), 's3ship-exec-'))
    const keys = ['a', 'b', 'c', 'd', 'e']
    const files = await Promise.all(
      keys.map(async (k) => {
        const p = join(dir, k)
        await writeFile(p, 'x')
        return { key: k, localPath: p, hash: 'h', size: 1 }
      }),
    )
    const failKeys = new Set(['a', 'c', 'e'])
    const { s3, cf } = makeClients((cmd) => {
      if (cmd instanceof PutObjectCommand && failKeys.has(cmd.input.Key ?? '')) {
        throw new Error(`fail-${cmd.input.Key}`)
      }
      return {}
    })
    const report = await executePlan({
      plan: makePlan({ toUpload: files }),
      s3Client: s3,
      cfClient: cf,
      cacheControlFor: () => undefined,
      retry: { attempts: 1, baseMs: 1 },
      concurrency: 5,
    })
    expect(report.uploaded).toBe(2)
    expect(report.failures).toHaveLength(3)
    expect(report.failures.map((f) => f.key).sort()).toEqual(['a', 'c', 'e'])
    await rm(dir, { recursive: true, force: true })
  })

  test('redirect failure recorded with redirect fullKey', async () => {
    const { s3, cf } = makeClients((cmd) => {
      if (cmd instanceof PutObjectCommand) throw new Error('redirect-fail')
      return {}
    })
    const report = await executePlan({
      plan: makePlan({ redirects: [{ from: 'old', to: '/new', fullKey: 'docs/old' }] }),
      s3Client: s3,
      cfClient: cf,
      cacheControlFor: () => undefined,
      retry: { attempts: 1, baseMs: 1 },
      concurrency: 2,
    })
    expect(report.redirected).toBe(0)
    expect(report.failures).toHaveLength(1)
    expect(report.failures[0]?.key).toBe('docs/old')
  })

  test('delete batch failure recorded as <delete-batch>', async () => {
    const { s3, cf } = makeClients((cmd) => {
      if (cmd instanceof DeleteObjectsCommand) throw new Error('delete-fail')
      return {}
    })
    const report = await executePlan({
      plan: makePlan({ toDelete: ['a', 'b', 'c'] }),
      s3Client: s3,
      cfClient: cf,
      cacheControlFor: () => undefined,
      retry: { attempts: 1, baseMs: 1 },
      concurrency: 2,
    })
    expect(report.deleted).toBe(0)
    expect(report.failures).toHaveLength(1)
    expect(report.failures[0]?.key).toBe('<delete-batch>')
  })

  test('cloudfront invalidation failure recorded as <cloudfront-invalidation>', async () => {
    const { s3 } = makeClients()
    const cf = {
      async send() {
        throw new Error('cf-fail')
      },
    } as unknown as CloudFrontClient
    const report = await executePlan({
      plan: makePlan({
        cloudfront: { distributionId: 'E1', invalidationPaths: ['/*'] },
      }),
      s3Client: s3,
      cfClient: cf,
      cacheControlFor: () => undefined,
      retry: { attempts: 1, baseMs: 1 },
      concurrency: 2,
    })
    expect(report.invalidationId).toBeUndefined()
    expect(report.failures).toHaveLength(1)
    expect(report.failures[0]?.key).toBe('<cloudfront-invalidation>')
  })

  test('respects concurrency limit on uploads', async () => {
    const dir = await mkdtemp(join(tmpdir(), 's3ship-exec-'))
    const files = await Promise.all(
      Array.from({ length: 5 }, async (_, i) => {
        const p = join(dir, `f${i}.html`)
        await writeFile(p, 'x')
        return { key: `f${i}.html`, localPath: p, hash: 'h', size: 1 }
      }),
    )

    let active = 0
    let maxActive = 0
    const { s3, cf } = makeClients(async (cmd) => {
      if (cmd instanceof PutObjectCommand) {
        active++
        maxActive = Math.max(maxActive, active)
        await new Promise((r) => setTimeout(r, 10))
        active--
      }
      return {}
    })
    await executePlan({
      plan: makePlan({ toUpload: files }),
      s3Client: s3,
      cfClient: cf,
      cacheControlFor: () => undefined,
      retry: { attempts: 1, baseMs: 1 },
      concurrency: 2,
    })
    expect(maxActive).toBeLessThanOrEqual(2)
    await rm(dir, { recursive: true, force: true })
  })
})
