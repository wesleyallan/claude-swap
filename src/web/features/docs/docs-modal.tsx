import { cn } from 'cn'
import { BookOpenIcon, CodeIcon } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { useLocale, useTranslations } from 'use-intl'
import { IconLink } from '@/web/components/icon-link'
import { RouteModal } from '@/web/components/route-modal'
import en from './content/en.md?raw'
import es from './content/es.md?raw'
import ptBR from './content/pt-BR.md?raw'
import { parseDocs } from './parse-docs'

const content: Record<string, string> = { en, es, 'pt-BR': ptBR }

/** Help pages: section list on the left, the selected section on the right, in the UI language. */
export function DocsModal() {
  const t = useTranslations('modal')
  const tDevDocs = useTranslations('devDocs')
  const locale = useLocale()
  const sections = useMemo(() => parseDocs(content[locale] ?? en), [locale])
  const [selectedIndex, setSelectedIndex] = useState(0)
  const article = useRef<HTMLElement>(null)
  const current = sections[selectedIndex] ?? sections[0]
  const select = (index: number) => {
    setSelectedIndex(index)
    if (article.current) article.current.scrollTop = 0
  }
  return (
    <RouteModal
      title={t('docsTitle')}
      icon={<BookOpenIcon />}
      actions={
        <IconLink to="/docs-dev" size="icon-sm" label={tDevDocs('title')} icon={<CodeIcon />} />
      }
      className="flex h-[min(85dvh,820px)] flex-col overflow-hidden sm:max-w-5xl"
    >
      <div className="-mx-6 -mb-6 flex min-h-0 flex-1 flex-col border-t md:flex-row">
        <nav
          aria-label={t('docsSections')}
          className="shrink-0 overflow-x-auto border-b p-3 md:w-56 md:overflow-y-auto md:border-r md:border-b-0"
        >
          <ul className="flex gap-1 md:flex-col">
            {sections.map((section, index) => (
              <li key={section.id}>
                <button
                  type="button"
                  aria-current={index === selectedIndex ? 'page' : undefined}
                  onClick={() => select(index)}
                  className={cn(
                    'w-full whitespace-nowrap rounded-lg px-3 py-2 text-left text-sm outline-none transition-colors hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 md:whitespace-normal',
                    index === selectedIndex
                      ? 'bg-accent font-medium text-foreground'
                      : 'text-muted-foreground',
                  )}
                >
                  {section.title}
                </button>
              </li>
            ))}
          </ul>
        </nav>
        <article ref={article} className="min-h-0 flex-1 overflow-y-auto px-6 py-6 md:px-10">
          <h2 className="mb-4 font-heading text-display-sm">{current?.title}</h2>
          <div
            className="docs-prose"
            // biome-ignore lint/security/noDangerouslySetInnerHtml: trusted, bundled content
            dangerouslySetInnerHTML={{ __html: current?.html ?? '' }}
          />
        </article>
      </div>
    </RouteModal>
  )
}
