import { apiUrl } from "./client";

export async function loginUser(username, password) {
  const res = await fetch(apiUrl("/api/auth/login"), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  return res.json();
}

export async function registerUser(username, password, email) {
  const res = await fetch(apiUrl("/api/auth/register"), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password, email }),
  });
  return res.json();
}

export async function googleLogin(credential) {
  const res = await fetch(apiUrl("/api/auth/google"), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ credential }),
  });
  return res.json();
}

export async function refreshAccessToken() {
  const refreshToken = localStorage.getItem('refreshToken');
  if (!refreshToken) return false;

  const res = await fetch(apiUrl('/api/auth/refresh'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken }),
  });

  if (!res.ok) return false;
  const data = await res.json();
  if (!data.token) return false;

  localStorage.setItem('token', data.token);
  if (data.refreshToken) {
    localStorage.setItem('refreshToken', data.refreshToken);
  }

  return true;
}
