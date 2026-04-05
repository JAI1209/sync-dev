import { useState } from 'react'
import Login from './pages/Login'
import Register from './pages/Register'
import Dashboard from './pages/Dashboard'

function App() {
  const [page, setPage] = useState('login')
  const [token, setToken] = useState(localStorage.getItem('token'))

  const handleLogin = (token) => {
    localStorage.setItem('token', token)
    setToken(token)
    setPage('dashboard')
  }

  const handleLogout = () => {
    localStorage.removeItem('token')
    setToken(null)
    setPage('login')
  }

  if (token) return <Dashboard onLogout={handleLogout} />

  if (page === 'login')
    return <Login onLogin={handleLogin} onGoRegister={() => setPage('register')} />

  if (page === 'register')
    return <Register onGoLogin={() => setPage('login')} />
}

export default App