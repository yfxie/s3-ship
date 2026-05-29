import { readFile } from 'node:fs/promises'
import { PutObjectCommand } from '@aws-sdk/client-s3'
import type { S3Like } from '../aws/s3-client.js'
import { inferContentType } from '../util/content-type.js'
import { type RetryOptions, withRetry } from '../util/retry.js'
import type { PlannedFile } from './diff.js'

export interface UploadInput {
  client: S3Like
  bucket: string
  file: PlannedFile
  cacheControlFor: (key: string) => string | undefined
  retry: RetryOptions
}

export async function uploadFile(input: UploadInput): Promise<void> {
  const body = await readFile(input.file.localPath)
  const contentType = inferContentType(input.file.localPath)
  const cacheControl = input.cacheControlFor(input.file.key)

  const command = new PutObjectCommand({
    Bucket: input.bucket,
    Key: input.file.key,
    Body: body,
    ContentType: contentType,
    CacheControl: cacheControl,
    ChecksumAlgorithm: 'CRC32',
  })

  await withRetry(() => input.client.send(command), input.retry)
}
