import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import AuthGate from './components/AuthGate'
import './styles/global.css'
import './styles/workspace-views.css'
import './styles/motion.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AuthGate>{(onLock) => <App onLock={onLock} />}</AuthGate>
  </React.StrictMode>,
)
