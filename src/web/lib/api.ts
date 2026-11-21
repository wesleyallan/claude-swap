import { hc, parseResponse } from 'hono/client'
import type { AppType } from '@/server/app'

const api = hc<AppType>('/').api

export type Preferences = Awaited<ReturnType<typeof fetchDashboard>>['preferences']
export type Theme = Preferences['theme']
export type Locale = Preferences['locale']

export const fetchDashboard = () => parseResponse(api.dashboard.$get())
export const fetchHistory = () => parseResponse(api.history.$get())
export const runEngineNow = () => parseResponse(api.engine.run.$post())
export const patchPreferences = (json: Partial<Preferences>) =>
  parseResponse(api.preferences.$patch({ json }))

export type Dashboard = Awaited<ReturnType<typeof fetchDashboard>>
export type Account = Dashboard['accounts'][number]
export type AccountStatus = Account['status']
export type Usage = Dashboard['usage'][string]
export type HistoryPoint = Awaited<ReturnType<typeof fetchHistory>>[number]

export const putOrder = (ids: string[]) => parseResponse(api.accounts.order.$put({ json: { ids } }))
export const promoteAccount = (id: string) =>
  parseResponse(api.accounts[':id'].promote.$post({ param: { id } }))
export const setAccountEnabled = ({ id, enabled }: { id: string; enabled: boolean }) =>
  parseResponse(api.accounts[':id'].$patch({ param: { id }, json: { enabled } }))
export const importCurrentLogin = (label = '') =>
  parseResponse(api.accounts.import.$post({ json: { label } }))
export const fetchCurrentLogin = () => parseResponse(api.accounts.current.$get())
export const removeAccount = (id: string) =>
  parseResponse(api.accounts[':id'].$delete({ param: { id } }))
