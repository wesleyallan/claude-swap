import { Link } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { Button } from '@/web/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/web/components/ui/tooltip'

/** Icon-only link; the tooltip shows the same text as its accessible name. */
export function IconLink({
  to,
  label,
  icon,
  size = 'icon',
  className,
}: {
  to: '/docs' | '/settings' | '/docs-dev'
  label: string
  icon: ReactNode
  size?: 'icon' | 'icon-sm'
  className?: string
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size={size}
            className={className}
            aria-label={label}
            nativeButton={false}
            render={<Link to={to} />}
          />
        }
      >
        {icon}
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  )
}
