import {
  AlertBox,
  Button,
  Checkbox,
  Divider,
  Field,
  KeyHint,
  OAuthButton,
  SectionCard,
  SessionCard,
  StatusPill,
  TerminalSpinner,
} from './ui'

function AuthRail({ mode }) {
  const labels = {
    login: '// auth',
    register: '// provision',
    forgot: '// recovery',
  }

  return (
    <aside className="auth-rail">
      <div className="auth-rail__top">
        <p className="eyebrow">{labels[mode]}</p>
        <StatusPill label="engineering mode" tone="success" />
      </div>

      <div className="auth-rail__copy">
        <h1>SyncDev</h1>
        <p>Real-time collaborative coding environment</p>
      </div>

      <div className="auth-rail__stack">
        <div className="rail-block">
          <span className="rail-block__label">{'{ runtime }'}</span>
          <p>Instant workspace handoff, room restore, and terminal-aware session state.</p>
        </div>
        <div className="rail-block">
          <span className="rail-block__label">{'< controls />'}</span>
          <p>Keyboard-led flows, hard focus states, and composable collaboration surfaces.</p>
        </div>
        <div className="rail-status">
          <div>
            <span>Transport</span>
            <strong>stable</strong>
          </div>
          <div>
            <span>Latency</span>
            <strong>32ms</strong>
          </div>
          <div>
            <span>Peers</span>
            <strong>12 active</strong>
          </div>
        </div>
      </div>

      <div className="shortcut-row">
        <KeyHint>CTRL</KeyHint>
        <KeyHint>SHIFT</KeyHint>
        <KeyHint>P</KeyHint>
        <span className="shortcut-row__label">Command surface</span>
      </div>
    </aside>
  )
}

function LoginForm({
  authBanner,
  authBusy,
  loginForm,
  onLoginChange,
  onLoginSubmit,
  onNavigate,
  onTogglePassword,
  showPassword,
}) {
  return (
    <>
      <div className="form-intro">
        <h2>SyncDev</h2>
        <p>Real-time collaborative coding environment</p>
      </div>

      {authBanner ? <AlertBox {...authBanner} /> : null}

      <form className="form-grid" onSubmit={onLoginSubmit}>
        <Field
          autoComplete="username"
          hint="// credentials"
          label="USERNAME"
          onChange={(event) => onLoginChange('username', event.target.value)}
          placeholder="enter_username()"
          required
          type="text"
          value={loginForm.username}
        />
        <Field
          autoComplete="current-password"
          hint="// secure"
          label="PASSWORD"
          onChange={(event) => onLoginChange('password', event.target.value)}
          placeholder="enter_password()"
          required
          trailing={
            <button className="inline-control" onClick={onTogglePassword} type="button">
              {showPassword ? 'HIDE' : 'SHOW'}
            </button>
          }
          type={showPassword ? 'text' : 'password'}
          value={loginForm.password}
        />

        <div className="form-row">
          <Checkbox
            checked={loginForm.remember}
            label="Remember me"
            onChange={(value) => onLoginChange('remember', value)}
          />
          <button className="text-action" onClick={() => onNavigate('forgot')} type="button">
            Reset access
          </button>
        </div>

        <Button className="form-button" type="submit" variant="primary">
          {authBusy === 'login' ? (
            <>
              <TerminalSpinner />
              Authenticating
            </>
          ) : (
            'Authenticate'
          )}
        </Button>

        <button
          className="text-action text-action--strong"
          onClick={() => onNavigate('register')}
          type="button"
        >
          Provision Account
        </button>
      </form>

      <Divider text="OR CONTINUE WITH" />

      <div className="oauth-grid">
        <OAuthButton provider="google">Google Login</OAuthButton>
        <OAuthButton provider="github">GitHub Login</OAuthButton>
      </div>
    </>
  )
}

