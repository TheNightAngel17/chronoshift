import { BucketTreeEditor } from '../../components/BucketTreeEditor'
import styles from './ConfigTab.module.css'

/**
 * Configuration tab (BUILD_PLAN §10.2). Only the bucket tree editor lives here
 * so far; the settings form and the data / danger zone sections follow in
 * their own tickets.
 */
function ConfigTab(): React.JSX.Element {
  return (
    <div className={styles.tab}>
      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>Buckets</h3>
        <p className={styles.sectionDescription}>
          Add, rename, reorder, recolor, and archive the buckets you track time against. Buckets
          that have tracked time can be archived but not deleted.
        </p>
        <BucketTreeEditor />
      </section>
    </div>
  )
}

export default ConfigTab
