import { useState } from 'react'
import { Routes, Route, Navigate, useNavigate } from 'react-router-dom'
import { jwtDecode } from 'jwt-decode'
import { AppHeader, AuthScreen, DashboardScreen } from './components/screens'
import Editor from './pages/Editor'
import logoSrc from './assets/SD.png'
import { loginUser, googleLogin, registerUser } from './api/auth'

// ─── helpers ────────────────────────────────────────────────────────────────
const SESSIONS_KEY = 'syncdev_recent_sessions'

function loadSessions() {
  try { return JSON.parse(localStorage.getItem(SESSIONS_KEY)) || [] }
  catch { return [] }
}

function saveSessions(sessions) {
  localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions))
}

function addSession(sessions, id) {
  const now = new Date()
  const label = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  const newSession = { id, status: 'live', participants: 1, created: `Today ${label}` }
  // deduplicate — if same room rejoined, bump it to top
  const filtered = sessions.filter(s => s.id !== id)
  const updated = [newSession, ...filtered].slice(0, 10) // keep last 10
  saveSessions(updated)
  return updated
}

export default function App() {
  const [token, setToken] = useState(localStorage.getItem('token'))
  const navigate = useNavigate()

  // ── auth screen state ──────────────────────────────────────────────────────
  const [authMode, setAuthMode] = useState('login') // 'login' | 'register' | 'forgot'
  const [authBusy, setAuthBusy] = useState(null)    // 'login' | 'register' | 'forgot' | null
  const [authBanner, setAuthBanner] = useState(null) // { tone, title, detail }
  const [showPassword, setShowPassword] = useState(false)

  const [loginForm, setLoginForm] = useState({ username: '', password: '', remember: false })
  const [registerForm, setRegisterForm] = useState({ username: '', email: '', password: '', confirmPassword: '' })
  const [forgotForm, setForgotForm] = useState({ email: '' })

  // ── dashboard state ────────────────────────────────────────────────────────
  const [joinRoomId, setJoinRoomId] = useState('')
  const [dashboardBusy, setDashboardBusy] = useState(null)
  const [dashboardBanner, setDashboardBanner] = useState(null)
  const [recentSessions, setRecentSessions] = useState(loadSessions)

  // ── helpers ────────────────────────────────────────────────────────────────
  const getUsername = () => {
    try { return jwtDecode(token).user?.username || 'engineer' }
    catch { return 'engineer' }
  }

  const saveToken = (t) => {
    localStorage.setItem('token', t)
    setToken(t)
  }

  const handleLogout = () => {
    localStorage.removeItem('token')
    setToken(null)
    navigate('/login')
  }

  // ── auth handlers ──────────────────────────────────────────────────────────
  const handleLoginChange = (field, value) =>
    setLoginForm(prev => ({ ...prev, [field]: value }))

  const handleLoginSubmit = async (e) => {
    e.preventDefault()
    setAuthBanner(null)
    setAuthBusy('login')
    const data = await loginUser(loginForm.username, loginForm.password)
    setAuthBusy(null)
    if (data.token) {
      saveToken(data.token)
      navigate('/dashboard')
    } else {
      setAuthBanner({ tone: 'danger', title: 'Auth failed', detail: data.msg || 'Invalid credentials' })
    }
  }

  const handleGoogleSuccess = async (credentialResponse) => {
    setAuthBanner(null)
    const data = await googleLogin(credentialResponse.credential)
    if (data.token) {
      saveToken(data.token)
      navigate('/dashboard')
    } else {
      setAuthBanner({ tone: 'danger', title: 'Google login failed', detail: 'Try again or use username/password' })
    }
  }

  const handleRegisterChange = (field, value) =>
    setRegisterForm(prev => ({ ...prev, [field]: value }))

  const handleRegisterSubmit = async (e) => {
    e.preventDefault()
    setAuthBanner(null)
    if (registerForm.password !== registerForm.confirmPassword) {
      setAuthBanner({ tone: 'danger', title: 'Password mismatch', detail: 'Both password fields must match' })
      return
    }
    setAuthBusy('register')
    const data = await registerUser(registerForm.username, registerForm.password, registerForm.email)
    setAuthBusy(null)
    if (data.token) {
      setAuthBanner({ tone: 'success', title: 'Account created', detail: 'You can now sign in' })
      setAuthMode('login')
    } else {
      setAuthBanner({ tone: 'danger', title: 'Registration failed', detail: data.msg || 'Try a different username' })
    }
  }

  const handleForgotChange = (field, value) =>
    setForgotForm(prev => ({ ...prev, [field]: value }))

  const handleForgotSubmit = async (e) => {
    e.preventDefault()
    setAuthBusy('forgot')
    try {
      const res = await fetch('/api/auth/forgot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: forgotForm.email }),
      })
      const data = await res.json()
      setAuthBanner({ tone: res.ok ? 'success' : 'danger', title: res.ok ? 'Reset link queued' : 'Error', detail: data.msg || (res.ok ? 'Check your inbox' : 'Please try again') })
    } catch {
      setAuthBanner({ tone: 'danger', title: 'Network error', detail: 'Could not reach server' })
    } finally {
      setAuthBusy(null)
    }
  }

  // clears banner when switching modes
  const handleAuthNavigate = (mode) => {
    setAuthBanner(null)
    if (mode === 'login') navigate('/login')
    else if (mode === 'register') navigate('/register')
    else setAuthMode(mode)
  }

  // ── dashboard handlers ─────────────────────────────────────────────────────
  const handleInitializeSession = () => {
    setDashboardBusy('create')
    const id = Math.random().toString(36).substring(2, 8).toUpperCase()
    setTimeout(() => {
      setDashboardBusy(null)
      setRecentSessions(prev => addSession(prev, id))
      navigate(`/editor/${id}`)
    }, 600)
  }

  const handleJoinSession = (e) => {
    e.preventDefault()
    if (!joinRoomId.trim()) {
      setDashboardBanner({ tone: 'danger', title: 'No room ID', detail: 'Enter a room code to connect' })
      return
    }
    const id = joinRoomId.trim()
    setDashboardBusy('join')
    setTimeout(() => {
      setDashboardBusy(null)
      setRecentSessions(prev => addSession(prev, id))
      navigate(`/editor/${id}`)
    }, 500)
  }

  const [reconnectingId, setReconnectingId] = useState(null)

  const handleReconnect = (session) => {
    setReconnectingId(session.id)
    setTimeout(() => {
      setReconnectingId(null)
      navigate(`/editor/${session.id}`)
    }, 500)
  }

  // ── shared auth screen props ───────────────────────────────────────────────
  const authProps = {
    mode: authMode,
    authBanner,
    authBusy,
    showPassword,
    loginForm,
    registerForm,
    forgotForm,
    onLoginChange: handleLoginChange,
    onLoginSubmit: handleLoginSubmit,
    onRegisterChange: handleRegisterChange,
    onRegisterSubmit: handleRegisterSubmit,
    onForgotChange: handleForgotChange,
    onForgotSubmit: handleForgotSubmit,
    onNavigate: handleAuthNavigate,
    onTogglePassword: () => setShowPassword(p => !p),
    // Google OAuth — pass the raw handler; AuthScreen renders GoogleLogin component
    onGoogleSuccess: handleGoogleSuccess,
    onGoogleError: () => setAuthBanner({ tone: 'danger', title: 'Google login failed' }),
  }

  return (
    <div className="app-shell">
      <Routes>
        {/* ── AUTH ── */}
        <Route
          path="/login"
          element={
            token ? <Navigate to="/dashboard" /> : (
              <>
                <AppHeader
                  activeScreen="login"
                  isAuthenticated={false}
                  logoSrc={logoSrc}
                  onNavigate={handleAuthNavigate}
                  onLogout={handleLogout}
                />
                <AuthScreen {...authProps} mode="login" />
              </>
            )
          }
        />

        <Route
          path="/register"
          element={
            token ? <Navigate to="/dashboard" /> : (
              <>
                <AppHeader
                  activeScreen="register"
                  isAuthenticated={false}
                  logoSrc={logoSrc}
                  onNavigate={handleAuthNavigate}
                  onLogout={handleLogout}
                />
                <AuthScreen {...authProps} mode="register" />
              </>
            )
          }
        />

        {/* ── DASHBOARD ── */}
        <Route
          path="/dashboard"
          element={
            token ? (
              <>
                <AppHeader
                  activeScreen="dashboard"
                  isAuthenticated={true}
                  logoSrc={logoSrc}
                  onLogout={handleLogout}
                  onNavigate={handleAuthNavigate}
                />
                <DashboardScreen
                  activeUser={getUsername()}
                  dashboardBanner={dashboardBanner}
                  dashboardBusy={dashboardBusy}
                  joinRoomId={joinRoomId}
                  onInitializeSession={handleInitializeSession}
                  onJoinRoomIdChange={setJoinRoomId}
                  onJoinSession={handleJoinSession}
                  onReconnect={handleReconnect}
                  reconnectingId={reconnectingId}
                  recentSessions={recentSessions}
                />
              </>
            ) : <Navigate to="/login" />
          }
        />

        {/* ── EDITOR (unchanged — your working socket logic) ── */}
        <Route
          path="/editor/:roomId"
          element={token ? <Editor username={getUsername()} /> : <Navigate to="/login" />}
        />

        <Route path="*" element={<Navigate to={token ? '/dashboard' : '/login'} />} />
      </Routes>
    </div>
  )
}