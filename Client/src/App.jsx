import { startTransition, useEffect, useState } from 'react'
import logo from './assets/SD.png'
import { AppHeader, AuthScreen, DashboardScreen } from './components/screens'

const STORAGE_KEY = 'syncdev-ui-auth'
const API_BASE = import.meta.env.VITE_API_BASE || '/api/auth'

const initialSessions = [
  { id: 'SD-2048', participants: 4, created: '09:12 UTC', status: 'live' },
  { id: 'SD-7F3A', participants: 2, created: 'Yesterday', status: 'idle' },
  { id: 'SD-12BC', participants: 6, created: 'Apr 04', status: 'archived' },
]

function readStoredAuth() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return null

    const parsed = JSON.parse(raw)
    if (!parsed?.token) return null

    return parsed
  } catch {
    return null
  }
}

function createRoomId() {
  return `SD-${Math.random().toString(36).slice(2, 6).toUpperCase()}`
}

function createTimestamp() {
  return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function delay(ms = 900) {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

function App() {
  const storedAuth = readStoredAuth()
  const [screen, setScreen] = useState(storedAuth ? 'dashboard' : 'login')
  const [isAuthenticated, setIsAuthenticated] = useState(Boolean(storedAuth))
  const [activeUser, setActiveUser] = useState(storedAuth?.username || 'engineer')
  const [authToken, setAuthToken] = useState(storedAuth?.token || '')
  const [showPassword, setShowPassword] = useState(false)
  const [authBanner, setAuthBanner] = useState(null)
  const [dashboardBanner, setDashboardBanner] = useState(null)
  const [authBusy, setAuthBusy] = useState('')
  const [dashboardBusy, setDashboardBusy] = useState('')
  const [loginForm, setLoginForm] = useState({
    username: storedAuth?.username || '',
    password: '',
    remember: true,
  })
  const [registerForm, setRegisterForm] = useState({
    username: '',
    email: '',
    password: '',
    confirmPassword: '',
  })
  const [forgotForm, setForgotForm] = useState({ email: '' })
  const [joinRoomId, setJoinRoomId] = useState('SD-2048')
  const [recentSessions, setRecentSessions] = useState(initialSessions)

  useEffect(() => {
    if (isAuthenticated && authToken && loginForm.remember) {
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ authenticated: true, username: activeUser, token: authToken }),
      )
      return
    }

    window.localStorage.removeItem(STORAGE_KEY)
  }, [activeUser, authToken, isAuthenticated, loginForm.remember])

  useEffect(() => {
    if (!authToken) return

    let canceled = false

    async function verifySession() {
      try {
        const response = await fetch(`${API_BASE}/me`, {
          headers: {
            Authorization: `Bearer ${authToken}`,
          },
        })

        if (!response.ok) {
          window.localStorage.removeItem(STORAGE_KEY)
          setIsAuthenticated(false)
          setScreen('login')
          return
        }

        const data = await response.json()
        if (!canceled) {
          setActiveUser(data.username || activeUser)
          setIsAuthenticated(true)
        }
      } catch {
        if (!canceled) {
          window.localStorage.removeItem(STORAGE_KEY)
          setIsAuthenticated(false)
          setScreen('login')
        }
      }
    }

    verifySession()
    return () => {
      canceled = true
    }
  }, [authToken])

  const navigate = (nextScreen) => {
    setAuthBanner(null)
    startTransition(() => setScreen(nextScreen))
  }

  const handleLoginChange = (field, value) => {
    setLoginForm((current) => ({ ...current, [field]: value }))
  }

  const handleRegisterChange = (field, value) => {
    setRegisterForm((current) => ({ ...current, [field]: value }))
  }

  const handleForgotChange = (field, value) => {
    setForgotForm((current) => ({ ...current, [field]: value }))
  }

  const pushRecentSession = (session) => {
    setRecentSessions((current) => {
      const next = [session, ...current.filter((item) => item.id !== session.id)]
      return next.slice(0, 4)
    })
  }

  const handleLoginSubmit = async (event) => {
    event.preventDefault()
    setAuthBanner(null)
    setAuthBusy('login')
    await delay()

    const username = loginForm.username.trim()
    const password = loginForm.password.trim()

    if (username.length < 3 || password.length < 8) {
      setAuthBanner({
        tone: 'danger',
        title: 'Invalid credentials.',
        detail: 'Use a username with at least 3 characters and a password with at least 8.',
      })
      setAuthBusy('')
      return
    }

    try {
      const response = await fetch(`${API_BASE}/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ username, password }),
      })

      if (!response.ok) {
        const error = await response.json().catch(() => null)
        setAuthBanner({
          tone: 'danger',
          title: 'Invalid credentials.',
          detail: error?.msg || 'Unable to authenticate.',
        })
        setAuthBusy('')
        return
      }

      const data = await response.json()
      setAuthToken(data.token)
      setActiveUser(username)
      setIsAuthenticated(true)
      setDashboardBanner({
        tone: 'success',
        title: 'Connected to session.',
        detail: 'Workspace shell restored. Session bus is standing by.',
      })
      setAuthBusy('')
      startTransition(() => setScreen('dashboard'))
    } catch (err) {
      setAuthBanner({
        tone: 'danger',
        title: 'Login failed.',
        detail: 'The authentication service is unavailable.',
      })
      setAuthBusy('')
    }
  }

  const handleRegisterSubmit = async (event) => {
    event.preventDefault()
    setAuthBanner(null)
    setAuthBusy('register')
    await delay()

    const username = registerForm.username.trim()
    const email = registerForm.email.trim()

    if (!email.includes('@')) {
      setAuthBanner({
        tone: 'danger',
        title: 'Provisioning halted.',
        detail: 'A valid email address is required to create an account.',
      })
      setAuthBusy('')
      return
    }

    if (registerForm.password.length < 8) {
      setAuthBanner({
        tone: 'danger',
        title: 'Provisioning halted.',
        detail: 'Password must be at least 8 characters long.',
      })
      setAuthBusy('')
      return
    }

    if (registerForm.password !== registerForm.confirmPassword) {
      setAuthBanner({
        tone: 'danger',
        title: 'Provisioning halted.',
        detail: 'Password confirmation does not match.',
      })
      setAuthBusy('')
      return
    }

    try {
      const response = await fetch(`${API_BASE}/register`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ username, email, password: registerForm.password }),
      })

      if (!response.ok) {
        const error = await response.json().catch(() => null)
        setAuthBanner({
          tone: 'danger',
          title: 'Provisioning halted.',
          detail: error?.msg || 'Unable to create an account.',
        })
        setAuthBusy('')
        return
      }

      const data = await response.json()
      setLoginForm((current) => ({ ...current, username, password: '' }))
      setAuthBanner({
        tone: 'success',
        title: 'Account created.',
        detail: `${username || 'Engineer'} is ready for authentication.`,
      })
      setAuthBusy('')
      startTransition(() => setScreen('login'))
    } catch (err) {
      setAuthBanner({
        tone: 'danger',
        title: 'Provisioning halted.',
        detail: 'The registration service is unavailable.',
      })
      setAuthBusy('')
    }
  }

  const handleForgotSubmit = async (event) => {
    event.preventDefault()
    setAuthBanner(null)
    setAuthBusy('forgot')
    await delay(700)

    const email = forgotForm.email.trim()
    if (!email.includes('@')) {
      setAuthBanner({
        tone: 'danger',
        title: 'Reset failed.',
        detail: 'Enter a valid email address to receive a reset link.',
      })
      setAuthBusy('')
      return
    }

    try {
      const response = await fetch(`${API_BASE}/forgot`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email }),
      })

      if (!response.ok) {
        const error = await response.json().catch(() => null)
        setAuthBanner({
          tone: 'danger',
          title: 'Reset failed.',
          detail: error?.msg || 'Unable to send a reset link.',
        })
        setAuthBusy('')
        return
      }

      setAuthBanner({
        tone: 'success',
        title: 'Reset link sent.',
        detail: 'Credential recovery instructions are queued for delivery.',
      })
      setAuthBusy('')
    } catch (err) {
      setAuthBanner({
        tone: 'danger',
        title: 'Reset failed.',
        detail: 'The reset service is unavailable.',
      })
      setAuthBusy('')
    }
  }

  const handleInitializeSession = async () => {
    setDashboardBanner(null)
    setDashboardBusy('create')
    await delay(800)

    const roomId = createRoomId()
    const nextSession = { id: roomId, participants: 1, created: createTimestamp(), status: 'live' }

    setJoinRoomId(roomId)
    pushRecentSession(nextSession)
    setDashboardBanner({
      tone: 'success',
      title: 'Connected to session.',
      detail: `Room ${roomId} initialized and waiting for collaborators.`,
    })
    setDashboardBusy('')
  }

  const handleJoinSession = async (event) => {
    event.preventDefault()
    setDashboardBanner(null)
    setDashboardBusy('join')
    await delay(800)

    const roomId = joinRoomId.trim().toUpperCase()

    if (!/^SD-[A-Z0-9]{4}$/.test(roomId)) {
      setDashboardBanner({
        tone: 'danger',
        title: 'Room not found.',
        detail: 'Use a room identifier in the form SD-2048.',
      })
      setDashboardBusy('')
      return
    }

    const existingSession = recentSessions.find((session) => session.id === roomId)
    const nextSession = existingSession || {
      id: roomId,
      participants: 3,
      created: createTimestamp(),
      status: 'live',
    }

    pushRecentSession({ ...nextSession, status: 'live' })
    setDashboardBanner({
      tone: 'success',
      title: 'Connected to session.',
      detail: `${roomId} joined successfully. Pair channel is synchronized.`,
    })
    setDashboardBusy('')
  }

  const handleReconnect = async (session) => {
    setDashboardBusy(session.id)
    await delay(650)
    setJoinRoomId(session.id)
    pushRecentSession({ ...session, status: 'live' })
    setDashboardBanner({
      tone: 'success',
      title: 'Connected to session.',
      detail: `${session.id} reattached from recent history.`,
    })
    setDashboardBusy('')
  }

  const handleLogout = () => {
    setIsAuthenticated(false)
    setAuthToken('')
    setActiveUser('engineer')
    setDashboardBusy('')
    setDashboardBanner(null)
    setShowPassword(false)
    setLoginForm((current) => ({ ...current, password: '' }))
    navigate('login')
  }

  return (
    <div className="app-shell">
      <AppHeader
        activeScreen={screen}
        isAuthenticated={isAuthenticated}
        logoSrc={logo}
        onLogout={handleLogout}
        onNavigate={navigate}
      />

      {screen !== 'dashboard' ? (
        <AuthScreen
          authBanner={authBanner}
          authBusy={authBusy}
          forgotForm={forgotForm}
          loginForm={loginForm}
          mode={screen}
          onForgotChange={handleForgotChange}
          onForgotSubmit={handleForgotSubmit}
          onLoginChange={handleLoginChange}
          onLoginSubmit={handleLoginSubmit}
          onNavigate={navigate}
          onRegisterChange={handleRegisterChange}
          onRegisterSubmit={handleRegisterSubmit}
          onTogglePassword={() => setShowPassword((current) => !current)}
          registerForm={registerForm}
          showPassword={showPassword}
        />
      ) : (
        <DashboardScreen
          activeUser={activeUser}
          dashboardBanner={dashboardBanner}
          dashboardBusy={dashboardBusy}
          joinRoomId={joinRoomId}
          onInitializeSession={handleInitializeSession}
          onJoinRoomIdChange={setJoinRoomId}
          onJoinSession={handleJoinSession}
          onReconnect={handleReconnect}
          recentSessions={recentSessions}
        />
      )}
    </div>
  )
}

export default App
