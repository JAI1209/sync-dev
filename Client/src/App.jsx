import { useState, useEffect } from 'react'
import { Routes, Route, Navigate, useNavigate, useSearchParams, useLocation } from 'react-router-dom'
import { jwtDecode } from 'jwt-decode'
import { AppHeader, AuthScreen, DashboardScreen } from './components/screens'
import Editor from './pages/Editor'
import ErrorBoundary from './components/ErrorBoundary'
import GitHubAuthCallback from './pages/GitHubAuthCallback'
import logoSrc from './assets/SD.png'
import { loginUser, googleLogin, registerUser } from './api/auth'
import { apiUrl, authFetch, clearAuthTokens, getAccessToken, saveAuthTokens } from './api/client'
import { importGitHubRepo } from './api/github'
import { generateRoomId } from './utils/ids'

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
  const location = useLocation()
  const [searchParams] = useSearchParams()
  const githubErrorQ = searchParams.get('github_error')

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

  const [githubConnected, setGithubConnected] = useState(false)
  const [ghOwner, setGhOwner] = useState('')
  const [ghRepo, setGhRepo] = useState('')
  const [ghRef, setGhRef] = useState('')
  const [githubImportBusy, setGithubImportBusy] = useState(false)

  useEffect(() => {
    if (!token) {
      setGithubConnected(false)
      return
    }
    let cancelled = false
    authFetch('/api/auth/me')
      .then(async (r) => {
        const d = await r.json().catch(() => ({}))
        if (!r.ok) {
          if (!cancelled) {
            setGithubConnected(false)
            if (!getAccessToken()) setToken(null)
          }
          return
        }
        if (!cancelled) {
          setGithubConnected(Boolean(d.githubConnected))
          const latestToken = getAccessToken()
          if (latestToken && latestToken !== token) setToken(latestToken)
        }
      })
      .catch(() => {
        if (!cancelled) setGithubConnected(false)
      })
    return () => { cancelled = true }
  }, [token])

  useEffect(() => {
    if (token || location.pathname !== '/login' || !githubErrorQ) return
    setAuthBanner({
      tone: 'danger',
      title: 'GitHub sign-in',
      detail: decodeURIComponent(githubErrorQ),
    })
  }, [githubErrorQ, location.pathname, token])

  // ── helpers ────────────────────────────────────────────────────────────────
  const getUsername = () => {
    try { return jwtDecode(token).user?.username || 'engineer' }
    catch { return 'engineer' }
  }

  const saveToken = (accessToken, refreshToken) => {
    // Bug 7 Fix: Remove race window - save tokens immediately
    saveAuthTokens(accessToken, refreshToken)
    setToken(accessToken)
  }

  const handleLogout = () => {
    clearAuthTokens()
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
    try {
      const data = await loginUser(loginForm.username, loginForm.password)
      if (data.token) {
        saveToken(data.token, data.refreshToken)
        navigate('/dashboard')
      } else {
        setAuthBanner({ tone: 'danger', title: 'Auth failed', detail: data.msg || 'Invalid credentials' })
      }
    } catch (err) {
      setAuthBanner({ tone: 'danger', title: 'Network error', detail: err.message || 'Unable to reach server' })
    } finally {
      setAuthBusy(null)
    }
  }

  const handleGoogleSuccess = async (credentialResponse) => {
    setAuthBanner(null)
    try {
      const data = await googleLogin(credentialResponse.credential)
      if (data.token) {
        saveToken(data.token, data.refreshToken)
        navigate('/dashboard')
      } else {
        setAuthBanner({ tone: 'danger', title: 'Google login failed', detail: data.msg || 'Try again or use username/password' })
      }
    } catch (err) {
      setAuthBanner({ tone: 'danger', title: 'Network error', detail: err.message || 'Unable to reach server' })
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
    try {
      const data = await registerUser(registerForm.username, registerForm.password, registerForm.email)
      if (data.token) {
        saveToken(data.token, data.refreshToken)
        navigate('/dashboard')
      } else {
        setAuthBanner({ tone: 'danger', title: 'Registration failed', detail: data.msg || 'Try a different username' })
      }
    } catch (err) {
      setAuthBanner({ tone: 'danger', title: 'Network error', detail: err.message || 'Unable to reach server' })
    } finally {
      setAuthBusy(null)
    }
  }

  const handleForgotChange = (field, value) =>
    setForgotForm(prev => ({ ...prev, [field]: value }))

  const handleForgotSubmit = async (e) => {
    e.preventDefault()
    setAuthBusy('forgot')
    try {
      const res = await fetch(apiUrl('/api/auth/forgot'), {
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
    const id = generateRoomId()
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

  const handleGitHubImportSubmit = async (e) => {
    e.preventDefault()
    setDashboardBanner(null)
    const o = ghOwner.trim()
    const r = ghRepo.trim()
    if (!githubConnected) {
      setDashboardBanner({
        tone: 'danger',
        title: 'GitHub',
        detail: 'Sign in with GitHub from the login page first.',
      })
      return
    }
    if (!o || !r) {
      setDashboardBanner({
        tone: 'danger',
        title: 'Repository',
        detail: 'Enter owner and repository name.',
      })
      return
    }
    setGithubImportBusy(true)
    try {
      const data = await importGitHubRepo(o, r, ghRef.trim() || undefined)
      const ids = Object.keys(data.files || {})
      if (!ids.length) {
        setDashboardBanner({
          tone: 'danger',
          title: 'Nothing to import',
          detail: 'No matching text files found for this branch (check ignores and size limits).',
        })
        return
      }
      const id = generateRoomId()
      sessionStorage.setItem(
        'syncdev_pending_import',
        JSON.stringify({
          roomId: id,
          files: data.files,
          folders: data.folders || {},
          orderedFileIds: data.orderedFileIds || ids,
          github: data.meta || null,
        })
      )
      setRecentSessions((prev) => addSession(prev, id))
      navigate(`/editor/${id}`)
    } catch (err) {
      setDashboardBanner({
        tone: 'danger',
        title: 'GitHub import',
        detail: err.message || 'Request failed',
      })
    } finally {
      setGithubImportBusy(false)
    }
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
    onGitHubClick: () => setAuthBusy('github'),
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

        <Route path="/auth/github/callback" element={<GitHubAuthCallback />} />

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
                  githubConnected={githubConnected}
                  githubImportBusy={githubImportBusy}
                  ghOwner={ghOwner}
                  ghRepo={ghRepo}
                  ghRef={ghRef}
                  onGhOwnerChange={setGhOwner}
                  onGhRepoChange={setGhRepo}
                  onGhRefChange={setGhRef}
                  onGitHubImportSubmit={handleGitHubImportSubmit}
                />
              </>
            ) : <Navigate to="/login" />
          }
        />

        {/* ── EDITOR (unchanged — your working socket logic) ── */}
        <Route
          path="/editor/:roomId"
          element={token ? (
            <ErrorBoundary>
              <Editor username={getUsername()} />
            </ErrorBoundary>
          ) : <Navigate to="/login" />}
        />

        <Route path="*" element={<Navigate to={token ? '/dashboard' : '/login'} />} />
      </Routes>
    </div>
  )
}
