import React from "react";
import ReactDOM from "react-dom/client";
import App from "@/App.jsx";
import "./index.css";  // se você usa esse arquivo
import "./App.css";    // garante que o App.css entra antes do App

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
