import type { CloudFrontLike } from '../aws/cloudfront-client.js'
import type { S3Like } from '../aws/s3-client.js'
import { parallelLimit } from '../util/parallel-limit.js'
import type { RetryOptions } from '../util/retry.js'
import { deleteStale } from './delete-stale.js'
import type { PlannedFile, UploadPlan } from './diff.js'
import { invalidateCloudFront } from './invalidate.js'
import { putRedirect } from './redirects.js'
import { uploadFile } from './upload.js'

export interface ExecuteInput {
  plan: UploadPlan
  s3Client: S3Like
  cfClient?: CloudFrontLike
  cacheControlFor: (key: string) => string | undefined
  retry: RetryOptions
  concurrency: number
  skipInvalidate?: boolean
}

export interface ExecutionFailure {
  key: string
  error: unknown
}

export interface ExecutionReport {
  uploaded: number
  updated: number
  skipped: number
  deleted: number
  redirected: number
  invalidationId?: string
  failures: ExecutionFailure[]
}

async function runUploads(
  files: PlannedFile[],
  input: ExecuteInput,
): Promise<{ ok: number; failures: ExecutionFailure[] }> {
  const results = await parallelLimit(files, input.concurrency, (file) =>
    uploadFile({
      client: input.s3Client,
      bucket: input.plan.bucket,
      file,
      cacheControlFor: input.cacheControlFor,
      retry: input.retry,
    }),
  )
  const ok = results.filter((r) => r.ok).length
  const failures = results
    .filter((r): r is { ok: false; error: unknown; item: PlannedFile } => !r.ok)
    .map((r) => ({ key: r.item.key, error: r.error }))
  return { ok, failures }
}

export async function executePlan(input: ExecuteInput): Promise<ExecutionReport> {
  const failures: ExecutionFailure[] = []

  const uploadResult = await runUploads(input.plan.toUpload, input)
  failures.push(...uploadResult.failures)

  const updateResult = await runUploads(input.plan.toUpdate, input)
  failures.push(...updateResult.failures)

  const redirectResults = await parallelLimit(input.plan.redirects, input.concurrency, (redirect) =>
    putRedirect({
      client: input.s3Client,
      bucket: input.plan.bucket,
      redirect,
      retry: input.retry,
    }),
  )
  const redirected = redirectResults.filter((r) => r.ok).length
  for (const r of redirectResults) {
    if (!r.ok) {
      failures.push({ key: r.item.fullKey, error: r.error })
    }
  }

  let deleted = 0
  if (input.plan.toDelete.length > 0) {
    try {
      await deleteStale({
        client: input.s3Client,
        bucket: input.plan.bucket,
        keys: input.plan.toDelete,
        retry: input.retry,
      })
      deleted = input.plan.toDelete.length
    } catch (error) {
      failures.push({ key: '<delete-batch>', error })
    }
  }

  let invalidationId: string | undefined
  if (!input.skipInvalidate && input.plan.cloudfront && input.cfClient) {
    try {
      invalidationId = await invalidateCloudFront({
        client: input.cfClient,
        distributionId: input.plan.cloudfront.distributionId,
        paths: input.plan.cloudfront.invalidationPaths,
      })
    } catch (error) {
      failures.push({ key: '<cloudfront-invalidation>', error })
    }
  }

  return {
    uploaded: uploadResult.ok,
    updated: updateResult.ok,
    skipped: input.plan.toSkip.length,
    deleted,
    redirected,
    invalidationId,
    failures,
  }
}
