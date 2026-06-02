import { PutObjectCommand } from '@aws-sdk/client-s3'
import type { S3Like } from '../aws/s3-client.js'
import { type RetryOptions, withRetry } from '../util/retry.js'
import type { PlannedRedirect } from './diff.js'

export interface PutRedirectInput {
  client: S3Like
  bucket: string
  redirect: PlannedRedirect
  retry: RetryOptions
}

export async function putRedirect(input: PutRedirectInput): Promise<void> {
  const command = new PutObjectCommand({
    Bucket: input.bucket,
    Key: input.redirect.fullKey,
    ContentType: 'text/html; charset=utf-8',
    WebsiteRedirectLocation: input.redirect.to,
  })
  await withRetry(() => input.client.send(command), input.retry)
}
