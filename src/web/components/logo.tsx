import { useId } from 'react'

/**
 * Claude Swap mark: swap arrows over our eight-spoke asterisk on a coral tile.
 * Same drawing as `public/logo.svg` (the favicon/PNG source); ids are per-instance so two marks
 * on one page do not share a gradient or mask.
 */
export function Logo({ className }: { className?: string }) {
  const id = useId()
  const arrows = 'M19 25.5h26M40 19.5l6 6-6 6M45 38.5H19M24 32.5l-6 6 6 6'
  return (
    <svg viewBox="0 0 64 64" aria-hidden className={className}>
      <defs>
        <linearGradient id={`${id}g`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#da8c70" />
          <stop offset="1" stopColor="#b5624a" />
        </linearGradient>
        <mask id={`${id}m`}>
          <rect width="64" height="64" fill="#fff" />
          <path
            d={arrows}
            fill="none"
            stroke="#000"
            strokeWidth="11"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </mask>
      </defs>
      <rect x="2" y="2" width="60" height="60" rx="16" fill={`url(#${id}g)`} />
      <g
        fill="none"
        stroke="#faf9f5"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="4.5"
      >
        <path
          mask={`url(#${id}m)`}
          strokeOpacity=".3"
          d="M32 9v46M9 32h46M15.7 15.7l32.6 32.6M48.3 15.7 15.7 48.3"
        />
        <path d={arrows} />
      </g>
    </svg>
  )
}
