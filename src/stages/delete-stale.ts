import { DeleteObjectsCommand } from '@aws-sdk/client-s3'
import type { S3Like } from '../aws/s3-client.js'
import { type RetryOptions, withRetry } from '../util/retry.js'

const MAX_KEYS_PER_BATCH = 1000

export interface DeleteStaleInput {
  client: S3Like
  bucket: string
  keys: string[]
  retry: RetryOptions
}

export async function deleteStale(input: DeleteStaleInput): Promise<void> {
  if (input.keys.length === 0) return

  for (let i = 0; i < input.keys.length; i += MAX_KEYS_PER_BATCH) {
    const batch = input.keys.slice(i, i + MAX_KEYS_PER_BATCH)
    const command = new DeleteObjectsCommand({
      Bucket: input.bucket,
      Delete: {
        Objects: batch.map((Key) => ({ Key })),
        Quiet: true,
      },
    })
    await withRetry(() => input.client.send(command), input.retry)
  }
}
