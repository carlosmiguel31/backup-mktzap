import { useState } from "react";
import { FaUser, FaLock } from "react-icons/fa";
import Toast from "@/Components/Toast.jsx";
import "./Login.css";
import "@fontsource/poppins";
import "@fontsource/poppins/500.css";
import "@fontsource/poppins/700.css";

const API = (import.meta.env.VITE_API_URL || "/api").replace(/\/$/, "");

async function fetchJSON(url, opts = {}) {
  const res = await fetch(url, { credentials: "include", ...opts });
  const ct = res.headers.get("content-type") || "";
  const raw = await res.text().catch(() => "");
  let data = raw;
  if (ct.includes("application/json")) {
    try { data = JSON.parse(raw); } catch {}
  }
  if (!res.ok) {
    const msg = (data && data.message) || (typeof data === "string" ? data : "") || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data;
}

export default function Login({ onLoginSuccess }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [errorToast, setErrorToast] = useState(null);

  const handleSubmit = async (event) => {
    event.preventDefault();
    try {
      await fetchJSON(`${API}/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ login: username, password }),
      });
      sessionStorage.setItem("loginOk", "1");
      onLoginSuccess?.();
    } catch (err) {
      setErrorToast(err.message || "Login ou senha incorretos!");
    }
  };

  return (
    <div className="container">
      <form onSubmit={handleSubmit}>
        <img src="bro.webp" alt="Logo do Sistema" className="logo" />
        <div className="input-field">
          <input
            type="text"
            placeholder="Usuário"
            required
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
          <FaUser className="icon" />
        </div>
        <div className="input-field">
          <input
            type="password"
            placeholder="Senha"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <FaLock className="icon" />
        </div>

        <div className="recall-forget">
          <label>
            <input type="checkbox" />
            Lembre de mim
          </label>
        </div>
        <button type="submit">Login</button>
      </form>

      {errorToast && (
        <Toast
          type="error"
          message={errorToast}
          duration={5000}
          onClose={() => setErrorToast(null)}
        />
      )}
    </div>
  );
}
