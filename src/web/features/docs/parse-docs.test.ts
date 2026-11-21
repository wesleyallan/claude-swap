import { describe, expect, it } from 'vitest'
import { parseDocs } from './parse-docs'

describe('parseDocs', () => {
  it('splits on level-2 headings with a slug id per section', () => {
    const sections = parseDocs('## Visão geral\n\nOlá **mundo**\n\n## API HTTP\n\n- a\n')
    expect(sections.map(({ id, title }) => ({ id, title }))).toEqual([
      { id: 'visao-geral', title: 'Visão geral' },
      { id: 'api-http', title: 'API HTTP' },
    ])
    expect(sections[0]?.html).toContain('<strong>mundo</strong>')
  })

  it('opens external links in a new tab and leaves mailto links alone', () => {
    const [section] = parseDocs('## Links\n\n[GitHub](https://github.com) [Mail](mailto:a@b.c)\n')
    expect(section?.html).toContain(
      '<a target="_blank" rel="noreferrer" href="https://github.com">GitHub</a>',
    )
    expect(section?.html).toContain('<a href="mailto:a@b.c">Mail</a>')
  })
})
