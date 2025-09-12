import { useEffect, useMemo, useState } from "react";
import { SlDoc, SlClose } from "react-icons/sl";
import { HiChevronDoubleDown, HiChevronDoubleUp } from "react-icons/hi2";
import "./historico.css";
import Popup from "@/Components/Popup.jsx";

/** ===== Base URL da API ===== */
const API = (import.meta.env.VITE_API_URL || "/api").replace(/\/$/, "");

/** ===== datas ===== */
function parseDate(val) {
  if (!val) return null;
  if (val instanceof Date) return Number.isNaN(val.getTime()) ? null : val;

  let s = String(val);
  if (/^\d+$/.test(s)) {
    const d = new Date(Number(s));
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d+)?$/.test(s)) {
    s = s.replace(" ", "T") + "Z";
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}
function fmtDate(val) {
  const d = parseDate(val);
  return d ? d.toLocaleString() : "—";
}

/** ===== HTTP helpers ===== */
async function fetchJson(pathOrUrl, options = {}) {
  const url = pathOrUrl.startsWith("http") ? pathOrUrl : `${API}${pathOrUrl}`;
  const r = await fetch(url, { credentials: "include", ...options });
  const ct = r.headers.get("content-type") || "";
  const raw = await r.text().catch(() => "");
  let data = raw;
  if (ct.includes("application/json")) {
    try { data = JSON.parse(raw); } catch {}
  }
  if (!r.ok) {
    const msg = (data && data.message) || (typeof data === "string" ? data : "") || `HTTP ${r.status}`;
    const err = new Error(msg);
    err.status = r.status;
    err.detail = data?.detail;
    throw err;
  }
  return data;
}

