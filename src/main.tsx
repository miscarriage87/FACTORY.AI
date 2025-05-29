import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'

// Create a root using the new React 18 createRoot API
ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
