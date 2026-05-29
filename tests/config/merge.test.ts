import { describe, expect, test } from 'bun:test'
import { resolveConfig } from '../../src/config/merge.js'

describe('resolveConfig (defaults < base < env < cli overrides)', () => {
  test('returns base config when no environment and no overrides', () => {
    const result = resolveConfig({ bucket: 'b', source: 'dist' }, {})
    expect(result.bucket).toBe('b')
    expect(result.source).toBe('dist')
  })

  test('applies built-in defaults when not set', () => {
    const result = resolveConfig({ bucket: 'b' }, {})
    expect(result.source).toBe('dist')
    expect(result.target).toBe('')
    expect(result.syncDelete).toBe(false)
  })

  test('environment overrides top-level bucket', () => {
    const result = resolveConfig(
      {
        bucket: 'top-bucket',
        environments: { prod: { bucket: 'prod-bucket' } },
      },
      { env: 'prod' },
    )
    expect(result.bucket).toBe('prod-bucket')
  })

  test('environment merges deeply with top-level cloudfront', () => {
    const result = resolveConfig(
      {
        bucket: 'b',
        cloudfront: { distributionId: 'TOP', invalidationPaths: ['/*'] },
        environments: {
          prod: { cloudfront: { distributionId: 'PROD' } },
        },
      },
      { env: 'prod' },
    )
    expect(result.cloudfront?.distributionId).toBe('PROD')
    expect(result.cloudfront?.invalidationPaths).toEqual(['/*'])
  })

  test('CLI overrides win over environment and top-level', () => {
    const result = resolveConfig(
      {
        bucket: 'top',
        profile: 'top-profile',
        environments: { prod: { bucket: 'env-bucket', profile: 'env-profile' } },
      },
      { env: 'prod', profile: 'cli-profile', bucket: 'cli-bucket' },
    )
    expect(result.bucket).toBe('cli-bucket')
    expect(result.profile).toBe('cli-profile')
  })

  test('CLI syncDelete=true overrides config false', () => {
    const result = resolveConfig({ bucket: 'b', syncDelete: false }, { syncDelete: true })
    expect(result.syncDelete).toBe(true)
  })

  test('CLI syncDelete=false overrides config true', () => {
    const result = resolveConfig({ bucket: 'b', syncDelete: true }, { syncDelete: false })
    expect(result.syncDelete).toBe(false)
  })

  test('CLI target overrides empty default', () => {
    const result = resolveConfig({ bucket: 'b' }, { target: 'docs/v2' })
    expect(result.target).toBe('docs/v2')
  })

  test('CLI source overrides config', () => {
    const result = resolveConfig({ bucket: 'b', source: 'public' }, { source: 'build' })
    expect(result.source).toBe('build')
  })

  test('throws when env name is given but not found in config', () => {
    expect(() =>
      resolveConfig(
        { bucket: 'b', environments: { staging: { bucket: 's' } } },
        { env: 'production' },
      ),
    ).toThrow(/production/)
  })

  test('AWS_REGION env var fills region when not set in config or CLI', () => {
    const result = resolveConfig({ bucket: 'b' }, { envVars: { AWS_REGION: 'eu-west-1' } })
    expect(result.region).toBe('eu-west-1')
  })

  test('AWS_PROFILE env var fills profile when not set in config or CLI', () => {
    const result = resolveConfig({ bucket: 'b' }, { envVars: { AWS_PROFILE: 'dev' } })
    expect(result.profile).toBe('dev')
  })

  test('CLI flag wins over env var', () => {
    const result = resolveConfig(
      { bucket: 'b' },
      { profile: 'cli', envVars: { AWS_PROFILE: 'env' } },
    )
    expect(result.profile).toBe('cli')
  })

  test('config value wins over env var', () => {
    const result = resolveConfig(
      { bucket: 'b', profile: 'config' },
      { envVars: { AWS_PROFILE: 'env' } },
    )
    expect(result.profile).toBe('config')
  })

  test('redirects from environment replace top-level redirects', () => {
    const result = resolveConfig(
      {
        bucket: 'b',
        redirects: [{ from: 'a', to: '/a' }],
        environments: { prod: { redirects: [{ from: 'b', to: '/b' }] } },
      },
      { env: 'prod' },
    )
    expect(result.redirects).toEqual([{ from: 'b', to: '/b' }])
  })

  test('ignore arrays from environment replace top-level ignore', () => {
    const result = resolveConfig(
      {
        bucket: 'b',
        ignore: ['*.log'],
        environments: { prod: { ignore: ['*.tmp'] } },
      },
      { env: 'prod' },
    )
    expect(result.ignore).toEqual(['*.tmp'])
  })

  test('top-level ignore preserved when environment does not override', () => {
    const result = resolveConfig(
      {
        bucket: 'b',
        ignore: ['*.log'],
        environments: { prod: {} },
      },
      { env: 'prod' },
    )
    expect(result.ignore).toEqual(['*.log'])
  })
})
