import type { CacheRule, Config, EnvironmentConfig, RedirectRule } from './schema.js'

export interface CliOverrides {
  env?: string
  profile?: string
  bucket?: string
  target?: string
  source?: string
  syncDelete?: boolean
  envVars?: Record<string, string | undefined>
}

export interface ResolvedConfig {
  source: string
  target: string
  bucket: string
  region: string | undefined
  profile: string | undefined
  cloudfront: { distributionId: string; invalidationPaths: string[] } | undefined
  syncDelete: boolean
  ignore: string[]
  redirects: RedirectRule[]
  cacheControl: CacheRule[]
  environment: string | undefined
}

const DEFAULTS = {
  source: 'dist',
  target: '',
  syncDelete: false,
  invalidationPaths: ['/*'],
}

function pickEnvironment(
  config: Config,
  envName: string | undefined,
): EnvironmentConfig | undefined {
  if (!envName) return undefined
  const env = config.environments?.[envName]
  if (!env) {
    const available = Object.keys(config.environments ?? {}).join(', ') || '(none)'
    throw new Error(
      `[config] environment "${envName}" not found. Available environments: ${available}`,
    )
  }
  return env
}

export function resolveConfig(config: Config, overrides: CliOverrides): ResolvedConfig {
  const env = pickEnvironment(config, overrides.env)
  const envVars = overrides.envVars ?? {}

  const layered: Partial<Config> = {
    ...config,
    ...(env ?? {}),
  }

  if (env?.cloudfront || config.cloudfront) {
    layered.cloudfront = {
      ...(config.cloudfront ?? {}),
      ...(env?.cloudfront ?? {}),
    } as Config['cloudfront']
  }

  const bucket = overrides.bucket ?? layered.bucket
  if (!bucket) {
    throw new Error('[config] bucket is required (top-level, environment, or --bucket flag)')
  }

  const region = layered.region ?? envVars.AWS_REGION
  const profile = overrides.profile ?? layered.profile ?? envVars.AWS_PROFILE

  const cloudfront = layered.cloudfront
    ? {
        distributionId: layered.cloudfront.distributionId,
        invalidationPaths: layered.cloudfront.invalidationPaths ?? DEFAULTS.invalidationPaths,
      }
    : undefined

  const syncDelete = overrides.syncDelete ?? layered.syncDelete ?? DEFAULTS.syncDelete

  return {
    source: overrides.source ?? layered.source ?? DEFAULTS.source,
    target: overrides.target ?? layered.target ?? DEFAULTS.target,
    bucket,
    region,
    profile,
    cloudfront,
    syncDelete,
    ignore: layered.ignore ?? [],
    redirects: layered.redirects ?? [],
    cacheControl: layered.cacheControl ?? [],
    environment: overrides.env,
  }
}
