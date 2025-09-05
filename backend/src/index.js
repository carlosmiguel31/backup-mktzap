import express from "express";
import session from "express-session";
import cors from "cors";
import dotenv from "dotenv";
import pg from "pg";
import PDFDocument from "pdfkit"; // << NOVO

dotenv.config();
const { Pool } = pg;

const app = express();
const port = process.env.PORT || 3000;

// ==== login DEV (mantenha só em dev) ====
const ADMIN_LOGIN = process.env.ADMIN_LOGIN;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  keepAlive: true,
});

const allowed = (process.env.FRONTEND_ORIGIN || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
  app.use(cors({
    origin: (origin, cb) => {
    if (!origin || allowed.includes(origin)) return cb(null, true);
    cb(new Error('CORS: origin not allowed'));
  },
  credentials: true,
}));
app.use(express.json());
app.use(
  session({
    secret: process.env.SESSION_SECRET || "dev_secret",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production", 
    }
  })
);
app.set("trust proxy", 1);


function requireAuth(req, _res, next) {
  if (req.session?.login !== ADMIN_LOGIN) return _res.status(401).json({ ok:false, message:"Não autenticado" });
  return next();
}

app.get("/", (_req, res) => res.json({ ok: true }));

app.get("/health/db", async (_req, res) => {
  try {
    const r = await pool.query("SELECT now()");
    res.json({ ok: true, time: r.rows[0].now });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post("/login", async (req, res) => {
  const { login, password } = req.body;
  if (login === ADMIN_LOGIN && password === ADMIN_PASSWORD) {
    req.session.login = ADMIN_LOGIN;
    return res.json({ success: true, user: ADMIN_LOGIN });
  }
  return res
    .status(401)
    .json({ success: false, message: "Usuário ou senha inválidos" });
});

app.get("/session", (req, res) =>
  res.json({ loggedIn: !!req.session?.login, user: req.session?.login || null })
);

app.post("/logout", (req, res) =>
  req.session.destroy((err) =>
    err ? res.status(500).json({ success: false }) : res.json({ success: true })
  )
);

// Lista protocolos (histórico)
app.get("/api/historico", requireAuth, async (req, res) => {
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
});

// Mensagens de um protocolo
app.get("/api/historico/:id/mensagens", requireAuth, async (req, res) => {
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
});

/* ===== Util simples p/ nome de arquivo ===== */
function sanitizeFilename(s) {
  return String(s).replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 100) || "arquivo";
}

/* ===== Exportar PDF do histórico (por protocolo) ===== */
app.get("/api/historico/:id/export.pdf", requireAuth, async (req, res) => {
  try {
    const idParam = String(req.params.id);

    // Meta do protocolo
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

    // Mensagens
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

    // Cabeçalhos HTTP
    const filename = `historico_${sanitizeFilename(idParam)}.pdf`;
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);

    // Monta PDF
    const doc = new PDFDocument({ size: "A4", margin: 50 });
    doc.pipe(res);

    // Título e meta
    doc.font("Helvetica-Bold").fontSize(18).text("Histórico de Atendimento");
    doc.moveDown(0.5);
    doc.font("Helvetica").fontSize(12).text(`Protocolo: ${meta.protocolo || idParam}`);
    doc.text(`Telefone: ${meta.cliente_contato || "—"}`);
    doc.text(`Atendente: ${meta.atendente_nome || "—"}`);
    doc.text(`Aberto em: ${meta.data_abertura ? new Date(meta.data_abertura).toLocaleString() : "—"}`);
    doc.text(`Última mensagem: ${meta.ultima_msg_em ? new Date(meta.ultima_msg_em).toLocaleString() : "—"}`);
    doc.text(`Total de mensagens: ${meta.total_msgs}`);
    doc.moveDown();
    doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor("#cccccc").stroke();
    doc.moveDown();

    // Mensagens
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
});

app.listen(port, () => console.log(`API rodando na porta ${port}`));
