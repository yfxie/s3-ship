import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { initConfig } from '../../src/cli/init.js'

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 's3ship-init-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('initConfig', () => {
  test('writes s3-ship.config.json', async () => {
    const result = await initConfig({ cwd: dir, format: 'json' })
    expect(existsSync(join(dir, 's3-ship.config.json'))).toBe(true)
    expect(result.path.endsWith('s3-ship.config.json')).toBe(true)
    const content = await readFile(join(dir, 's3-ship.config.json'), 'utf8')
    expect(() => JSON.parse(content)).not.toThrow()
    expect(content).toContain('bucket')
  })

  test('writes s3-ship.config.yml for yaml format', async () => {
    const result = await initConfig({ cwd: dir, format: 'yml' })
    expect(existsSync(join(dir, 's3-ship.config.yml'))).toBe(true)
    expect(result.path.endsWith('.yml')).toBe(true)
  })

  test('writes s3-ship.config.js for js format', async () => {
    await initConfig({ cwd: dir, format: 'js' })
    expect(existsSync(join(dir, 's3-ship.config.js'))).toBe(true)
    const content = await readFile(join(dir, 's3-ship.config.js'), 'utf8')
    expect(content).toContain('export default')
  })

  test('writes s3-ship.config.ts with defineConfig import for ts format', async () => {
    await initConfig({ cwd: dir, format: 'ts' })
    const content = await readFile(join(dir, 's3-ship.config.ts'), 'utf8')
    expect(content).toContain('defineConfig')
    expect(content).toContain("from 's3-ship'")
  })

  test('defaults to ts when format omitted', async () => {
    const result = await initConfig({ cwd: dir })
    expect(result.path.endsWith('s3-ship.config.ts')).toBe(true)
  })

  test('refuses to overwrite existing file', async () => {
    await writeFile(join(dir, 's3-ship.config.json'), '{}')
    await expect(initConfig({ cwd: dir, format: 'json' })).rejects.toThrow(/exists/i)
  })

  test('refuses overwrite for ts format', async () => {
    await writeFile(join(dir, 's3-ship.config.ts'), 'x')
    await expect(initConfig({ cwd: dir, format: 'ts' })).rejects.toThrow(/exists/i)
  })

  test('refuses overwrite for js format', async () => {
    await writeFile(join(dir, 's3-ship.config.js'), 'x')
    await expect(initConfig({ cwd: dir, format: 'js' })).rejects.toThrow(/exists/i)
  })

  test('refuses overwrite for mjs format', async () => {
    await writeFile(join(dir, 's3-ship.config.mjs'), 'x')
    await expect(initConfig({ cwd: dir, format: 'mjs' })).rejects.toThrow(/exists/i)
  })

  test('refuses overwrite for yml format', async () => {
    await writeFile(join(dir, 's3-ship.config.yml'), 'x')
    await expect(initConfig({ cwd: dir, format: 'yml' })).rejects.toThrow(/exists/i)
  })

  test('refuses overwrite for yaml format', async () => {
    await writeFile(join(dir, 's3-ship.config.yaml'), 'x')
    await expect(initConfig({ cwd: dir, format: 'yaml' })).rejects.toThrow(/exists/i)
  })

  test('throws on unknown format', async () => {
    await expect(initConfig({ cwd: dir, format: 'xml' as never })).rejects.toThrow(
      /unsupported|format/i,
    )
  })
})
