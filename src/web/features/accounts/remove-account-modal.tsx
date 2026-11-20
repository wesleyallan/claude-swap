import { useNavigate, useParams } from '@tanstack/react-router'
import { AlertTriangleIcon, Trash2Icon } from 'lucide-react'
import { useTranslations } from 'use-intl'
import { RouteModal } from '@/web/components/route-modal'
import { Alert, AlertDescription, AlertTitle } from '@/web/components/ui/alert'
import { Button } from '@/web/components/ui/button'
import { DialogClose, DialogFooter } from '@/web/components/ui/dialog'
import { Skeleton } from '@/web/components/ui/skeleton'
import { toast } from '@/web/components/ui/toast'
import { useDashboard, useRemoveAccount } from '@/web/lib/query'

export function RemoveAccountModal() {
  const t = useTranslations('removeAccount')
  const tModal = useTranslations('modal')
  const { id } = useParams({ strict: false })
  const navigate = useNavigate()
  const { data } = useDashboard()
  const remove = useRemoveAccount()
  const account = data?.accounts.find((a) => a.id === id)
  // Same rule as the dashboard: while an unknown login is live, no stored account is in use.
  const active = account && !data?.engine.unknownLogin && data?.activeId === account.id

  const confirm = () => {
    if (!account) return
    // Optimistic: the row is gone at once; a failure brings it back with a toast.
    // mutateAsync, not mutate's callbacks: those never fire once this modal has unmounted.
    remove.mutateAsync(account.id).then(
      () => toast.add({ title: t('removed', { name: account.label }), type: 'success' }),
      () => {}, // the hook already rolled back and toasted the error
    )
    // The trigger (the row's remove button) is gone, so focus would fall to <body>.
    navigate({ to: '/' }).then(() =>
      requestAnimationFrame(() => document.getElementById('main')?.focus({ preventScroll: true })),
    )
  }

  return (
    <RouteModal
      title={tModal('removeAccountTitle')}
      description={account ? t('confirm', { name: account.label }) : data && t('missing')}
    >
      {!data && <Skeleton aria-busy className="h-10" />}
      {active && (
        <Alert className="border-warning/60">
          <AlertTriangleIcon className="text-warning" />
          <AlertTitle>{t('activeTitle')}</AlertTitle>
          <AlertDescription>{t('activeHint')}</AlertDescription>
        </Alert>
      )}
      <DialogFooter>
        <DialogClose render={<Button variant="outline" />}>{tModal('cancel')}</DialogClose>
        {account && (
          <Button variant="destructive" onClick={confirm}>
            <Trash2Icon data-icon="inline-start" />
            {t('remove')}
          </Button>
        )}
      </DialogFooter>
    </RouteModal>
  )
}
