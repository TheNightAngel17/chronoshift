import type { Page } from '@playwright/test'

/**
 * Thin page-object layer over the bucket tree editor's DOM.
 *
 * Row actions go through a direct DOM query inside the page (name label's
 * exact text match, then its own `.actions` div), not a Playwright
 * text-based locator. That's not a workaround for flakiness — it's the
 * structure: every row's reparent `<select>` lists every bucket as an
 * `<option>`, so `page.locator('li', { hasText })` matches any row that
 * merely *mentions* a name, and nested buckets render as `<li>` inside their
 * parent's `<li>`, so a parent row also "contains" its children's text. Both
 * make "the row for bucket X" ambiguous through CSS/XPath containment alone.
 */

interface RowActionResult {
  ok: boolean
  reason?: string
}

export async function openConfigurationTab(window: Page): Promise<void> {
  await window.getByRole('button', { name: 'Configuration' }).click()
  await window.waitForSelector('text=Buckets')
}

export async function addTopLevelBucket(window: Page, name: string): Promise<void> {
  await window.getByRole('button', { name: 'Add top-level bucket' }).click()
  await window.getByPlaceholder('New bucket name').fill(name)
  await window.getByRole('button', { name: 'Create' }).click()
  await window.waitForTimeout(300)
}

export async function addChildBucket(
  window: Page,
  parentName: string,
  childName: string
): Promise<void> {
  const result = await clickRowButton(window, parentName, 'Add child')
  if (!result.ok) {
    throw new Error(`addChildBucket(${parentName}): ${result.reason}`)
  }
  await window.getByPlaceholder('New bucket name').fill(childName)
  await window.getByRole('button', { name: 'Create' }).click()
  await window.waitForTimeout(300)
}

export async function renameBucket(
  window: Page,
  bucketName: string,
  newName: string
): Promise<void> {
  const result = await clickRowButton(window, bucketName, 'Rename')
  if (!result.ok) {
    throw new Error(`renameBucket(${bucketName}): ${result.reason}`)
  }
  await window.getByLabel(`Rename ${bucketName}`).fill(newName)
  await window.getByRole('button', { name: 'Save' }).click()
  await window.waitForTimeout(300)
}

export async function archiveBucket(window: Page, bucketName: string): Promise<void> {
  const result = await clickRowButton(window, bucketName, 'Archive')
  if (!result.ok) {
    throw new Error(`archiveBucket(${bucketName}): ${result.reason}`)
  }
  await window.waitForTimeout(300)
}

export async function deleteBucket(window: Page, bucketName: string): Promise<void> {
  const openConfirm = await clickRowButton(window, bucketName, 'Delete')
  if (!openConfirm.ok) {
    throw new Error(`deleteBucket(${bucketName}): ${openConfirm.reason}`)
  }
  const confirmed = await clickRowButton(window, bucketName, 'Confirm delete')
  if (!confirmed.ok) {
    throw new Error(`deleteBucket(${bucketName}) confirm step: ${confirmed.reason}`)
  }
  await window.waitForTimeout(300)
}

export async function clickRowButton(
  window: Page,
  bucketName: string,
  buttonText: string
): Promise<RowActionResult> {
  return window.evaluate(
    ({ bucketName, buttonText }) => {
      const nameSpan = Array.from(document.querySelectorAll('[class*="_name_"]')).find(
        (el) => el.textContent === bucketName
      )
      if (!nameSpan) return { ok: false, reason: `no row named "${bucketName}"` }

      const li = nameSpan.closest('li')
      const actionsDiv = li ? Array.from(li.children).find((el) => el.className.includes('_actions_')) : null
      if (!actionsDiv) return { ok: false, reason: `row for "${bucketName}" has no actions` }

      const button = Array.from(actionsDiv.querySelectorAll('button')).find(
        (b) => b.textContent?.trim() === buttonText
      )
      if (!button) return { ok: false, reason: `no "${buttonText}" button in row` }
      if (button.disabled) return { ok: false, reason: `"${buttonText}" button is disabled` }

      button.click()
      return { ok: true }
    },
    { bucketName, buttonText }
  )
}

export async function isRowButtonDisabled(
  window: Page,
  bucketName: string,
  buttonText: string
): Promise<boolean> {
  return window.evaluate(
    ({ bucketName, buttonText }) => {
      const nameSpan = Array.from(document.querySelectorAll('[class*="_name_"]')).find(
        (el) => el.textContent === bucketName
      )
      const li = nameSpan?.closest('li')
      const actionsDiv = li ? Array.from(li.children).find((el) => el.className.includes('_actions_')) : null
      const button = actionsDiv
        ? Array.from(actionsDiv.querySelectorAll('button')).find(
            (b) => b.textContent?.trim() === buttonText
          )
        : null
      return button?.disabled ?? true
    },
    { bucketName, buttonText }
  )
}

export async function isRowColorInputDisabled(window: Page, bucketName: string): Promise<boolean> {
  return window.evaluate((bucketName) => {
    const nameSpan = Array.from(document.querySelectorAll('[class*="_name_"]')).find(
      (el) => el.textContent === bucketName
    )
    const li = nameSpan?.closest('li')
    const input = li?.querySelector('input[type="color"]') as HTMLInputElement | null | undefined
    return input?.disabled ?? true
  }, bucketName)
}
