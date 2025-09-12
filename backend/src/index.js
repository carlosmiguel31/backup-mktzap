import express from "express";
import session from "express-session";
import cors from "cors";
import dotenv from "dotenv";
import pg from "pg";
import PDFDocument from "pdfkit";

dotenv.config();
const { Pool } = pg;

const app = express();

/* ========= Server ========= */
const PORT = Number(process.env.PORT || 8000);
const HOST = process.env.HOST || "0.0.0.0";
app.set("trust proxy", 1); // atrás do Nginx

/* ========= Admin (credenciais) =========
 * Em produção, defina ADMIN_LOGIN/ADMIN_PASSWORD no .env.
 * (Se quiser habilitar fallback "admin/Une@1234" em prod,
 *  coloque AUTH_DEV_FALLBACK=true no .env)
 */
const DEV_FALLBACK =
  (process.env.AUTH_DEV_FALLBACK || "false").toLowerCase() === "true";

const useDevDefaults =
  process.env.NODE_ENV !== "production" || DEV_FALLBACK;

const ADMIN_LOGIN = process.env.ADMIN_LOGIN || (useDevDefaults ? "admin" : "");
const ADMIN_PASSWORD =
  process.env.ADMIN_PASSWORD || (useDevDefaults ? "Une@1234" : "");

/* ========= Postgres ========= */
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  keepAlive: true,
  ssl:
    String(process.env.DATABASE_SSL || "").toLowerCase() === "true"
      ? { rejectUnauthorized: false }
      : undefined,
});

/* ========= CORS & Body =========
 * Como o front e o back rodam no mesmo host/porta por trás do Nginx,
 * refletir a Origin é o suficiente. (credentials: true)
 */
app.use(
  cors({
    origin: true,
    credentials: true,
  })
);

app.use(express.json());

/* ========= Sessão ========= */
const cookieSecure =
  (process.env.SESSION_SECURE || "").toLowerCase() === "true"; // true se HTTPS
const cookieSameSite = process.env.SESSION_SAMESITE || "lax";  // 'lax' ou 'none' (se HTTPS)

app.use(
  session({
    secret: process.env.SESSION_SECRET || "dev_secret",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: cookieSameSite,
      secure: cookieSecure,
      // maxAge: 1000 * 60 * 60 * 8, // opcional: 8h
    },
  })
);

/* ========= Auth middleware ========= */
function requireAuth(req, res, next) {
  // Liberação total opcional para testes: AUTH_DISABLED=true
  if ((process.env.AUTH_DISABLED || "false").toLowerCase() === "true") {
    return next();
  }
  if (!req.session?.login) {
    return res.status(401).json({ ok: false, message: "Não autenticado" });
  }
  return next();
}

/* ========= Helpers ========= */
function sanitizeFilename(s) {
  return String(s).replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 100) || "arquivo";
}

/* ========= Health ========= */
const healthHandler = (_req, res) => res.status(200).json({ ok: true });
app.get("/health", healthHandler);
app.get("/api/health", healthHandler);

