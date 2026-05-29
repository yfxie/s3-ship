import { ListObjectsV2Command, type ListObjectsV2CommandOutput } from '@aws-sdk/client-s3'
import { type S3Like, normalizeTargetPrefix } from '../aws/s3-client.js'

export interface ListRemoteInput {
  client: S3Like
  bucket: string
  target: string
}

export interface RemoteObject {
  key: string
  size: number
  etag: string
}

export async function listRemoteFiles(input: ListRemoteInput): Promise<RemoteObject[]> {
  const prefix = normalizeTargetPrefix(input.target)
  const results: RemoteObject[] = []
  let continuationToken: string | undefined

  do {
    const command = new ListObjectsV2Command({
      Bucket: input.bucket,
      Prefix: prefix || undefined,
      ContinuationToken: continuationToken,
    })
    const response = (await input.client.send(command)) as ListObjectsV2CommandOutput
    for (const item of response.Contents ?? []) {
      if (!item.Key) continue
      results.push({
        key: item.Key,
        size: item.Size ?? 0,
        etag: stripQuotes(item.ETag ?? ''),
      })
    }
    continuationToken = response.NextContinuationToken
  } while (continuationToken)

  return results
}

function stripQuotes(etag: string): string {
  return etag.replace(/^"+|"+$/g, '')
}
