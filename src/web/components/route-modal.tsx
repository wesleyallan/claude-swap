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
  className,
  children,
}: {
  title: string
  description?: ReactNode
  /** Extra classes for the dialog panel (e.g. a wider max width). */
  className?: string
  children?: ReactNode
}) {
  const navigate = useNavigate()
  const t = useTranslations('modal')
  return (
    <Dialog open onOpenChange={(open) => !open && navigate({ to: '/' })}>
      <DialogContent closeLabel={t('close')} className={className}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  )
}
