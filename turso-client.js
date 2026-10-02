// Tiny libSQL/Turso HTTP client. This keeps QuickCourt Vercel-compatible without
// shipping the native sqlite3 binary that Vercel's runtime cannot load.
const url = process.env.TURSO_DATABASE_URL;
const token = process.env.TURSO_AUTH_TOKEN;

function value(v) {
  if (v === null || v === undefined) return { type: 'null' };
  if (typeof v === 'boolean') return { type: 'integer', value: v ? '1' : '0' };
  if (typeof v === 'bigint') return { type: 'integer', value: v.toString() };
  if (typeof v === 'number') return Number.isInteger(v)
    ? { type: 'integer', value: String(v) }
    : { type: 'float', value: String(v) };
  if (Buffer.isBuffer(v)) return { type: 'blob', base64: v.toString('base64') };
  return { type: 'text', value: String(v) };
}

function decode(v) {
  if (!v) return null;
  if (v.type === 'null') return null;
  if (v.type === 'integer') return Number(v.value);
  if (v.type === 'float') return Number(v.value);
  if (v.type === 'blob') return Buffer.from(v.base64 || '', 'base64');
  return v.value;
}

function rowsToObjects(result) {
  const cols = result.cols || [];
  return (result.rows || []).map(row => Object.fromEntries(cols.map((c, i) => [c.name, decode(row[i])])))
}

function endpoint() {
  if (!url) throw new Error('TURSO_DATABASE_URL is not configured.');
  const base = url.replace(/^libsql:\/\//, 'https://').replace(/\/$/, '');
  return base.endsWith('/v2/pipeline') ? base : `${base}/v2/pipeline`;
}

async function execute(sql, args = []) {
  const res = await fetch(endpoint(), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token || ''}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      requests: [{
        type: 'execute',
        stmt: { sql, args: args.map(value) },
      }],
    }),
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Turso request failed (${res.status}): ${JSON.stringify(body).slice(0, 500)}`);
  const first = body.results?.[0];
  if (!first || first.type !== 'ok') throw new Error(`Turso query failed: ${JSON.stringify(first || body).slice(0, 500)}`);
  const response = first.response;
  if (response?.type === 'error') throw new Error(response.error?.message || 'Turso query failed.');
  const result = response?.result || {};
  return {
    rows: rowsToObjects(result),
    rowsAffected: Number(result.affected_row_count || 0),
    lastInsertRowid: result.last_insert_rowid,
  };
}

module.exports = { execute };
