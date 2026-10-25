import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import AuthGate from './components/AuthGate'
import ServerStoreProvider from './lib/serverStore'
import PwaProvider from './lib/pwa'
import { PwaNotices } from './components/MobileAppSettings'
import { AppearanceProvider } from './lib/appearance'
import './styles/global.css'
import './styles/workspace-views.css'
import './styles/motion.css'
import './styles/pwa.css'
import './styles/rhine-theme.css'
import './styles/interface-motion.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AppearanceProvider>
      <PwaProvider>
        <AuthGate>
          {(onLock) => (
            <ServerStoreProvider>
              <App onLock={onLock} />
            </ServerStoreProvider>
          )}
        </AuthGate>
        <PwaNotices />
      </PwaProvider>
    </AppearanceProvider>
  </React.StrictMode>,
)
