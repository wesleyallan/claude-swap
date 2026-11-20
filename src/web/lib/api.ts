import { hc, parseResponse } from 'hono/client'
import type { AppType } from '@/server/app'

/** Typed client for the local API (same origin). */
export const api = hc<AppType>('/').api

export type Preferences = Awaited<ReturnType<typeof fetchDashboard>>['preferences']
export type Theme = Preferences['theme']
export type Locale = Preferences['locale']

export const fetchDashboard = () => parseResponse(api.dashboard.$get())
export const patchPreferences = (json: Partial<Preferences>) =>
  parseResponse(api.preferences.$patch({ json }))
