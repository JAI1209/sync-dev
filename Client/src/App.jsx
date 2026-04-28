import { useEffect, useState } from "react";
import { Navigate, Route, Routes, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { AppHeader, AuthScreen } from "./components/screens";
import Dashboard from "./pages/Dashboard";
import Editor from "./pages/Editor";
import GitHubAuthCallback from "./pages/GitHubAuthCallback";
import logoSrc from "./assets/SD.png";
import { googleLogin, loginUser, registerUser } from "./api/auth";
import { useAuth } from "./context/AuthContext";

export default function App() {
  const { token, setToken, username, handleLogout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const githubErrorQ = searchParams.get("github_error");

  const [authMode, setAuthMode] = useState("login");
  const [authBusy, setAuthBusy] = useState(null);
  const [authBanner, setAuthBanner] = useState(null);
  const [showPassword, setShowPassword] = useState(false);

  const [loginForm, setLoginForm] = useState({ username: "", password: "", remember: false });
  const [registerForm, setRegisterForm] = useState({
    username: "",
    email: "",
    password: "",
    confirmPassword: "",
  });
  const [forgotForm, setForgotForm] = useState({ email: "" });

  useEffect(() => {
    if (token || location.pathname !== "/login" || !githubErrorQ) return;
    setAuthBanner({
      tone: "danger",
      title: "GitHub sign-in",
      detail: decodeURIComponent(githubErrorQ),
    });
  }, [githubErrorQ, location.pathname, token]);

  const handleLoginChange = (field, value) => {
    setLoginForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleLoginSubmit = async (event) => {
    event.preventDefault();
    setAuthBanner(null);
    setAuthBusy("login");
    const data = await loginUser(loginForm.username, loginForm.password);
    setAuthBusy(null);

    if (data.token) {
      setToken(data.token);
      if (data.refreshToken) localStorage.setItem("refreshToken", data.refreshToken);
      navigate("/dashboard");
      return;
    }

    setAuthBanner({ tone: "danger", title: "Auth failed", detail: data.msg || "Invalid credentials" });
  };

  const handleGoogleSuccess = async (credentialResponse) => {
    setAuthBanner(null);
    const data = await googleLogin(credentialResponse.credential);

    if (data.token) {
      setToken(data.token);
      if (data.refreshToken) localStorage.setItem("refreshToken", data.refreshToken);
      navigate("/dashboard");
      return;
    }

    setAuthBanner({
      tone: "danger",
      title: "Google login failed",
      detail: "Try again or use username/password",
    });
  };

  const handleRegisterChange = (field, value) => {
    setRegisterForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleRegisterSubmit = async (event) => {
    event.preventDefault();
    setAuthBanner(null);

    if (registerForm.password !== registerForm.confirmPassword) {
      setAuthBanner({ tone: "danger", title: "Password mismatch", detail: "Both password fields must match" });
      return;
    }

    setAuthBusy("register");
    const data = await registerUser(registerForm.username, registerForm.password, registerForm.email);
    setAuthBusy(null);

    if (data.token) {
      setAuthBanner({ tone: "success", title: "Account created", detail: "You can now sign in" });
      setAuthMode("login");
      return;
    }

    setAuthBanner({
      tone: "danger",
      title: "Registration failed",
      detail: data.msg || "Try a different username",
    });
  };

  const handleForgotChange = (field, value) => {
    setForgotForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleForgotSubmit = async (event) => {
    event.preventDefault();
    setAuthBusy("forgot");

    try {
      const res = await fetch("/api/auth/forgot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: forgotForm.email }),
      });
      const data = await res.json();
      setAuthBanner({
        tone: res.ok ? "success" : "danger",
        title: res.ok ? "Reset link queued" : "Error",
        detail: data.msg || (res.ok ? "Check your inbox" : "Please try again"),
      });
    } catch {
      setAuthBanner({ tone: "danger", title: "Network error", detail: "Could not reach server" });
    } finally {
      setAuthBusy(null);
    }
  };

  const handleAuthNavigate = (mode) => {
    setAuthBanner(null);
    if (mode === "login") navigate("/login");
    else if (mode === "register") navigate("/register");
    else setAuthMode(mode);
  };

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
    onTogglePassword: () => setShowPassword((prev) => !prev),
    onGoogleSuccess: handleGoogleSuccess,
    onGoogleError: () => setAuthBanner({ tone: "danger", title: "Google login failed" }),
  };

  return (
    <div className="app-shell">
      <Routes>
        <Route
          path="/login"
          element={
            token ? (
              <Navigate to="/dashboard" />
            ) : (
              <>
                <AppHeader
                  activeScreen="login"
                  isAuthenticated={false}
                  logoSrc={logoSrc}
                  onLogout={handleLogout}
                  onNavigate={handleAuthNavigate}
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
            token ? (
              <Navigate to="/dashboard" />
            ) : (
              <>
                <AppHeader
                  activeScreen="register"
                  isAuthenticated={false}
                  logoSrc={logoSrc}
                  onLogout={handleLogout}
                  onNavigate={handleAuthNavigate}
                />
                <AuthScreen {...authProps} mode="register" />
              </>
            )
          }
        />

        <Route
          path="/dashboard"
          element={
            token ? (
              // FIX: Route the actual dashboard page so the repaired Dashboard.jsx UI is used.
              <Dashboard onLogout={handleLogout} username={username} />
            ) : (
              <Navigate to="/login" />
            )
          }
        />

        <Route path="/editor/:roomId" element={token ? <Editor username={username} /> : <Navigate to="/login" />} />
        <Route path="*" element={<Navigate to={token ? "/dashboard" : "/login"} />} />
      </Routes>
    </div>
  );
}
