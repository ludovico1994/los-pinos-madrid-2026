function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}

function sanitize(value, maxLen = 200) {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim().slice(0, maxLen);
}

async function ensureSchema(db) {
  await db
    .prepare(
      "CREATE TABLE IF NOT EXISTS votes (entry_key TEXT NOT NULL, voter_id TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (entry_key, voter_id))"
    )
    .run();
  await db.prepare("CREATE INDEX IF NOT EXISTS idx_votes_entry_key ON votes(entry_key)").run();
  await db.prepare("CREATE INDEX IF NOT EXISTS idx_votes_voter_id ON votes(voter_id)").run();
}

async function buildState(db, voterId) {
  const countsQuery = await db
    .prepare("SELECT entry_key, COUNT(*) AS votes FROM votes GROUP BY entry_key")
    .all();

  const selectedQuery = voterId
    ? await db.prepare("SELECT entry_key FROM votes WHERE voter_id = ?").bind(voterId).all()
    : { results: [] };

  const counts = {};
  for (const row of countsQuery.results || []) {
    counts[row.entry_key] = Number(row.votes || 0);
  }

  const selectedEntries = {};
  for (const row of selectedQuery.results || []) {
    selectedEntries[row.entry_key] = true;
  }

  return { counts, selectedEntries };
}

export async function onRequestOptions() {
  return new Response(null, { status: 204 });
}

export async function onRequestGet(context) {
  const db = context.env.DB;
  if (!db) {
    return json({ error: "DB binding mancante (configura D1 con binding 'DB')." }, 503);
  }

  try {
    await ensureSchema(db);
    const url = new URL(context.request.url);
    const voterId = sanitize(url.searchParams.get("voter_id"), 120);
    const state = await buildState(db, voterId);
    return json(state);
  } catch (error) {
    return json({ error: "Errore lettura voti", details: String(error && error.message ? error.message : error) }, 500);
  }
}

export async function onRequestPost(context) {
  const db = context.env.DB;
  if (!db) {
    return json({ error: "DB binding mancante (configura D1 con binding 'DB')." }, 503);
  }

  try {
    await ensureSchema(db);
    const body = await context.request.json();
    const action = sanitize(body.action, 16);
    const voterId = sanitize(body.voter_id, 120);
    const entryKey = sanitize(body.entry_key, 220);

    if (!voterId || !entryKey) {
      return json({ error: "Parametri mancanti: voter_id e entry_key sono obbligatori." }, 400);
    }
    if (action !== "add" && action !== "remove") {
      return json({ error: "Azione non valida. Usa 'add' o 'remove'." }, 400);
    }

    if (action === "add") {
      await db.prepare("INSERT OR IGNORE INTO votes (entry_key, voter_id) VALUES (?, ?)").bind(entryKey, voterId).run();
    } else {
      await db.prepare("DELETE FROM votes WHERE entry_key = ? AND voter_id = ?").bind(entryKey, voterId).run();
    }

    const state = await buildState(db, voterId);
    return json(state);
  } catch (error) {
    return json({ error: "Errore aggiornamento voto", details: String(error && error.message ? error.message : error) }, 500);
  }
}
