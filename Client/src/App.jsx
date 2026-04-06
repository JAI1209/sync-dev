import { useState } from 'react'
import { Routes, Route, Navigate, useNavigate } from 'react-router-dom'
import { jwtDecode } from 'jwt-decode'
import { AppHeader, AuthScreen, DashboardScreen } from './components/screens'
import Editor from './pages/Editor'
import logoSrc from './assets/SD.png'
import { loginUser, googleLogin, registerUser } from './api/auth'

// ─── mock recent sessions (replace with real API call later) ───────────────
const MOCK_SESSIONS = [
  { id: 'SD-4821', status: 'live', participants: 3, created: '2 hrs ago' },
  { id: 'SD-2049', status: 'closed', participants: 1, created: 'Yesterday' },
]

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
    const data = await registerUser(registerForm.username, registerForm.password)
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
    // calls POST /api/auth/forgot
    await fetch('/api/auth/forgot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: forgotForm.email }),
    })
    setAuthBusy(null)
    setAuthBanner({ tone: 'success', title: 'Reset link queued', detail: 'Check your inbox' })
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
      navigate(`/editor/${id}`)
    }, 600) // brief delay so spinner shows — replace with real API call if needed
  }

  const handleJoinSession = (e) => {
    e.preventDefault()
    if (!joinRoomId.trim()) {
      setDashboardBanner({ tone: 'danger', title: 'No room ID', detail: 'Enter a room code to connect' })
      return
    }
    setDashboardBusy('join')
    setTimeout(() => {
      setDashboardBusy(null)
      navigate(`/editor/${joinRoomId.trim()}`)
    }, 500)
  }

  const handleReconnect = (session) => {
    navigate(`/editor/${session.id}`)
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
                  recentSessions={MOCK_SESSIONS}
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