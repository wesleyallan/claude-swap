import { RouterProvider } from '@tanstack/react-router'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { AppProviders } from './app'
import { createQueryClient } from './lib/query'
import { createAppRouter } from './router'
import './index.css'

const root = document.getElementById('root')
if (!root) throw new Error('#root element missing')

const router = createAppRouter()

createRoot(root).render(
  <StrictMode>
    <AppProviders client={createQueryClient()}>
      <RouterProvider router={router} />
    </AppProviders>
  </StrictMode>,
)
