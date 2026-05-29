import { describe, expect, test } from 'bun:test'
import { computeDiff } from '../../src/stages/diff.js'
import type { RemoteObject } from '../../src/stages/list-remote.js'
import type { LocalFile } from '../../src/stages/scan.js'

function local(key: string, hash = 'h', size = 1): LocalFile {
  return { key, localPath: `/abs/${key}`, hash, size }
}

function remote(key: string, etag = 'h', size = 1): RemoteObject {
  return { key, etag, size }
}

describe('computeDiff', () => {
  test('returns all-empty plan when both sides empty', () => {
    const plan = computeDiff({
      bucket: 'b',
      target: '',
      localFiles: [],
      remoteObjects: [],
      redirects: [],
      syncDelete: false,
    })
    expect(plan.toUpload).toEqual([])
    expect(plan.toUpdate).toEqual([])
    expect(plan.toSkip).toEqual([])
    expect(plan.toDelete).toEqual([])
    expect(plan.bucket).toBe('b')
    expect(plan.target).toBe('')
  })

  test('local file not in remote -> toUpload with full key', () => {
    const plan = computeDiff({
      bucket: 'b',
      target: '',
      localFiles: [local('a.html', 'h1')],
      remoteObjects: [],
      redirects: [],
      syncDelete: false,
    })
    expect(plan.toUpload).toHaveLength(1)
    expect(plan.toUpload[0]?.key).toBe('a.html')
  })

  test('local file matches remote ETag -> toSkip', () => {
    const plan = computeDiff({
      bucket: 'b',
      target: '',
      localFiles: [local('a.html', 'sameetag')],
      remoteObjects: [remote('a.html', 'sameetag')],
      redirects: [],
      syncDelete: false,
    })
    expect(plan.toSkip).toHaveLength(1)
    expect(plan.toUpload).toHaveLength(0)
    expect(plan.toUpdate).toHaveLength(0)
  })

  test('local file ETag differs -> toUpdate', () => {
    const plan = computeDiff({
      bucket: 'b',
      target: '',
      localFiles: [local('a.html', 'newhash')],
      remoteObjects: [remote('a.html', 'oldhash')],
      redirects: [],
      syncDelete: false,
    })
    expect(plan.toUpdate).toHaveLength(1)
    expect(plan.toUpdate[0]?.key).toBe('a.html')
  })

  test('multipart remote ETag (contains dash) -> always toUpdate', () => {
    const plan = computeDiff({
      bucket: 'b',
      target: '',
      localFiles: [local('big.bin', 'localhash')],
      remoteObjects: [remote('big.bin', 'somehash-3')],
      redirects: [],
      syncDelete: false,
    })
    expect(plan.toUpdate).toHaveLength(1)
  })

  test('target prefix prepended to local file keys before lookup', () => {
    const plan = computeDiff({
      bucket: 'b',
      target: 'docs/v2',
      localFiles: [local('a.html', 'sameetag')],
      remoteObjects: [remote('docs/v2/a.html', 'sameetag')],
      redirects: [],
      syncDelete: false,
    })
    expect(plan.toSkip).toHaveLength(1)
    expect(plan.toSkip[0]?.key).toBe('docs/v2/a.html')
  })

  test('syncDelete=true: remote not in local -> toDelete', () => {
    const plan = computeDiff({
      bucket: 'b',
      target: '',
      localFiles: [local('keep.html', 'h')],
      remoteObjects: [remote('keep.html', 'h'), remote('gone.html', 'old')],
      redirects: [],
      syncDelete: true,
    })
    expect(plan.toDelete).toEqual(['gone.html'])
  })

  test('syncDelete=false: stale remote NOT in toDelete', () => {
    const plan = computeDiff({
      bucket: 'b',
      target: '',
      localFiles: [],
      remoteObjects: [remote('gone.html', 'x')],
      redirects: [],
      syncDelete: false,
    })
    expect(plan.toDelete).toEqual([])
  })

  test('syncDelete with target prefix: only deletes within prefix', () => {
    const plan = computeDiff({
      bucket: 'b',
      target: 'docs/v2',
      localFiles: [local('a.html', 'h')],
      remoteObjects: [remote('docs/v2/a.html', 'h'), remote('docs/v2/gone.html', 'x')],
      redirects: [],
      syncDelete: true,
    })
    expect(plan.toDelete).toEqual(['docs/v2/gone.html'])
  })

  test('syncDelete does not include redirect keys in toDelete', () => {
    const plan = computeDiff({
      bucket: 'b',
      target: '',
      localFiles: [],
      remoteObjects: [remote('old', '')],
      redirects: [{ from: 'old', to: '/new' }],
      syncDelete: true,
    })
    expect(plan.toDelete).toEqual([])
  })

  test('redirect.from prefixed by target before conflict check', () => {
    const plan = computeDiff({
      bucket: 'b',
      target: 'docs',
      localFiles: [],
      remoteObjects: [remote('docs/redir', '')],
      redirects: [{ from: 'redir', to: '/new' }],
      syncDelete: true,
    })
    expect(plan.toDelete).toEqual([])
    expect(plan.redirects[0]?.from).toBe('redir')
  })

  test('redirect at same key as local file -> local file dropped, redirect kept, no error', () => {
    const plan = computeDiff({
      bucket: 'b',
      target: '',
      localFiles: [local('about.html', 'h'), local('keep.html', 'h')],
      remoteObjects: [],
      redirects: [{ from: 'about.html', to: '/new' }],
      syncDelete: false,
    })
    expect(plan.toUpload.map((f) => f.key)).toEqual(['keep.html'])
    expect(plan.redirects).toHaveLength(1)
    expect(plan.redirects[0]?.fullKey).toBe('about.html')
  })

  test('redirect overrides local file with target prefix applied', () => {
    const plan = computeDiff({
      bucket: 'b',
      target: 'docs',
      localFiles: [local('page.html', 'h')],
      remoteObjects: [],
      redirects: [{ from: 'page.html', to: '/x' }],
      syncDelete: false,
    })
    expect(plan.toUpload).toHaveLength(0)
    expect(plan.redirects[0]?.fullKey).toBe('docs/page.html')
  })

  test('redirect-overridden local file is still protected from sync-delete', () => {
    const plan = computeDiff({
      bucket: 'b',
      target: '',
      localFiles: [local('about.html', 'h')],
      remoteObjects: [remote('about.html', 'oldhash')],
      redirects: [{ from: 'about.html', to: '/new' }],
      syncDelete: true,
    })
    expect(plan.toDelete).toEqual([])
  })

  test('redirect overrides existing remote file with same key (treated as toUpload via redirect)', () => {
    const plan = computeDiff({
      bucket: 'b',
      target: '',
      localFiles: [local('about.html', 'h')],
      remoteObjects: [remote('about.html', 'oldhash')],
      redirects: [{ from: 'about.html', to: '/new' }],
      syncDelete: false,
    })
    expect(plan.toUpload).toHaveLength(0)
    expect(plan.toUpdate).toHaveLength(0)
    expect(plan.toSkip).toHaveLength(0)
    expect(plan.redirects).toHaveLength(1)
  })

  test('plan carries cloudfront pass-through', () => {
    const plan = computeDiff({
      bucket: 'b',
      target: '',
      localFiles: [],
      remoteObjects: [],
      redirects: [],
      syncDelete: false,
      cloudfront: { distributionId: 'E1', invalidationPaths: ['/*'] },
    })
    expect(plan.cloudfront?.distributionId).toBe('E1')
  })

  test('plan output is deterministic (sorted)', () => {
    const plan = computeDiff({
      bucket: 'b',
      target: '',
      localFiles: [local('z.html'), local('a.html')],
      remoteObjects: [],
      redirects: [],
      syncDelete: false,
    })
    expect(plan.toUpload.map((f) => f.key)).toEqual(['a.html', 'z.html'])
  })
})
