import { createContext, useContext, useState } from 'react'
import { jwtDecode } from 'jwt-decode'

const AuthContext = createContext(null)

function decodeUsername(token) {
    if (!token) return ''
    try {
        const decoded = jwtDecode(token)
        return decoded?.user?.username || ''
    } catch {
        return ''
    }
}

export function AuthProvider({ children }) {
    const [token, setTokenState] = useState(() => localStorage.getItem('token') || '')

    const setToken = (newToken) => {
        if (newToken) {
            localStorage.setItem('token', newToken);
        } else {
            localStorage.removeItem('token');
        }
        setTokenState(newToken);
    };
    const username = decodeUsername(token)
    const isAuthenticated = Boolean(token)

    const handleLogout = () => {
        localStorage.removeItem('refreshToken');
        setToken('');
    };

    return (
        <AuthContext.Provider value={{ token, setToken, username, isAuthenticated, handleLogout }}>
            {children}
        </AuthContext.Provider>
    )
}

export function useAuth() {
    return useContext(AuthContext)
}
