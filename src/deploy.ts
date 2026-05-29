import type { CloudFrontClient } from '@aws-sdk/client-cloudfront'
import type { S3Client } from '@aws-sdk/client-s3'
import type { CloudFrontClientOptions, CloudFrontLike } from './aws/cloudfront-client.js'
import { createCloudFrontClient } from './aws/cloudfront-client.js'
import type { S3ClientOptions, S3Like } from './aws/s3-client.js'
import { createS3Client } from './aws/s3-client.js'
import { loadConfigFile } from './config/load.js'
import { type ResolvedConfig, resolveConfig } from './config/merge.js'
import { validateConfig } from './config/schema.js'
import { type UploadPlan, computeDiff } from './stages/diff.js'
import { type ExecutionReport, executePlan } from './stages/execute.js'
import { listRemoteFiles } from './stages/list-remote.js'
import { scanLocalFiles } from './stages/scan.js'
import { matchGlob } from './util/glob-match.js'

export interface DeployOptions {
  cwd: string
  envVars: Record<string, string | undefined>
  env?: string
  configPath?: string
  profile?: string
  bucket?: string
  target?: string
  source?: string
  syncDelete?: boolean
  dryRun?: boolean
  skipInvalidate?: boolean
  concurrency?: number
  s3ClientFactory?: (opts: S3ClientOptions) => S3Like | S3Client
  cfClientFactory?: (opts: CloudFrontClientOptions) => CloudFrontLike | CloudFrontClient
}

export interface DeployResult {
  resolvedConfig: ResolvedConfig
  plan: UploadPlan
  report?: ExecutionReport
  dryRun: boolean
  configPath: string
}

const DEFAULT_RETRY = { attempts: 3, baseMs: 200 }
const DEFAULT_CONCURRENCY = 10

export async function deploy(options: DeployOptions): Promise<DeployResult> {
  const loaded = await loadConfigFile({ cwd: options.cwd, configPath: options.configPath })
  const validation = validateConfig(loaded.config)
  if (!validation.ok) {
    const summary = validation.errors
      .map((e) => `  - [${e.path || '<root>'}] ${e.message}`)
      .join('\n')
    throw new Error(`[config] Invalid config (${loaded.sourcePath}):\n${summary}`)
  }

  const resolvedConfig = resolveConfig(validation.value, {
    env: options.env,
    profile: options.profile,
    bucket: options.bucket,
    target: options.target,
    source: options.source,
    syncDelete: options.syncDelete,
    envVars: options.envVars,
  })

  const s3Factory = options.s3ClientFactory ?? createS3Client
  const cfFactory = options.cfClientFactory ?? createCloudFrontClient

  const s3Client = s3Factory({
    region: resolvedConfig.region,
    profile: resolvedConfig.profile,
  }) as S3Like
  const cfClient = resolvedConfig.cloudfront
    ? (cfFactory({
        region: resolvedConfig.region,
        profile: resolvedConfig.profile,
      }) as CloudFrontLike)
    : undefined

  const sourcePath = resolveSourcePath(options.cwd, resolvedConfig.source)

  const [localFiles, remoteObjects] = await Promise.all([
    scanLocalFiles({ source: sourcePath, ignore: resolvedConfig.ignore }),
    listRemoteFiles({
      client: s3Client,
      bucket: resolvedConfig.bucket,
      target: resolvedConfig.target,
    }),
  ])

  const plan = computeDiff({
    bucket: resolvedConfig.bucket,
    target: resolvedConfig.target,
    localFiles,
    remoteObjects,
    redirects: resolvedConfig.redirects,
    syncDelete: resolvedConfig.syncDelete,
    cloudfront: resolvedConfig.cloudfront,
  })

  if (options.dryRun) {
    return { resolvedConfig, plan, dryRun: true, configPath: loaded.sourcePath }
  }

  const cacheControlFor = buildCacheControlMatcher(resolvedConfig.cacheControl)
  const report = await executePlan({
    plan,
    s3Client,
    cfClient,
    cacheControlFor,
    retry: DEFAULT_RETRY,
    concurrency: options.concurrency ?? DEFAULT_CONCURRENCY,
    skipInvalidate: options.skipInvalidate,
  })

  return { resolvedConfig, plan, report, dryRun: false, configPath: loaded.sourcePath }
}

function resolveSourcePath(cwd: string, source: string): string {
  if (source.startsWith('/')) return source
  return `${cwd}/${source}`
}

function buildCacheControlMatcher(
  rules: Array<{ match: string; cacheControl: string }>,
): (key: string) => string | undefined {
  if (rules.length === 0) return () => undefined
  return (key: string) => {
    for (const rule of rules) {
      if (matchGlob(key, rule.match)) return rule.cacheControl
    }
    return undefined
  }
}
