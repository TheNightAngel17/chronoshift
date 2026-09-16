import { useEffect, useState } from 'react'
import type { PromptKind, PromptPayload } from '../../../shared/ipc-contract'
import styles from './App.module.css'

// The URL's `?kind=` lets the window show *something* the instant the page
// mounts (BUILD_PLAN §9), before the `prompt:show` event carrying the actual
// payload (state / idleEvent / recoveryInfo) has had a chance to arrive.
function readKindFromLocation(): PromptKind | null {
  const kind = new URLSearchParams(window.location.search).get('kind')

  return kind === 'start' || kind === 'checkin' || kind === 'idle' || kind === 'recovery'
    ? kind
    : null
}

// Placeholder content only — StartPrompt/CheckinPrompt/IdlePrompt/
// RecoveryPrompt each get their real UI in their own future issue (§9.1-9.4).
// This module is just the routing shell.
function StartPromptStub(): React.JSX.Element {
  return <p className={styles.body}>What are you working on?</p>
}

function CheckinPromptStub(): React.JSX.Element {
  return <p className={styles.body}>Still working on this?</p>
}

function IdlePromptStub(): React.JSX.Element {
  return <p className={styles.body}>You were away — what was that?</p>
}

function RecoveryPromptStub(): React.JSX.Element {
  return <p className={styles.body}>ChronoShift didn&apos;t shut down cleanly.</p>
}

function App(): React.JSX.Element {
  const [payload, setPayload] = useState<PromptPayload | null>(null)
  const kind = payload?.kind ?? readKindFromLocation()

  useEffect(() => {
    return window.api.prompts.onShow((next) => {
      setPayload(next)
    })
  }, [])

  return (
    <main className={styles.shell}>
      {kind === 'start' ? <StartPromptStub /> : null}
      {kind === 'checkin' ? <CheckinPromptStub /> : null}
      {kind === 'idle' ? <IdlePromptStub /> : null}
      {kind === 'recovery' ? <RecoveryPromptStub /> : null}
    </main>
  )
}

export default App
