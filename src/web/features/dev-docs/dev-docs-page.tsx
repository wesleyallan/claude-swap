import { CodeIcon } from 'lucide-react'
import type { MouseEvent } from 'react'
import { useMemo } from 'react'
import { useLocale, useTranslations } from 'use-intl'
import { parseDocs } from '../docs/parse-docs'
import en from './content/en.md?raw'
import es from './content/es.md?raw'
import ptBR from './content/pt-BR.md?raw'

const content: Record<string, string> = { en, es, 'pt-BR': ptBR }

/** `/doc-dev`: how the project is built, as one page with a section index. Not linked anywhere. */
export function DevDocsPage() {
  const t = useTranslations('devDocs')
  const locale = useLocale()
  const sections = useMemo(() => parseDocs(content[locale] ?? en), [locale])

  // The router owns the URL: scroll to the section instead of letting the hash navigate.
  const scrollTo = (event: MouseEvent, id: string) => {
    event.preventDefault()
    const heading = document.getElementById(id)
    heading?.scrollIntoView({ block: 'start' })
    heading?.focus({ preventScroll: true })
  }

  return (
    <div className="flex flex-col gap-10">
      <header className="flex flex-col gap-3">
        <h1 className="flex items-center gap-3 font-heading text-display-md">
          <span
            aria-hidden
            className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-brand/10 text-brand [&_svg]:size-6"
          >
            <CodeIcon />
          </span>
          {t('title')}
        </h1>
        <p className="max-w-prose text-muted-foreground">{t('intro')}</p>
      </header>
      <div className="grid gap-10 md:grid-cols-[13rem_minmax(0,1fr)] lg:gap-16">
        <nav aria-label={t('sections')} className="md:sticky md:top-6 md:self-start">
          <ul className="flex flex-col gap-0.5 border-l">
            {sections.map((section) => (
              <li key={section.id}>
                <a
                  href={`#${section.id}`}
                  onClick={(event) => scrollTo(event, section.id)}
                  className="-ml-px block border-transparent border-l-2 py-1.5 pl-4 text-muted-foreground text-sm outline-none transition-colors hover:border-brand hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
                >
                  {section.title}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <article className="flex min-w-0 flex-col gap-14">
          {sections.map((section) => (
            <section key={section.id} aria-labelledby={section.id} className="flex flex-col gap-4">
              <h2
                id={section.id}
                tabIndex={-1}
                className="scroll-mt-6 font-heading text-display-sm outline-none"
              >
                {section.title}
              </h2>
              <div
                className="docs-prose"
                // biome-ignore lint/security/noDangerouslySetInnerHtml: our own bundled markdown
                dangerouslySetInnerHTML={{ __html: section.html }}
              />
            </section>
          ))}
        </article>
      </div>
    </div>
  )
}
