import { registerBucketIpcHandlers } from './handlers/buckets'
import { registerSegmentsIpcHandlers } from './handlers/segments'
import { registerTrackingIpcHandlers } from './handlers/tracking'

export function registerIpcHandlers(): void {
  registerBucketIpcHandlers()
  registerTrackingIpcHandlers()
  registerSegmentsIpcHandlers()
}
