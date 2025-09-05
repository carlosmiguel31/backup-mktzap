import dotenv from "dotenv";
import pg from "pg";
dotenv.config();

const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  keepAlive: true,
  // ssl: { rejectUnauthorized: false }, // se necessário
});

console.log("Usando DATABASE_URL?", !!process.env.DATABASE_URL);


// log útil
console.log("PG target ->", process.env.PGHOST + ":" + process.env.PGPORT, "/", process.env.PGDATABASE);

// teste de conexão na subida
pool.query("SELECT version(), now()")
  .then(r => console.log("DB OK:", r.rows[0].now))
  .catch(e => {
    console.error("Falha ao conectar no Postgres:", e.code || e.message);
    // opcional: process.exit(1);
  });

export { pool };
