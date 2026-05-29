# s3-ship

[![npm version](https://img.shields.io/npm/v/s3-ship.svg)](https://www.npmjs.com/package/s3-ship)
[![npm downloads](https://img.shields.io/npm/dm/s3-ship.svg)](https://www.npmjs.com/package/s3-ship)
[![CI](https://github.com/yfxie/s3-ship/actions/workflows/ci.yml/badge.svg)](https://github.com/yfxie/s3-ship/actions/workflows/ci.yml)
[![codecov](https://codecov.io/gh/yfxie/s3-ship/branch/main/graph/badge.svg)](https://codecov.io/gh/yfxie/s3-ship)
[![License](https://img.shields.io/npm/l/s3-ship.svg)](https://github.com/yfxie/s3-ship/blob/main/LICENSE)
[![Types](https://img.shields.io/npm/types/s3-ship.svg)](https://www.npmjs.com/package/s3-ship)
[![Built with Bun](https://img.shields.io/badge/built%20with-Bun-fbf0df)](https://bun.sh)

Deploy a directory of static files to AWS S3 with redirects, CloudFront invalidation, and multi-environment support — in a single command.

```sh
npm install -g s3-ship
s3-ship init
# edit s3-ship.config.ts
s3-ship deploy
```

## Features

- **One-shot deploy** — scan local files, diff against S3 (by MD5/ETag), upload only what changed
- **Redirects** — bulk-define `WebsiteRedirectLocation` redirect objects in config
- **CloudFront invalidation** — automatically clear edge caches after upload
- **Multi-environment** — separate buckets/distributions per `staging` / `production`
- **AWS profile and env-var support** — works with your existing AWS credentials
- **Dry-run** — preview every action before any network write
- **Sync-delete (opt-in)** — remove S3 keys no longer present locally, **bounded to your target prefix**
- **Smart ignore** — `.DS_Store`, `Thumbs.db`, `.git/`, `*.swp` are always excluded
- **Multiple config formats** — auto-detects `.ts`, `.js`, `.mjs`, `.cjs`, `.json`, `.yml`, `.yaml`
- **Fail-fast validation** — config errors are reported all at once before any AWS call

## Install

```sh
# global
npm install -g s3-ship

# or per-project
npm install --save-dev s3-ship
```

Requires Node.js 18+.

## Quickstart

1. Create a config file in your project root:

```sh
s3-ship init                    # writes s3-ship.config.ts
s3-ship init --format json      # or json / yml / js / mjs
```

2. Edit the file:

```ts
import { defineConfig } from 's3-ship'

export default defineConfig({
  source: 'dist',
  bucket: 'my-website-bucket',
  region: 'us-east-1',
  cloudfront: { distributionId: 'EABCDEF12345' },
})
```

3. Preview, then deploy:

```sh
s3-ship deploy --dry-run
s3-ship deploy
```

## Configuration

Top-level options:

| Option | Type | Default | Description |
|---|---|---|---|
| `source` | `string` | `'dist'` | Local directory to upload |
| `target` | `string` | `''` | Target prefix in the bucket. All list/delete operations are bounded to this prefix |
| `bucket` | `string` | — | S3 bucket name (required at top level or per environment) |
| `region` | `string` | — | AWS region. Falls back to `AWS_REGION` env var |
| `profile` | `string` | — | AWS profile name. Falls back to `AWS_PROFILE` env var |
| `cloudfront` | `object` | — | `{ distributionId: string, invalidationPaths?: string[] }`. Default paths `['/*']` |
| `syncDelete` | `boolean` | `false` | Delete remote keys not present locally (bounded to `target`) |
| `ignore` | `string[]` | `[]` | Additional glob patterns to ignore on top of the always-ignored set |
| `redirects` | `RedirectRule[]` | `[]` | See [Redirects](#redirects) below |
| `cacheControl` | `CacheRule[]` | `[]` | Per-glob `Cache-Control` headers, e.g. `[{ match: 'assets/**', cacheControl: 'public, max-age=31536000, immutable' }]` |
| `environments` | `Record<string, Partial<Config>>` | — | Named overrides; activated with `--env <name>` |

### Multi-environment

```ts
export default defineConfig({
  source: 'dist',
  cloudfront: { invalidationPaths: ['/*'] }, // shared
  environments: {
    staging: {
      bucket: 'staging.example.com',
      cloudfront: { distributionId: 'ESTAGE' },
    },
    production: {
      bucket: 'www.example.com',
      cloudfront: { distributionId: 'EPROD' },
    },
  },
})
```

```sh
s3-ship deploy --env staging
s3-ship deploy --env production
```

Precedence (high → low): **CLI flags > environment vars (`AWS_*`) > `environments.<name>` > top-level > built-in defaults**.

### Redirects

S3 supports per-object 301 redirects via `WebsiteRedirectLocation`. Each rule creates a 0-byte object whose only purpose is to redirect.

```ts
redirects: [
  { from: 'blog/old-post', to: '/blog/new-post' },
  { from: 'legacy.html', to: 'https://example.com', statusCode: 302 },
]
```

- `from` is automatically prefixed by `target` if set.
- If `from` collides with a real source file at the same key, the redirect wins — the source file is silently dropped from the upload plan.
- Redirects are excluded from `syncDelete`.

### Target prefix and sync-delete safety

If `target = 'docs/v2'`, **every** S3 list and delete operation is bounded to `Prefix='docs/v2/'`. `syncDelete` will never touch a key outside this prefix, even if it's not in your local source.

If `target` is empty (the bucket root), `syncDelete` operates on the whole bucket. Use with care.

## CLI

```
s3-ship deploy [options]
  --env <name>           Use environments.<name> from config
  --profile <name>       Override AWS profile
  --bucket <name>        Override target bucket
  --target <prefix>      Override target prefix
  --source <dir>         Override local source directory
  --dry-run              Print plan, exit without uploading
  --sync-delete          Enable sync-delete (overrides config)
  --no-sync-delete       Disable sync-delete (overrides config)
  --no-invalidate        Skip CloudFront invalidation
  --config <path>        Path to config file
  --verbose              List every file (uploads, updates, deletes, skipped, redirects, failures) without the default 20-item truncation

s3-ship init [--format ts|js|mjs|json|yml|yaml]
  Create a starter config file (default: ts)

s3-ship validate [--config <path>]
  Validate the config file without contacting AWS
```

Exit codes: `0` success — `1` config error — `2` AWS / upload failure.

## Programmatic API

```ts
import { deploy } from 's3-ship'

const result = await deploy({
  cwd: process.cwd(),
  envVars: process.env,
  env: 'production',
  dryRun: true,
})
console.log(result.plan)
```

`deploy()` returns `{ plan, report?, resolvedConfig, dryRun, configPath }`.

## Development

```sh
bun install
bun test                   # run tests
bun test --watch           # watch mode
bun run test:coverage      # generate coverage report (text + lcov)
bun run typecheck
bun run lint
bun run build              # produces dist/
```

Coverage output is written to `coverage/lcov.info` for upload to Codecov in CI.

## License

MIT
