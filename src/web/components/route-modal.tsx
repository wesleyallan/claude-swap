import { useNavigate } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { useTranslations } from 'use-intl'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/web/components/ui/dialog'

/**
 * A dialog that *is* a route: closing it (Esc, backdrop, ✕, a `DialogClose`) navigates back to the
 * dashboard underneath. Base UI traps focus inside and returns it to the element focused before
 * it opened (the link that navigated here).
 */
export function RouteModal({
  title,
  description,
  children,
}: {
  title: string
  description?: ReactNode
  children?: ReactNode
}) {
  const navigate = useNavigate()
  const t = useTranslations('modal')
  return (
    <Dialog open onOpenChange={(open) => !open && navigate({ to: '/' })}>
      <DialogContent closeLabel={t('close')}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  )
}
