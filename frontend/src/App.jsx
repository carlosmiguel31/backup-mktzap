import "./App.css";
import Login from "@/Components/Login";
import Historico from "@/pages/historico";
import Toast from "@/components/Toast";
import { useState } from "react";

function App() {
  const [page, setPage] = useState("login");
  const [showToast, setShowToast] = useState(false);

  return (
    <>
      {page === "login" && (
        <Login
          onLoginSuccess={() => {
            setPage("historico");
            setShowToast(true); // ativa o toast no login
          }}
        />
      )}

      {page === "historico" && <Historico />}

      {showToast && (
        <Toast
          message="Login realizado com sucesso!"
          duration={5000}
          onClose={() => setShowToast(false)}
        />
      )}
    </>
  );
}

export default App;
