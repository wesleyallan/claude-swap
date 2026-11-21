import { useNavigate } from '@tanstack/react-router'
import { AlertTriangleIcon, UserPlusIcon } from 'lucide-react'
import { type FormEvent, type ReactNode, useId, useState } from 'react'
import { useTranslations } from 'use-intl'
import { RouteModal } from '@/web/components/route-modal'
import { Alert, AlertDescription, AlertTitle } from '@/web/components/ui/alert'
import { Button } from '@/web/components/ui/button'
import { DialogClose, DialogFooter } from '@/web/components/ui/dialog'
import { Field, FieldDescription, FieldLabel } from '@/web/components/ui/field'
import { Input } from '@/web/components/ui/input'
import { toast } from '@/web/components/ui/toast'
import { useCurrentLogin, useImportCurrentLogin } from '@/web/lib/query'

const code = (chunks: ReactNode) => (
  <code className="rounded-sm bg-muted px-1 py-0.5 font-mono text-[0.9em]">{chunks}</code>
)

/** "/login in Claude Code, then import": the only way accounts get in (also the unknown-login banner's target). */
export function AddAccountModal() {
  const t = useTranslations('addAccount')
  const tModal = useTranslations('modal')
  const navigate = useNavigate()
  const current = useCurrentLogin()
  const importLogin = useImportCurrentLogin()
  const [label, setLabel] = useState('')
  const id = useId()
  const login = current.data?.login

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!login) return
    importLogin.mutate(label, {
      onSuccess: (account) => {
        toast.add({
          title: t(login.known ? 'updated' : 'added', { name: account.label }),
          type: 'success',
        })
        navigate({ to: '/' })
      },
    })
  }

  return (
    <RouteModal title={tModal('addAccountTitle')} description={t('intro')}>
      <form noValidate onSubmit={submit} className="flex flex-col gap-6">
        <ol className="flex list-inside list-decimal flex-col gap-2 marker:text-muted-foreground">
          <li>{t.rich('step1', { code })}</li>
          <li>{t.rich('step2', { code })}</li>
          <li>{t('step3')}</li>
        </ol>
        <Alert className="border-warning/60">
          <AlertTriangleIcon className="text-warning" />
          <AlertTitle>{t('logoutTitle')}</AlertTitle>
          <AlertDescription>{t('logoutHint')}</AlertDescription>
        </Alert>
        <div className="flex flex-col gap-1.5 rounded-xl bg-muted/60 p-4" aria-live="polite">
          <span className="text-caption text-muted-foreground">{t('detected')}</span>
          {current.isPending ? (
            <span>{t('checking')}</span>
          ) : current.isError ? (
            <span className="text-destructive">{t('readFailed')}</span>
          ) : login ? (
            <>
              <span className="font-medium break-all">{login.email}</span>
              {login.known && <span className="text-muted-foreground">{t('known')}</span>}
            </>
          ) : (
            <span>{t('notLoggedIn')}</span>
          )}
        </div>
        <Field>
          <FieldLabel htmlFor={`${id}-label`}>{t('label')}</FieldLabel>
          <Input
            id={`${id}-label`}
            value={label}
            maxLength={100}
            autoComplete="off"
            placeholder={login?.email}
            aria-describedby={`${id}-label-desc`}
            onChange={(event) => setLabel(event.target.value)}
          />
          <FieldDescription id={`${id}-label-desc`}>{t('labelHint')}</FieldDescription>
        </Field>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>{tModal('cancel')}</DialogClose>
          <Button type="submit" disabled={!login || importLogin.isPending}>
            <UserPlusIcon data-icon="inline-start" />
            {t('import')}
          </Button>
        </DialogFooter>
      </form>
    </RouteModal>
  )
}
