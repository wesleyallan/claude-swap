import { useNavigate } from '@tanstack/react-router'
import { cn } from 'cn'
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
  actions,
  iconTone = 'brand',
  icon,
  description,
  className,
  children,
}: {
  title: string
  /** Extra header buttons, placed left of the close button. */
  actions?: ReactNode
  /** Same icon as the control that opened the modal, shown before the title. */
  icon?: ReactNode
  iconTone?: 'brand' | 'destructive'
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
        <DialogHeader className={cn(icon && 'gap-3')}>
          <DialogTitle
            className={cn(
              icon && 'flex items-center gap-3 leading-tight max-sm:text-title-lg',
              actions ? 'pr-16' : 'pr-8',
            )}
          >
            {icon && (
              <span
                aria-hidden
                className={cn(
                  'flex size-10 shrink-0 items-center justify-center rounded-xl [&_svg]:size-5',
                  iconTone === 'brand'
                    ? 'bg-brand/10 text-brand'
                    : 'bg-destructive/10 text-destructive',
                )}
              >
                {icon}
              </span>
            )}
            <span className="min-w-0 break-words">{title}</span>
          </DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        {actions && (
          <div className="absolute top-7 right-14 flex items-center gap-1">{actions}</div>
        )}
        {children}
      </DialogContent>
    </Dialog>
  )
}
