import {
  CreateInvalidationCommand,
  type CreateInvalidationCommandOutput,
} from '@aws-sdk/client-cloudfront'
import type { CloudFrontLike } from '../aws/cloudfront-client.js'

export interface InvalidateInput {
  client: CloudFrontLike
  distributionId: string
  paths: string[]
}

export async function invalidateCloudFront(input: InvalidateInput): Promise<string | undefined> {
  const callerReference = `s3-ship-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
  const command = new CreateInvalidationCommand({
    DistributionId: input.distributionId,
    InvalidationBatch: {
      CallerReference: callerReference,
      Paths: {
        Quantity: input.paths.length,
        Items: input.paths,
      },
    },
  })
  const response = (await input.client.send(command)) as CreateInvalidationCommandOutput
  return response.Invalidation?.Id
}
