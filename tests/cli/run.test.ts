import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runCli } from '../../src/cli/run.js'

let dir: string
let prevCwd: string
let stdoutBuf: string
let stderrBuf: string
const origWrites = {
  out: process.stdout.write.bind(process.stdout),
  err: process.stderr.write.bind(process.stderr),
  log: console.log,
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 's3ship-cli-'))
  prevCwd = process.cwd()
  process.chdir(dir)
  stdoutBuf = ''
  stderrBuf = ''
  process.exitCode = 0
  process.stdout.write = ((chunk: string | Uint8Array) => {
    stdoutBuf += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString()
    return true
  }) as typeof process.stdout.write
  process.stderr.write = ((chunk: string | Uint8Array) => {
    stderrBuf += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString()
    return true
  }) as typeof process.stderr.write
  console.log = ((...args: unknown[]) => {
    stdoutBuf += `${args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')}\n`
  }) as typeof console.log
})

afterEach(async () => {
  process.stdout.write = origWrites.out
  process.stderr.write = origWrites.err
  console.log = origWrites.log
  process.chdir(prevCwd)
  await rm(dir, { recursive: true, force: true })
  process.exitCode = 0
})

describe('runCli', () => {
  test('init creates config file with default ts format', async () => {
    const code = await runCli(['node', 's3-ship', 'init'])
    expect(code).toBe(0)
    expect(stdoutBuf).toContain('s3-ship.config.ts')
  })

  test('init --format json creates JSON file', async () => {
    await runCli(['node', 's3-ship', 'init', '--format', 'json'])
    const content = await readFile(join(dir, 's3-ship.config.json'), 'utf8')
    expect(JSON.parse(content).bucket).toBeDefined()
  })

  test('validate prints OK for valid config', async () => {
    await writeFile(join(dir, 's3-ship.config.json'), JSON.stringify({ bucket: 'b' }))
    const code = await runCli(['node', 's3-ship', 'validate'])
    expect(code).toBe(0)
    expect(stdoutBuf).toContain('OK')
  })

  test('validate prints errors for invalid config (exit 1)', async () => {
    await writeFile(join(dir, 's3-ship.config.json'), '{}')
    const code = await runCli(['node', 's3-ship', 'validate'])
    expect(code).toBe(1)
    expect(stderrBuf).toContain('Invalid config')
    expect(stderrBuf).toContain('bucket')
  })

  test('validate without config file reports clear error', async () => {
    const code = await runCli(['node', 's3-ship', 'validate'])
    expect(code).toBe(1)
    expect(stderrBuf.toLowerCase()).toContain('config')
  })

  test('--help prints usage with command list', async () => {
    const code = await runCli(['node', 's3-ship', '--help'])
    expect(code).toBe(0)
    expect(stdoutBuf.toLowerCase()).toContain('usage')
    expect(stdoutBuf).toContain('deploy')
    expect(stdoutBuf).toContain('init')
    expect(stdoutBuf).toContain('validate')
  })

  test('--version prints version with package name', async () => {
    const code = await runCli(['node', 's3-ship', '--version'])
    expect(code).toBe(0)
    expect(stdoutBuf).toContain('s3-ship/')
  })

  test('deploy --help prints flag descriptions including --sync-delete', async () => {
    const code = await runCli(['node', 's3-ship', 'deploy', '--help'])
    expect(code).toBe(0)
    expect(stdoutBuf).toContain('--sync-delete')
    expect(stdoutBuf).toContain('--dry-run')
    expect(stdoutBuf).toContain('--config')
  })
})
