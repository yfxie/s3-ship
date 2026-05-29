import { z } from 'zod'

export const redirectRuleSchema = z.object({
  from: z.string().min(1, 'redirect.from is required'),
  to: z.string().min(1, 'redirect.to is required'),
  statusCode: z.union([z.literal(301), z.literal(302)]).optional(),
})

export const cacheRuleSchema = z.object({
  match: z.string().min(1),
  cacheControl: z.string().min(1),
})

export const cloudfrontConfigSchema = z.object({
  distributionId: z.string().min(1, 'cloudfront.distributionId is required'),
  invalidationPaths: z.array(z.string().min(1)).optional(),
})

const baseConfigShape = {
  source: z.string().min(1).optional(),
  target: z.string().optional(),
  bucket: z.string().min(1).optional(),
  region: z.string().min(1).optional(),
  profile: z.string().min(1).optional(),
  cloudfront: cloudfrontConfigSchema.optional(),
  syncDelete: z.boolean().optional(),
  ignore: z.array(z.string()).optional(),
  redirects: z.array(redirectRuleSchema).optional(),
  cacheControl: z.array(cacheRuleSchema).optional(),
}

export const environmentConfigSchema = z.object(baseConfigShape).strict()

export const configSchema = z
  .object({
    ...baseConfigShape,
    environments: z.record(z.string().min(1), environmentConfigSchema).optional(),
  })
  .strict()

export type Config = z.infer<typeof configSchema>
export type EnvironmentConfig = z.infer<typeof environmentConfigSchema>
export type RedirectRule = z.infer<typeof redirectRuleSchema>
export type CacheRule = z.infer<typeof cacheRuleSchema>
export type CloudFrontConfig = z.infer<typeof cloudfrontConfigSchema>

export interface ConfigError {
  path: string
  message: string
}

export type ValidationResult = { ok: true; value: Config } | { ok: false; errors: ConfigError[] }

function zodIssuesToErrors(issues: z.ZodIssue[]): ConfigError[] {
  return issues.map((issue) => ({
    path: issue.path.join('.'),
    message: issue.message,
  }))
}

export function validateConfig(input: unknown): ValidationResult {
  const parsed = configSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, errors: zodIssuesToErrors(parsed.error.issues) }
  }

  const value = parsed.data
  const errors: ConfigError[] = []

  const envs = value.environments ?? {}
  const envEntries = Object.entries(envs)

  const topHasBucket = typeof value.bucket === 'string' && value.bucket.length > 0
  if (!topHasBucket) {
    if (envEntries.length === 0) {
      errors.push({
        path: 'bucket',
        message: 'bucket is required at the top level or inside every environment',
      })
    } else {
      for (const [name, env] of envEntries) {
        const envHasBucket = typeof env.bucket === 'string' && env.bucket.length > 0
        if (!envHasBucket) {
          errors.push({
            path: `environments.${name}.bucket`,
            message: `bucket is required in environment "${name}" because no top-level bucket is set`,
          })
        }
      }
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors }
  }
  return { ok: true, value }
}
