import { describe, expect, test } from 'bun:test'
import { formatPlan, formatReport } from '../src/reporter.js'

describe('formatPlan', () => {
  test('shows "no changes" when plan is empty', () => {
    const out = formatPlan({
      bucket: 'b',
      target: '',
      toUpload: [],
      toUpdate: [],
      toSkip: [],
      toDelete: [],
      redirects: [],
    })
    expect(out.toLowerCase()).toContain('no changes')
  })

  test('includes bucket and target in summary', () => {
    const out = formatPlan({
      bucket: 'mybucket',
      target: 'docs/v2',
      toUpload: [],
      toUpdate: [],
      toSkip: [],
      toDelete: [],
      redirects: [],
    })
    expect(out).toContain('mybucket')
    expect(out).toContain('docs/v2')
  })

  test('shows counts for upload, update, skip, delete, redirects', () => {
    const out = formatPlan({
      bucket: 'b',
      target: '',
      toUpload: [{ key: 'a', localPath: '/a', hash: 'h', size: 1 }],
      toUpdate: [{ key: 'b', localPath: '/b', hash: 'h', size: 1 }],
      toSkip: [{ key: 'c', localPath: '/c', hash: 'h', size: 1 }],
      toDelete: ['d', 'e'],
      redirects: [{ from: 'o', to: '/n', fullKey: 'o' }],
    })
    expect(out).toMatch(/upload[^\n]*1/i)
    expect(out).toMatch(/update[^\n]*1/i)
    expect(out).toMatch(/skip[^\n]*1/i)
    expect(out).toMatch(/delete[^\n]*2/i)
    expect(out).toMatch(/redirect[^\n]*1/i)
  })

  test('shows cloudfront distribution id when configured', () => {
    const out = formatPlan({
      bucket: 'b',
      target: '',
      toUpload: [],
      toUpdate: [],
      toSkip: [],
      toDelete: [],
      redirects: [],
      cloudfront: { distributionId: 'EABC123', invalidationPaths: ['/*'] },
    })
    expect(out).toContain('EABC123')
  })
})

describe('formatPlan verbose mode', () => {
  function file(key: string) {
    return { key, localPath: `/abs/${key}`, hash: 'h', size: 1 }
  }

  test('default mode truncates at 20 with "and N more"', () => {
    const files = Array.from({ length: 25 }, (_, i) => file(`f${i.toString().padStart(2, '0')}`))
    const out = formatPlan({
      bucket: 'b',
      target: '',
      toUpload: files,
      toUpdate: [],
      toSkip: [],
      toDelete: [],
      redirects: [],
    })
    expect(out).toContain('and 5 more')
    expect(out).not.toContain('f24')
  })

  test('verbose mode lists all items without truncation', () => {
    const files = Array.from({ length: 25 }, (_, i) => file(`f${i.toString().padStart(2, '0')}`))
    const out = formatPlan(
      {
        bucket: 'b',
        target: '',
        toUpload: files,
        toUpdate: [],
        toSkip: [],
        toDelete: [],
        redirects: [],
      },
      { verbose: true },
    )
    expect(out).not.toContain('and 5 more')
    expect(out).toContain('f00')
    expect(out).toContain('f24')
  })

  test('verbose lists toSkip items (normally hidden)', () => {
    const out = formatPlan(
      {
        bucket: 'b',
        target: '',
        toUpload: [],
        toUpdate: [],
        toSkip: [file('untouched.html')],
        toDelete: [],
        redirects: [],
      },
      { verbose: true },
    )
    expect(out).toContain('untouched.html')
  })

  test('non-verbose does NOT list toSkip items', () => {
    const out = formatPlan({
      bucket: 'b',
      target: '',
      toUpload: [],
      toUpdate: [],
      toSkip: [file('untouched.html')],
      toDelete: [],
      redirects: [],
    })
    expect(out).not.toContain('untouched.html')
  })

  test('verbose includes per-file size next to upload entries', () => {
    const out = formatPlan(
      {
        bucket: 'b',
        target: '',
        toUpload: [{ key: 'big.bin', localPath: '/big.bin', hash: 'h', size: 2048 }],
        toUpdate: [],
        toSkip: [],
        toDelete: [],
        redirects: [],
      },
      { verbose: true },
    )
    expect(out).toMatch(/big\.bin.*KB|big\.bin.*2048/)
  })
})

describe('formatReport', () => {
  test('shows success counts', () => {
    const out = formatReport({
      uploaded: 3,
      updated: 1,
      skipped: 5,
      deleted: 2,
      redirected: 1,
      failures: [],
    })
    expect(out).toContain('3')
    expect(out).toContain('1')
  })

  test('shows failure summary when failures present', () => {
    const out = formatReport({
      uploaded: 0,
      updated: 0,
      skipped: 0,
      deleted: 0,
      redirected: 0,
      failures: [{ key: 'a.html', error: new Error('blip') }],
    })
    expect(out.toLowerCase()).toMatch(/fail|error/)
    expect(out).toContain('a.html')
  })

  test('default mode truncates failures at 20 with "and N more"', () => {
    const failures = Array.from({ length: 25 }, (_, i) => ({
      key: `k${i}`,
      error: new Error('e'),
    }))
    const out = formatReport({
      uploaded: 0,
      updated: 0,
      skipped: 0,
      deleted: 0,
      redirected: 0,
      failures,
    })
    expect(out).toContain('and 5 more')
  })

  test('verbose mode lists all failures without truncation', () => {
    const failures = Array.from({ length: 25 }, (_, i) => ({
      key: `k${i}`,
      error: new Error('e'),
    }))
    const out = formatReport(
      {
        uploaded: 0,
        updated: 0,
        skipped: 0,
        deleted: 0,
        redirected: 0,
        failures,
      },
      { verbose: true },
    )
    expect(out).not.toContain('and 5 more')
    expect(out).toContain('k24')
  })

  test('shows invalidation id when present', () => {
    const out = formatReport({
      uploaded: 0,
      updated: 0,
      skipped: 0,
      deleted: 0,
      redirected: 0,
      failures: [],
      invalidationId: 'INV-X',
    })
    expect(out).toContain('INV-X')
  })
})
