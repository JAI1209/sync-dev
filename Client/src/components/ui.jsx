import { useEffect, useId, useState } from 'react'
import { useTheme } from '../context/ThemeContext.jsx'

function cx(...values) {
  return values.filter(Boolean).join(' ')
}

export function Button({ children, className = '', icon, variant = 'primary', ...props }) {
  const busy = props.disabled && typeof children !== 'string'
  return (
    <button className={cx('button', `button--${variant}`, className)} type="button" {...props}>
      {icon ? <span className="button__icon">{icon}</span> : null}
      {busy ? <span className="button__spinner-wrap"><TerminalSpinner /></span> : null}
      <span>{children}</span>
    </button>
  )
}

export function Field({ label, hint, trailing, className = '', ...props }) {
  const inputId = useId()
  return (
    <div className={cx('field', className)}>
      <div className="field__meta">
        <label className="field__label" htmlFor={inputId}>{label}</label>
        {hint ? <span className="field__hint">{hint}</span> : null}
      </div>
      <div className="input-shell">
        <input className="input" id={inputId} {...props} />
        <span aria-hidden="true" className="input-shell__cursor" />
        {trailing ? <div className="input-shell__trailing">{trailing}</div> : null}
      </div>
    </div>
  )
}

export function Checkbox({ checked, label, onChange }) { const inputId = useId(); return <label className="checkbox" htmlFor={inputId}><input checked={checked} id={inputId} onChange={(event) => onChange(event.target.checked)} type="checkbox" /><span aria-hidden="true" className="checkbox__box" /><span className="checkbox__label">{label}</span></label> }

export function AlertBox({ detail, tone = 'info', title }) {
  const role = tone === 'danger' ? 'alert' : 'status'
  const icon = tone === 'success' ? '✓' : tone === 'danger' ? '✕' : 'ℹ'
  return (
    <div className={cx('alert-box', `alert-box--${tone}`)} role={role} aria-live="polite">
      <span className="alert-box__icon" aria-hidden="true">{icon}</span>
      <div><p className="alert-box__title">{title}</p>{detail ? <p className="alert-box__detail">{detail}</p> : null}</div>
    </div>
  )
}

export const Divider = ({ text }) => <div className="divider" role="presentation"><span>{text}</span></div>
export function OAuthButton({ children, provider, ...props }) { const icon = provider === 'google' ? <GoogleBadge /> : <GitHubBadge />; return <Button className="oauth-button" icon={icon} variant="secondary" {...props}>{children}</Button> }

export function SectionCard({ actions, children, className = '', eyebrow, stamp, subtitle, title }) {
  return <section className={cx('section-card', className)}>{stamp ? <span className="section-card__stamp">{stamp}</span> : null}{(eyebrow || title || subtitle || actions) ? <header className="section-card__header"><div className="section-card__heading">{eyebrow ? <p className="section-card__eyebrow">{eyebrow}</p> : null}{title ? <h2 className="section-card__title">{title}</h2> : null}{subtitle ? <p className="section-card__subtitle">{subtitle}</p> : null}</div>{actions ? <div className="section-card__actions">{actions}</div> : null}</header> : null}{children}</section>
}

export const StatusPill = ({ label, tone = 'neutral' }) => <span className={cx('status-pill', `status-pill--${tone}`)}><span className="status-pill__dot" aria-hidden="true" />{label}</span>

export function TerminalSpinner() { const frames = ['|', '/', '-', '\\']; const [index, setIndex] = useState(0); useEffect(() => { const timer = window.setInterval(() => setIndex((current) => (current + 1) % frames.length), 120); return () => window.clearInterval(timer) }, [frames.length]); return <span className="terminal-spinner-wrap"><span className="terminal-spinner" aria-hidden="true">[{frames[index]}]</span></span> }

export function ThemeToggle({ className = '' }) { const { theme, toggleTheme } = useTheme(); const nextTheme = theme === 'dark' ? 'light' : 'dark'; return <button aria-label={`Switch to ${nextTheme} mode`} className={cx('theme-toggle', className)} onClick={toggleTheme} title={`Switch to ${nextTheme} mode`} type="button"><span className="sr-only">Toggle theme</span><span aria-hidden="true" className="theme-toggle__track"><span className="theme-toggle__thumb" /></span></button> }

export function SessionCard({ busy, onReconnect, session }) { return <article className="session-card"><div className="session-card__meta"><div><p className="session-card__label">ROOM ID</p><p className="session-card__value">{session.id}</p></div><StatusPill label={session.status === 'live' ? 'live sync' : session.status} tone={session.status === 'live' ? 'success' : 'neutral'} /></div><dl className="session-card__details"><div><dt>Participants</dt><dd>{session.participants}</dd></div><div><dt>Created</dt><dd>{session.created}</dd></div></dl><Button className="session-card__action" onClick={() => onReconnect(session)} variant="secondary">{busy ? <><TerminalSpinner />Reconnecting</> : 'Reconnect'}</Button></article> }

export const KeyHint = ({ children }) => <span className="key-hint">{children}</span>
export function GoogleBadge() { return <span className="brand-badge brand-badge--google" aria-hidden="true"><svg viewBox="0 0 20 20"><path d="M10 2h3v3h-3z" fill="#EA4335" /><path d="M13 2h5v3h-5z" fill="#FBBC05" /><path d="M2 8h3v4H2z" fill="#34A853" /><path d="M5 12h8v3H5z" fill="#4285F4" /></svg></span> }
export function GitHubBadge() { return <span className="brand-badge brand-badge--github" aria-hidden="true"><svg viewBox="0 0 20 20"><path d="M10 2.5a6.5 6.5 0 0 0-2.05 12.68v-2.2c-1.94.42-2.44-.82-2.44-.82-.34-.86-.82-1.08-.82-1.08-.68-.46.05-.45.05-.45.75.05 1.14.77 1.14.77.66 1.13 1.74.8 2.17.61.07-.48.26-.81.47-1-1.55-.18-3.18-.78-3.18-3.5 0-.78.28-1.42.75-1.92-.08-.18-.33-.9.07-1.88 0 0 .6-.19 1.96.73A6.7 6.7 0 0 1 10 5.78c.6 0 1.2.08 1.77.24 1.36-.92 1.97-.73 1.97-.73.39.98.14 1.7.07 1.88.46.5.75 1.14.75 1.92 0 2.73-1.64 3.31-3.2 3.49.25.22.48.65.48 1.33v1.97A6.5 6.5 0 0 0 10 2.5Z" fill="currentColor" /></svg></span> }
