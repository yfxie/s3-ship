import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import cac from 'cac'
import { loadConfigFile } from '../config/load.js'
import { validateConfig } from '../config/schema.js'
import { deploy } from '../deploy.js'
import { formatPlan, formatReport } from '../reporter.js'
import { type InitFormat, initConfig } from './init.js'

interface DeployFlags {
  env?: string
  profile?: string
  bucket?: string
  target?: string
  source?: string
  dryRun?: boolean
  syncDelete?: boolean
  invalidate?: boolean
  config?: string
  verbose?: boolean
}

interface InitFlags {
  format?: string
}

function readVersion(): string {
  try {
    const here = dirname(fileURLToPath(import.meta.url))
    const candidates = [join(here, '..', '..', 'package.json'), join(here, '..', 'package.json')]
    for (const c of candidates) {
      try {
        const raw = readFileSync(c, 'utf8')
        const pkg = JSON.parse(raw) as { name?: string; version?: string }
        if (pkg.name === 's3-ship' && pkg.version) return pkg.version
      } catch {}
    }
  } catch {}
  return '0.0.0'
}

export interface RunCliOptions {
  deployFn?: typeof deploy
}

export async function runCli(argv: string[], options: RunCliOptions = {}): Promise<number> {
  const cli = cac('s3-ship')
  const deployFn = options.deployFn ?? deploy

  cli
    .command('deploy', 'Deploy the local source directory to S3')
    .option('--env <name>', 'Environment name from config.environments')
    .option('--profile <name>', 'Override AWS profile')
    .option('--bucket <name>', 'Override target bucket')
    .option('--target <prefix>', 'Override target prefix')
    .option('--source <dir>', 'Override local source directory')
    .option('--dry-run', 'Show plan without executing')
    .option(
      '--sync-delete',
      'Delete remote keys absent locally (bounded to target). Pass --no-sync-delete to disable.',
    )
    .option('--no-invalidate', 'Skip CloudFront invalidation')
    .option('--config <path>', 'Path to config file')
    .option('--verbose', 'Verbose output')
    .action(async (flags: DeployFlags) => {
      const result = await deployFn({
        cwd: process.cwd(),
        envVars: process.env,
        env: flags.env,
        configPath: flags.config,
        profile: flags.profile,
        bucket: flags.bucket,
        target: flags.target,
        source: flags.source,
        dryRun: flags.dryRun,
        syncDelete: flags.syncDelete,
        skipInvalidate: flags.invalidate === false,
      })

      const verbose = flags.verbose === true
      process.stdout.write(formatPlan(result.plan, { verbose }))
      if (result.dryRun) {
        process.stdout.write('\n(dry-run; no changes applied)\n')
        return
      }
      if (result.report) {
        process.stdout.write(`\n${formatReport(result.report, { verbose })}`)
        if (result.report.failures.length > 0) {
          process.exitCode = 2
        }
      }
    })

  cli
    .command('init', 'Create a starter s3-ship config file')
    .option('--format <fmt>', 'Config format: ts | js | mjs | json | yml | yaml', {
      default: 'ts',
    })
    .action(async (flags: InitFlags) => {
      const result = await initConfig({
        cwd: process.cwd(),
        format: (flags.format ?? 'ts') as InitFormat,
      })
      process.stdout.write(`Created ${result.path}\n`)
    })

  cli
    .command('validate', 'Validate the config file without contacting AWS')
    .option('--config <path>', 'Path to config file')
    .action(async (flags: { config?: string }) => {
      const loaded = await loadConfigFile({
        cwd: process.cwd(),
        configPath: flags.config,
      })
      const result = validateConfig(loaded.config)
      if (!result.ok) {
        process.stderr.write(`[config] Invalid config (${loaded.sourcePath}):\n`)
        for (const err of result.errors) {
          process.stderr.write(`  - [${err.path || '<root>'}] ${err.message}\n`)
        }
        process.exitCode = 1
        return
      }
      process.stdout.write(`OK ${loaded.sourcePath}\n`)
    })

  cli.help()
  cli.version(readVersion())

  try {
    cli.parse(argv, { run: false })
    await cli.runMatchedCommand()
    const code = process.exitCode
    return typeof code === 'number' ? code : code ? 1 : 0
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    process.stderr.write(`${message}\n`)
    if (/\[config\]/.test(message)) return 1
    return 2
  }
}
