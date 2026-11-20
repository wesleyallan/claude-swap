import { useNavigate } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { useTranslations } from 'use-intl'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/web/components/ui/dialog'

/** A dialog that *is* a route: closing it navigates back to the dashboard underneath. */
export function RouteModal({ title, children }: { title: string; children?: ReactNode }) {
  const navigate = useNavigate()
  const t = useTranslations('modal')
  return (
    <Dialog open onOpenChange={(open) => !open && navigate({ to: '/' })}>
      <DialogContent closeLabel={t('close')}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  )
}
