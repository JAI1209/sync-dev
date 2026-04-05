import { useState } from 'react'
import { loginUser } from '../api/auth'

export default function Login({ onLogin, onGoRegister }) {
    const [username, setUsername] = useState('')
    const [password, setPassword] = useState('')
    const [error, setError] = useState('')
    const [loading, setLoading] = useState(false)

    const handleSubmit = async (e) => {
        e.preventDefault()
        setError('')
        setLoading(true)

        const data = await loginUser(username, password)
        setLoading(false)

        if (data.token) {
            onLogin(data.token)
        } else {
            setError(data.msg || 'Something went wrong')
        }
    }

    return (
        <div className="wrapper">
            <div className="card">
                <h2>SyncDev</h2>
                <p>Sign in to your account</p>

                {error && <p className="error">{error}</p>}

                <form onSubmit={handleSubmit}>
                    <div className="field">
                        <label>Username</label>
                        <input
                            type="text"
                            placeholder="Enter username"
                            value={username}
                            onChange={(e) => setUsername(e.target.value)}
                            required
                        />
                    </div>

                    <div className="field">
                        <label>Password</label>
                        <input
                            type="password"
                            placeholder="Enter password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            required
                        />
                    </div>

                    <button type="submit" disabled={loading}>
                        {loading ? 'Signing in...' : 'Sign In'}
                    </button>
                </form>

                <p style={{ marginTop: '1.25rem', fontSize: '13px', color: '#6b7094' }}>
                    Don't have an account?{' '}
                    <span className="link" onClick={onGoRegister}>
                        Register
                    </span>
                </p>
            </div>
        </div>
    )
}