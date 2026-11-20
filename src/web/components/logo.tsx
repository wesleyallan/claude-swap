/** claude-swap mark: a coral eight-spoke asterisk (our own glyph, not the Anthropic logo). */
export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={className}>
      <g stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
        <path d="M12 3v18M3 12h18M5.6 5.6l12.8 12.8M18.4 5.6 5.6 18.4" />
      </g>
    </svg>
  )
}
