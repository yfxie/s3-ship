import { describe, expect, test } from 'bun:test'
import { validateConfig } from '../../src/config/schema.js'

describe('validateConfig', () => {
  test('accepts minimal valid config with bucket', () => {
    const result = validateConfig({ bucket: 'my-bucket' })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.bucket).toBe('my-bucket')
    }
  })

  test('rejects config without bucket at top level or env', () => {
    const result = validateConfig({ source: 'dist' })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors.some((e) => e.path === 'bucket' || e.path.endsWith('.bucket'))).toBe(
        true,
      )
    }
  })

  test('accepts bucket defined only inside environments', () => {
    const result = validateConfig({
      source: 'dist',
      environments: {
        production: { bucket: 'prod-bucket' },
      },
    })
    expect(result.ok).toBe(true)
  })

  test('collects multiple errors at once instead of stopping at first', () => {
    const result = validateConfig({
      source: 123,
      bucket: '',
      redirects: [{ from: 'a' }],
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors.length).toBeGreaterThanOrEqual(2)
    }
  })

  test('rejects empty bucket string', () => {
    const result = validateConfig({ bucket: '' })
    expect(result.ok).toBe(false)
  })

  test('rejects redirect missing "to"', () => {
    const result = validateConfig({
      bucket: 'b',
      redirects: [{ from: 'old' } as never],
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors.some((e) => e.path.includes('redirects'))).toBe(true)
    }
  })

  test('rejects redirect statusCode not in {301, 302}', () => {
    const result = validateConfig({
      bucket: 'b',
      redirects: [{ from: 'a', to: '/b', statusCode: 404 as never }],
    })
    expect(result.ok).toBe(false)
  })

  test('accepts statusCode 301 and 302', () => {
    const r1 = validateConfig({
      bucket: 'b',
      redirects: [{ from: 'a', to: '/b', statusCode: 301 }],
    })
    const r2 = validateConfig({
      bucket: 'b',
      redirects: [{ from: 'a', to: '/b', statusCode: 302 }],
    })
    expect(r1.ok).toBe(true)
    expect(r2.ok).toBe(true)
  })

  test('accepts cloudfront with distributionId', () => {
    const result = validateConfig({
      bucket: 'b',
      cloudfront: { distributionId: 'E123ABC' },
    })
    expect(result.ok).toBe(true)
  })

  test('rejects cloudfront missing distributionId', () => {
    const result = validateConfig({
      bucket: 'b',
      cloudfront: {} as never,
    })
    expect(result.ok).toBe(false)
  })

  test('error message includes a suggestion field when present', () => {
    const result = validateConfig({ source: 'dist' })
    if (!result.ok) {
      const bucketErr = result.errors.find((e) => e.path.endsWith('bucket'))
      expect(bucketErr?.message).toBeDefined()
    }
  })
})
