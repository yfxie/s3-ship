import { existsSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export type InitFormat = 'js' | 'ts' | 'mjs' | 'json' | 'yml' | 'yaml'

export interface InitOptions {
  cwd: string
  format?: InitFormat
}

export interface InitResult {
  path: string
  format: InitFormat
}

const TEMPLATES: Record<InitFormat, { filename: string; content: string }> = {
  ts: {
    filename: 's3-ship.config.ts',
    content: `import { defineConfig } from 's3-ship'

export default defineConfig({
  source: 'dist',
  bucket: 'my-bucket-name',
  region: 'us-east-1',

  // Uncomment to invalidate CloudFront after every deploy
  // cloudfront: { distributionId: 'EXXXXXXX' },

  // Uncomment to delete S3 keys not present locally (bounded to target prefix)
  // syncDelete: true,

  // redirects: [
  //   { from: 'old.html', to: '/new.html' },
  // ],

  // cacheControl: [
  //   { match: 'assets/**', cacheControl: 'public, max-age=31536000, immutable' },
  //   { match: '*.html', cacheControl: 'public, max-age=0, must-revalidate' },
  // ],

  // environments: {
  //   production: { bucket: 'prod-bucket', cloudfront: { distributionId: 'EPROD' } },
  //   staging:    { bucket: 'staging-bucket' },
  // },
})
`,
  },
  js: {
    filename: 's3-ship.config.js',
    content: `/** @type {import('s3-ship').Config} */
export default {
  source: 'dist',
  bucket: 'my-bucket-name',
  region: 'us-east-1',
}
`,
  },
  mjs: {
    filename: 's3-ship.config.mjs',
    content: `/** @type {import('s3-ship').Config} */
export default {
  source: 'dist',
  bucket: 'my-bucket-name',
  region: 'us-east-1',
}
`,
  },
  json: {
    filename: 's3-ship.config.json',
    content: `${JSON.stringify(
      {
        source: 'dist',
        bucket: 'my-bucket-name',
        region: 'us-east-1',
      },
      null,
      2,
    )}\n`,
  },
  yml: {
    filename: 's3-ship.config.yml',
    content: `source: dist
bucket: my-bucket-name
region: us-east-1
# cloudfront:
#   distributionId: EXXXXXXX
# syncDelete: true
# redirects:
#   - { from: old.html, to: /new.html }
# environments:
#   production:
#     bucket: prod-bucket
#   staging:
#     bucket: staging-bucket
`,
  },
  yaml: {
    filename: 's3-ship.config.yaml',
    content: `source: dist
bucket: my-bucket-name
region: us-east-1
`,
  },
}

export async function initConfig(options: InitOptions): Promise<InitResult> {
  const format = (options.format ?? 'ts') as InitFormat
  const template = TEMPLATES[format]
  if (!template) {
    throw new Error(
      `[init] Unsupported format "${format}". Use one of: ${Object.keys(TEMPLATES).join(', ')}`,
    )
  }
  const path = join(options.cwd, template.filename)
  if (existsSync(path)) {
    throw new Error(`[init] ${template.filename} already exists at ${path}`)
  }
  await writeFile(path, template.content, 'utf8')
  return { path, format }
}
