import { normalizeTargetPrefix } from '../aws/s3-client.js'
import type { RedirectRule } from '../config/schema.js'
import type { RemoteObject } from './list-remote.js'
import type { LocalFile } from './scan.js'

export interface PlannedFile extends LocalFile {
  key: string
}

export interface PlannedRedirect extends RedirectRule {
  fullKey: string
}

export interface ResolvedCloudFront {
  distributionId: string
  invalidationPaths: string[]
}

export interface DiffInput {
  bucket: string
  target: string
  localFiles: LocalFile[]
  remoteObjects: RemoteObject[]
  redirects: RedirectRule[]
  syncDelete: boolean
  cloudfront?: ResolvedCloudFront
}

export interface UploadPlan {
  bucket: string
  target: string
  toUpload: PlannedFile[]
  toUpdate: PlannedFile[]
  toSkip: PlannedFile[]
  toDelete: string[]
  redirects: PlannedRedirect[]
  cloudfront?: ResolvedCloudFront
}

function prefixed(prefix: string, key: string): string {
  return prefix ? `${prefix}${key}` : key
}

function sortByKey<T extends { key: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
}

export function computeDiff(input: DiffInput): UploadPlan {
  const prefix = normalizeTargetPrefix(input.target)

  const plannedRedirects: PlannedRedirect[] = input.redirects.map((r) => ({
    ...r,
    fullKey: prefixed(prefix, r.from),
  }))
  const redirectKeys = new Set(plannedRedirects.map((r) => r.fullKey))

  const localFull: PlannedFile[] = input.localFiles
    .map((f) => ({ ...f, key: prefixed(prefix, f.key) }))
    .filter((f) => !redirectKeys.has(f.key))

  const localKeys = new Set(localFull.map((f) => f.key))

  const remoteByKey = new Map(input.remoteObjects.map((r) => [r.key, r]))

  const toUpload: PlannedFile[] = []
  const toUpdate: PlannedFile[] = []
  const toSkip: PlannedFile[] = []

  for (const file of localFull) {
    const remote = remoteByKey.get(file.key)
    if (!remote) {
      toUpload.push(file)
      continue
    }
    if (remote.etag.includes('-')) {
      toUpdate.push(file)
      continue
    }
    if (remote.etag === file.hash) {
      toSkip.push(file)
    } else {
      toUpdate.push(file)
    }
  }

  let toDelete: string[] = []
  if (input.syncDelete) {
    for (const remote of input.remoteObjects) {
      if (localKeys.has(remote.key)) continue
      if (redirectKeys.has(remote.key)) continue
      toDelete.push(remote.key)
    }
    toDelete = toDelete.sort()
  }

  return {
    bucket: input.bucket,
    target: input.target,
    toUpload: sortByKey(toUpload),
    toUpdate: sortByKey(toUpdate),
    toSkip: sortByKey(toSkip),
    toDelete,
    redirects: plannedRedirects,
    cloudfront: input.cloudfront,
  }
}
