import { useState } from 'react'
import { Routes, Route, Navigate, useNavigate } from 'react-router-dom'
import { jwtDecode } from 'jwt-decode'
import Login from './pages/Login'
import Register from './pages/Register'
import Dashboard from './pages/Dashboard'
import Editor from './pages/Editor'

function App() {
  const [token, setToken] = useState(localStorage.getItem('token'))
  const navigate = useNavigate()

  const getUsername = () => {
    try {
      return jwtDecode(token).user?.username || 'user'
    } catch {
      return 'user'
    }
  }

  const handleLogin = (token) => {
    localStorage.setItem('token', token)
    setToken(token)
    navigate('/dashboard')
  }

  const handleLogout = () => {
    localStorage.removeItem('token')
    setToken(null)
    navigate('/login')
  }

  return (
    <Routes>
      <Route path="/login" element={!token ? <Login onLogin={handleLogin} /> : <Navigate to="/dashboard" />} />
      <Route path="/register" element={!token ? <Register /> : <Navigate to="/dashboard" />} />
      <Route path="/dashboard" element={token ? <Dashboard onLogout={handleLogout} username={getUsername()} /> : <Navigate to="/login" />} />
      <Route path="/editor/:roomId" element={token ? <Editor username={getUsername()} /> : <Navigate to="/login" />} />
      <Route path="*" element={<Navigate to={token ? '/dashboard' : '/login'} />} />
    </Routes>
  )
}

export default App