import { useEffect, useState } from "react";

// Recebe: message, duration, onClose, type
export default function Toast({ message, duration = 5000, onClose, type = "success" }) {
  const [timeLeft, setTimeLeft] = useState(duration / 1000);

  useEffect(() => {
    const interval = setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 1) {
          clearInterval(interval);
          onClose?.();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [duration, onClose]);

  // Definir imagem e título por tipo
  const config = {
    success: { img: "/bro2.png", title: "Sucesso!" },
    error: { img: "/bro_error.png", title: "Erro!" },
    warning: { img: "/bro_cuidado.png", title: "Atenção!" },
  };

  const { img, title } = config[type] || config.success;

  return (
    <div className="toastContainer">
      <div className="toast">
        <div className="toastImg placeholder">
          <img src={img} alt={title} className="logo" />
        </div>

        <div className="toastBody">
          <div className="toastTitle">{title}</div>
          <div className="toastMsg">{message}</div>
          <div className="toastMsg">Fechando em {timeLeft}s...</div>

          <div className="toastProgressWrap">
            <div
              className="toastProgress"
              style={{ animationDuration: `${duration}ms` }}
            ></div>
          </div>
        </div>
        <button className="toastClose" onClick={onClose}>✖</button>
      </div>
    </div>
  );
}
