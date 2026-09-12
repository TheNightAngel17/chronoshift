import { useMemo, useState } from 'react'
import { MAIN_TABS, type MainTabId } from '../../../shared/tabs'
import ConfigTab from './tabs/ConfigTab'
import ReviewTab from './tabs/ReviewTab'
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
        <p className={styles.eyebrow}>ChronoShift</p>
        <h1 className={styles.title}>Local-first time tracking</h1>
      </header>

      <nav aria-label="Primary" className={styles.tabs}>
        {MAIN_TABS.map((tab) => (
          <button
            key={tab.id}
            className={tab.id === activeTab ? styles.activeTab : styles.tab}
            type="button"
            onClick={() => {
              setActiveTab(tab.id)
            }}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      <section className={styles.panel}>
        <h2 className={styles.panelTitle}>{activePanel.label}</h2>
        <p className={styles.panelDescription}>{activePanel.description}</p>
        {activePanel.id === 'configuration' ? <ConfigTab /> : <ReviewTab />}
      </section>
    </main>
  )
}

export default App
