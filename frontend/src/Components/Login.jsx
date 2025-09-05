import { useState } from "react";
import { FaUser, FaLock } from "react-icons/fa";
import Toast from "@/components/Toast"; // importe o toast
import "./Login.css";
import "@fontsource/poppins";
import "@fontsource/poppins/500.css";
import "@fontsource/poppins/700.css";

const Login = ({ onLoginSuccess }) => {
  const [username, setUsername] = useState(""); 
  const [password, setPassword] = useState(""); 
  const [errorToast, setErrorToast] = useState(null); // mensagem de erro

  const handleSubmit = async (event) => {
    event.preventDefault();

    try {
      const response = await fetch(`${import.meta.env.VITE_API_URL}/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ login: username, password }),
        credentials: "include",
      });

      const data = await response.json();

      if (response.ok) {
        sessionStorage.setItem("loginOk", "1");
        onLoginSuccess?.();
      } else {
        // exibe toast de erro
        setErrorToast(data.message || "Login ou senha incorretos!");
      }
    } catch (error) {
      setErrorToast("Erro ao conectar com o servidor!");
      console.error("Error ao fazer login:", error);
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

      {/* Toast de erro */}
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
};

export default Login;
