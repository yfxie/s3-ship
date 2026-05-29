import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { extname, isAbsolute, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import YAML from 'yaml'

export interface LoadOptions {
  cwd: string
  configPath?: string
}

export interface LoadResult {
  config: Record<string, unknown>
  sourcePath: string
}

const SEARCH_ORDER = [
  's3-ship.config.ts',
  's3-ship.config.js',
  's3-ship.config.mjs',
  's3-ship.config.cjs',
  's3-ship.config.json',
  's3-ship.config.yml',
  's3-ship.config.yaml',
] as const

export async function loadConfigFile(options: LoadOptions): Promise<LoadResult> {
  const sourcePath = options.configPath
    ? resolveExplicitPath(options.configPath, options.cwd)
    : findConfigInCwd(options.cwd)

  if (!sourcePath) {
    throw new Error(
      `[config] No s3-ship config file found in ${options.cwd}. Expected one of: ${SEARCH_ORDER.join(', ')}`,
    )
  }

  const config = await readByExtension(sourcePath)
  return { config, sourcePath }
}

function resolveExplicitPath(configPath: string, cwd: string): string {
  const abs = isAbsolute(configPath) ? configPath : resolve(cwd, configPath)
  if (!existsSync(abs)) {
    throw new Error(`[config] Config file not found: ${abs}`)
  }
  return abs
}

function findConfigInCwd(cwd: string): string | undefined {
  for (const name of SEARCH_ORDER) {
    const candidate = resolve(cwd, name)
    if (existsSync(candidate)) {
      return candidate
    }
  }
  return undefined
}

async function readByExtension(path: string): Promise<Record<string, unknown>> {
  const ext = extname(path).toLowerCase()
  switch (ext) {
    case '.json':
      return parseJson(path)
    case '.yml':
    case '.yaml':
      return parseYaml(path)
    case '.ts':
    case '.js':
    case '.mjs':
    case '.cjs':
      return importModule(path)
    default:
      throw new Error(`[config] Unsupported config file extension: ${ext}`)
  }
}

async function parseJson(path: string): Promise<Record<string, unknown>> {
  const raw = await readFile(path, 'utf8')
  try {
    return JSON.parse(raw)
  } catch (err) {
    throw new Error(`[config] Failed to parse JSON config at ${path}: ${(err as Error).message}`)
  }
}

async function parseYaml(path: string): Promise<Record<string, unknown>> {
  const raw = await readFile(path, 'utf8')
  try {
    const data = YAML.parse(raw)
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw new Error('YAML root must be a mapping')
    }
    return data as Record<string, unknown>
  } catch (err) {
    throw new Error(`[config] Failed to parse YAML config at ${path}: ${(err as Error).message}`)
  }
}

async function importModule(path: string): Promise<Record<string, unknown>> {
  const url = `${pathToFileURL(path).href}?t=${Date.now()}`
  const mod = (await import(url)) as { default?: unknown }
  if (mod.default == null) {
    throw new Error(
      `[config] ${path} has no default export. Add: export default { ... } or module.exports = { ... }`,
    )
  }
  if (typeof mod.default !== 'object' || Array.isArray(mod.default)) {
    throw new Error(`[config] ${path} default export must be a config object.`)
  }
  return mod.default as Record<string, unknown>
}
