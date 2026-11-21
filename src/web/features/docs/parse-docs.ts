import { marked } from 'marked'

export interface DocSection {
  readonly id: string
  readonly title: string
  readonly html: string
}

const slug = (title: string) =>
  title
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')

/** Splits a `## `-sectioned markdown file into titled sections rendered to HTML. */
export function parseDocs(markdown: string): DocSection[] {
  return markdown
    .split(/^## /m)
    .filter((section) => section.trim())
    .map((section) => {
      const titleEnd = section.indexOf('\n')
      const title = section.slice(0, titleEnd).trim()
      const html = marked
        .parse(section.slice(titleEnd + 1), { async: false })
        // External links must not navigate away from the dashboard.
        .replaceAll('<a href="http', '<a target="_blank" rel="noreferrer" href="http')
      return { id: slug(title), title, html }
    })
}