async function ensureLogin() {
  try {
    const s = await fetchJson(`/session`);
    if (s.loggedIn) return true;
  } catch { /* tenta login */ }

  // para testes/staging; em produção o usuário usa tela de login
  const r = await fetch(`${API}/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ login: "admin", password: "Une@1234" }),
  });
  if (!r.ok) return false;
  const j = await r.json().catch(() => ({}));
  return j.success === true;
}

/** ===== UI ===== */
function Bubble({ side, text, when }) {
  return (
    <div className={`bubbleWrap ${side === "left" ? "left" : "right"}`}>
      <div className="bubble">
        <div className="bubbleText">{text}</div>
        <div className="bubbleWhen">{when}</div>
      </div>
    </div>
  );
}

function HistoryModal({ item, msgs, loading, err, onClose, onExport }) {
  const [q, setQ] = useState("");

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.classList.add("no-scroll");
    document.body.style.overflow = "hidden";
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.classList.remove("no-scroll");
      document.body.style.overflow = prev || "";
    };
  }, [onClose]);

  const filtered = q
    ? msgs.filter((m) => (m.message || "").toLowerCase().includes(q.toLowerCase()))
    : msgs;

  return (
    <div className="overlay" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modalHeader">
          <div className="mhLeft">
            <div className="mhTitle">Consulta de Histórico</div>
            <div className="mhSub">Protocolo: {item.numero}</div>
          </div>
          <button className="iconClose" onClick={onClose} aria-label="Fechar">
            <SlClose className="icon" />
          </button>
        </div>

        <div className="modalToolbar">
          <div className="infoGrid">
            <div><strong>Telefone do Cliente: {item.cliente_contato ?? "—"}</strong></div>
            <div><strong>Atendente: {item.atendente_nome ?? "—"}</strong></div>
            <div><strong>Aberto em: {fmtDate(item.data_abertura)}</strong></div>
          </div>
          <div className="searchRow">
            <input
              className="searchInput"
              placeholder="Digite o termo ou frase do conteúdo que deseja encontrar"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <button className="searchBtn" type="button">🔍</button>
          </div>
        </div>

        <div className="modalBody">
          <div className="messages">
            {err && <div className="empty">Erro: {err}</div>}
            {!err &&
              (loading ? (
                <div>Carregando mensagens…</div>
              ) : filtered.length === 0 ? (
                <div className="empty">Sem mensagens</div>
              ) : (
                filtered.map((m) => (
                  <Bubble
                    key={m.id}
                    side={m.sent_by_operator ? "right" : "left"}
                    text={m.message}
                    when={fmtDate(m.created_at)}
                  />
                ))
              ))}
          </div>
        </div>

        <div className="modalFooter">
          <div className="footerActions">
            <button className="btn secondary" type="button" onClick={() => onExport(item.id)}>
              Gerar PDF <SlDoc className="icon" />
            </button>
            <button className="btn primary" type="button" onClick={onClose}>
              Fechar <SlClose className="icon" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Card({ item, expanded, onToggle, onExport }) {
  const [msgs, setMsgs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!expanded) return;
    let abort = false;
    (async () => {
      setLoading(true);
      setErr("");
      try {
        const data = await fetchJson(`/historico/${encodeURIComponent(item.id)}/mensagens`);
        if (!abort) setMsgs(data || []);
      } catch (e) {
        if (!abort) setErr(e.message || "Falha ao carregar mensagens");
      } finally {
        if (!abort) setLoading(false);
      }
    })();
    return () => { abort = true; };
  }, [expanded, item.id]);

  return (
    <div className="card">
      <div className="cardGrid">
        <strong>Protocolo: {item.numero}</strong>
        <div>Telefone: {item.cliente_contato || "—"}</div>
        <div>Atendente: {item.atendente_nome ?? "—"}</div>
        <div>Data: {fmtDate(item.data_abertura)}</div>
        <button className="btn" type="button" onClick={onToggle}>
          {expanded ? <HiChevronDoubleUp className="icon" /> : <HiChevronDoubleDown className="icon" />}
        </button>
      </div>

      {expanded && (
        <HistoryModal
          item={item}
          msgs={msgs}
          loading={loading}
          err={err}
          onClose={onToggle}
          onExport={onExport}
        />
      )}
    </div>
  );
}

export default function Historico({ showPopup, onClosePopup }) {
  const [phone, setPhone] = useState("");
  const [rows, setRows] = useState([]);
  const [expandedId, setExpandedId] = useState(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [month, setMonth] = useState("");
  const pageSize = 10;

  const canSearch = useMemo(
    () => /\d{6,}/.test(phone.replace(/\D/g, "")),
    [phone]
  );

  useEffect(() => {
    (async () => {
      try { await ensureLogin(); } catch { /* ignore */ }
    })();
  }, []);

  async function search(p = page) {
    setLoading(true);
    setErr("");
    try {
      const ok = await ensureLogin();
      if (!ok) throw new Error("Falha na autenticação");

      const digits = phone.replace(/\D/g, "");
      const params = new URLSearchParams({
        phone: digits,
        page: String(p),
        pageSize: String(pageSize),
      });
      if (month) params.set("month", month);

      const j = await fetchJson(`/historico?${params.toString()}`);
      setRows(j.data || []);
      setTotal(j.total || 0);
      setPage(p);
      setExpandedId(null);
    } catch (e) {
      setErr(e.message || "Erro ao buscar histórico");
      setRows([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }

  function exportPdf(id) {
    window.location.href = `${API}/historico/${encodeURIComponent(id)}/export.pdf`;
  }

  const pages = Math.max(1, Math.ceil(total / pageSize));

  function isSameMonth(dateStr, ym) {
    if (!ym) return true;
    const d = parseDate(dateStr);
    if (!d) return false;
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    return `${yyyy}-${mm}` === ym;
  }

  const visibleRows = useMemo(
    () => rows.filter((r) => isSameMonth(r.data_abertura, month)),
    [rows, month]
  );

  return (
    <div className="root">
      <Popup isOpen={showPopup} onClose={onClosePopup}>
        <h2 className="text-xl font-bold">🚀 Bem-vindo!</h2>
        <p className="mt-2 text-gray-600">
          Você fez login com sucesso e agora está no histórico.
        </p>
      </Popup>

      <div className="header">
        <h2>Histórico</h2>
        <p>Utilize o filtro de número abaixo para obter o histórico dos atendimentos realizados.</p>
      </div>

      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          if (canSearch) search(1);
        }}
      >
        <label htmlFor="phone" style={{ fontWeight: 700 }}>Número de contato</label>
        <input
          id="phone"
          className="input"
          placeholder="(__) _____-____"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
        />

        <label htmlFor="month" style={{ fontWeight: 700 }}>Mês</label>
        <input
          id="month"
          type="month"
          className="input"
          value={month}
          onChange={(e) => setMonth(e.target.value)}
        />

        <button className="btn" disabled={!canSearch || loading} type="submit">
          {loading ? "Buscando…" : "Pesquisar"}
        </button>

        <span className="hint">{total ? `${total} resultados encontrados` : ""}</span>
      </form>

      {err && <div className="empty" style={{ marginTop: 8 }}>Erro: {err}</div>}

      <div className="results">
        {visibleRows.map((item) => (
          <Card
            key={item.id}
            item={item}
            expanded={expandedId === item.id}
            onToggle={() => setExpandedId(expandedId === item.id ? null : item.id)}
            onExport={exportPdf}
          />
        ))}
        {!visibleRows.length && !loading && !err && (
          <div className="empty">Nenhum resultado encontrado...</div>
        )}
      </div>

      {total > pageSize && (
        <div className="pager">
          <button
            className="btn"
            type="button"
            disabled={page <= 1 || loading}
            onClick={() => search(page - 1)}
          >
            Anterior
          </button>
          <span>Pagina {page} de {pages}</span>
          <button
            className="btn"
            type="button"
            disabled={page >= pages || loading}
            onClick={() => search(page + 1)}
          >
            Próxima
          </button>
        </div>
      )}
    </div>
  );
}
