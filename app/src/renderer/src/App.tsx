import { useMemo, useState } from 'react'
import { MAIN_TABS, type MainTabId } from '../../shared/tabs'
import styles from './App.module.css'

function App(): React.JSX.Element {
  const [activeTab, setActiveTab] = useState<MainTabId>('review')
  const activePanel = useMemo(
    () => MAIN_TABS.find((tab) => tab.id === activeTab) ?? MAIN_TABS[0],
    [activeTab]
  )

  return (
    <main className={styles.shell}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>ChronoShift</p>
          <h1 className={styles.title}>Local-first time tracking</h1>
          <p className={styles.subtitle}>
            Phase 1 is in place with the main application shell, ready for the tracking workflows to
            be built out next.
          </p>
        </div>
      </header>

      <nav aria-label="Primary" className={styles.tabs}>
        {MAIN_TABS.map((tab) => (
          <button
            key={tab.id}
            className={tab.id === activeTab ? styles.activeTab : styles.tab}
            type="button"
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      <section className={styles.panel}>
        <h2 className={styles.panelTitle}>{activePanel.label}</h2>
        <p className={styles.panelDescription}>{activePanel.description}</p>
        <div className={styles.placeholder}>
          Empty state for the {activePanel.label.toLowerCase()} tab.
        </div>
      </section>
    </main>
  )
}

export default App
