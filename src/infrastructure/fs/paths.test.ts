import { describe, expect, it } from 'vitest'
import { resolveSwapHome, swapPaths } from './paths'

const home = '/home/u'

describe('resolveSwapHome', () => {
  it('prefers CLAUDE_SWAP_HOME', () => {
    expect(resolveSwapHome({ CLAUDE_SWAP_HOME: '/x/swap', XDG_CONFIG_HOME: '/xdg' }, home)).toBe(
      '/x/swap',
    )
  })

  it('falls back to $XDG_CONFIG_HOME/claude-swap', () => {
    expect(resolveSwapHome({ XDG_CONFIG_HOME: '/xdg' }, home)).toBe('/xdg/claude-swap')
  })

  it('falls back to ~/.config/claude-swap; empty or relative XDG is ignored', () => {
    expect(resolveSwapHome({}, home)).toBe('/home/u/.config/claude-swap')
    expect(resolveSwapHome({ XDG_CONFIG_HOME: '', CLAUDE_SWAP_HOME: '' }, home)).toBe(
      '/home/u/.config/claude-swap',
    )
    expect(resolveSwapHome({ XDG_CONFIG_HOME: 'rel' }, home)).toBe('/home/u/.config/claude-swap')
  })

  it('swapPaths lists our files inside the home', () => {
    expect(swapPaths('/s')).toEqual({
      home: '/s',
      config: '/s/config.json',
      secrets: '/s/secrets.json',
      state: '/s/state.json',
      backups: '/s/backups',
    })
  })
})