function RegisterForm({ authBanner, authBusy, onNavigate, onRegisterChange, onRegisterSubmit, registerForm }) {
  return (
    <>
      <div className="form-intro">
        <h2>Create Account</h2>
        <p>Provision a new engineering workspace.</p>
      </div>

      {authBanner ? <AlertBox {...authBanner} /> : null}

      <form className="form-grid" onSubmit={onRegisterSubmit}>
        <Field
          hint="// handle"
          label="USERNAME"
          onChange={(event) => onRegisterChange('username', event.target.value)}
          placeholder="choose_username()"
          required
          type="text"
          value={registerForm.username}
        />
        <Field
          hint="// contact"
          label="EMAIL"
          onChange={(event) => onRegisterChange('email', event.target.value)}
          placeholder="engineer@syncdev.dev"
          required
          type="email"
          value={registerForm.email}
        />
        <Field
          hint="// secret"
          label="PASSWORD"
          onChange={(event) => onRegisterChange('password', event.target.value)}
          placeholder="create_password()"
          required
          type="password"
          value={registerForm.password}
        />
        <Field
          hint="// verify"
          label="CONFIRM_PASSWORD"
          onChange={(event) => onRegisterChange('confirmPassword', event.target.value)}
          placeholder="confirm_password()"
          required
          type="password"
          value={registerForm.confirmPassword}
        />

        <Button className="form-button" type="submit" variant="primary">
          {authBusy === 'register' ? (
            <>
              <TerminalSpinner />
              Provisioning
            </>
          ) : (
            'Create Account'
          )}
        </Button>
      </form>

      <button className="text-action" onClick={() => onNavigate('login')} type="button">
        Already have account -&gt; Login
      </button>
    </>
  )
}

function ForgotForm({ authBanner, authBusy, forgotForm, onForgotChange, onForgotSubmit, onNavigate }) {
  return (
    <>
      <div className="form-intro">
        <h2>Reset Access</h2>
        <p>Reset your credentials.</p>
      </div>

      {authBanner ? <AlertBox {...authBanner} /> : null}

      <form className="form-grid" onSubmit={onForgotSubmit}>
        <Field
          hint="// recovery"
          label="EMAIL"
          onChange={(event) => onForgotChange('email', event.target.value)}
          placeholder="engineer@syncdev.dev"
          required
          type="email"
          value={forgotForm.email}
        />

        <Button className="form-button" type="submit" variant="primary">
          {authBusy === 'forgot' ? (
            <>
              <TerminalSpinner />
              Routing
            </>
          ) : (
            'Send reset link'
          )}
        </Button>
      </form>

      <button className="text-action" onClick={() => onNavigate('login')} type="button">
        Return to Login
      </button>
    </>
  )
}

export function AppHeader({ activeScreen, isAuthenticated, logoSrc, onLogout, onNavigate }) {
  return (
    <header className="app-header">
      <div className="app-header__left">
        <div className="brand-logo">
          <img alt="SyncDev logo" src={logoSrc} />
        </div>
        <div className="brand-copy">
          <span>SyncDev</span>
          <StatusPill label="sync ready" tone="success" />
        </div>
      </div>

      <div className="app-header__center">
        <span className="header-title">SyncDev</span>
      </div>

      <div className="app-header__right">
        {isAuthenticated ? (
          <Button onClick={onLogout} variant="danger">
            Logout
          </Button>
        ) : (
          <>
            <Button onClick={() => onNavigate('login')} variant={activeScreen === 'login' ? 'primary' : 'secondary'}>
              Login
            </Button>
            <Button
              onClick={() => onNavigate('register')}
              variant={activeScreen === 'register' ? 'primary' : 'secondary'}
            >
              Register
            </Button>
          </>
        )}
      </div>
    </header>
  )
}

export function AuthScreen(props) {
  const { mode } = props
  const eyebrow = mode === 'login' ? '< access />' : mode === 'register' ? '< provision />' : '< recovery />'
  const stamp = mode === 'login' ? '{ }' : mode === 'register' ? '< >' : '//'

  return (
    <main className="page page--auth">
      <section className="auth-shell">
        <AuthRail mode={mode} />
        <SectionCard className="auth-panel" eyebrow={eyebrow} stamp={stamp}>
          {mode === 'login' ? <LoginForm {...props} /> : null}
          {mode === 'register' ? <RegisterForm {...props} /> : null}
          {mode === 'forgot' ? <ForgotForm {...props} /> : null}
        </SectionCard>
      </section>
    </main>
  )
}

