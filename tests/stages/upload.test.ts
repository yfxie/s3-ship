import { describe, expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { PutObjectCommand } from '@aws-sdk/client-s3'
import type { S3Like } from '../../src/aws/s3-client.js'
import { uploadFile } from '../../src/stages/upload.js'

function makeClient(behavior: (callCount: number) => unknown | Promise<unknown>): {
  client: S3Like
  callCount: () => number
  lastCommand: () => PutObjectCommand | undefined
} {
  let count = 0
  let last: PutObjectCommand | undefined
  return {
    client: {
      async send(command: unknown) {
        last = command as PutObjectCommand
        count++
        const result = await behavior(count)
        return result
      },
    },
    callCount: () => count,
    lastCommand: () => last,
  }
}

describe('uploadFile', () => {
  test('issues PutObjectCommand with bucket, key, body', async () => {
    const dir = await mkdtemp(join(tmpdir(), 's3ship-upload-'))
    const path = join(dir, 'index.html')
    await writeFile(path, '<html></html>')
    const { client, lastCommand } = makeClient(() => ({}))
    await uploadFile({
      client,
      bucket: 'b',
      file: { key: 'index.html', localPath: path, hash: 'h', size: 13 },
      cacheControlFor: () => undefined,
      retry: { attempts: 1, baseMs: 1 },
    })
    const cmd = lastCommand()!
    expect(cmd.input.Bucket).toBe('b')
    expect(cmd.input.Key).toBe('index.html')
    expect(cmd.input.Body).toBeDefined()
    await rm(dir, { recursive: true, force: true })
  })

  test('infers ContentType for .html', async () => {
    const dir = await mkdtemp(join(tmpdir(), 's3ship-upload-'))
    const path = join(dir, 'a.html')
    await writeFile(path, 'x')
    const { client, lastCommand } = makeClient(() => ({}))
    await uploadFile({
      client,
      bucket: 'b',
      file: { key: 'a.html', localPath: path, hash: 'h', size: 1 },
      cacheControlFor: () => undefined,
      retry: { attempts: 1, baseMs: 1 },
    })
    expect(lastCommand()?.input.ContentType).toContain('text/html')
    await rm(dir, { recursive: true, force: true })
  })

  test('infers ContentType for .css, .js, .json, .svg, .png', async () => {
    const dir = await mkdtemp(join(tmpdir(), 's3ship-upload-'))
    const cases = [
      ['styles.css', 'text/css'],
      ['app.js', 'application/javascript'],
      ['data.json', 'application/json'],
      ['icon.svg', 'image/svg+xml'],
      ['img.png', 'image/png'],
    ]
    for (const [name, expected] of cases) {
      const path = join(dir, name!)
      await writeFile(path, 'x')
      const { client, lastCommand } = makeClient(() => ({}))
      await uploadFile({
        client,
        bucket: 'b',
        file: { key: name!, localPath: path, hash: 'h', size: 1 },
        cacheControlFor: () => undefined,
        retry: { attempts: 1, baseMs: 1 },
      })
      expect(lastCommand()?.input.ContentType).toContain(expected!)
    }
    await rm(dir, { recursive: true, force: true })
  })

  test('sets ChecksumAlgorithm to avoid SDK chunked-streaming warning', async () => {
    const dir = await mkdtemp(join(tmpdir(), 's3ship-upload-'))
    const path = join(dir, 'a.html')
    await writeFile(path, 'x')
    const { client, lastCommand } = makeClient(() => ({}))
    await uploadFile({
      client,
      bucket: 'b',
      file: { key: 'a.html', localPath: path, hash: 'h', size: 1 },
      cacheControlFor: () => undefined,
      retry: { attempts: 1, baseMs: 1 },
    })
    expect(lastCommand()?.input.ChecksumAlgorithm).toBe('CRC32')
    await rm(dir, { recursive: true, force: true })
  })

  test('falls back to application/octet-stream for unknown extension', async () => {
    const dir = await mkdtemp(join(tmpdir(), 's3ship-upload-'))
    const path = join(dir, 'data.xyz')
    await writeFile(path, 'x')
    const { client, lastCommand } = makeClient(() => ({}))
    await uploadFile({
      client,
      bucket: 'b',
      file: { key: 'data.xyz', localPath: path, hash: 'h', size: 1 },
      cacheControlFor: () => undefined,
      retry: { attempts: 1, baseMs: 1 },
    })
    expect(lastCommand()?.input.ContentType).toBe('application/octet-stream')
    await rm(dir, { recursive: true, force: true })
  })

  test('applies CacheControl when provided by callback', async () => {
    const dir = await mkdtemp(join(tmpdir(), 's3ship-upload-'))
    const path = join(dir, 'a.css')
    await writeFile(path, 'x')
    const { client, lastCommand } = makeClient(() => ({}))
    await uploadFile({
      client,
      bucket: 'b',
      file: { key: 'a.css', localPath: path, hash: 'h', size: 1 },
      cacheControlFor: (key) => (key.endsWith('.css') ? 'max-age=31536000' : undefined),
      retry: { attempts: 1, baseMs: 1 },
    })
    expect(lastCommand()?.input.CacheControl).toBe('max-age=31536000')
    await rm(dir, { recursive: true, force: true })
  })

  test('retries on failure, succeeds on second attempt', async () => {
    const dir = await mkdtemp(join(tmpdir(), 's3ship-upload-'))
    const path = join(dir, 'a.html')
    await writeFile(path, 'x')
    const { client, callCount } = makeClient((n) => {
      if (n === 1) throw new Error('network blip')
      return {}
    })
    await uploadFile({
      client,
      bucket: 'b',
      file: { key: 'a.html', localPath: path, hash: 'h', size: 1 },
      cacheControlFor: () => undefined,
      retry: { attempts: 3, baseMs: 1 },
    })
    expect(callCount()).toBe(2)
    await rm(dir, { recursive: true, force: true })
  })

  test('throws after exhausting retries', async () => {
    const dir = await mkdtemp(join(tmpdir(), 's3ship-upload-'))
    const path = join(dir, 'a.html')
    await writeFile(path, 'x')
    const { client, callCount } = makeClient(() => {
      throw new Error('always fail')
    })
    await expect(
      uploadFile({
        client,
        bucket: 'b',
        file: { key: 'a.html', localPath: path, hash: 'h', size: 1 },
        cacheControlFor: () => undefined,
        retry: { attempts: 3, baseMs: 1 },
      }),
    ).rejects.toThrow(/always fail/)
    expect(callCount()).toBe(3)
    await rm(dir, { recursive: true, force: true })
  })
})
