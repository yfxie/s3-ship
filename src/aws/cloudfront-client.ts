import { CloudFrontClient } from '@aws-sdk/client-cloudfront'
import { fromIni } from '@aws-sdk/credential-providers'

export interface CloudFrontLike {
  send(command: unknown): Promise<unknown>
}

export interface CloudFrontClientOptions {
  region?: string
  profile?: string
}

export function createCloudFrontClient(options: CloudFrontClientOptions): CloudFrontClient {
  return new CloudFrontClient({
    region: options.region ?? 'us-east-1',
    credentials: options.profile ? fromIni({ profile: options.profile }) : undefined,
  })
}
