export type MainTabId = 'review' | 'configuration'

export type MainTab = {
  id: MainTabId
  label: string
  description: string
}

export const MAIN_TABS: MainTab[] = [
  {
    id: 'review',
    label: 'Review',
    description: 'Review tracked time, confirmations, and weekly totals.'
  },
  {
    id: 'configuration',
    label: 'Configuration',
    description: 'Manage buckets, defaults, and local application settings.'
  }
]
