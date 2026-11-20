import { expect, it } from 'vitest'
import { initialChunks } from './perf-budget'

it('lists the entry script and its modulepreloads, not CSS', () => {
  const html = `<script type="module" crossorigin src="/assets/index-a.js"></script>
    <link rel="modulepreload" crossorigin href="/assets/clsx-b.js">
    <link rel="stylesheet" crossorigin href="/assets/index-c.css">`
  expect(initialChunks(html)).toEqual(['assets/index-a.js', 'assets/clsx-b.js'])
})
