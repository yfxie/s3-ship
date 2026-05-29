import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadConfigFile } from '../../src/config/load.js'

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 's3ship-load-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('loadConfigFile', () => {
  test('loads JSON config from explicit path', async () => {
    const path = join(dir, 's3-ship.config.json')
    await writeFile(path, JSON.stringify({ bucket: 'json-bucket', source: 'dist' }))
    const result = await loadConfigFile({ cwd: dir, configPath: path })
    expect(result.config).toEqual({ bucket: 'json-bucket', source: 'dist' })
    expect(result.sourcePath).toBe(path)
  })

  test('loads YAML config from explicit path', async () => {
    const path = join(dir, 's3-ship.config.yml')
    await writeFile(path, 'bucket: yaml-bucket\nsource: build\n')
    const result = await loadConfigFile({ cwd: dir, configPath: path })
    expect(result.config).toEqual({ bucket: 'yaml-bucket', source: 'build' })
  })

  test('loads .yaml extension as YAML', async () => {
    const path = join(dir, 's3-ship.config.yaml')
    await writeFile(path, 'bucket: yaml2\n')
    const result = await loadConfigFile({ cwd: dir, configPath: path })
    expect(result.config.bucket).toBe('yaml2')
  })

  test('loads JS config with default export', async () => {
    const path = join(dir, 's3-ship.config.mjs')
    await writeFile(path, 'export default { bucket: "js-bucket" }\n')
    const result = await loadConfigFile({ cwd: dir, configPath: path })
    expect(result.config).toEqual({ bucket: 'js-bucket' })
  })

  test('loads TS config (Bun handles transpilation)', async () => {
    const path = join(dir, 's3-ship.config.ts')
    await writeFile(
      path,
      'const cfg: { bucket: string } = { bucket: "ts-bucket" }\nexport default cfg\n',
    )
    const result = await loadConfigFile({ cwd: dir, configPath: path })
    expect(result.config).toEqual({ bucket: 'ts-bucket' })
  })

  test('auto-detects s3-ship.config.json in cwd when no path given', async () => {
    await writeFile(join(dir, 's3-ship.config.json'), '{"bucket":"auto"}')
    const result = await loadConfigFile({ cwd: dir })
    expect(result.config.bucket).toBe('auto')
  })

  test('auto-detect prefers .ts > .js > .mjs > .json > .yml when multiple exist', async () => {
    await writeFile(join(dir, 's3-ship.config.json'), '{"bucket":"json"}')
    await writeFile(join(dir, 's3-ship.config.yml'), 'bucket: yaml')
    const result = await loadConfigFile({ cwd: dir })
    expect(result.config.bucket).toBe('json')
  })

  test('throws when no config file exists', async () => {
    await expect(loadConfigFile({ cwd: dir })).rejects.toThrow(/No s3-ship config file found/)
  })

  test('throws when explicit path does not exist', async () => {
    await expect(loadConfigFile({ cwd: dir, configPath: join(dir, 'nope.json') })).rejects.toThrow(
      /not found/,
    )
  })

  test('throws on invalid JSON', async () => {
    const path = join(dir, 's3-ship.config.json')
    await writeFile(path, '{not json}')
    await expect(loadConfigFile({ cwd: dir, configPath: path })).rejects.toThrow(/JSON|parse/i)
  })

  test('throws on invalid YAML', async () => {
    const path = join(dir, 's3-ship.config.yml')
    await writeFile(path, 'bucket: : oops\n  - bad\n')
    await expect(loadConfigFile({ cwd: dir, configPath: path })).rejects.toThrow(/YAML|parse/i)
  })

  test('loads .cjs config via CommonJS interop (module.exports)', async () => {
    const path = join(dir, 's3-ship.config.cjs')
    await writeFile(path, 'module.exports = { bucket: "cjs-bucket", source: "out" }\n')
    const result = await loadConfigFile({ cwd: dir, configPath: path })
    expect(result.config.bucket).toBe('cjs-bucket')
    expect(result.config.source).toBe('out')
  })

  test('throws when JS config has no default export', async () => {
    const path = join(dir, 's3-ship.config.mjs')
    await writeFile(path, 'export const cfg = { bucket: "x" }\n')
    await expect(loadConfigFile({ cwd: dir, configPath: path })).rejects.toThrow(/default export/i)
  })
})
