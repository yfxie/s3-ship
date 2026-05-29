import { S3Client } from '@aws-sdk/client-s3'
import { fromIni } from '@aws-sdk/credential-providers'

export interface S3Like {
  send(command: unknown): Promise<unknown>
}

export interface S3ClientOptions {
  region?: string
  profile?: string
}

export function createS3Client(options: S3ClientOptions): S3Client {
  return new S3Client({
    region: options.region,
    credentials: options.profile ? fromIni({ profile: options.profile }) : undefined,
  })
}

export function normalizeTargetPrefix(target: string): string {
  if (!target) return ''
  return target.endsWith('/') ? target : `${target}/`
}
