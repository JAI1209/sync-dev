import { apiUrl, refreshAccessToken as refreshTokenFlow, saveAuthTokens } from "./client";

async function parseJsonSafe(res) {
  return res.json().catch(() => ({}));
}

async function postJson(path, body) {
  let res;
  try {
    res = await fetch(apiUrl(path), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error("Unable to reach the server. Please check your connection.");
  }

  const data = await parseJsonSafe(res);
  if (!res.ok) {
    return { ...data, msg: data.msg || `Request failed (${res.status})` };
  }

  return data;
}

function captureTokens(data) {
  if (data?.token) {
    saveAuthTokens(data.token, data.refreshToken);
  }
}

export async function loginUser(username, password) {
  const data = await postJson("/api/auth/login", { username, password });
  captureTokens(data);
  return data;
}

export async function registerUser(username, password, email) {
  const data = await postJson("/api/auth/register", { username, password, email });
  captureTokens(data);
  return data;
}

export async function googleLogin(credential) {
  const data = await postJson("/api/auth/google", { credential });
  captureTokens(data);
  return data;
}

export async function refreshAccessToken() {
  return refreshTokenFlow();
}