app.get(["/health/db", "/api/health/db"], async (_req, res) => {
  try {
    const r = await pool.query("SELECT now()");
    res.json({ ok: true, time: r.rows[0].now });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

/* ========= Auth ========= */
const loginHandler = (req, res) => {
  const { login, password } = req.body || {};
  const ok =
    ADMIN_LOGIN &&
    login === ADMIN_LOGIN &&
    password === ADMIN_PASSWORD;

  if (ok) {
    req.session.login = login; // guarda o usuário logado
    return res.json({ success: true, user: login });
  }
  return res.status(401).json({ success: false, message: "Usuário ou senha inválidos" });
};

const sessionHandler = (req, res) =>
  res.json({ loggedIn: !!req.session?.login, user: req.session?.login || null });

const logoutHandler = (req, res) =>
  req.session.destroy((err) =>
    err ? res.status(500).json({ success: false }) : res.json({ success: true })
  );

app.post("/login", loginHandler);
app.get("/session", sessionHandler);
app.post("/logout", logoutHandler);

app.post("/api/login", loginHandler);
app.get("/api/session", sessionHandler);
app.post("/api/logout", logoutHandler);

/* ========= Histórico - lista ========= */
const historicoListHandler = async (req, res) => {
  try {
    const phone = String(req.query.phone || "").replace(/\D/g, "");
    const month = String(req.query.month || "").trim();
    const page = Math.max(parseInt(req.query.page || "1", 10), 1);
    const pageSize = Math.min(Math.max(parseInt(req.query.pageSize || "20", 10), 1), 100);
    const offset = (page - 1) * pageSize;

    const params = [];
    const where = [];

    if (phone) {
      params.push(phone);
      where.push(
        `regexp_replace(COALESCE(fl.phone::text,''), '[^0-9]', '', 'g') LIKE '%' || $${params.length} || '%'`
      );
    }

    if (/^\d{4}-\d{2}$/.test(month)) {
      const [yStr, mStr] = month.split("-");
      const y = parseInt(yStr, 10);
      const m = parseInt(mStr, 10);
      const start = new Date(Date.UTC(y, m - 1, 1, 0, 0, 0)).toISOString();
      const next = new Date(Date.UTC(y, m, 1, 0, 0, 0)).toISOString();

      params.push(start);
      where.push(`fl.created_at >= $${params.length}`);
      params.push(next);
      where.push(`fl.created_at <  $${params.length}`);
    }

    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

    const totalSql = `
      WITH fl_filt AS (
        SELECT fl.protocol
        FROM public.flow_log fl
        ${whereSql}
        GROUP BY fl.protocol
      )
      SELECT COUNT(*)::int AS total FROM fl_filt
    `;
    const totalR = await pool.query(totalSql, params);
    const total = totalR.rows?.[0]?.total || 0;

    const rowsSql = `
      WITH fl_filt AS (
        SELECT fl.protocol, fl.phone, fl.created_at
        FROM public.flow_log fl
        ${whereSql}
      ),
      agg AS (
        SELECT
          protocol,
          MIN(created_at) AS data_abertura,
          MAX(created_at) AS ultima_msg_em,
          COUNT(*)        AS total_msgs,
          (ARRAY_AGG(phone ORDER BY created_at DESC))[1] AS cliente_contato
        FROM fl_filt
        GROUP BY protocol
      ),
      att AS (
        SELECT
          a.protocol,
          a.closed_by_user_id
        FROM public.atendimentos a
      ),
      u AS (
        SELECT
          att.protocol,
          COALESCE(u.display_name, u.nome, u.email, '') AS atendente_nome
        FROM att
        LEFT JOIN public.usuario u
          ON u.id_users::text = att.closed_by_user_id::text
      )
      SELECT
        a.protocol::text                     AS id,
        a.protocol::text                     AS numero,
        COALESCE(a.cliente_contato::text,'') AS cliente_contato,
        COALESCE(u.atendente_nome,'')        AS atendente_nome,
        a.data_abertura,
        a.ultima_msg_em,
        a.total_msgs
      FROM agg a
      LEFT JOIN u
        ON regexp_replace(u.protocol::text,'[^0-9]','','g')
         = regexp_replace(a.protocol::text,'[^0-9]','','g')
      ORDER BY a.ultima_msg_em DESC, a.protocol DESC
      LIMIT $${params.length + 1}
      OFFSET $${params.length + 2}
    `;

    const rowsR = await pool.query(rowsSql, [...params, pageSize, offset]);
    res.json({ page, pageSize, total, data: rowsR.rows });
  } catch (e) {
    console.error("ERRO /api/historico:", e);
    res
      .status(500)
      .json({ message: "Erro ao listar histórico", detail: e?.message || String(e) });
  }
};

app.get("/api/historico", requireAuth, historicoListHandler);
app.get("/historico", requireAuth, historicoListHandler); // compat

/* ========= Histórico - mensagens ========= */
const historicoMsgsHandler = async (req, res) => {
  try {
    const idParam = String(req.params.id);

    const sql = `
      SELECT
        c.id,
        c.sent_by_operator,
        c.history_id,
        c.message,
        c.created_at,
        u.nome
      FROM public.chats AS c
      LEFT JOIN public.usuario u
        ON c.user_id = u.id_users::INT
      LEFT JOIN public.atendimentos a
        ON c.history_id = a.id_atendimentos
      WHERE a.protocol = $1
      ORDER BY c.id ASC
    `;

    const result = await pool.query(sql, [idParam]);
    res.json(result.rows);
  } catch (e) {
    console.error("ERRO /api/historico/:id/mensagens:", e);
    res.status(500).json({
      message: "Erro ao listar mensagens",
      detail: e?.message || String(e),
    });
  }
};

app.get("/api/historico/:id/mensagens", requireAuth, historicoMsgsHandler);
app.get("/historico/:id/mensagens", requireAuth, historicoMsgsHandler); // compat

/* ========= Export PDF ========= */
const historicoExportPdfHandler = async (req, res) => {
  try {
    const idParam = String(req.params.id);

    const metaSql = `
      WITH fl AS (
        SELECT protocol, phone, created_at
        FROM public.flow_log
        WHERE protocol = $1
      ),
      agg AS (
        SELECT
          protocol,
          MIN(created_at) AS data_abertura,
          MAX(created_at) AS ultima_msg_em,
          COUNT(*)        AS total_msgs,
          (ARRAY_AGG(phone ORDER BY created_at DESC))[1] AS cliente_contato
        FROM fl
        GROUP BY protocol
      ),
      att AS (
        SELECT a.protocol, a.closed_by_user_id
        FROM public.atendimentos a
        WHERE a.protocol = $1
      ),
      u AS (
        SELECT
          att.protocol,
          COALESCE(u.display_name, u.nome, u.email, '') AS atendente_nome
        FROM att
        LEFT JOIN public.usuario u
          ON u.id_users::text = att.closed_by_user_id::text
      )
      SELECT
        a.protocol::text                     AS protocolo,
        COALESCE(a.cliente_contato::text,'') AS cliente_contato,
        COALESCE(u.atendente_nome,'')        AS atendente_nome,
        a.data_abertura,
        a.ultima_msg_em,
        a.total_msgs
      FROM agg a
      LEFT JOIN u
        ON regexp_replace(u.protocol::text,'[^0-9]','','g')
         = regexp_replace(a.protocol::text,'[^0-9]','','g')
      LIMIT 1
    `;
    const metaR = await pool.query(metaSql, [idParam]);
    const meta = metaR.rows?.[0] || {
      protocolo: idParam,
      cliente_contato: "",
      atendente_nome: "",
      data_abertura: null,
      ultima_msg_em: null,
      total_msgs: 0,
    };

    const msgsSql = `
      SELECT
        c.id,
        c.sent_by_operator,
        c.message,
        c.created_at,
        COALESCE(u.nome, '') AS nome
      FROM public.chats AS c
      LEFT JOIN public.usuario u
        ON c.user_id = u.id_users::INT
      LEFT JOIN public.atendimentos a
        ON c.history_id = a.id_atendimentos
      WHERE a.protocol = $1
      ORDER BY c.id ASC
    `;
    const msgsR = await pool.query(msgsSql, [idParam]);
    const msgs = msgsR.rows || [];

    const filename = `historico_${sanitizeFilename(idParam)}.pdf`;
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);

    const doc = new PDFDocument({ size: "A4", margin: 50 });
    doc.pipe(res);

    doc.font("Helvetica-Bold").fontSize(18).text("Histórico de Atendimento");
    doc.moveDown(0.5);
    doc.font("Helvetica").fontSize(12).text(`Protocolo: ${meta.protocolo || idParam}`);
    doc.text(`Telefone: ${meta.cliente_contato || "—"}`);
    doc.text(`Atendente: ${meta.atendente_nome || "—"}`);
    doc.text(
      `Aberto em: ${meta.data_abertura ? new Date(meta.data_abertura).toLocaleString() : "—"}`
    );
    doc.text(
      `Última mensagem: ${meta.ultima_msg_em ? new Date(meta.ultima_msg_em).toLocaleString() : "—"}`
    );
    doc.text(`Total de mensagens: ${meta.total_msgs}`);
    doc.moveDown();
    doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor("#cccccc").stroke();
    doc.moveDown();

    msgs.forEach((m, idx) => {
      const isOperador = !!m.sent_by_operator;
      const autor = isOperador ? (m.nome || "Operador") : "Cliente";
      const quando = m.created_at ? new Date(m.created_at).toLocaleString() : "—";
      const header = `${autor} — ${quando}`;

      doc.font("Helvetica-Bold").fontSize(12).fillColor("#111111");
      doc.text(header, { align: isOperador ? "right" : "left" });

      doc.font("Helvetica").fontSize(12).fillColor("#333333");
      doc.text(m.message || "", { align: isOperador ? "right" : "left" });

      if (idx < msgs.length - 1) {
        doc.moveDown(0.5);
        doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor("#eeeeee").stroke();
        doc.moveDown(0.5);
      }
    });

    doc.end();
  } catch (e) {
    console.error("ERRO /api/historico/:id/export.pdf:", e);
    res.status(500).json({
      message: "Erro ao gerar PDF",
      detail: e?.message || String(e),
    });
  }
};
app.get("/api/historico/:id/export.pdf", requireAuth, historicoExportPdfHandler);
app.get("/historico/:id/export.pdf", requireAuth, historicoExportPdfHandler);

/* ========= Start ========= */
app.listen(PORT, HOST, () => {
  console.log(
    `API rodando em http://${HOST}:${PORT} (NODE_ENV=${process.env.NODE_ENV || "dev"})`
  );
});
