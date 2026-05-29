import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { scanLocalFiles } from '../../src/stages/scan.js'

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 's3ship-scan-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

function md5(content: string): string {
  return createHash('md5').update(content).digest('hex')
}

describe('scanLocalFiles', () => {
  test('returns empty array for empty source directory', async () => {
    const result = await scanLocalFiles({ source: dir, ignore: [] })
    expect(result).toEqual([])
  })

  test('returns one entry per file', async () => {
    await writeFile(join(dir, 'a.html'), 'hello')
    await writeFile(join(dir, 'b.css'), 'body{}')
    const result = await scanLocalFiles({ source: dir, ignore: [] })
    expect(result).toHaveLength(2)
  })

  test('entry contains key (relative POSIX path), size, and md5 hash', async () => {
    await writeFile(join(dir, 'index.html'), 'hello world')
    const result = await scanLocalFiles({ source: dir, ignore: [] })
    expect(result[0]?.key).toBe('index.html')
    expect(result[0]?.size).toBe(11)
    expect(result[0]?.hash).toBe(md5('hello world'))
    expect(result[0]?.localPath.endsWith('index.html')).toBe(true)
  })

  test('uses forward slashes in key for nested files', async () => {
    await mkdir(join(dir, 'a', 'b'), { recursive: true })
    await writeFile(join(dir, 'a', 'b', 'c.html'), 'x')
    const result = await scanLocalFiles({ source: dir, ignore: [] })
    expect(result[0]?.key).toBe('a/b/c.html')
  })

  test('always ignores .DS_Store', async () => {
    await writeFile(join(dir, 'a.html'), 'a')
    await writeFile(join(dir, '.DS_Store'), 'junk')
    const result = await scanLocalFiles({ source: dir, ignore: [] })
    expect(result.map((f) => f.key)).toEqual(['a.html'])
  })

  test('always ignores Thumbs.db', async () => {
    await writeFile(join(dir, 'a.html'), 'a')
    await writeFile(join(dir, 'Thumbs.db'), 'junk')
    const result = await scanLocalFiles({ source: dir, ignore: [] })
    expect(result.map((f) => f.key)).toEqual(['a.html'])
  })

  test('always ignores nested .DS_Store', async () => {
    await mkdir(join(dir, 'sub'), { recursive: true })
    await writeFile(join(dir, 'sub', '.DS_Store'), 'x')
    await writeFile(join(dir, 'sub', 'page.html'), 'p')
    const result = await scanLocalFiles({ source: dir, ignore: [] })
    expect(result.map((f) => f.key)).toEqual(['sub/page.html'])
  })

  test('always ignores .git directory contents', async () => {
    await mkdir(join(dir, '.git'), { recursive: true })
    await writeFile(join(dir, '.git', 'HEAD'), 'ref')
    await writeFile(join(dir, 'a.html'), 'a')
    const result = await scanLocalFiles({ source: dir, ignore: [] })
    expect(result.map((f) => f.key)).toEqual(['a.html'])
  })

  test('always ignores *.swp', async () => {
    await writeFile(join(dir, 'a.html'), 'a')
    await writeFile(join(dir, '.a.html.swp'), 'vim')
    const result = await scanLocalFiles({ source: dir, ignore: [] })
    expect(result.map((f) => f.key)).toEqual(['a.html'])
  })

  test('applies custom ignore patterns on top of always-ignore', async () => {
    await writeFile(join(dir, 'a.html'), 'a')
    await writeFile(join(dir, 'b.log'), 'log')
    await writeFile(join(dir, 'keep.txt'), 't')
    const result = await scanLocalFiles({ source: dir, ignore: ['*.log'] })
    const keys = result.map((f) => f.key).sort()
    expect(keys).toEqual(['a.html', 'keep.txt'])
  })

  test('throws when source directory does not exist', async () => {
    await expect(scanLocalFiles({ source: join(dir, 'missing'), ignore: [] })).rejects.toThrow(
      /source.*directory/i,
    )
  })

  test('result is sorted by key for deterministic plans', async () => {
    await writeFile(join(dir, 'z.html'), 'z')
    await writeFile(join(dir, 'a.html'), 'a')
    await writeFile(join(dir, 'm.html'), 'm')
    const result = await scanLocalFiles({ source: dir, ignore: [] })
    expect(result.map((f) => f.key)).toEqual(['a.html', 'm.html', 'z.html'])
  })

  test('two files with same content produce same hash', async () => {
    await writeFile(join(dir, 'a.html'), 'same')
    await writeFile(join(dir, 'b.html'), 'same')
    const result = await scanLocalFiles({ source: dir, ignore: [] })
    expect(result[0]?.hash).toBe(result[1]?.hash)
  })
})