export function DashboardScreen({
  activeUser,
  dashboardBanner,
  dashboardBusy,
  joinRoomId,
  onInitializeSession,
  onJoinRoomIdChange,
  onJoinSession,
  onReconnect,
  recentSessions,
}) {
  return (
    <main className="page page--dashboard">
      <section className="dashboard-grid">
        <SectionCard
          className="dashboard-hero"
          eyebrow="// workspace"
          stamp="{ }"
          subtitle="Create or join a collaboration session."
          title="Welcome back, engineer."
        >
          {dashboardBanner ? <AlertBox {...dashboardBanner} /> : null}

          <div className="dashboard-actions">
            <Button onClick={onInitializeSession} variant="primary">
              {dashboardBusy === 'create' ? (
                <>
                  <TerminalSpinner />
                  Initializing Session
                </>
              ) : (
                'Initialize Session'
              )}
            </Button>

            <form className="join-shell" onSubmit={onJoinSession}>
              <Field
                hint="// target room"
                label="ROOM_ID"
                onChange={(event) => onJoinRoomIdChange(event.target.value.toUpperCase())}
                placeholder="SD-2048"
                required
                type="text"
                value={joinRoomId}
              />
              <Button className="join-shell__button" type="submit" variant="secondary">
                {dashboardBusy === 'join' ? (
                  <>
                    <TerminalSpinner />
                    Connecting
                  </>
                ) : (
                  'Connect to Session'
                )}
              </Button>
            </form>
          </div>

          <div className="hint-strip">
            <div>
              <span className="hint-strip__label">Operator</span>
              <strong>{activeUser}</strong>
            </div>
            <div>
              <span className="hint-strip__label">Status</span>
              <strong>Ready for pair session</strong>
            </div>
            <div>
              <span className="hint-strip__label">Shortcut</span>
              <strong>
                <KeyHint>CTRL</KeyHint>
                <KeyHint>K</KeyHint>
              </strong>
            </div>
          </div>
        </SectionCard>

        <SectionCard
          className="metrics-card"
          eyebrow="// transport"
          stamp="< >"
          subtitle="Live collaboration telemetry"
          title="Connection Status"
        >
          <div className="metric-stack">
            <div className="metric-row">
              <span>Session fabric</span>
              <StatusPill label="connected" tone="success" />
            </div>
            <div className="metric-row">
              <span>Presence bus</span>
              <strong>12 peers online</strong>
            </div>
            <div className="metric-row">
              <span>Editor latency</span>
              <strong>18ms</strong>
            </div>
            <div className="metric-row">
              <span>Persistence</span>
              <strong>checkpoint synced</strong>
            </div>
          </div>
        </SectionCard>

        <SectionCard
          className="workspace-card"
          eyebrow="// live surface"
          stamp="//"
          subtitle="Shared editor preview"
          title="Collaboration Canvas"
        >
          <div className="workspace-window">
            <div className="workspace-window__toolbar">
              <div className="workspace-tabs">
                <span className="workspace-tab workspace-tab--active">session.tsx</span>
                <span className="workspace-tab">presence.ts</span>
                <span className="workspace-tab">room.config</span>
              </div>
              <StatusPill label="2 cursors active" tone="success" />
            </div>

            <div className="workspace-window__body">
              <div className="code-lines">
                <div className="code-line">
                  <span className="line-no">01</span>
                  <span className="line-code">export const sessionState = {'{'}</span>
                </div>
                <div className="code-line">
                  <span className="line-no">02</span>
                  <span className="line-code code-line--accent">  roomId: &apos;{joinRoomId}&apos;,</span>
                </div>
                <div className="code-line">
                  <span className="line-no">03</span>
                  <span className="line-code">  presence: &apos;synced&apos;,</span>
                </div>
                <div className="code-line">
                  <span className="line-no">04</span>
                  <span className="line-code">  peers: ['me', 'pair-engineer'],</span>
                </div>
                <div className="code-line">
                  <span className="line-no">05</span>
                  <span className="line-code">  transport: &apos;websocket&apos;,</span>
                </div>
                <div className="code-line">
                  <span className="line-no">06</span>
                  <span className="line-code">  mode: &apos;collaborative&apos;,</span>
                </div>
                <div className="code-line">
                  <span className="line-no">07</span>
                  <span className="line-code">{'}'}</span>
                </div>
              </div>

              <div className="presence-rail">
                <div className="presence-card">
                  <span className="presence-card__name">you</span>
                  <span className="presence-card__state">editing session.tsx</span>
                </div>
                <div className="presence-card presence-card--accent">
                  <span className="presence-card__name">pair-engineer</span>
                  <span className="presence-card__state">cursor at line 04</span>
                </div>
              </div>
            </div>
          </div>
        </SectionCard>

        <SectionCard
          className="sessions-card"
          eyebrow="// history"
          stamp="{ }"
          subtitle="UI only"
          title="Recent Sessions"
        >
          <div className="session-list">
            {recentSessions.map((session) => (
              <SessionCard
                busy={dashboardBusy === session.id}
                key={session.id}
                onReconnect={onReconnect}
                session={session}
              />
            ))}
          </div>
        </SectionCard>
      </section>
    </main>
  )
}
