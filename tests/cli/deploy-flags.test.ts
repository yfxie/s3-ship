import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runCli } from '../../src/cli/run.js'
import type { DeployOptions, DeployResult } from '../../src/deploy.js'

let dir: string
let prevCwd: string
let captured: DeployOptions | undefined
const origWrite = process.stdout.write.bind(process.stdout)

async function fakeDeploy(opts: DeployOptions): Promise<DeployResult> {
  captured = opts
  return {
    resolvedConfig: {
      source: 'dist',
      target: '',
      bucket: 'b',
      region: undefined,
      profile: undefined,
      cloudfront: undefined,
      syncDelete: false,
      ignore: [],
      redirects: [],
      cacheControl: [],
      environment: undefined,
    },
    plan: {
      bucket: 'b',
      target: '',
      toUpload: [],
      toUpdate: [],
      toSkip: [],
      toDelete: [],
      redirects: [],
    },
    dryRun: false,
    configPath: 'fake',
    report: { uploaded: 0, updated: 0, skipped: 0, deleted: 0, redirected: 0, failures: [] },
  }
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 's3ship-flags-'))
  prevCwd = process.cwd()
  process.chdir(dir)
  captured = undefined
  process.exitCode = 0
  process.stdout.write = (() => true) as typeof process.stdout.write
})

afterEach(async () => {
  process.stdout.write = origWrite
  process.chdir(prevCwd)
  await rm(dir, { recursive: true, force: true })
  process.exitCode = 0
})

describe('CLI deploy flag → DeployOptions translation', () => {
  test('no --sync-delete flag means syncDelete is undefined (so config wins, defaults to false)', async () => {
    await runCli(['node', 's3-ship', 'deploy'], { deployFn: fakeDeploy })
    expect(captured?.syncDelete).toBeUndefined()
  })

  test('--sync-delete sets syncDelete=true', async () => {
    await runCli(['node', 's3-ship', 'deploy', '--sync-delete'], { deployFn: fakeDeploy })
    expect(captured?.syncDelete).toBe(true)
  })

  test('--no-sync-delete sets syncDelete=false to override config', async () => {
    await runCli(['node', 's3-ship', 'deploy', '--no-sync-delete'], { deployFn: fakeDeploy })
    expect(captured?.syncDelete).toBe(false)
  })

  test('no --no-invalidate keeps invalidation enabled', async () => {
    await runCli(['node', 's3-ship', 'deploy'], { deployFn: fakeDeploy })
    expect(captured?.skipInvalidate).toBe(false)
  })

  test('--no-invalidate sets skipInvalidate=true', async () => {
    await runCli(['node', 's3-ship', 'deploy', '--no-invalidate'], { deployFn: fakeDeploy })
    expect(captured?.skipInvalidate).toBe(true)
  })

  test('--dry-run propagates', async () => {
    await runCli(['node', 's3-ship', 'deploy', '--dry-run'], { deployFn: fakeDeploy })
    expect(captured?.dryRun).toBe(true)
  })

  test('--env propagates', async () => {
    await runCli(['node', 's3-ship', 'deploy', '--env', 'production'], { deployFn: fakeDeploy })
    expect(captured?.env).toBe('production')
  })

  test('--profile, --bucket, --target, --source all propagate', async () => {
    await runCli(
      [
        'node',
        's3-ship',
        'deploy',
        '--profile',
        'myprof',
        '--bucket',
        'mybucket',
        '--target',
        'docs',
        '--source',
        'build',
      ],
      { deployFn: fakeDeploy },
    )
    expect(captured?.profile).toBe('myprof')
    expect(captured?.bucket).toBe('mybucket')
    expect(captured?.target).toBe('docs')
    expect(captured?.source).toBe('build')
  })
})
