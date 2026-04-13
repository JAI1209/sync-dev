import { useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

export default function GitHubAuthCallback() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  useEffect(() => {
    const token = searchParams.get("token");
    const ghErr = searchParams.get("github_error");
    if (token) {
      localStorage.setItem("token", token);
      navigate("/dashboard", { replace: true });
      return;
    }
    if (ghErr) {
      navigate(`/login?github_error=${encodeURIComponent(ghErr)}`, { replace: true });
      return;
    }
    navigate("/login", { replace: true });
  }, [navigate, searchParams]);

  return (
    <main className="page page--auth" style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "50vh" }}>
      <p style={{ color: "var(--muted)", fontSize: 14, fontFamily: "inherit" }}>Completing GitHub sign-in…</p>
    </main>
  );
}
