/**
 * Claude Swap mark: our eight-spoke asterisk in coral with swap arrows in its hollow centre, no
 * background. Same drawing as `public/logo.svg` (the favicon/PNG source).
 */
export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" aria-hidden className={className}>
      <g fill="none" stroke="#d97757" strokeLinecap="round" strokeLinejoin="round">
        <path
          strokeWidth="7"
          d="M32 4v11M32 49v11M4 32h11M49 32h11M12.2 12.2 20 20M44 44l7.8 7.8M51.8 12.2 44 20M20 44l-7.8 7.8"
        />
        <path
          strokeWidth="4"
          d="M23 27.5h17M36.5 24l3.5 3.5-3.5 3.5M41 36.5H24M27.5 33 24 36.5l3.5 3.5"
        />
      </g>
    </svg>
  )
}
