import type { UploadPlan } from './stages/diff.js'
import type { ExecutionReport } from './stages/execute.js'

const MAX_LISTED = 20

export interface ReportOptions {
  verbose?: boolean
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(2)} MB`
}

function totalSize(files: Array<{ size: number }>): number {
  return files.reduce((acc, f) => acc + f.size, 0)
}

function listSection(label: string, items: string[], verbose: boolean): string {
  if (items.length === 0) return ''
  const limit = verbose ? items.length : MAX_LISTED
  const shown = items.slice(0, limit)
  const overflow = items.length - shown.length
  const lines = [`  ${label}:`, ...shown.map((k) => `    + ${k}`)]
  if (overflow > 0) lines.push(`    … and ${overflow} more`)
  return `${lines.join('\n')}\n`
}

function fileLine(f: { key: string; size: number }, verbose: boolean): string {
  return verbose ? `${f.key}  (${formatBytes(f.size)})` : f.key
}

export function formatPlan(plan: UploadPlan, options: ReportOptions = {}): string {
  const verbose = options.verbose === true
  const total =
    plan.toUpload.length + plan.toUpdate.length + plan.toDelete.length + plan.redirects.length

  const lines: string[] = []
  const targetLabel = plan.target || '(bucket root)'
  lines.push(`Plan for s3://${plan.bucket}/${plan.target ? plan.target : ''}`)
  lines.push(`  target: ${targetLabel}`)

  if (total === 0 && plan.toSkip.length === 0) {
    lines.push('  no changes')
  } else if (total === 0) {
    lines.push(`  no changes (${plan.toSkip.length} files already in sync)`)
  } else {
    lines.push(`  upload: ${plan.toUpload.length} (${formatBytes(totalSize(plan.toUpload))})`)
    lines.push(`  update: ${plan.toUpdate.length} (${formatBytes(totalSize(plan.toUpdate))})`)
    lines.push(`  skip:   ${plan.toSkip.length}`)
    lines.push(`  delete: ${plan.toDelete.length}`)
    lines.push(`  redirect: ${plan.redirects.length}`)
  }

  if (plan.cloudfront) {
    lines.push(
      `  cloudfront: ${plan.cloudfront.distributionId} (${plan.cloudfront.invalidationPaths.join(', ')})`,
    )
  }

  let out = `${lines.join('\n')}\n`
  out += listSection(
    'upload',
    plan.toUpload.map((f) => fileLine(f, verbose)),
    verbose,
  )
  out += listSection(
    'update',
    plan.toUpdate.map((f) => fileLine(f, verbose)),
    verbose,
  )
  out += listSection('delete', plan.toDelete, verbose)
  out += listSection(
    'redirect',
    plan.redirects.map((r) => `${r.fullKey} -> ${r.to}`),
    verbose,
  )
  if (verbose) {
    out += listSection(
      'skip',
      plan.toSkip.map((f) => f.key),
      verbose,
    )
  }
  return out
}

export function formatReport(report: ExecutionReport, options: ReportOptions = {}): string {
  const verbose = options.verbose === true
  const lines: string[] = ['Deploy complete']
  lines.push(`  uploaded: ${report.uploaded}`)
  lines.push(`  updated:  ${report.updated}`)
  lines.push(`  skipped:  ${report.skipped}`)
  lines.push(`  deleted:  ${report.deleted}`)
  lines.push(`  redirected: ${report.redirected}`)
  if (report.invalidationId) {
    lines.push(`  invalidation: ${report.invalidationId}`)
  }
  if (report.failures.length > 0) {
    lines.push(`  failures: ${report.failures.length}`)
    const limit = verbose ? report.failures.length : MAX_LISTED
    for (const f of report.failures.slice(0, limit)) {
      const msg = f.error instanceof Error ? f.error.message : String(f.error)
      lines.push(`    ! ${f.key}: ${msg}`)
    }
    if (report.failures.length > limit) {
      lines.push(`    … and ${report.failures.length - limit} more`)
    }
  }
  return `${lines.join('\n')}\n`
}
