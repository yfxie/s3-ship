export { defineConfig } from './config/define.js'
export { deploy } from './deploy.js'
export type { DeployOptions, DeployResult } from './deploy.js'
export type { ResolvedConfig } from './config/merge.js'
export type {
  Config,
  EnvironmentConfig,
  RedirectRule,
  CacheRule,
  CloudFrontConfig,
} from './config/schema.js'
export type { UploadPlan } from './stages/diff.js'
export type { ExecutionReport } from './stages/execute.js'
