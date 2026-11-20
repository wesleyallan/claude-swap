import {
  Accessibility,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from '@dnd-kit/dom'
import { DragDropProvider } from '@dnd-kit/react'
import { isSortable, useSortable } from '@dnd-kit/react/sortable'
import { useState } from 'react'
import { useTranslations } from 'use-intl'
import type { Account, Dashboard } from '@/web/lib/api'
import { usePromoteAccount, useReorderAccounts, useSetAccountEnabled } from '@/web/lib/query'
import { AccountRow, type AccountRowProps } from './account-row'
import { move } from './model'

function SortableRow(props: AccountRowProps) {
  const { ref, handleRef, isDragging } = useSortable({ id: props.account.id, index: props.index })
  return <AccountRow {...props} rowRef={ref} handleRef={handleRef} dragging={isDragging} />
}

type Props = Pick<Dashboard, 'accounts' | 'usage' | 'activeId'> & {
  thresholds: Dashboard['preferences']['thresholds']
}

/** The priority list: drag (pointer or keyboard) or the up/down buttons reorder it. */
export function AccountList({ accounts, usage, activeId, thresholds }: Props) {
  const t = useTranslations('accounts')
  const reorder = useReorderAccounts()
  const promote = usePromoteAccount()
  const setEnabled = useSetAccountEnabled()
  const [status, setStatus] = useState('')
  const total = accounts.length
  const ids = accounts.map((a) => a.id)
  const nameOf = (id: unknown) => accounts.find((a) => a.id === id)?.label ?? String(id)

  const onMove = (id: string, direction: -1 | 1) => {
    const from = ids.indexOf(id)
    const to = from + direction
    reorder.mutate(move(ids, from, to))
    setStatus(t('dnd.moved', { name: nameOf(id), position: to + 1, total }))
    // Keep focus on the arrow the user pressed (or its sibling once the row hits an edge).
    requestAnimationFrame(() => {
      const atEdge = to === 0 || to === total - 1
      const same = document.getElementById(`move-${direction < 0 ? 'up' : 'down'}-${id}`)
      const other = document.getElementById(`move-${direction < 0 ? 'down' : 'up'}-${id}`)
      ;(atEdge ? other : same)?.focus()
    })
  }

  const accessibility = Accessibility.configure({
    screenReaderInstructions: { draggable: t('dnd.instructions') },
    announcements: {
      dragstart: ({ operation: { source } }: DragStartEvent) =>
        source && t('dnd.picked', { name: nameOf(source.id) }),
      dragover: ({ operation: { source } }: DragOverEvent) =>
        isSortable(source)
          ? t('dnd.over', { name: nameOf(source.id), position: source.index + 1, total })
          : undefined,
      dragend: ({ operation: { source }, canceled }: DragEndEvent) => {
        if (!isSortable(source)) return undefined
        const name = nameOf(source.id)
        return canceled
          ? t('dnd.canceled', { name, position: source.initialIndex + 1 })
          : t('dnd.dropped', { name, position: source.index + 1, total })
      },
    },
  })

  return (
    <DragDropProvider
      plugins={(defaults) => [...defaults, accessibility]}
      onDragEnd={(event) => {
        const { source } = event.operation
        if (event.canceled || !isSortable(source)) return
        if (source.initialIndex !== source.index)
          reorder.mutate(move(ids, source.initialIndex, source.index))
      }}
    >
      <ol aria-labelledby="accounts-title" className="flex flex-col gap-3">
        {accounts.map((a: Account, index) => (
          <SortableRow
            key={a.id}
            account={a}
            usage={usage[a.id]}
            index={index}
            total={total}
            active={a.id === activeId}
            thresholds={thresholds}
            onPromote={(id) => promote.mutate(id)}
            onMove={onMove}
            onEnabledChange={(id, enabled) => setEnabled.mutate({ id, enabled })}
          />
        ))}
      </ol>
      <p aria-live="polite" className="sr-only">
        {status}
      </p>
    </DragDropProvider>
  )
}
