import { createHash } from 'node:crypto'
import { existsSync, statSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { sep } from 'node:path'
import { glob } from 'tinyglobby'

export interface ScanInput {
  source: string
  ignore: string[]
}

export interface LocalFile {
  key: string
  localPath: string
  size: number
  hash: string
}

const ALWAYS_IGNORE = ['**/.DS_Store', '**/Thumbs.db', '**/.git/**', '**/*.swp'] as const

export async function scanLocalFiles(input: ScanInput): Promise<LocalFile[]> {
  if (!existsSync(input.source) || !statSync(input.source).isDirectory()) {
    throw new Error(`[scan] source directory does not exist: ${input.source}`)
  }

  const ignore = [...ALWAYS_IGNORE, ...input.ignore]

  const paths = await glob(['**/*'], {
    cwd: input.source,
    dot: true,
    onlyFiles: true,
    ignore,
    absolute: true,
  })

  const files: LocalFile[] = await Promise.all(
    paths.map(async (absPath) => {
      const buf = await readFile(absPath)
      const hash = createHash('md5').update(buf).digest('hex')
      const rel = absPath.slice(input.source.length).replace(/^[\\/]/, '')
      const key = rel.split(sep).join('/')
      return { key, localPath: absPath, size: buf.byteLength, hash }
    }),
  )

  files.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
  return files
}
