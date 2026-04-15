import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { GoogleOAuthProvider } from '@react-oauth/google'
import { AuthProvider } from './context/AuthContext.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import * as Sentry from '@sentry/react'
import './index.css'
import App from './App.jsx'

Sentry.init({
  dsn: import.meta.env.VITE_SENTRY_DSN,
  enabled: !!import.meta.env.VITE_SENTRY_DSN,
  environment: import.meta.env.MODE,
  tracesSampleRate: 0.2,
  replaysOnErrorSampleRate: 1.0,
});

createRoot(document.getElementById('root')).render(
  <GoogleOAuthProvider clientId={import.meta.env.VITE_GOOGLE_CLIENT_ID}>
    <AuthProvider>
      <BrowserRouter>
        <ErrorBoundary>
          <App />
        </ErrorBoundary>
      </BrowserRouter>
    </AuthProvider>
  </GoogleOAuthProvider>,
)