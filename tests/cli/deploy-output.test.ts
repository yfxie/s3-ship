import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runCli } from '../../src/cli/run.js'
import type { DeployOptions, DeployResult } from '../../src/deploy.js'
import type { UploadPlan } from '../../src/stages/diff.js'
import type { ExecutionReport } from '../../src/stages/execute.js'

let dir: string
let prevCwd: string
let stdoutBuf: string
let stderrBuf: string
let captured: DeployOptions | undefined
const orig = {
  out: process.stdout.write.bind(process.stdout),
  err: process.stderr.write.bind(process.stderr),
}

const dummyResolved = {
  source: 'dist',
  target: '',
  bucket: 'mybucket',
  region: undefined,
  profile: undefined,
  cloudfront: undefined,
  syncDelete: false,
  ignore: [],
  redirects: [],
  cacheControl: [],
  environment: undefined,
}

function file(key: string, size = 100) {
  return { key, localPath: `/abs/${key}`, hash: 'h', size }
}

function makeResult(overrides: {
  plan?: Partial<UploadPlan>
  report?: ExecutionReport
  dryRun?: boolean
}): DeployResult {
  return {
    resolvedConfig: dummyResolved,
    plan: {
      bucket: 'mybucket',
      target: '',
      toUpload: [],
      toUpdate: [],
      toSkip: [],
      toDelete: [],
      redirects: [],
      ...overrides.plan,
    },
    report: overrides.report,
    dryRun: overrides.dryRun ?? false,
    configPath: 'fake',
  }
}

function fakeDeployReturning(result: DeployResult): typeof import('../../src/deploy.js').deploy {
  return (async (opts: DeployOptions) => {
    captured = opts
    return result
  }) as never
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 's3ship-out-'))
  prevCwd = process.cwd()
  process.chdir(dir)
  stdoutBuf = ''
  stderrBuf = ''
  captured = undefined
  process.exitCode = 0
  process.stdout.write = ((chunk: string | Uint8Array) => {
    stdoutBuf += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString()
    return true
  }) as typeof process.stdout.write
  process.stderr.write = ((chunk: string | Uint8Array) => {
    stderrBuf += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString()
    return true
  }) as typeof process.stderr.write
})

afterEach(async () => {
  process.stdout.write = orig.out
  process.stderr.write = orig.err
  process.chdir(prevCwd)
  await rm(dir, { recursive: true, force: true })
  process.exitCode = 0
})

describe('runCli deploy: stdout output', () => {
  test('prints formatPlan output to stdout', async () => {
    const result = makeResult({
      plan: { toUpload: [file('index.html'), file('about.html')] },
      report: { uploaded: 2, updated: 0, skipped: 0, deleted: 0, redirected: 0, failures: [] },
    })
    const code = await runCli(['node', 's3-ship', 'deploy'], {
      deployFn: fakeDeployReturning(result),
    })
    expect(code).toBe(0)
    expect(stdoutBuf).toContain('mybucket')
    expect(stdoutBuf).toContain('index.html')
    expect(stdoutBuf).toContain('about.html')
  })

  test('prints formatReport with counts after successful deploy', async () => {
    const result = makeResult({
      plan: { toUpload: [file('a.html')] },
      report: { uploaded: 1, updated: 0, skipped: 0, deleted: 0, redirected: 0, failures: [] },
    })
    await runCli(['node', 's3-ship', 'deploy'], { deployFn: fakeDeployReturning(result) })
    expect(stdoutBuf).toContain('Deploy complete')
    expect(stdoutBuf).toMatch(/uploaded:\s*1/)
  })
})

describe('runCli deploy: --dry-run', () => {
  test('prints "(dry-run; no changes applied)" footer', async () => {
    const result = makeResult({
      plan: { toUpload: [file('a.html')] },
      dryRun: true,
      report: undefined,
    })
    await runCli(['node', 's3-ship', 'deploy', '--dry-run'], {
      deployFn: fakeDeployReturning(result),
    })
    expect(stdoutBuf).toContain('(dry-run')
    expect(stdoutBuf).not.toContain('Deploy complete')
  })

  test('--dry-run does not print Deploy complete even if report present', async () => {
    const result = makeResult({
      plan: {},
      dryRun: true,
      report: undefined,
    })
    await runCli(['node', 's3-ship', 'deploy', '--dry-run'], {
      deployFn: fakeDeployReturning(result),
    })
    expect(stdoutBuf).not.toContain('Deploy complete')
  })
})

describe('runCli deploy: --config flag', () => {
  test('propagates --config <path> to deploy()', async () => {
    const result = makeResult({
      plan: {},
      report: { uploaded: 0, updated: 0, skipped: 0, deleted: 0, redirected: 0, failures: [] },
    })
    await runCli(['node', 's3-ship', 'deploy', '--config', '/abs/cfg.json'], {
      deployFn: fakeDeployReturning(result),
    })
    expect(captured?.configPath).toBe('/abs/cfg.json')
  })
})

describe('runCli deploy: exit codes', () => {
  test('exit code 2 when report has failures', async () => {
    const result = makeResult({
      plan: { toUpload: [file('a.html')] },
      report: {
        uploaded: 0,
        updated: 0,
        skipped: 0,
        deleted: 0,
        redirected: 0,
        failures: [{ key: 'a.html', error: new Error('blip') }],
      },
    })
    const code = await runCli(['node', 's3-ship', 'deploy'], {
      deployFn: fakeDeployReturning(result),
    })
    expect(code).toBe(2)
    expect(stdoutBuf).toContain('failures: 1')
    expect(stdoutBuf).toContain('a.html')
  })

  test('exit code 0 when failures are empty', async () => {
    const result = makeResult({
      plan: {},
      report: { uploaded: 0, updated: 0, skipped: 0, deleted: 0, redirected: 0, failures: [] },
    })
    const code = await runCli(['node', 's3-ship', 'deploy'], {
      deployFn: fakeDeployReturning(result),
    })
    expect(code).toBe(0)
  })

  test('exit code 1 when deploy throws a [config] error', async () => {
    const code = await runCli(['node', 's3-ship', 'deploy'], {
      deployFn: (async () => {
        throw new Error('[config] missing bucket')
      }) as never,
    })
    expect(code).toBe(1)
    expect(stderrBuf).toContain('[config]')
  })

  test('exit code 2 when deploy throws a non-config error', async () => {
    const code = await runCli(['node', 's3-ship', 'deploy'], {
      deployFn: (async () => {
        throw new Error('network reset')
      }) as never,
    })
    expect(code).toBe(2)
    expect(stderrBuf).toContain('network reset')
  })
})

describe('runCli deploy: --verbose stdout effect', () => {
  test('without --verbose hides skip section', async () => {
    const result = makeResult({
      plan: {
        toUpload: [file('a.html')],
        toSkip: [file('untouched.html')],
      },
      report: { uploaded: 1, updated: 0, skipped: 1, deleted: 0, redirected: 0, failures: [] },
    })
    await runCli(['node', 's3-ship', 'deploy'], { deployFn: fakeDeployReturning(result) })
    expect(stdoutBuf).not.toContain('untouched.html')
  })

  test('with --verbose includes skip section', async () => {
    const result = makeResult({
      plan: {
        toUpload: [file('a.html')],
        toSkip: [file('untouched.html')],
      },
      report: { uploaded: 1, updated: 0, skipped: 1, deleted: 0, redirected: 0, failures: [] },
    })
    await runCli(['node', 's3-ship', 'deploy', '--verbose'], {
      deployFn: fakeDeployReturning(result),
    })
    expect(stdoutBuf).toContain('untouched.html')
  })
})
