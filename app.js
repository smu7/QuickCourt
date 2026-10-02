const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const { createClient } = require('@libsql/client');
const path = require('path');
const { mail, isConfigured, reminderHours } = require('./email'); // Gmail API transport is pending — see email/index.js

// Vercel runs in UTC. The whole app thinks in the venue's local time (slots, "today", reminders).
process.env.TZ = process.env.APP_TIMEZONE || 'Asia/Kolkata';

const app = express();

app.use(cors());
// Vercel's Node runtime may already have parsed a JSON body; if so, don't try to read the stream twice.
app.use((req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const pre = req.body;
  if (pre && typeof pre === 'object' && Object.keys(pre).length) req._body = true;
  next();
});
// NOTE: Vercel itself rejects request bodies over 4.5 MB, so keep facility photos small.
app.use(express.json({ limit: '15mb' }));

// ponytail: sha256 instead of bcrypt — no external dep, fine for a demo with no real users.
// Upgrade to bcrypt/argon2 before this ever holds real passwords.
const hash = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const genOtp = () => String(crypto.randomInt(100000, 1000000)); // 6 digits, matches the 6-box OTP screen
const uid = (p) => p + '_' + crypto.randomBytes(5).toString('hex');
const j = (v) => JSON.stringify(v || []);
const P = (s, d = []) => { try { return JSON.parse(s); } catch { return d; } };
const PASSWORD_RULE = /^(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,20}$/;
const PASSWORD_MSG = 'Password must be 8–20 characters with at least one uppercase letter, one number and one special symbol.';
const RESERVE_MIN = 10; // an unpaid reservation holds its slot this long

const pad = (n) => String(n).padStart(2, '0');
const localDate = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (n, d = new Date()) => { const x = new Date(d); x.setDate(x.getDate() + n); return localDate(x); };
const toMin = (t) => { const [h, m] = String(t).split(':').map(Number); return h * 60 + m; };
const stamp = (d = new Date()) => `${localDate(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
const toTime = (m) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;

// Predefined catalog — sports & amenities are picked from these, never free text.
// ponytail: catalog lives in code + JSON columns on venues instead of SPORTS/AMENITIES/VENUE_SPORTS
// join tables. Same data, fewer joins; normalize if sports need their own admin CRUD.
const SPORTS = ['Badminton', 'Football', 'Cricket', 'Tennis', 'Table Tennis', 'Padel', 'Basketball', 'Swimming'];
const AMENITIES = ['Parking', 'Washroom', 'Changing Room', 'Drinking Water', 'Wi-Fi', 'Floodlights', 'CCTV', 'Locker', 'Cafeteria', 'First Aid', 'Seating', 'Equipment Rental', 'Air Conditioning', 'Coaching'];
const SKILL_LEVELS = ['Beginner', 'Intermediate', 'Advanced'];

// State → City → Area → [lat, lng, pincode]. Venues point here by (state, city, area) text, and the
// location selector, venue filters and facility wizard all read this one tree via /api/catalog.
// ponytail: fixed demo tree in code; move to a table when owners need to add new areas.
const LOCATIONS = {
  Gujarat: {
    Ahmedabad: { Navrangpura: [23.0365, 72.5611, '380009'], Satellite: [23.0258, 72.5070, '380015'], Bopal: [23.0339, 72.4636, '380058'], Vastrapur: [23.0395, 72.5296, '380015'],
      'Prahlad Nagar': [23.0120, 72.5108, '380015'], Paldi: [23.0120, 72.5625, '380007'], Gota: [23.1015, 72.5415, '382481'], Maninagar: [22.9962, 72.6036, '380008'], Thaltej: [23.0500, 72.5080, '380059'] },
    Surat: { Adajan: [21.1959, 72.7933, '395009'], Vesu: [21.1418, 72.7709, '395007'], Pal: [21.1925, 72.7690, '395009'] },
    Vadodara: { Alkapuri: [22.3100, 73.1700, '390007'], Manjalpur: [22.2750, 73.1900, '390011'], Gotri: [22.3180, 73.1350, '390021'] },
  },
  Maharashtra: {
    Mumbai: { 'Andheri West': [19.1363, 72.8277, '400053'], 'Bandra West': [19.0596, 72.8295, '400050'], Powai: [19.1176, 72.9060, '400076'] },
    Pune: { Kothrud: [18.5074, 73.8077, '411038'], Baner: [18.5590, 73.7868, '411045'], 'Viman Nagar': [18.5679, 73.9143, '411014'] },
  },
  Karnataka: {
    Bengaluru: { Koramangala: [12.9352, 77.6245, '560034'], Indiranagar: [12.9784, 77.6408, '560038'], Whitefield: [12.9698, 77.7500, '560066'], 'HSR Layout': [12.9116, 77.6389, '560102'] },
  },
  Rajasthan: {
    Jaipur: { 'Malviya Nagar': [26.8530, 75.8050, '302017'], 'Vaishali Nagar': [26.9110, 75.7430, '302021'] },
  },
};
const stateOf = (city) => Object.keys(LOCATIONS).find(s => LOCATIONS[s][city]);

// ---------------------------------------------------------------------------
// DB — promise wrappers so handlers can be async (Express 5 forwards rejections)
// ---------------------------------------------------------------------------
// Turso (libSQL) in production, a local file for `npm run dev`. libsql:// is swapped for https:// because
// plain HTTP requests are the most reliable transport from serverless functions.
const DB_URL = process.env.TURSO_DATABASE_URL || process.env.DATABASE_URL || '';
const client = DB_URL ? createClient({ url: DB_URL.replace(/^libsql:\/\//, 'https://'), authToken: process.env.TURSO_AUTH_TOKEN })
  : process.env.VERCEL ? null : createClient({ url: 'file:' + path.join(__dirname, 'local.db') });
const rowsOf = (r) => r.rows.map(row => Object.fromEntries(r.columns.map((c, i) => [c, row[i]])));
const get = async (sql, p = []) => rowsOf(await client.execute({ sql, args: p }))[0];
const all = async (sql, p = []) => rowsOf(await client.execute({ sql, args: p }));
const run = (sql, p = []) => client.execute({ sql, args: p });
const fail = (status, msg, extra) => Object.assign(new Error(msg), { status, extra });

async function setupSchema() {
  const stmts = [];
  const S = (sql) => stmts.push(sql);
  S(`CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY, name TEXT, email TEXT UNIQUE, password_hash TEXT,
    avatar TEXT, role TEXT, phone TEXT, sports TEXT, skill_level TEXT,
    status TEXT DEFAULT 'Active', email_verified INTEGER DEFAULT 0,
    otp TEXT, otp_expires INTEGER, created_at TEXT)`);
  S(`CREATE TABLE IF NOT EXISTS venues (
    id TEXT PRIMARY KEY, owner_id TEXT, name TEXT, description TEXT,
    address TEXT, area TEXT, city TEXT, state TEXT, pincode TEXT,
    latitude REAL, longitude REAL, venue_type TEXT, contact_phone TEXT,
    sports TEXT, amenities TEXT, cover_image TEXT, images TEXT,
    opening_time TEXT DEFAULT '06:00', closing_time TEXT DEFAULT '23:00',
    slot_minutes INTEGER DEFAULT 60, active_days TEXT DEFAULT '[0,1,2,3,4,5,6]',
    status TEXT DEFAULT 'Pending', reject_reason TEXT, created_at TEXT)`);
  // opening/closing_time on a court are NULL unless the owner overrides the facility hours.
  S(`CREATE TABLE IF NOT EXISTS courts (
    id TEXT PRIMARY KEY, venue_id TEXT, name TEXT, sport TEXT,
    price_per_hour INTEGER, status TEXT DEFAULT 'Active', opening_time TEXT, closing_time TEXT)`);
  // Only exceptions are stored. Open slots are derived from facility hours + slot duration
  // + active days, minus bookings and these blocks — owners never create slots one by one.
  S(`CREATE TABLE IF NOT EXISTS blocked_slots (
    id TEXT PRIMARY KEY, court_id TEXT, date TEXT, start_time TEXT, end_time TEXT, reason TEXT)`);
  // status: Reserved (awaiting payment) → Confirmed → Completed | Cancelled | Expired
  S(`CREATE TABLE IF NOT EXISTS bookings (
    id TEXT PRIMARY KEY, user_id TEXT, venue_id TEXT, court_id TEXT, sport TEXT,
    date TEXT, start_time TEXT, duration REAL, total_price INTEGER,
    status TEXT DEFAULT 'Reserved', created_at TEXT,
    reminder_sent INTEGER DEFAULT 0, completed_sent INTEGER DEFAULT 0)`);
  S(`CREATE TABLE IF NOT EXISTS payments (
    id TEXT PRIMARY KEY, booking_id TEXT, amount INTEGER, status TEXT, created_at TEXT)`);
  S(`CREATE TABLE IF NOT EXISTS reviews (
    id TEXT PRIMARY KEY, user_id TEXT, venue_id TEXT, booking_id TEXT UNIQUE,
    rating INTEGER, comment TEXT, created_at TEXT)`);
  S(`CREATE TABLE IF NOT EXISTS matches (
    id TEXT PRIMARY KEY, creator_id TEXT, venue_id TEXT, sport TEXT, date TEXT,
    start_time TEXT, duration REAL, max_players INTEGER, skill_level TEXT,
    description TEXT, status TEXT DEFAULT 'Open', created_at TEXT)`);
  S(`CREATE TABLE IF NOT EXISTS match_participants (
    match_id TEXT, user_id TEXT, PRIMARY KEY (match_id, user_id))`);
  S(`CREATE TABLE IF NOT EXISTS reports (
    id TEXT PRIMARY KEY, reporter_id TEXT, target_type TEXT, target_id TEXT,
    reason TEXT, status TEXT DEFAULT 'Open', admin_action TEXT, created_at TEXT)`);
  S(`CREATE TABLE IF NOT EXISTS favorites (
    user_id TEXT, venue_id TEXT, created_at TEXT, PRIMARY KEY (user_id, venue_id))`);
  S(`CREATE TABLE IF NOT EXISTS notifications (
    id TEXT PRIMARY KEY, user_id TEXT, type TEXT, message TEXT, link TEXT,
    read INTEGER DEFAULT 0, created_at TEXT)`);
  await client.batch(stmts, 'write'); // one round trip instead of eleven
  // A table that already existed in Turso (older/partial schema) is topped up instead of failing later.
  const WANT = {
    users: { name: 'TEXT', avatar: 'TEXT', role: 'TEXT', phone: 'TEXT', sports: 'TEXT', skill_level: 'TEXT', status: "TEXT DEFAULT 'Active'", email_verified: 'INTEGER DEFAULT 0', otp: 'TEXT', otp_expires: 'INTEGER', created_at: 'TEXT' },
    venues: { owner_id: 'TEXT', description: 'TEXT', address: 'TEXT', area: 'TEXT', city: 'TEXT', state: 'TEXT', pincode: 'TEXT', latitude: 'REAL', longitude: 'REAL', venue_type: 'TEXT', contact_phone: 'TEXT', sports: 'TEXT', amenities: 'TEXT',
      cover_image: 'TEXT', images: 'TEXT', opening_time: "TEXT DEFAULT '06:00'", closing_time: "TEXT DEFAULT '23:00'", slot_minutes: 'INTEGER DEFAULT 60', active_days: "TEXT DEFAULT '[0,1,2,3,4,5,6]'", status: "TEXT DEFAULT 'Pending'", reject_reason: 'TEXT', created_at: 'TEXT' },
    courts: { opening_time: 'TEXT', closing_time: 'TEXT' },
    bookings: { reminder_sent: 'INTEGER DEFAULT 0', completed_sent: 'INTEGER DEFAULT 0' },
  };
  for (const [table, cols] of Object.entries(WANT)) {
    const have = new Set((await all(`PRAGMA table_info(${table})`)).map(c => c.name));
    for (const [col, def] of Object.entries(cols)) if (!have.has(col)) await run(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
  }
}

// ---------------------------------------------------------------------------
// SEED — demo users, approved venues + one pending, courts, bookings, matches
// ---------------------------------------------------------------------------
const IMG = {
  Badminton: 'https://images.unsplash.com/photo-1626224583764-f87db24ac4ea?w=800&auto=format&fit=crop',
  Football: 'https://images.unsplash.com/photo-1579952363873-27f3bade9f55?w=800&auto=format&fit=crop',
  'Table Tennis': 'https://images.unsplash.com/photo-1534158914592-062992fbe900?w=800&auto=format&fit=crop',
  Padel: 'https://images.unsplash.com/photo-1646649853703-7645147474ba?w=800&auto=format&fit=crop',
  Tennis: 'https://images.unsplash.com/photo-1595435934249-5df7ed86e1c0?w=800&auto=format&fit=crop',
  Cricket: 'https://images.unsplash.com/photo-1531415074968-036ba1b575da?w=800&auto=format&fit=crop',
  Basketball: 'https://images.unsplash.com/photo-1546519638-68e109498ffc?w=800&auto=format&fit=crop',
  Swimming: 'https://images.unsplash.com/photo-1576013551627-0cc20b96c2a7?w=800&auto=format&fit=crop',
};

// ---------------------------------------------------------------------------
// REVIEW TEXT — a pool of distinct comments so no venue ever shows the same review twice
// ---------------------------------------------------------------------------
const REVIEW_TEXT = {
  pos: ['Booked in under a minute and the court was exactly as pictured.', 'Great lighting for evening games.', 'Well maintained, will book again.', 'Staff were helpful and the slot started right on time.',
    'Clean, spacious and easy to find. Our group had a great time.', 'Brought the office team here for a Friday session and everyone loved it.', 'Booking was painless and the confirmation came instantly.',
    'Honestly better than the photos. Worth every rupee.', 'Good vibe, friendly regulars, and the washrooms were clean.', 'Came for one hour and ended up staying for two.',
    'Plenty of parking and a calm atmosphere even on a Saturday.', 'Surface was in great shape. Very little wear.', 'One of the better venues in the area, I recommend booking early.',
    'Smooth check-in, no confusion about the slot.', 'Perfect for a quick after-work game.', 'Lovely place. Kids and adults were all comfortable.'],
  mid: ['Decent, but the washroom needs work.', 'Good surface and friendly staff. Parking gets tight after 7 PM.', 'Fine for the price, though it gets crowded on weekends.', 'Court was good but the lights on one side flickered.',
    'Nice place overall, a bit hot by the end of the session.', 'Slot started a few minutes late, otherwise a pleasant game.'],
  low: ['Floor was a little slippery and the staff took a while to respond.', 'Not bad, but the booking time and what was ready on the ground did not quite match.', 'Needs better upkeep, the nets were torn.'],
  sport: {
    Badminton: ['The wooden flooring is easy on the knees and the shuttle lanes are well lit.', 'No glare from the ceiling lights, which makes a huge difference for badminton.', 'Nets were tight and the court lines were crisp.'],
    Football: ['Turf was soft and even, no loose rubber crumbs everywhere.', 'Floodlights covered the whole pitch and the goals were sturdy.', 'Good size for a 6-a-side and the fencing keeps the ball in play.'],
    Cricket: ['The nets and the pitch both held up well for a full 2-hour session.', 'Good bounce on the turf and a proper scoreboard to keep things fun.', 'Pavilion seating was a nice touch for the people waiting for their turn.'],
    Tennis: ['Court surface was consistent and the bounce was true.', 'Early morning slots are lovely here, cool and quiet.', 'Ball machine session was a good value for the price.'],
    'Table Tennis': ['Tables were level and the bats on rent were in decent shape.', 'Lighting over the tables was even and there was no glare.', 'Quiet hall with proper spacing between tables.'],
    Padel: ['Glass walls were spotless and the rebounds were consistent.', 'Great for first-timers, the staff explained the rules patiently.', 'Rental paddles were good quality, no need to bring our own.'],
    Basketball: ['Hoops were firm and the paint was fresh.', 'Rims had a nice bounce and the court had good grip.', 'Plenty of space for a proper full-court game.'],
    Swimming: ['Water was clean and the temperature was just right.', 'Lanes were well managed and the lifeguards were attentive.', 'Changing rooms were tidy and the lockers worked.'],
  },
};
const rnd = (x) => (Math.imul(x + 7, 2654435761) >>> 0) / 4294967296;
const pickRating = (x) => [5, 5, 4, 4, 4, 5, 3, 4, 5, 2][Math.floor(rnd(x * 3 + 1) * 10)];
// Returns a comment for this rating that the venue has not used yet, or null if the pool is exhausted.
function pickReview(sport, rating, used, seed) {
  const list = rating >= 4 ? [...REVIEW_TEXT.pos, ...(REVIEW_TEXT.sport[sport] || [])] : rating === 3 ? REVIEW_TEXT.mid : REVIEW_TEXT.low;
  for (let i = 0; i < list.length; i++) { const t = list[(seed * 5 + i) % list.length]; if (!used.has(t)) { used.add(t); return t; } }
  return null;
}

// One-time cleanup for demo data that was seeded before reviews/bookings were de-duplicated (see meta flag).
// Only touches the @quickcourt.demo accounts — real players' bookings and reviews are never modified.
async function tidyDemoData() {
  await run('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)');
  if (await get("SELECT 1 x FROM meta WHERE key = 'tidy_v1'")) return;
  const demo = "(SELECT id FROM users WHERE email LIKE '%@quickcourt.demo')";
  const stmts = [];
  // 1) repeated bookings: same player, same venue and start time again, a second booking on one day, or more than 3 at a venue
  const seen = new Set(), day = new Set(), per = new Map();
  for (const b of await all(`SELECT id, user_id, venue_id, date, start_time FROM bookings WHERE user_id IN ${demo} ORDER BY date, created_at, id`)) {
    const uv = b.user_id + '|' + b.venue_id, slot = uv + '|' + b.start_time;
    if (seen.has(slot) || day.has(b.user_id + b.date) || (per.get(uv) || 0) >= 3) {
      for (const t of ['payments', 'reviews']) stmts.push({ sql: `DELETE FROM ${t} WHERE booking_id = ?`, args: [b.id] });
      stmts.push({ sql: 'DELETE FROM bookings WHERE id = ?', args: [b.id] });
    } else { seen.add(slot); day.add(b.user_id + b.date); per.set(uv, (per.get(uv) || 0) + 1); }
  }
  const gone = new Set(stmts.filter(s => s.sql.startsWith('DELETE FROM bookings')).map(s => s.args[0]));
  // 2) reviews: one per player per venue, every comment different within a venue
  const used = {}, byUV = new Set(), cnt = {};
  for (const r of await all(`SELECT r.id, r.booking_id, r.user_id, r.venue_id, r.rating, v.sports FROM reviews r JOIN venues v ON v.id = r.venue_id WHERE r.user_id IN ${demo} ORDER BY r.venue_id, r.created_at, r.id`)) {
    if (gone.has(r.booking_id)) continue;
    const uv = r.user_id + '|' + r.venue_id, set = used[r.venue_id] ||= new Set();
    const text = byUV.has(uv) ? null : pickReview(P(r.sports)[0], r.rating, set, r.id.length + (cnt[r.venue_id] || 0));
    if (!text) { stmts.push({ sql: 'DELETE FROM reviews WHERE id = ?', args: [r.id] }); continue; }
    byUV.add(uv); cnt[r.venue_id] = (cnt[r.venue_id] || 0) + 1;
    stmts.push({ sql: 'UPDATE reviews SET comment = ? WHERE id = ?', args: [text, r.id] });
  }
  // 3) top up venues that lost reviews, from finished bookings nobody reviewed yet (max 3 per venue)
  let n = 0;
  for (const b of await all(`SELECT b.id, b.user_id, b.venue_id, b.date, b.sport FROM bookings b LEFT JOIN reviews r ON r.booking_id = b.id WHERE b.status = 'Completed' AND r.id IS NULL AND b.user_id IN ${demo} ORDER BY b.date DESC`)) {
    const uv = b.user_id + '|' + b.venue_id;
    if (gone.has(b.id) || byUV.has(uv) || (cnt[b.venue_id] || 0) >= 3) continue;
    const rating = pickRating(++n), text = pickReview(b.sport, rating, used[b.venue_id] ||= new Set(), n);
    if (!text) continue;
    byUV.add(uv); cnt[b.venue_id] = (cnt[b.venue_id] || 0) + 1;
    stmts.push({ sql: 'INSERT OR IGNORE INTO reviews (id,user_id,venue_id,booking_id,rating,comment,created_at) VALUES (?,?,?,?,?,?,?)',
      args: [uid('review'), b.user_id, b.venue_id, b.id, rating, text, new Date(b.date + 'T12:00:00').toISOString()] });
  }
  for (let i = 0; i < stmts.length; i += 100) await client.batch(stmts.slice(i, i + 100), 'write');
  await run("INSERT OR REPLACE INTO meta (key, value) VALUES ('tidy_v1', ?)", [new Date().toISOString()]);
}

async function seedIfEmpty() {
  const { c } = await get('SELECT COUNT(*) c FROM users');
  const { v } = await get('SELECT COUNT(*) v FROM venues');
  if (c > 0 && v > 0) return; // real data already there — never touch it
  // ~700 inserts: over the network they must go as ONE atomic batch, never one-by-one.
  const stmts = [], taken = new Set();
  const queue = async (sql, args = []) => {
    stmts.push({ sql: sql.replace('INSERT INTO', 'INSERT OR IGNORE INTO'), args }); // safe if some demo rows already exist
    if (sql.includes('INSERT INTO bookings')) taken.add([args[3], args[5], args[6]].join('|'));
  };
  const isTaken = async (sql, args) => (taken.has(args.join('|')) ? { 1: 1 } : undefined);
  await seedData(queue, isTaken);
  try { await client.batch(stmts, 'write'); }
  catch (e) { if (!(await get('SELECT COUNT(*) c FROM venues')).c) throw e; } // another cold start seeded first
}

async function seedData(run, get) {
  const now = new Date().toISOString();
  const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString();

  // [id, name, email, password, role, phone, sports, skill, created_at, home city]
  const users = [
    ['u_player', 'Aarav Mehta', 'player@quickcourt.demo', 'Player@123', 'player', '9820011223', ['Badminton', 'Tennis'], 'Intermediate', daysAgo(20), 'Ahmedabad'],
    ['u_player2', 'Riya Shah', 'riya@quickcourt.demo', 'Player@123', 'player', '9820055667', ['Football', 'Badminton'], 'Beginner', daysAgo(4), 'Ahmedabad'],
    ['u_player3', 'Kabir Joshi', 'kabir@quickcourt.demo', 'Player@123', 'player', '9820077889', ['Cricket'], 'Advanced', daysAgo(2), 'Ahmedabad'],
    ['u_player4', 'Meera Patel', 'meera@quickcourt.demo', 'Player@123', 'player', '9825012345', ['Badminton', 'Swimming'], 'Intermediate', daysAgo(11), 'Surat'],
    ['u_player5', 'Harsh Modi', 'harsh@quickcourt.demo', 'Player@123', 'player', '9825067890', ['Football', 'Cricket'], 'Advanced', daysAgo(7), 'Surat'],
    ['u_player6', 'Pooja Trivedi', 'pooja@quickcourt.demo', 'Player@123', 'player', '9824011122', ['Tennis'], 'Beginner', daysAgo(9), 'Vadodara'],
    ['u_player7', 'Dev Nair', 'dev@quickcourt.demo', 'Player@123', 'player', '9819033344', ['Football', 'Padel'], 'Intermediate', daysAgo(13), 'Mumbai'],
    ['u_player8', 'Ishaan Kulkarni', 'ishaan@quickcourt.demo', 'Player@123', 'player', '9822055566', ['Cricket', 'Basketball'], 'Intermediate', daysAgo(5), 'Pune'],
    ['u_player9', 'Sneha Reddy', 'sneha@quickcourt.demo', 'Player@123', 'player', '9845077788', ['Badminton', 'Football'], 'Advanced', daysAgo(3), 'Bengaluru'],
    ['u_player10', 'Arjun Singh', 'arjun@quickcourt.demo', 'Player@123', 'player', '9829099900', ['Cricket', 'Badminton'], 'Beginner', daysAgo(1), 'Jaipur'],
    ['u_owner', 'Nisha Vora', 'owner@quickcourt.demo', 'Owner@123', 'owner', '9820033445', [], '', daysAgo(30)],
    ['u_owner2', 'Rohan Desai', 'rohan.owner@quickcourt.demo', 'Owner@123', 'owner', '9825044556', [], '', daysAgo(26)],
    ['u_owner3', 'Kunal Kapoor', 'kunal.owner@quickcourt.demo', 'Owner@123', 'owner', '9819066778', [], '', daysAgo(22)],
    ['u_owner4', 'Ananya Rao', 'ananya.owner@quickcourt.demo', 'Owner@123', 'owner', '9845088990', [], '', daysAgo(12)],
    ['u_admin', 'Platform Admin', 'admin@quickcourt.demo', 'Admin@123', 'admin', '', [], '', daysAgo(40)],
  ];
  for (const u of users) {
    await run(`INSERT INTO users (id,name,email,password_hash,avatar,role,phone,sports,skill_level,status,email_verified,created_at)
               VALUES (?,?,?,?,'',?,?,?,?,'Active',1,?)`, [u[0], u[1], u[2], hash(u[3]), u[4], u[5], j(u[6]), u[7], u[8]]);
  }
  const localPlayers = (city) => { const l = users.filter(u => u[9] === city).map(u => u[0]); return l.length ? l : ['u_player']; };

  // [city, owner, [id, name, area, sports, type, price, about, amenities]]
  const venueGroups = [
    ['Ahmedabad', 'u_owner', [
      ['sbr', 'SBR Badminton', 'Satellite', ['Badminton'], 'Indoor', 250, 'Tournament-grade wooden flooring across four courts, with racquet and shuttle rental and a resident coach on weekends.', ['Parking', 'Washroom', 'CCTV', 'Locker', 'Drinking Water']],
      ['skyline', 'Skyline Turf Arena', 'Bopal', ['Football'], 'Outdoor', 900, 'FIFA-spec artificial turf built for 7-a-side games, floodlit for evening matches with a seating gallery.', ['Floodlights', 'Parking', 'Washroom', 'First Aid', 'Cafeteria']],
      ['ttub', 'Amdavad TT Hub', 'Navrangpura', ['Table Tennis'], 'Indoor', 180, "Six tournament tables in a climate-controlled hall, popular with the city's weekend league players.", ['Air Conditioning', 'Equipment Rental', 'Coaching', 'Washroom']],
      ['navshuttle', 'Navrangpura Shuttle House', 'Navrangpura', ['Badminton'], 'Indoor', 300, 'Three synthetic-mat courts a short walk from the university area, with early-morning and late-night slots.', ['Air Conditioning', 'Locker', 'Drinking Water', 'Washroom']],
      ['padel1', 'Prime Padel Court', 'Satellite', ['Padel'], 'Outdoor', 700, "Ahmedabad's first dedicated glass-walled padel courts, with rental paddles on site.", ['Floodlights', 'Parking', 'Equipment Rental']],
      ['river', 'Riverfront Courts', 'Paldi', ['Tennis'], 'Outdoor', 320, 'Four clay courts along the Sabarmati Riverfront with early-morning slots that book out fastest.', ['Floodlights', 'Parking', 'Seating']],
      ['gota', 'Gota Sports Club', 'Gota', ['Badminton', 'Cricket'], 'Indoor', 450, 'A multi-sport indoor club with badminton courts and a box-cricket net, popular for corporate tournaments.', ['Parking', 'Washroom', 'CCTV', 'Cafeteria', 'Locker']],
      ['vastrapur', 'Vastrapur Sports Complex', 'Vastrapur', ['Cricket'], 'Outdoor', 1200, 'Full-size turf ground with practice nets and a pavilion, the go-to venue for weekend tournaments.', ['Floodlights', 'Parking', 'Seating', 'Changing Room']],
      ['maninagar', 'Maninagar Community Courts', 'Maninagar', ['Badminton', 'Tennis'], 'Both', 280, 'A neighbourhood favourite with indoor badminton courts and an outdoor tennis court at budget-friendly rates.', ['Parking', 'Washroom', 'Seating']],
      ['bopal2', 'Bopal Football Turf 2', 'Bopal', ['Football'], 'Outdoor', 850, 'A newer 5-a-side turf close to the SP Ring Road, quieter than the bigger arenas.', ['Floodlights', 'Parking', 'Washroom']],
      ['sqpadel', 'SG Highway Padel Club', 'Prahlad Nagar', ['Padel'], 'Indoor', 650, 'Boutique indoor padel club with two air-conditioned courts and coaching on request.', ['Air Conditioning', 'Coaching', 'Parking', 'Locker']],
      ['thaltej', 'Thaltej Hoops Arena', 'Thaltej', ['Basketball'], 'Outdoor', 400, 'Newly submitted full-size basketball court with floodlights — awaiting admin approval.', ['Floodlights', 'Parking', 'Drinking Water']],
    ]],
    ['Surat', 'u_owner2', [
      ['vesusmash', 'Vesu Smash Arena', 'Vesu', ['Badminton'], 'Indoor', 300, 'Five BWF-approved mats under bright LED lighting, a short drive from VIP Road.', ['Air Conditioning', 'Parking', 'Locker', 'Drinking Water']],
      ['vesuturf', 'Vesu Kick Off Turf', 'Vesu', ['Football', 'Cricket'], 'Outdoor', 1000, 'A rooftop turf that switches between 6-a-side football and box cricket, busiest after 8 PM.', ['Floodlights', 'Parking', 'Washroom', 'Cafeteria']],
      ['adajanclub', 'Adajan Riverside Club', 'Adajan', ['Table Tennis', 'Badminton'], 'Indoor', 220, 'A family sports club by the Tapi riverfront with TT tables and two badminton courts.', ['Air Conditioning', 'Coaching', 'Washroom', 'Seating']],
      ['palaqua', 'Pal Aquatic Centre', 'Pal', ['Swimming'], 'Indoor', 150, 'Temperature-controlled 25 m pool with lane booking by the hour and certified lifeguards.', ['Changing Room', 'Locker', 'First Aid', 'Washroom']],
    ]],
    ['Vadodara', 'u_owner2', [
      ['alkatennis', 'Alkapuri Tennis Academy', 'Alkapuri', ['Tennis'], 'Outdoor', 350, 'Three hard courts with ball machines and weekend clinics for juniors.', ['Floodlights', 'Coaching', 'Parking', 'Seating']],
      ['alkaarena', 'Alkapuri Indoor Arena', 'Alkapuri', ['Basketball'], 'Indoor', 380, 'Half-court basketball hall — resubmission requested after the first review.', ['Parking', 'Washroom']],
      ['manjbox', 'Manjalpur Box Cricket', 'Manjalpur', ['Cricket'], 'Outdoor', 800, 'Netted box-cricket arena with bowling machine rental and scoreboard.', ['Floodlights', 'Equipment Rental', 'Parking', 'Drinking Water']],
      ['gotrihoops', 'Gotri Hoops Court', 'Gotri', ['Basketball'], 'Outdoor', 300, 'Open-air full court with fresh acrylic paint and night lighting.', ['Floodlights', 'Drinking Water', 'Seating']],
    ]],
    ['Mumbai', 'u_owner3', [
      ['andheriturf', 'Andheri Sports Turf', 'Andheri West', ['Football'], 'Outdoor', 1500, 'Rooftop 7-a-side turf off Link Road, with covered seating for monsoon evenings.', ['Floodlights', 'Changing Room', 'Washroom', 'Cafeteria']],
      ['bandrapadel', 'Bandra Padel House', 'Bandra West', ['Padel'], 'Indoor', 1400, 'Two panoramic glass courts, pro shop and a café overlooking the courts.', ['Air Conditioning', 'Equipment Rental', 'Cafeteria', 'Locker']],
      ['powaibad', 'Powai Lakeside Badminton', 'Powai', ['Badminton'], 'Indoor', 450, 'Six wooden courts near Hiranandani, popular with the after-work crowd.', ['Air Conditioning', 'Parking', 'Locker', 'Washroom']],
    ]],
    ['Pune', 'u_owner3', [
      ['kothrudnets', 'Kothrud Cricket Nets', 'Kothrud', ['Cricket'], 'Outdoor', 600, 'Turf and cement practice nets with bowling machines and a coach on call.', ['Floodlights', 'Coaching', 'Equipment Rental', 'Parking']],
      ['banertennis', 'Baner Hills Tennis Club', 'Baner', ['Tennis', 'Badminton'], 'Both', 500, 'Hillside club with two outdoor tennis courts and an indoor badminton hall.', ['Parking', 'Changing Room', 'Cafeteria', 'Seating']],
      ['vimanhoops', 'Viman Nagar Hoops', 'Viman Nagar', ['Basketball'], 'Indoor', 400, 'Indoor maple-floor court hosting weekly 3x3 leagues.', ['Air Conditioning', 'Washroom', 'Drinking Water']],
    ]],
    ['Bengaluru', 'u_owner4', [
      ['koraturf', 'Koramangala Turf Park', 'Koramangala', ['Football'], 'Outdoor', 1300, 'Two 5-a-side pitches in the heart of Koramangala, booked solid on weekends.', ['Floodlights', 'Parking', 'Washroom', 'Cafeteria']],
      ['indirashuttle', 'Indiranagar Shuttle Club', 'Indiranagar', ['Badminton'], 'Indoor', 400, 'Four cushioned courts off 100 Feet Road with shuttle and shoe rental.', ['Air Conditioning', 'Equipment Rental', 'Locker', 'Washroom']],
      ['whiteaqua', 'Whitefield Aqua Sports', 'Whitefield', ['Swimming', 'Tennis'], 'Both', 350, 'Semi-olympic pool plus a floodlit tennis court, close to the ITPL tech parks.', ['Changing Room', 'Locker', 'Floodlights', 'Parking']],
      ['hsrpadel', 'HSR Padel Social', 'HSR Layout', ['Padel'], 'Outdoor', 1100, 'Three new outdoor padel courts with a social deck — submitted for approval.', ['Floodlights', 'Cafeteria', 'Equipment Rental']],
    ]],
    ['Jaipur', 'u_owner4', [
      ['malviyacricket', 'Malviya Nagar Cricket Ground', 'Malviya Nagar', ['Cricket'], 'Outdoor', 900, 'A full-size ground with a turf wicket and pavilion, used for corporate T20 leagues.', ['Floodlights', 'Seating', 'Changing Room', 'Parking']],
      ['vaishalibad', 'Vaishali Nagar Badminton Hall', 'Vaishali Nagar', ['Badminton'], 'Indoor', 250, 'Four courts with fresh synthetic mats and friendly evening doubles groups.', ['Parking', 'Washroom', 'Drinking Water']],
    ]],
  ];
  const STATUS = { thaltej: 'Pending', hsrpadel: 'Pending', alkaarena: 'Rejected' };
  const courtsByVenue = {}, venueCity = {};
  let i = 0;
  for (const [city, owner, list] of venueGroups) {
    for (const [id, name, area, sports, type, price, about, amenities] of list) {
      const [lat, lng, pin] = LOCATIONS[stateOf(city)][city][area];
      const img = IMG[sports[0]] || IMG.Football;
      const status = STATUS[id] || 'Approved';
      venueCity[id] = city;
      await run(`INSERT INTO venues (id,owner_id,name,description,address,area,city,state,pincode,latitude,longitude,venue_type,contact_phone,sports,amenities,cover_image,images,status,reject_reason,created_at)
                 VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [id, owner, name, about, `${10 + i} ${area} Main Road`, area, city, stateOf(city), pin, lat + (i % 3) * 0.003, lng + (i % 2) * 0.003, type,
          users.find(u => u[0] === owner)[5], j(sports), j(amenities), img, j([img]), status,
          status === 'Rejected' ? "Photos don't show the playing surface. Please upload court photos and resubmit." : null,
          status === 'Approved' ? daysAgo(25 - (i % 20)) : daysAgo(1 + (i % 3))]);
      i++;
      courtsByVenue[id] = [];
      const courtSports = sports.length > 1 ? [...sports, sports[0]] : [sports[0], sports[0]];
      for (const [ci, sport] of courtSports.entries()) {
        const cid = `${id}_c${ci + 1}`;
        courtsByVenue[id].push({ id: cid, sport, price });
        await run('INSERT INTO courts (id,venue_id,name,sport,price_per_hour,status) VALUES (?,?,?,?,?,?)',
          [cid, id, `Court ${ci + 1}`, sport, price, ci === 2 ? 'Maintenance' : 'Active']);
      }
    }
  }

  // Bookings spread over the last 3 weeks + the next few days, so dashboards have data.
  // Each booking goes to a player who lives in that venue's city.
  const hours = ['07:00', '08:00', '17:00', '18:00', '19:00', '20:00', '21:00'];
  const approved = Object.keys(courtsByVenue).filter(id => !STATUS[id]);
  const sportOf = {};
  for (const g of venueGroups) for (const v of g[2]) sportOf[v[0]] = v[3][0];
  // A player books at most once a day, at most 3 times per venue, and reviews a venue once — no repeats.
  const userDay = new Set(), userVenue = new Map(), reviewedUV = new Set(), usedText = {};
  let n = 0;
  for (let d = -20; d <= 5; d++) {
    for (let k = 0; k < 8 + ((d + 21) % 3); k++) {
      const vid = approved[(n * 7 + d + 21) % approved.length];
      const court = courtsByVenue[vid][n % 2];
      const date = addDays(d);
      const start = hours[(n * 3 + k) % hours.length];
      const local = localPlayers(venueCity[vid]);
      const user = local[n % local.length], uv = user + '|' + vid;
      n++;
      if (await get('SELECT 1 FROM bookings WHERE court_id=? AND date=? AND start_time=?', [court.id, date, start])) continue;
      if (userDay.has(user + date) || (userVenue.get(uv) || 0) >= 3) continue;
      userDay.add(user + date); userVenue.set(uv, (userVenue.get(uv) || 0) + 1);
      const cancelled = n % 11 === 0;
      const status = cancelled ? 'Cancelled' : d < 0 ? 'Completed' : 'Confirmed';
      const bid = uid('booking');
      await run(`INSERT INTO bookings (id,user_id,venue_id,court_id,sport,date,start_time,duration,total_price,status,created_at,reminder_sent,completed_sent)
                 VALUES (?,?,?,?,?,?,?,1,?,?,?,1,1)`, [bid, user, vid, court.id, court.sport, date, start, court.price, status, daysAgo(Math.max(0, -d + 1))]);
      await run('INSERT INTO payments (id,booking_id,amount,status,created_at) VALUES (?,?,?,?,?)',
        [uid('pay'), bid, court.price, cancelled ? 'Refunded' : 'Paid', daysAgo(Math.max(0, -d + 1))]);
      if (status === 'Completed' && !reviewedUV.has(uv) && rnd(n) < 0.45) {
        const r = pickRating(n), text = pickReview(sportOf[vid], r, usedText[vid] ||= new Set(), n);
        if (text) {
          reviewedUV.add(uv);
          await run('INSERT INTO reviews (id,user_id,venue_id,booking_id,rating,comment,created_at) VALUES (?,?,?,?,?,?,?)',
            [uid('review'), user, vid, bid, r, text, daysAgo(Math.max(0, -d))]);
        }
      }
    }
  }

  const matches = [
    ['m1', 'u_player', 'sbr', 'Badminton', addDays(1), '19:00', 1, 4, 'Intermediate', 'Looking for 2 more for doubles.', ['u_player', 'u_player2']],
    ['m2', 'u_player2', 'skyline', 'Football', addDays(3), '18:00', 1.5, 14, '', 'Friendly 7-a-side, all levels welcome.', ['u_player2', 'u_player3']],
    ['m3', 'u_player3', 'vastrapur', 'Cricket', addDays(4), '07:00', 2, 12, 'Advanced', 'Box-cricket practice match, bring your own bat.', ['u_player3']],
    ['m4', 'u_player2', 'river', 'Tennis', addDays(5), '08:00', 1, 2, 'Beginner', 'Early morning singles, happy to rally.', ['u_player2']],
    ['m5', 'u_player5', 'vesuturf', 'Football', addDays(2), '20:00', 1, 12, 'Intermediate', 'Weeknight 6-a-side, need a keeper.', ['u_player5', 'u_player4']],
    ['m6', 'u_player7', 'bandrapadel', 'Padel', addDays(2), '07:00', 1.5, 4, 'Beginner', 'Learning padel — join us, paddles available.', ['u_player7']],
    ['m7', 'u_player9', 'indirashuttle', 'Badminton', addDays(1), '19:00', 1, 4, 'Advanced', 'Competitive doubles, fast rallies.', ['u_player9']],
    ['m8', 'u_player8', 'kothrudnets', 'Cricket', addDays(3), '17:00', 2, 10, '', 'Net session followed by a short match.', ['u_player8']],
  ];
  for (const m of matches) {
    await run(`INSERT INTO matches (id,creator_id,venue_id,sport,date,start_time,duration,max_players,skill_level,description,status,created_at)
               VALUES (?,?,?,?,?,?,?,?,?,?,'Open',?)`, [...m.slice(0, 10), now]);
    for (const p of m[10]) await run('INSERT INTO match_participants (match_id,user_id) VALUES (?,?)', [m[0], p]);
  }

  for (const [k, vid] of ['sbr', 'river', 'padel1', 'navshuttle'].entries()) await run('INSERT INTO favorites (user_id,venue_id,created_at) VALUES (?,?,?)', ['u_player', vid, daysAgo(10 - k)]);

  await run(`INSERT INTO reports (id,reporter_id,target_type,target_id,reason,status,created_at)
             VALUES (?,'u_player','venue','bopal2','Floodlights were off for half of my paid slot.','Open',?)`, [uid('report'), daysAgo(1)]);
  await run(`INSERT INTO reports (id,reporter_id,target_type,target_id,reason,status,created_at)
             VALUES (?,'u_player4','user','u_player5','Host cancelled at the venue and asked players to pay in cash.','Open',?)`, [uid('report'), daysAgo(2)]);

  // [user, type, message, link, hours ago, read]
  const notes = [
    ['u_player', 'booking', 'Welcome to QuickCourt! Your demo bookings are ready.', '#/bookings', 480, 1],
    ['u_player', 'match', 'Riya Shah joined your Badminton match at SBR Badminton.', '#/match/m1', 20, 0],
    ['u_player', 'booking', 'Reminder: you have courts booked this week. See your upcoming games.', '#/bookings', 3, 0],
    ['u_owner', 'booking', 'New booking at Skyline Turf Arena for tomorrow evening.', '#/owner/bookings', 2, 0],
    ['u_owner', 'booking', 'A booking at Riverfront Courts was cancelled and the slot is free again.', '#/owner/bookings', 26, 0],
    ['u_owner', 'approval', 'Thaltej Hoops Arena is waiting for admin approval.', '#/owner/facilities', 30, 1],
    ['u_owner2', 'approval', 'Alkapuri Indoor Arena was rejected: photos don\'t show the playing surface.', '#/owner/facilities', 40, 0],
    ['u_admin', 'approval', 'Thaltej Hoops Arena was submitted for approval by Nisha Vora.', '#/admin/facilities', 30, 0],
    ['u_admin', 'approval', 'HSR Padel Social was submitted for approval by Ananya Rao.', '#/admin/facilities', 6, 0],
    ['u_admin', 'report', 'New report: Bopal Football Turf 2 (floodlights off during a paid slot).', '#/admin/reports', 22, 0],
    ['u_admin', 'report', 'New report against a match host in Surat.', '#/admin/reports', 44, 1],
  ];
  for (const [u, type, msg, link, h, read] of notes) {
    await run('INSERT INTO notifications (id,user_id,type,message,link,read,created_at) VALUES (?,?,?,?,?,?,?)',
      [uid('ntf'), u, type, msg, link, read, new Date(Date.now() - h * 3600000).toISOString()]);
  }
}

async function notify(userId, type, message, link = '') {
  await run('INSERT INTO notifications (id,user_id,type,message,link,read,created_at) VALUES (?,?,?,?,?,0,?)',
    [uid('ntf'), userId, type, message, link, new Date().toISOString()]);
}
async function notifyAdmins(type, message, link) {
  for (const a of await all("SELECT id FROM users WHERE role='admin'")) await notify(a.id, type, message, link);
}

// ---------------------------------------------------------------------------
// EMAIL — business events call mail(); the service decides how/if it is delivered (email/index.js)
// ---------------------------------------------------------------------------
const money = (n) => `₹${Number(n).toLocaleString('en-IN')}`;
const hm = (t, h = 0) => toTime(toMin(t) + Math.round(h * 60));
const bookingCtx = (b, extra = {}) => ({
  name: b.user_name, playerName: b.user_name, venueName: b.venue_name, courtName: b.court_name, sport: b.sport, date: b.date,
  time: `${b.start_time} – ${hm(b.start_time, b.duration)}`, duration: `${b.duration} hr`, amount: money(b.total_price),
  location: [b.venue_area, b.venue_city].filter(Boolean).join(', '), bookingId: b.id, ...extra });
const ownerOf = (venueId) => get('SELECT u.id, u.name, u.email FROM venues v JOIN users u ON u.id = v.owner_id WHERE v.id = ?', [venueId]);

// Reminders + "completed" emails run off booking state, so the booking routes stay untouched.
// Only runs once Gmail is configured, so flags are never burned on skipped sends.
async function sendScheduledEmails() {
  const due = await all(`${BOOKING_SELECT} WHERE b.status = 'Confirmed' AND b.reminder_sent = 0
    AND datetime(b.date || ' ' || b.start_time) BETWEEN ? AND ?`, [stamp(), stamp(new Date(Date.now() + Math.round(reminderHours() * 60) * 60000))]);
  for (const b of due) { await run('UPDATE bookings SET reminder_sent = 1 WHERE id = ?', [b.id]); mail('bookingReminder', b.user_email, bookingCtx(b)); }
  await markCompleted();
  for (const b of await all(`${BOOKING_SELECT} WHERE b.status = 'Completed' AND b.completed_sent = 0`)) {
    await run('UPDATE bookings SET completed_sent = 1 WHERE id = ?', [b.id]); mail('bookingCompleted', b.user_email, bookingCtx(b));
  }
}

// Confirmed bookings whose end time has passed become Completed. Run before any booking read.
const markCompleted = () => run(`UPDATE bookings SET status='Completed' WHERE status='Confirmed'
  AND datetime(date || ' ' || start_time, '+' || CAST(duration * 60 AS INTEGER) || ' minutes') <= ?`, [stamp()]);

// ---------------------------------------------------------------------------
// INIT + SESSIONS + ROLE GUARD
// Serverless: every request may land on a fresh instance, so nothing lives in memory.
// Sessions are HMAC-signed tokens (userId + expiry); the user row is re-read on every request,
// so a ban takes effect immediately.
// ---------------------------------------------------------------------------
let readyP;
const ready = () => readyP ||= (async () => {
  if (!client) throw fail(503, 'Database is not configured. Set TURSO_DATABASE_URL and TURSO_AUTH_TOKEN in the Vercel project settings.');
  await setupSchema();
  await seedIfEmpty();
  await tidyDemoData().catch(e => console.error('[tidy] skipped:', e.message));
})().catch(e => { readyP = null; throw e; });

const SECRET = process.env.SESSION_SECRET || process.env.TURSO_AUTH_TOKEN || 'quickcourt-dev-secret';
const SESSION_DAYS = 30;
const sign = (s) => crypto.createHmac('sha256', SECRET).update(s).digest('base64url');
const makeToken = (data, days = SESSION_DAYS) => { const b = Buffer.from(JSON.stringify({ ...data, e: Date.now() + days * 86400000 })).toString('base64url'); return `${b}.${sign(b)}`; };
function readToken(t) {
  const [b, sig] = String(t || '').split('.');
  if (!b || !sig) return null;
  const want = Buffer.from(sign(b)), have = Buffer.from(sig);
  if (want.length !== have.length || !crypto.timingSafeEqual(want, have)) return null;
  try { const d = JSON.parse(Buffer.from(b, 'base64url').toString()); return d.e > Date.now() ? d : null; } catch { return null; }
}

app.use('/api', async (req, res, next) => {
  await ready();
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  const s = readToken(token);
  if (s?.u) {
    const u = await get('SELECT * FROM users WHERE id = ?', [s.u]);
    if (u && u.status !== 'Banned') { req.user = u; req.token = token; }
  }
  next();
});

// Reminder / "completed" emails: no background timer on serverless, so piggy-back on traffic (at most every 5 min
// per instance) and on the /api/cron/emails endpoint.
let lastScheduled = 0;
app.use('/api', async (req, res, next) => {
  if (isConfigured() && Date.now() - lastScheduled > 5 * 60000) {
    lastScheduled = Date.now();
    await sendScheduledEmails().catch(e => console.error('[email] scheduler:', e.message));
  }
  next();
});
// Quick diagnostics: open /api/health in the browser to see what the deployed database actually contains.
app.get('/api/health', async (req, res) => {
  const n = async (t, w = '') => (await get(`SELECT COUNT(*) c FROM ${t} ${w}`)).c;
  res.json({ ok: true, db: DB_URL ? 'turso' : 'local-file', users: await n('users'), venues: await n('venues'), approvedVenues: await n('venues', "WHERE status = 'Approved'"),
    courts: await n('courts'), bookings: await n('bookings'), venuesByCity: await all("SELECT city, COUNT(*) AS n FROM venues WHERE status = 'Approved' GROUP BY city") });
});
app.get('/api/cron/emails', async (req, res) => {
  if (process.env.CRON_SECRET && req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) throw fail(401, 'Unauthorized.');
  await ready();
  if (isConfigured()) await sendScheduledEmails(); else await markCompleted();
  res.json({ success: true });
});

const auth = (...roles) => (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'Please log in to continue.' });
  if (roles.length && !roles.includes(req.user.role)) return res.status(403).json({ error: 'You do not have access to this action.' });
  next();
};

const publicUser = (u) => {
  const { password_hash, otp, otp_expires, ...safe } = u;
  return { ...safe, sports: P(u.sports) };
};

// ---------------------------------------------------------------------------
// AUTH
// Verification and password-reset OTPs are sent through the configured Gmail service.
// ---------------------------------------------------------------------------
app.post('/api/auth/signup', async (req, res) => {
  const { name, email, password, confirmPassword, role, avatar } = req.body;
  const errors = {};
  if (!name || !name.trim()) errors.name = 'Full name is required.';
  if (!email || !/^\S+@\S+\.\S+$/.test(email)) errors.email = 'Enter a valid email address.';
  if (!['player', 'owner'].includes(role)) errors.role = 'Choose Player or Facility Owner.'; // admin is never public
  if (!PASSWORD_RULE.test(password || '')) errors.password = PASSWORD_MSG;
  if (password !== confirmPassword) errors.confirmPassword = 'Passwords do not match.'; // validated, never stored
  if (email && await get('SELECT id FROM users WHERE email = ?', [email.toLowerCase()])) errors.email = 'An account with this email already exists.';
  if (Object.keys(errors).length) throw fail(400, Object.values(errors)[0], { fields: errors });

  const otp = genOtp();
  await run(`INSERT INTO users (id,name,email,password_hash,avatar,role,phone,sports,skill_level,status,email_verified,otp,otp_expires,created_at)
             VALUES (?,?,?,?,?,?,'','[]','','Active',0,?,?,?)`,
    [uid('user'), name.trim(), email.toLowerCase(), hash(password), avatar || '', role, otp, Date.now() + 10 * 60000, new Date().toISOString()]);
  mail('verificationOtp', email.toLowerCase(), { name: name.trim(), otp });
  res.json({ email: email.toLowerCase() });
});

app.post('/api/auth/resend-otp', async (req, res) => {
  const u = await get('SELECT id FROM users WHERE email = ?', [String(req.body.email || '').toLowerCase()]);
  if (!u) throw fail(404, 'No account with this email.');
  const otp = genOtp();
  await run('UPDATE users SET otp = ?, otp_expires = ? WHERE id = ?', [otp, Date.now() + 10 * 60000, u.id]);
  mail('verificationOtp', u.email, { name: u.name, otp });
  res.json({ success: true });
});

function startSession(u) {
  return { token: makeToken({ u: u.id }), user: publicUser(u) };
}

app.post('/api/auth/verify-otp', async (req, res) => {
  const u = await get('SELECT * FROM users WHERE email = ?', [String(req.body.email || '').toLowerCase()]);
  if (!u) throw fail(404, 'No account with this email.');
  if (!u.email_verified && (String(u.otp) !== String(req.body.otp) || Date.now() > u.otp_expires)) throw fail(400, 'Invalid or expired OTP.');
  await run('UPDATE users SET email_verified = 1, otp = NULL WHERE id = ?', [u.id]);
  if (!u.email_verified) mail('welcome', u.email, { name: u.name }); // first sign-in only
  res.json(startSession({ ...u, email_verified: 1 })); // verified → signed straight in
});

app.post('/api/auth/login', async (req, res) => {
  const u = await get('SELECT * FROM users WHERE email = ?', [String(req.body.email || '').toLowerCase()]);
  if (!u || u.password_hash !== hash(req.body.password)) throw fail(401, 'Invalid email or password.');
  if (u.status === 'Banned') throw fail(403, 'This account has been banned. Contact support.');
  if (!u.email_verified) {
    const otp = genOtp();
    await run('UPDATE users SET otp = ?, otp_expires = ? WHERE id = ?', [otp, Date.now() + 10 * 60000, u.id]);
    mail('verificationOtp', u.email, { name: u.name, otp });
    throw fail(403, 'Please verify your email first.', { needsVerification: true, email: u.email });
  }
  res.json(startSession(u));
});

app.post('/api/auth/logout', (req, res) => res.json({ success: true })); // tokens are stateless; the client drops its copy

app.post('/api/auth/forgot-password', async (req, res) => {
  const u = await get('SELECT id FROM users WHERE email = ?', [String(req.body.email || '').toLowerCase()]);
  if (!u) throw fail(404, 'No account with this email.');
  const otp = genOtp();
  await run('UPDATE users SET otp = ?, otp_expires = ? WHERE id = ?', [otp, Date.now() + 10 * 60000, u.id]);
  mail('verificationOtp', u.email, { name: u.name, otp });
  res.json({ success: true });
});

app.post('/api/auth/reset-password', async (req, res) => {
  const { email, otp, newPassword, confirmPassword } = req.body;
  const u = await get('SELECT * FROM users WHERE email = ?', [String(email || '').toLowerCase()]);
  if (!u || String(u.otp) !== String(otp) || Date.now() > u.otp_expires) throw fail(400, 'Invalid or expired OTP.');
  if (!PASSWORD_RULE.test(newPassword || '')) throw fail(400, PASSWORD_MSG);
  if (newPassword !== confirmPassword) throw fail(400, 'Passwords do not match.');
  await run('UPDATE users SET password_hash = ?, otp = NULL, email_verified = 1 WHERE id = ?', [hash(newPassword), u.id]);
  res.json({ success: true });
});

// ---------------------------------------------------------------------------
// GOOGLE SIGN-IN (OAuth 2.0 authorization-code flow, server side — the client secret never reaches the browser)
//   Browser → GET /api/auth/google → Google → GET /api/auth/google/callback → redirect to /#/oauth?token=…
// Uses GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET, or falls back to the GMAIL_CLIENT_* pair if it is the same OAuth client.
// ---------------------------------------------------------------------------
const googleCfg = () => ({ id: process.env.GOOGLE_CLIENT_ID || process.env.GMAIL_CLIENT_ID, secret: process.env.GOOGLE_CLIENT_SECRET || process.env.GMAIL_CLIENT_SECRET });
const origin = (req) => `${req.headers['x-forwarded-proto'] || req.protocol}://${req.headers['x-forwarded-host'] || req.get('host')}`;
const redirectUri = (req) => process.env.GOOGLE_REDIRECT_URI || `${origin(req)}/api/auth/google/callback`;
const cookieOf = (req, name) => (req.headers.cookie || '').split(';').map(c => c.trim().split('=')).find(([k]) => k === name)?.[1];
const toLogin = (res, msg) => res.redirect(`/#/login?oauth_error=${encodeURIComponent(msg)}`);

app.get('/api/auth/google', (req, res) => {
  const { id } = googleCfg();
  if (!id || !googleCfg().secret) return toLogin(res, 'Google sign-in is not configured yet. Please use email for now.');
  const nonce = crypto.randomBytes(12).toString('hex');
  const next = String(req.query.next || '').startsWith('/') ? String(req.query.next) : '';
  const state = makeToken({ n: nonce, role: req.query.role === 'owner' ? 'owner' : 'player', next }, 10 / 1440); // valid 10 minutes
  res.setHeader('Set-Cookie', `qc_oauth=${nonce}; HttpOnly; Path=/api/auth; Max-Age=600; SameSite=Lax${req.protocol === 'https' || req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : ''}`);
  res.redirect('https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
    client_id: id, redirect_uri: redirectUri(req), response_type: 'code', scope: 'openid email profile', state, prompt: 'select_account' }));
});

app.get('/api/auth/google/callback', async (req, res) => {
  const st = readToken(req.query.state);
  if (req.query.error) return toLogin(res, req.query.error === 'access_denied' ? 'Google sign-in was cancelled.' : 'Google sign-in failed. Please try again.');
  if (!st || !req.query.code || st.n !== cookieOf(req, 'qc_oauth')) return toLogin(res, 'Google sign-in expired. Please try again.');
  const { id, secret } = googleCfg();
  const tr = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code: req.query.code, client_id: id, client_secret: secret, redirect_uri: redirectUri(req), grant_type: 'authorization_code' }) });
  const tok = await tr.json().catch(() => ({}));
  if (!tr.ok || !tok.access_token) { console.error('[google] token exchange failed:', tok.error, tok.error_description); return toLogin(res, 'Google sign-in failed. Please try again.'); }
  const info = await (await fetch('https://openidconnect.googleapis.com/v1/userinfo', { headers: { Authorization: `Bearer ${tok.access_token}` } })).json().catch(() => ({}));
  if (!info.email || info.email_verified === false) return toLogin(res, 'Your Google account has no verified email address.');
  const email = String(info.email).toLowerCase();

  let u = await get('SELECT * FROM users WHERE email = ?', [email]);
  if (u?.status === 'Banned') return toLogin(res, 'This account has been banned. Contact support.');
  if (!u) { // first Google sign-in creates the account (random password: they can set one later via "Forgot password")
    const uidv = uid('user');
    await run(`INSERT INTO users (id,name,email,password_hash,avatar,role,phone,sports,skill_level,status,email_verified,created_at)
               VALUES (?,?,?,?,?,?,'','[]','','Active',1,?)`,
      [uidv, String(info.name || email.split('@')[0]).slice(0, 80), email, hash(crypto.randomBytes(24).toString('hex')), info.picture || '', st.role === 'owner' ? 'owner' : 'player', new Date().toISOString()]);
    u = await get('SELECT * FROM users WHERE id = ?', [uidv]);
    mail('welcome', u.email, { name: u.name });
  } else if (!u.email_verified) { // Google has verified this address, so the pending OTP is no longer needed
    await run('UPDATE users SET email_verified = 1, otp = NULL WHERE id = ?', [u.id]);
  }
  res.setHeader('Set-Cookie', 'qc_oauth=; HttpOnly; Path=/api/auth; Max-Age=0');
  res.redirect(`/#/oauth?token=${encodeURIComponent(makeToken({ u: u.id }))}${st.next ? '&next=' + encodeURIComponent(st.next) : ''}`);
});

app.get('/api/me', auth(), (req, res) => res.json(publicUser(req.user)));

// Email, role and status are not editable here — only personal fields.
app.put('/api/me', auth(), async (req, res) => {
  const b = req.body;
  if (b.name !== undefined && !String(b.name).trim()) throw fail(400, 'Full name is required.');
  if (b.phone && !/^\d{10}$/.test(b.phone)) throw fail(400, 'Phone must be 10 digits.');
  if (b.sports && !b.sports.every(s => SPORTS.includes(s))) throw fail(400, 'Unknown sport selected.');
  if (b.skill_level && !SKILL_LEVELS.includes(b.skill_level)) throw fail(400, 'Unknown skill level.');
  const set = [], vals = [];
  for (const f of ['name', 'phone', 'avatar', 'sports', 'skill_level']) {
    if (b[f] !== undefined) { set.push(`${f} = ?`); vals.push(f === 'sports' ? j(b[f]) : b[f]); }
  }
  if (!set.length) throw fail(400, 'Nothing to update.');
  await run(`UPDATE users SET ${set.join(', ')} WHERE id = ?`, [...vals, req.user.id]);
  res.json(publicUser(await get('SELECT * FROM users WHERE id = ?', [req.user.id])));
});

app.put('/api/me/password', auth(), async (req, res) => {
  const { currentPassword, newPassword, confirmPassword } = req.body;
  if (req.user.password_hash !== hash(currentPassword)) throw fail(400, 'Current password is incorrect.');
  if (!PASSWORD_RULE.test(newPassword || '')) throw fail(400, PASSWORD_MSG);
  if (newPassword !== confirmPassword) throw fail(400, 'Passwords do not match.');
  await run('UPDATE users SET password_hash = ? WHERE id = ?', [hash(newPassword), req.user.id]);
  res.json({ success: true });
});

app.get('/api/catalog', (req, res) => res.json({ sports: SPORTS, amenities: AMENITIES, skillLevels: SKILL_LEVELS, sportImages: IMG, locations: LOCATIONS }));

// ---------------------------------------------------------------------------
// NOTIFICATIONS
// ---------------------------------------------------------------------------
app.get('/api/notifications', auth(), async (req, res) => {
  res.json(await all('SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 30', [req.user.id]));
});
app.put('/api/notifications/read', auth(), async (req, res) => {
  await run('UPDATE notifications SET read = 1 WHERE user_id = ?', [req.user.id]);
  res.json({ success: true });
});

// ---------------------------------------------------------------------------
// VENUES (public discovery)
// ---------------------------------------------------------------------------
const VENUE_SELECT = `SELECT v.*,
  IFNULL((SELECT MIN(price_per_hour) FROM courts WHERE venue_id = v.id AND status = 'Active'), 0) AS price,
  IFNULL((SELECT ROUND(AVG(rating), 1) FROM reviews WHERE venue_id = v.id), 0) AS rating,
  (SELECT COUNT(*) FROM reviews WHERE venue_id = v.id) AS reviewCount,
  (SELECT COUNT(*) FROM courts WHERE venue_id = v.id AND status = 'Active') AS activeCourts
  FROM venues v`;
const venueOut = (v, withImages = true) => {
  const out = { ...v, sports: P(v.sports), amenities: P(v.amenities), active_days: P(v.active_days, [0, 1, 2, 3, 4, 5, 6]) };
  out.images = withImages ? P(v.images) : undefined; // listings only need the cover
  return out;
};

app.get('/api/venues', async (req, res) => {
  const { sport, type, minRating, maxPrice, q, sort = 'popular', lat, lng, state, city, area } = req.query;
  const page = Math.max(1, Number(req.query.page) || 1), pageSize = Math.min(24, Number(req.query.pageSize) || 9);
  let sql = `${VENUE_SELECT} WHERE v.status = 'Approved'`;
  const args = [];
  if (type) { sql += " AND (v.venue_type = ? OR v.venue_type = 'Both')"; args.push(type); }
  for (const [col, val] of [['state', state], ['city', city], ['area', area]]) if (val) { sql += ` AND v.${col} = ?`; args.push(val); }
  if (q) { sql += ' AND (v.name LIKE ? OR v.area LIKE ? OR v.city LIKE ?)'; args.push(`%${q}%`, `%${q}%`, `%${q}%`); }
  let venues = (await all(sql, args)).map(v => venueOut(v, false));
  if (sport) venues = venues.filter(v => v.sports.includes(sport));
  if (maxPrice) venues = venues.filter(v => v.price <= Number(maxPrice));
  if (minRating) venues = venues.filter(v => v.rating >= Number(minRating));
  if (lat && lng) {
    // ponytail: flat-earth distance, fine within one city; haversine if venues span states.
    venues.forEach(v => { v.distanceKm = Math.round(Math.hypot((v.latitude - lat) * 111, (v.longitude - lng) * 102) * 10) / 10; });
  }
  const sorters = {
    popular: (a, b) => b.reviewCount - a.reviewCount || b.rating - a.rating,
    rating: (a, b) => b.rating - a.rating,
    price_asc: (a, b) => a.price - b.price,
    price_desc: (a, b) => b.price - a.price,
    distance: (a, b) => (a.distanceKm ?? 1e9) - (b.distanceKm ?? 1e9),
  };
  venues.sort(sorters[sort] || sorters.popular);
  const start = (page - 1) * pageSize;
  res.json({ venues: venues.slice(start, start + pageSize), total: venues.length, page, pageSize });
});

// Approved venues are public; pending/rejected ones are visible to their owner and admins only.
async function loadVenue(id, user) {
  const v = await get(`${VENUE_SELECT} WHERE v.id = ?`, [id]);
  if (!v) throw fail(404, 'Venue not found.');
  const privileged = user && (user.role === 'admin' || user.id === v.owner_id);
  if (v.status !== 'Approved' && !privileged) throw fail(404, 'Venue not found.');
  return v;
}

app.get('/api/venues/:id', async (req, res) => {
  const v = await loadVenue(req.params.id, req.user);
  const courts = await all('SELECT * FROM courts WHERE venue_id = ? ORDER BY name', [v.id]);
  res.json({ ...venueOut(v), courts });
});

app.get('/api/venues/:id/reviews', async (req, res) => {
  res.json(await all(`SELECT r.*, u.name AS user_name, u.avatar AS user_avatar FROM reviews r JOIN users u ON u.id = r.user_id
                      WHERE r.venue_id = ? ORDER BY r.created_at DESC`, [req.params.id]));
});

// ---------------------------------------------------------------------------
// AVAILABILITY — derived, never pre-generated
// ---------------------------------------------------------------------------
async function courtContext(court, venue, date) {
  const cutoff = new Date(Date.now() - RESERVE_MIN * 60000).toISOString();
  const booked = await all(`SELECT start_time, duration FROM bookings WHERE court_id = ? AND date = ?
    AND (status IN ('Confirmed','Completed') OR (status = 'Reserved' AND created_at > ?))`, [court.id, date, cutoff]);
  const blocked = await all('SELECT * FROM blocked_slots WHERE court_id = ? AND date = ?', [court.id, date]);
  const weekday = new Date(date + 'T00:00:00').getDay();
  return {
    court, date,
    open: toMin(court.opening_time || venue.opening_time || '06:00'),
    close: toMin(court.closing_time || venue.closing_time || '23:00'),
    slot: venue.slot_minutes || 60,
    closedDay: !P(venue.active_days, [0, 1, 2, 3, 4, 5, 6]).includes(weekday),
    booked: booked.map(b => [toMin(b.start_time), toMin(b.start_time) + b.duration * 60]),
    blocked: blocked.map(b => ({ ...b, s: toMin(b.start_time), e: toMin(b.end_time) })),
  };
}

// The single server-side rule for "can this court be booked for [start, start+dur)".
function bookingProblem(ctx, start, dur) {
  const now = new Date();
  if (ctx.date < localDate()) return 'The selected date must be today or later.';
  if (ctx.date === localDate() && start <= now.getHours() * 60 + now.getMinutes()) return 'Start time must be in the future.';
  if (ctx.court.status !== 'Active') return 'This court is under maintenance.';
  if (ctx.closedDay) return 'The facility is closed on this day.';
  if (start < ctx.open || start + dur > ctx.close) return 'That time is outside operating hours.';
  const hit = (s, e) => start < e && start + dur > s;
  if (ctx.booked.some(([s, e]) => hit(s, e))) return 'That slot was just booked by someone else. Please pick another time.';
  if (ctx.blocked.some(b => hit(b.s, b.e))) return 'That slot is blocked for maintenance. Please pick another time.';
  return null;
}

// Player booking grid: for each start time, which courts of this sport are free for the whole duration.
app.get('/api/venues/:id/availability', async (req, res) => {
  const { date, sport } = req.query;
  if (!date) throw fail(400, 'date is required (YYYY-MM-DD).');
  const venue = await loadVenue(req.params.id, req.user);
  const courts = await all('SELECT * FROM courts WHERE venue_id = ? AND sport = ? ORDER BY name', [venue.id, sport || P(venue.sports)[0]]);
  const ctxs = await Promise.all(courts.map(c => courtContext(c, venue, date)));
  const step = venue.slot_minutes || 60;
  const dur = Math.max(step, Math.round((Number(req.query.duration) || 1) * 60));
  const open = Math.min(...ctxs.map(c => c.open)), close = Math.max(...ctxs.map(c => c.close));
  const slots = [];
  for (let t = open; ctxs.length && t + dur <= close; t += step) {
    const free = ctxs.filter(c => !bookingProblem(c, t, dur)).map(c => ({ id: c.court.id, name: c.court.name, price_per_hour: c.court.price_per_hour }));
    slots.push({ time: toTime(t), available: free.length > 0, courts: free });
  }
  res.json({ slots, slotMinutes: step, closedDay: ctxs[0]?.closedDay || false });
});

// ---------------------------------------------------------------------------
// BOOKINGS — Reserve (server checks the slot) → Pay → Confirmed
// ---------------------------------------------------------------------------
// ponytail: one global promise-chain lock serializes check+insert so two requests can't
// both pass the availability check. Per-court locks if booking throughput ever matters.
let bookingLock = Promise.resolve();
const withBookingLock = (fn) => { const p = bookingLock.then(fn); bookingLock = p.catch(() => {}); return p; };

app.post('/api/bookings', auth('player'), async (req, res) => {
  const { venue_id, court_id, date, start_time } = req.body;
  const duration = Number(req.body.duration);
  if (!venue_id || !court_id || !date || !start_time || !(duration > 0)) throw fail(400, 'Venue, court, date, start time and duration are required.');
  const result = await withBookingLock(async () => {
    const venue = await loadVenue(venue_id, null);
    const court = await get('SELECT * FROM courts WHERE id = ? AND venue_id = ?', [court_id, venue_id]);
    if (!court) throw fail(404, 'Court not found.');
    const ctx = await courtContext(court, venue, date);
    const problem = bookingProblem(ctx, toMin(start_time), duration * 60);
    if (problem) throw fail(409, problem);
    const id = uid('booking');
    const total_price = Math.round(court.price_per_hour * duration); // price is always derived here, never sent by the client
    await run(`INSERT INTO bookings (id,user_id,venue_id,court_id,sport,date,start_time,duration,total_price,status,created_at)
               VALUES (?,?,?,?,?,?,?,?,?,'Reserved',?)`, [id, req.user.id, venue_id, court_id, court.sport, date, start_time, duration, total_price, new Date().toISOString()]);
    // The in-memory lock only covers one instance. Re-check after inserting: if an earlier overlapping
    // booking exists (another instance won the race), withdraw this one.
    const cutoff = new Date(Date.now() - RESERVE_MIN * 60000).toISOString();
    const mine = (await get('SELECT created_at FROM bookings WHERE id = ?', [id])).created_at, s0 = toMin(start_time), e0 = s0 + duration * 60;
    const rivals = await all(`SELECT id, start_time, duration, created_at FROM bookings WHERE court_id = ? AND date = ? AND id <> ?
      AND (status IN ('Confirmed','Completed') OR (status = 'Reserved' AND created_at > ?))`, [court_id, date, id, cutoff]);
    if (rivals.some(r => s0 < toMin(r.start_time) + r.duration * 60 && e0 > toMin(r.start_time) && (r.created_at < mine || (r.created_at === mine && r.id < id)))) {
      await run('DELETE FROM bookings WHERE id = ?', [id]);
      throw fail(409, 'That slot was just booked by someone else. Please pick another time.');
    }
    return { id, total_price, status: 'Reserved', expiresInMinutes: RESERVE_MIN };
  });
  res.json(result);
});

const BOOKING_SELECT = `SELECT b.*, v.name AS venue_name, v.area AS venue_area, v.city AS venue_city, v.cover_image,
  c.name AS court_name, u.name AS user_name, u.email AS user_email,
  (SELECT id FROM reviews WHERE booking_id = b.id) AS review_id,
  (SELECT status FROM payments WHERE booking_id = b.id ORDER BY created_at DESC LIMIT 1) AS payment_status
  FROM bookings b JOIN venues v ON v.id = b.venue_id JOIN courts c ON c.id = b.court_id JOIN users u ON u.id = b.user_id`;

app.get('/api/bookings/:id', auth(), async (req, res) => {
  await markCompleted();
  const b = await get(`${BOOKING_SELECT} WHERE b.id = ?`, [req.params.id]);
  const owner = b && (await get('SELECT owner_id FROM venues WHERE id = ?', [b.venue_id])).owner_id;
  if (!b || ![b.user_id, owner].includes(req.user.id) && req.user.role !== 'admin') throw fail(404, 'Booking not found.');
  res.json(b);
});

// Simulated payment: records a Paid payment row and confirms the reservation.
app.post('/api/bookings/:id/pay', auth('player'), async (req, res) => {
  const b = await get(`${BOOKING_SELECT} WHERE b.id = ? AND b.user_id = ?`, [req.params.id, req.user.id]);
  if (!b) throw fail(404, 'Booking not found.');
  if (b.status !== 'Reserved') throw fail(400, `This booking is already ${b.status.toLowerCase()}.`);
  if (Date.now() - new Date(b.created_at).getTime() > RESERVE_MIN * 60000) {
    await run("UPDATE bookings SET status = 'Expired' WHERE id = ?", [b.id]);
    throw fail(409, 'Your reservation expired before payment. Please pick the slot again.');
  }
  await run('INSERT INTO payments (id,booking_id,amount,status,created_at) VALUES (?,?,?,?,?)', [uid('pay'), b.id, b.total_price, 'Paid', new Date().toISOString()]);
  await run("UPDATE bookings SET status = 'Confirmed' WHERE id = ?", [b.id]);
  const owner = await get('SELECT owner_id FROM venues WHERE id = ?', [b.venue_id]);
  await notify(req.user.id, 'booking', `Booking confirmed: ${b.venue_name}, ${b.court_name} on ${b.date} at ${b.start_time}.`, `#/bookings`);
  const ow = await ownerOf(b.venue_id);
  mail('bookingConfirmed', b.user_email, bookingCtx(b, { amount: `${money(b.total_price)} (paid)` }));
  if (ow) mail('ownerNewBooking', ow.email, bookingCtx(b, { name: ow.name }));
  await notify(owner.owner_id, 'booking', `New booking: ${req.user.name} booked ${b.court_name} at ${b.venue_name} on ${b.date} ${b.start_time}.`, '#/owner/bookings');
  res.json({ success: true, status: 'Confirmed' });
});

app.get('/api/my/bookings', auth('player'), async (req, res) => {
  await markCompleted();
  res.json(await all(`${BOOKING_SELECT} WHERE b.user_id = ? AND b.status IN ('Confirmed','Completed','Cancelled') ORDER BY b.date DESC, b.start_time DESC`, [req.user.id]));
});

app.put('/api/bookings/:id/cancel', auth('player'), async (req, res) => {
  await markCompleted();
  const b = await get(`${BOOKING_SELECT} WHERE b.id = ? AND b.user_id = ?`, [req.params.id, req.user.id]);
  if (!b) throw fail(404, 'Booking not found.');
  if (!['Confirmed', 'Reserved'].includes(b.status)) throw fail(400, 'Only upcoming bookings can be cancelled.');
  const ow = await ownerOf(b.venue_id);
  mail('bookingCancelled', b.user_email, bookingCtx(b, { refund: b.payment_status === 'Paid' ? `Refund of ${money(b.total_price)} initiated` : '' }));
  if (ow) mail('ownerBookingCancelled', ow.email, bookingCtx(b, { name: ow.name }));
  await run("UPDATE bookings SET status = 'Cancelled' WHERE id = ?", [b.id]); // releases the slot: availability ignores cancelled rows
  await run("UPDATE payments SET status = 'Refunded' WHERE booking_id = ? AND status = 'Paid'", [b.id]);
  const owner = await get('SELECT owner_id FROM venues WHERE id = ?', [b.venue_id]);
  await notify(owner.owner_id, 'booking', `${req.user.name} cancelled ${b.court_name} at ${b.venue_name} on ${b.date} ${b.start_time}.`, '#/owner/bookings');
  res.json({ success: true });
});

// ---------------------------------------------------------------------------
// REVIEWS — only for your own completed booking, once
// ---------------------------------------------------------------------------
app.post('/api/reviews', auth('player'), async (req, res) => {
  const { booking_id, comment } = req.body;
  const rating = Number(req.body.rating);
  if (!(rating >= 1 && rating <= 5)) throw fail(400, 'Choose a rating from 1 to 5.');
  await markCompleted();
  const b = await get('SELECT * FROM bookings WHERE id = ? AND user_id = ?', [booking_id, req.user.id]);
  if (!b || b.status !== 'Completed') throw fail(400, 'You can review a venue after your booking is completed.');
  if (await get('SELECT 1 FROM reviews WHERE booking_id = ?', [booking_id])) throw fail(409, 'You already reviewed this booking.');
  await run('INSERT INTO reviews (id,user_id,venue_id,booking_id,rating,comment,created_at) VALUES (?,?,?,?,?,?,?)',
    [uid('review'), req.user.id, b.venue_id, booking_id, rating, String(comment || '').slice(0, 500), new Date().toISOString()]);
  res.json({ success: true });
});

// ---------------------------------------------------------------------------
// MATCHES
// ---------------------------------------------------------------------------
const MATCH_SELECT = `SELECT m.*, v.name AS venue_name, v.area AS venue_area, v.city AS venue_city, v.cover_image,
  u.name AS host_name, (SELECT COUNT(*) FROM match_participants WHERE match_id = m.id) AS joined_count
  FROM matches m JOIN venues v ON v.id = m.venue_id JOIN users u ON u.id = m.creator_id`;

app.get('/api/matches', async (req, res) => {
  let sql = `${MATCH_SELECT} WHERE m.date >= ? AND m.status IN ('Open','Full')`;
  const args = [localDate()];
  if (req.query.sport) { sql += ' AND m.sport = ?'; args.push(req.query.sport); }
  if (req.query.city) { sql += ' AND v.city = ?'; args.push(req.query.city); }
  const rows = await all(sql + ' ORDER BY m.date, m.start_time', args);
  if (req.user) {
    const mine = new Set((await all('SELECT match_id FROM match_participants WHERE user_id = ?', [req.user.id])).map(r => r.match_id));
    rows.forEach(r => { r.joined = mine.has(r.id); });
  }
  res.json(rows);
});

app.get('/api/my/matches', auth('player'), async (req, res) => {
  res.json(await all(`${MATCH_SELECT} WHERE m.id IN (SELECT match_id FROM match_participants WHERE user_id = ?) ORDER BY m.date DESC`, [req.user.id]));
});

// ---------------------------------------------------------------------------
// FAVOURITES — a player's saved venues
// ---------------------------------------------------------------------------
app.get('/api/my/favorites', auth('player'), async (req, res) => {
  const rows = await all(`${VENUE_SELECT} JOIN favorites f ON f.venue_id = v.id AND f.user_id = ? WHERE v.status = 'Approved' ORDER BY f.created_at DESC`, [req.user.id]);
  res.json(rows.map(v => venueOut(v, false)));
});
app.put('/api/my/favorites/:venueId', auth('player'), async (req, res) => {
  await loadVenue(req.params.venueId, null);
  await run('INSERT OR IGNORE INTO favorites (user_id,venue_id,created_at) VALUES (?,?,?)', [req.user.id, req.params.venueId, new Date().toISOString()]);
  res.json({ success: true });
});
app.delete('/api/my/favorites/:venueId', auth('player'), async (req, res) => {
  await run('DELETE FROM favorites WHERE user_id = ? AND venue_id = ?', [req.user.id, req.params.venueId]);
  res.json({ success: true });
});

app.get('/api/matches/:id', async (req, res) => {
  const m = await get(`${MATCH_SELECT} WHERE m.id = ?`, [req.params.id]);
  if (!m) throw fail(404, 'Match not found.');
  m.participants = await all('SELECT u.id, u.name, u.avatar, u.skill_level FROM match_participants p JOIN users u ON u.id = p.user_id WHERE p.match_id = ?', [m.id]);
  m.joined = !!req.user && m.participants.some(p => p.id === req.user.id);
  res.json(m);
});

app.post('/api/matches', auth('player'), async (req, res) => {
  const { venue_id, sport, date, start_time, skill_level, description } = req.body;
  const duration = Number(req.body.duration), max_players = Number(req.body.max_players);
  if (!venue_id || !sport || !date || !start_time || !(duration > 0) || !(max_players >= 2)) throw fail(400, 'Sport, venue, date, start time, duration and players needed (2 or more) are required.');
  const venue = await loadVenue(venue_id, null);
  if (!P(venue.sports).includes(sport)) throw fail(400, `${venue.name} does not offer ${sport}.`);
  if (date < localDate() || (date === localDate() && toMin(start_time) <= new Date().getHours() * 60 + new Date().getMinutes())) throw fail(400, 'Match must start in the future.');
  if (skill_level && !SKILL_LEVELS.includes(skill_level)) throw fail(400, 'Unknown skill level.');
  const id = uid('match');
  await run(`INSERT INTO matches (id,creator_id,venue_id,sport,date,start_time,duration,max_players,skill_level,description,status,created_at)
             VALUES (?,?,?,?,?,?,?,?,?,?,'Open',?)`, [id, req.user.id, venue_id, sport, date, start_time, duration, max_players, skill_level || '', String(description || '').slice(0, 300), new Date().toISOString()]);
  await run('INSERT INTO match_participants (match_id,user_id) VALUES (?,?)', [id, req.user.id]); // host counts as a player
  res.json({ id });
});

app.post('/api/matches/:id/join', auth('player'), async (req, res) => {
  const m = await get(`${MATCH_SELECT} WHERE m.id = ?`, [req.params.id]);
  if (!m) throw fail(404, 'Match not found.');
  if (m.date < localDate()) throw fail(400, 'This match has already been played.');
  if (await get('SELECT 1 FROM match_participants WHERE match_id = ? AND user_id = ?', [m.id, req.user.id])) throw fail(400, 'You have already joined this match.');
  if (m.joined_count >= m.max_players) throw fail(400, 'This match is full.');
  await run('INSERT INTO match_participants (match_id,user_id) VALUES (?,?)', [m.id, req.user.id]);
  if (m.joined_count + 1 >= m.max_players) await run("UPDATE matches SET status = 'Full' WHERE id = ?", [m.id]);
  const mc = { venueName: m.venue_name, date: m.date, time: m.start_time, sport: m.sport };
  mail('matchJoined', req.user.email, { ...mc, name: req.user.name, hostName: m.host_name });
  const host = await get('SELECT name, email FROM users WHERE id = ?', [m.creator_id]);
  if (host) mail('matchUpdate', host.email, { ...mc, name: host.name, subject: `${req.user.name} joined your ${m.sport} match`, message: `${req.user.name} joined your ${m.sport} match (${m.joined_count + 1}/${m.max_players} players).` });
  await notify(m.creator_id, 'match', `${req.user.name} joined your ${m.sport} match on ${m.date}.`, `#/match/${m.id}`);
  res.json({ success: true });
});

// ---------------------------------------------------------------------------
// REPORTS (any signed-in user can flag a facility or a user)
// ---------------------------------------------------------------------------
app.post('/api/reports', auth(), async (req, res) => {
  const { target_type, target_id, reason } = req.body;
  if (!['venue', 'user'].includes(target_type) || !target_id || !String(reason || '').trim()) throw fail(400, 'Choose what to report and give a reason.');
  await run("INSERT INTO reports (id,reporter_id,target_type,target_id,reason,status,created_at) VALUES (?,?,?,?,?,'Open',?)",
    [uid('report'), req.user.id, target_type, target_id, String(reason).slice(0, 500), new Date().toISOString()]);
  await notifyAdmins('report', `New report from ${req.user.name}: ${String(reason).slice(0, 60)}`, '#/admin/reports');
  res.json({ success: true });
});

// ---------------------------------------------------------------------------
// FACILITY OWNER
// ---------------------------------------------------------------------------
async function ownVenue(req, id) {
  const v = await get('SELECT * FROM venues WHERE id = ? AND owner_id = ?', [id, req.user.id]);
  if (!v) throw fail(404, 'Facility not found.');
  return v;
}
async function ownCourt(req, id) {
  const c = await get('SELECT c.* FROM courts c JOIN venues v ON v.id = c.venue_id WHERE c.id = ? AND v.owner_id = ?', [id, req.user.id]);
  if (!c) throw fail(404, 'Court not found.');
  return c;
}

app.get('/api/owner/venues', auth('owner'), async (req, res) => {
  res.json((await all(`${VENUE_SELECT} WHERE v.owner_id = ? ORDER BY v.created_at DESC`, [req.user.id])).map(v => venueOut(v, false)));
});

// Steps 1–3 of the setup wizard arrive together on submit and are validated here.
function venueFields(b) {
  const need = { name: 'Facility name', description: 'Description', address: 'Address line', area: 'Area / locality', city: 'City', state: 'State', pincode: 'Pincode', contact_phone: 'Contact phone' };
  for (const [k, label] of Object.entries(need)) if (!String(b[k] || '').trim()) throw fail(400, `${label} is required.`);
  if (!LOCATIONS[b.state]?.[b.city]?.[b.area]) throw fail(400, 'Choose the state, city and area from the list.');
  if (!/^\d{6}$/.test(b.pincode)) throw fail(400, 'Pincode must be 6 digits.');
  if (!/^\d{10}$/.test(b.contact_phone)) throw fail(400, 'Contact phone must be 10 digits.');
  if (!(Math.abs(b.latitude) <= 90 && Math.abs(b.longitude) <= 180) || b.latitude === '' || b.longitude === '' || b.latitude == null) throw fail(400, 'Set the map location (latitude & longitude).');
  if (!Array.isArray(b.sports) || !b.sports.length || !b.sports.every(s => SPORTS.includes(s))) throw fail(400, 'Select at least one supported sport.');
  if (!['Indoor', 'Outdoor', 'Both'].includes(b.venue_type)) throw fail(400, 'Choose a venue type.');
  if (!Array.isArray(b.amenities) || !b.amenities.every(a => AMENITIES.includes(a))) throw fail(400, 'Unknown amenity selected.');
  if (!Array.isArray(b.images) || !b.images.length) throw fail(400, 'Upload at least one photo.');
  return [b.name.trim(), b.description.trim(), b.address.trim(), b.area.trim(), b.city.trim(), b.state.trim(), b.pincode, Number(b.latitude), Number(b.longitude),
    b.contact_phone, b.venue_type, j(b.sports), j(b.amenities), b.images.includes(b.cover_image) ? b.cover_image : b.images[0], j(b.images)];
}

app.post('/api/owner/venues', auth('owner'), async (req, res) => {
  const id = uid('venue');
  await run(`INSERT INTO venues (id,owner_id,name,description,address,area,city,state,pincode,latitude,longitude,contact_phone,venue_type,sports,amenities,cover_image,images,status,created_at)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'Pending',?)`, [id, req.user.id, ...venueFields(req.body), new Date().toISOString()]);
  mail('facilitySubmitted', req.user.email, { name: req.user.name, venueName: req.body.name });
  await notifyAdmins('approval', `${req.body.name} was submitted for approval by ${req.user.name}.`, '#/admin/facilities');
  res.json({ id, status: 'Pending' });
});

// Editing submitted details sends the facility back to Pending: admin reviews, never edits.
app.put('/api/owner/venues/:id', auth('owner'), async (req, res) => {
  await ownVenue(req, req.params.id);
  await run(`UPDATE venues SET name=?,description=?,address=?,area=?,city=?,state=?,pincode=?,latitude=?,longitude=?,contact_phone=?,venue_type=?,sports=?,amenities=?,cover_image=?,images=?,
             status='Pending', reject_reason=NULL, created_at=? WHERE id = ?`, [...venueFields(req.body), new Date().toISOString(), req.params.id]);
  mail('facilitySubmitted', req.user.email, { name: req.user.name, venueName: req.body.name });
  await notifyAdmins('approval', `${req.body.name} was updated and resubmitted for approval.`, '#/admin/facilities');
  res.json({ success: true, status: 'Pending' });
});

// Availability config: opening/closing time, slot duration, active days. Does not affect approval.
app.put('/api/owner/venues/:id/availability', auth('owner'), async (req, res) => {
  await ownVenue(req, req.params.id);
  const { opening_time, closing_time, active_days } = req.body;
  const slot_minutes = Number(req.body.slot_minutes);
  if (!/^\d\d:\d\d$/.test(opening_time || '') || !/^\d\d:\d\d$/.test(closing_time || '') || toMin(opening_time) >= toMin(closing_time)) throw fail(400, 'Closing time must be after opening time.');
  if (![30, 60, 90, 120].includes(slot_minutes)) throw fail(400, 'Slot duration must be 30, 60, 90 or 120 minutes.');
  if (!Array.isArray(active_days) || !active_days.length || !active_days.every(d => d >= 0 && d <= 6)) throw fail(400, 'Select at least one active day.');
  await run('UPDATE venues SET opening_time=?, closing_time=?, slot_minutes=?, active_days=? WHERE id = ?', [opening_time, closing_time, slot_minutes, j(active_days), req.params.id]);
  res.json({ success: true });
});

function courtFields(b, venue) {
  if (!String(b.name || '').trim()) throw fail(400, 'Court name is required.');
  if (!P(venue.sports).includes(b.sport)) throw fail(400, 'Pick one of the facility\'s sports.');
  if (!(Number(b.price_per_hour) > 0)) throw fail(400, 'Base price per hour must be greater than 0.');
  if (!['Active', 'Maintenance'].includes(b.status || 'Active')) throw fail(400, 'Status must be Active or Maintenance.');
  const override = b.opening_time && b.closing_time;
  if (override && toMin(b.opening_time) >= toMin(b.closing_time)) throw fail(400, 'Override closing time must be after opening time.');
  return [b.name.trim(), b.sport, Math.round(Number(b.price_per_hour)), b.status || 'Active', override ? b.opening_time : null, override ? b.closing_time : null];
}

app.get('/api/owner/venues/:id/courts', auth('owner'), async (req, res) => {
  await ownVenue(req, req.params.id);
  res.json(await all('SELECT * FROM courts WHERE venue_id = ? ORDER BY name', [req.params.id]));
});
app.post('/api/owner/venues/:id/courts', auth('owner'), async (req, res) => {
  const venue = await ownVenue(req, req.params.id);
  const id = uid('court');
  await run('INSERT INTO courts (id,venue_id,name,sport,price_per_hour,status,opening_time,closing_time) VALUES (?,?,?,?,?,?,?,?)', [id, venue.id, ...courtFields(req.body, venue)]);
  res.json({ id });
});
app.put('/api/owner/courts/:id', auth('owner'), async (req, res) => {
  const court = await ownCourt(req, req.params.id);
  const venue = await get('SELECT * FROM venues WHERE id = ?', [court.venue_id]);
  await run('UPDATE courts SET name=?, sport=?, price_per_hour=?, status=?, opening_time=?, closing_time=? WHERE id = ?', [...courtFields(req.body, venue), court.id]);
  res.json({ success: true });
});
app.delete('/api/owner/courts/:id', auth('owner'), async (req, res) => {
  const court = await ownCourt(req, req.params.id);
  await markCompleted();
  if (await get("SELECT 1 FROM bookings WHERE court_id = ? AND status IN ('Reserved','Confirmed')", [court.id])) throw fail(409, 'This court has upcoming bookings. Set it to Maintenance instead.');
  await run('DELETE FROM courts WHERE id = ?', [court.id]);
  res.json({ success: true });
});

// Owner slot grid for one court + date: every generated slot with its state.
app.get('/api/owner/courts/:id/slots', auth('owner'), async (req, res) => {
  const court = await ownCourt(req, req.params.id);
  const venue = await get('SELECT * FROM venues WHERE id = ?', [court.venue_id]);
  const ctx = await courtContext(court, venue, req.query.date || localDate());
  const slots = [];
  for (let t = ctx.open; !ctx.closedDay && t + ctx.slot <= ctx.close; t += ctx.slot) {
    const hit = (s, e) => t < e && t + ctx.slot > s;
    const block = ctx.blocked.find(b => hit(b.s, b.e));
    const status = court.status !== 'Active' ? 'maintenance' : block ? 'blocked' : ctx.booked.some(([s, e]) => hit(s, e)) ? 'booked' : 'available';
    slots.push({ time: toTime(t), end: toTime(t + ctx.slot), status, blockId: block?.id, reason: block?.reason });
  }
  res.json({ slots, closedDay: ctx.closedDay });
});
app.post('/api/owner/courts/:id/block', auth('owner'), async (req, res) => {
  const court = await ownCourt(req, req.params.id);
  const { date, start_time, end_time, reason } = req.body;
  if (!date || !start_time || !end_time || toMin(start_time) >= toMin(end_time)) throw fail(400, 'Date and a valid start/end time are required.');
  if (await get("SELECT 1 FROM bookings WHERE court_id = ? AND date = ? AND status IN ('Reserved','Confirmed') AND ? < time(start_time, '+' || CAST(duration*60 AS INTEGER) || ' minutes') AND ? > start_time",
    [court.id, date, start_time, end_time])) throw fail(409, 'A player has already booked part of that range.');
  await run('INSERT INTO blocked_slots (id,court_id,date,start_time,end_time,reason) VALUES (?,?,?,?,?,?)', [uid('block'), court.id, date, start_time, end_time, reason || 'Maintenance']);
  res.json({ success: true });
});
app.delete('/api/owner/blocks/:id', auth('owner'), async (req, res) => {
  const b = await get('SELECT b.* FROM blocked_slots b JOIN courts c ON c.id = b.court_id JOIN venues v ON v.id = c.venue_id WHERE b.id = ? AND v.owner_id = ?', [req.params.id, req.user.id]);
  if (!b) throw fail(404, 'Block not found.');
  await run('DELETE FROM blocked_slots WHERE id = ?', [b.id]);
  res.json({ success: true });
});

app.get('/api/owner/bookings', auth('owner'), async (req, res) => {
  await markCompleted();
  let sql = `${BOOKING_SELECT} WHERE v.owner_id = ? AND b.status IN ('Confirmed','Completed','Cancelled')`;
  const args = [req.user.id];
  if (req.query.venueId) { sql += ' AND b.venue_id = ?'; args.push(req.query.venueId); }
  res.json(await all(sql + ' ORDER BY b.date DESC, b.start_time DESC', args));
});

// Every dashboard number is an aggregate over bookings/payments/courts — nothing is typed in.
app.get('/api/owner/stats', auth('owner'), async (req, res) => {
  await markCompleted();
  const scope = req.query.venueId ? ' AND v.id = ?' : '';
  const args = req.query.venueId ? [req.user.id, req.query.venueId] : [req.user.id];
  const B = `FROM bookings b JOIN venues v ON v.id = b.venue_id WHERE v.owner_id = ?${scope}`;
  const live = " AND b.status IN ('Confirmed','Completed')";
  const period = req.query.period || 'daily';
  const bucket = { daily: 'b.date', weekly: "strftime('%Y-W%W', b.date)", monthly: "substr(b.date, 1, 7)" }[period] || 'b.date';
  const since = { daily: addDays(-13), weekly: addDays(-7 * 8), monthly: addDays(-180) }[period] || addDays(-13);

  const totalBookings = (await get(`SELECT COUNT(*) c ${B}${live}`, args)).c;
  const activeCourts = (await get(`SELECT COUNT(*) c FROM courts c JOIN venues v ON v.id = c.venue_id WHERE v.owner_id = ?${scope} AND c.status = 'Active'`, args)).c;
  const revenue = (await get(`SELECT IFNULL(SUM(p.amount),0) s FROM payments p JOIN bookings b ON b.id = p.booking_id JOIN venues v ON v.id = b.venue_id WHERE v.owner_id = ?${scope} AND p.status = 'Paid'`, args)).s;
  const trend = await all(`SELECT ${bucket} AS label, COUNT(*) AS bookings, SUM(b.total_price) AS revenue ${B}${live} AND b.date >= ? AND b.date <= ? GROUP BY label ORDER BY label`, [...args, since, localDate()]);
  const peakHours = await all(`SELECT substr(b.start_time, 1, 2) AS hour, COUNT(*) AS bookings ${B}${live} GROUP BY hour ORDER BY hour`, args);
  const upcoming = await all(`${BOOKING_SELECT} WHERE v.owner_id = ?${scope} AND b.status = 'Confirmed' AND b.date >= ? AND b.date <= ? ORDER BY b.date, b.start_time`, [...args, localDate(), addDays(6)]);
  const bySport = await all(`SELECT b.sport AS label, SUM(b.total_price) AS revenue ${B}${live} GROUP BY b.sport ORDER BY revenue DESC`, args);

  // Occupancy (last 7 days) = booked court-hours / open court-hours on active days.
  const courts = await all(`SELECT c.*, v.opening_time vo, v.closing_time vc, v.active_days FROM courts c JOIN venues v ON v.id = c.venue_id WHERE v.owner_id = ?${scope} AND c.status = 'Active'`, args);
  let openHours = 0;
  for (let d = -6; d <= 0; d++) {
    const wd = new Date(addDays(d) + 'T00:00:00').getDay();
    for (const c of courts) if (P(c.active_days, [0, 1, 2, 3, 4, 5, 6]).includes(wd)) openHours += (toMin(c.closing_time || c.vc) - toMin(c.opening_time || c.vo)) / 60;
  }
  const bookedHours = (await get(`SELECT IFNULL(SUM(b.duration),0) h ${B}${live} AND b.date >= ? AND b.date <= ?`, [...args, addDays(-6), localDate()])).h;
  const occupancy = openHours ? Math.round((bookedHours / openHours) * 1000) / 10 : 0;

  const todayBookings = (await get(`SELECT COUNT(*) c ${B}${live} AND b.date = ?`, [...args, localDate()])).c;
  const recentCustomers = await all(`SELECT u.id, u.name, u.email, u.avatar, COUNT(*) AS bookings, SUM(b.total_price) AS spent, MAX(b.date) AS last_date
    FROM bookings b JOIN venues v ON v.id = b.venue_id JOIN users u ON u.id = b.user_id WHERE v.owner_id = ?${scope}${live}
    GROUP BY u.id ORDER BY last_date DESC, bookings DESC LIMIT 5`, args);
  res.json({ totalBookings, activeCourts, revenue, occupancy, trend, peakHours, upcoming, bySport, period, todayBookings, recentCustomers });
});

// ---------------------------------------------------------------------------
// ADMIN
// ---------------------------------------------------------------------------
app.get('/api/admin/stats', auth('admin'), async (req, res) => {
  await markCompleted();
  const since = addDays(-13);
  const c = async (sql, a = []) => (await get(sql, a)).c;
  res.json({
    totalUsers: await c("SELECT COUNT(*) c FROM users WHERE role IN ('player','owner')"),
    totalOwners: await c("SELECT COUNT(*) c FROM users WHERE role = 'owner'"),
    totalBookings: await c("SELECT COUNT(*) c FROM bookings WHERE status IN ('Confirmed','Completed')"),
    activeCourts: await c("SELECT COUNT(*) c FROM courts c JOIN venues v ON v.id = c.venue_id WHERE c.status = 'Active' AND v.status = 'Approved'"),
    pendingFacilities: await c("SELECT COUNT(*) c FROM venues WHERE status = 'Pending'"),
    bookingTrend: await all("SELECT date AS label, COUNT(*) AS value FROM bookings WHERE status IN ('Confirmed','Completed') AND date >= ? AND date <= ? GROUP BY date ORDER BY date", [since, localDate()]),
    earningsTrend: await all("SELECT substr(created_at,1,10) AS label, SUM(amount) AS value FROM payments WHERE status = 'Paid' AND substr(created_at,1,10) >= ? GROUP BY label ORDER BY label", [since]),
    signupTrend: await all("SELECT substr(created_at,1,10) AS label, COUNT(*) AS value FROM users WHERE role != 'admin' AND substr(created_at,1,10) >= ? GROUP BY label ORDER BY label", [since]),
    facilityStatus: await all('SELECT status AS label, COUNT(*) AS value FROM venues GROUP BY status ORDER BY status'),
    sportActivity: await all("SELECT sport AS label, COUNT(*) AS value FROM bookings WHERE status IN ('Confirmed','Completed') GROUP BY sport ORDER BY value DESC"),
    totalPlayers: await c("SELECT COUNT(*) c FROM users WHERE role = 'player'"),
    totalVenues: await c("SELECT COUNT(*) c FROM venues WHERE status = 'Approved'"),
    totalRevenue: (await get("SELECT IFNULL(SUM(amount),0) s FROM payments WHERE status = 'Paid'")).s,
    cityActivity: await all("SELECT v.city AS label, COUNT(*) AS value FROM bookings b JOIN venues v ON v.id = b.venue_id WHERE b.status IN ('Confirmed','Completed') GROUP BY v.city ORDER BY value DESC"),
    recentUsers: await all("SELECT id, name, email, role, avatar, status, created_at FROM users WHERE role != 'admin' ORDER BY created_at DESC LIMIT 5"),
    recentVenues: await all("SELECT v.id, v.name, v.area, v.city, v.status, v.created_at, u.name AS owner_name FROM venues v JOIN users u ON u.id = v.owner_id ORDER BY v.created_at DESC LIMIT 5"),
    recentBookings: await all(`${BOOKING_SELECT} WHERE b.status IN ('Confirmed','Completed','Cancelled') ORDER BY b.created_at DESC, b.date DESC LIMIT 6`),
  });
});

app.get('/api/admin/venues', auth('admin'), async (req, res) => {
  const status = req.query.status || 'Pending';
  const rows = await all(`${VENUE_SELECT.replace('FROM venues v', ', u.name AS owner_name, u.email AS owner_email FROM venues v JOIN users u ON u.id = v.owner_id')} WHERE v.status = ? ORDER BY v.created_at DESC`, [status]);
  res.json(rows.map(v => venueOut(v)));
});

app.put('/api/admin/venues/:id/approve', auth('admin'), async (req, res) => {
  const v = await get('SELECT * FROM venues WHERE id = ?', [req.params.id]);
  if (!v) throw fail(404, 'Facility not found.');
  await run("UPDATE venues SET status = 'Approved', reject_reason = NULL WHERE id = ?", [v.id]);
  const ow = await get('SELECT name, email FROM users WHERE id = ?', [v.owner_id]);
  if (ow) mail('facilityApproved', ow.email, { name: ow.name, venueName: v.name });
  await notify(v.owner_id, 'approval', `${v.name} was approved and is now live for players.`, '#/owner/facilities');
  res.json({ success: true });
});

app.put('/api/admin/venues/:id/reject', auth('admin'), async (req, res) => {
  const v = await get('SELECT * FROM venues WHERE id = ?', [req.params.id]);
  if (!v) throw fail(404, 'Facility not found.');
  const reason = String(req.body.reason || '').trim();
  await run("UPDATE venues SET status = 'Rejected', reject_reason = ? WHERE id = ?", [reason, v.id]);
  const ow = await get('SELECT name, email FROM users WHERE id = ?', [v.owner_id]);
  if (ow) mail('facilityRejected', ow.email, { name: ow.name, venueName: v.name, reason: reason || 'No reason was given.' });
  await notify(v.owner_id, 'approval', `${v.name} was rejected${reason ? ': ' + reason : '.'} Edit and resubmit from Facilities.`, '#/owner/facilities');
  res.json({ success: true });
});

app.get('/api/admin/users', auth('admin'), async (req, res) => {
  const { role, status, q } = req.query;
  let sql = `SELECT u.id, u.name, u.email, u.role, u.status, u.phone, u.avatar, u.created_at,
             (SELECT COUNT(*) FROM bookings WHERE user_id = u.id AND status IN ('Confirmed','Completed','Cancelled')) AS booking_count
             FROM users u WHERE u.role != 'admin'`; // never selects password_hash
  const args = [];
  if (role) { sql += ' AND u.role = ?'; args.push(role); }
  if (status) { sql += ' AND u.status = ?'; args.push(status); }
  if (q) { sql += ' AND (u.name LIKE ? OR u.email LIKE ?)'; args.push(`%${q}%`, `%${q}%`); }
  res.json(await all(sql + ' ORDER BY u.created_at DESC', args));
});

app.get('/api/admin/users/:id/bookings', auth('admin'), async (req, res) => {
  await markCompleted();
  res.json(await all(`${BOOKING_SELECT} WHERE b.user_id = ? AND b.status IN ('Confirmed','Completed','Cancelled') ORDER BY b.date DESC`, [req.params.id]));
});

async function setBan(id, status) {
  const u = await get("SELECT * FROM users WHERE id = ? AND role != 'admin'", [id]);
  if (!u) throw fail(404, 'User not found.');
  await run('UPDATE users SET status = ? WHERE id = ?', [status, id]);
  // no session table to purge: the auth middleware re-reads the user each request, so a ban applies immediately
}
app.put('/api/admin/users/:id/ban', auth('admin'), async (req, res) => { await setBan(req.params.id, 'Banned'); res.json({ success: true }); });
app.put('/api/admin/users/:id/unban', auth('admin'), async (req, res) => { await setBan(req.params.id, 'Active'); res.json({ success: true }); });

app.get('/api/admin/reports', auth('admin'), async (req, res) => {
  res.json(await all(`SELECT r.*, u.name AS reporter_name,
    CASE r.target_type WHEN 'venue' THEN (SELECT name FROM venues WHERE id = r.target_id) ELSE (SELECT name FROM users WHERE id = r.target_id) END AS target_name
    FROM reports r JOIN users u ON u.id = r.reporter_id ORDER BY (r.status = 'Open') DESC, r.created_at DESC`));
});

// action: 'ban_user' | 'unlist_facility' | 'resolve' | 'dismiss'
app.put('/api/admin/reports/:id', auth('admin'), async (req, res) => {
  const r = await get('SELECT * FROM reports WHERE id = ?', [req.params.id]);
  if (!r) throw fail(404, 'Report not found.');
  const { action, note } = req.body;
  if (action === 'ban_user' && r.target_type === 'user') await setBan(r.target_id, 'Banned');
  if (action === 'unlist_facility' && r.target_type === 'venue') {
    await run("UPDATE venues SET status = 'Rejected', reject_reason = ? WHERE id = ?", [note || 'Unlisted after a user report.', r.target_id]);
    const v = await get('SELECT owner_id, name FROM venues WHERE id = ?', [r.target_id]);
    const ow = v && await get('SELECT name, email FROM users WHERE id = ?', [v.owner_id]);
    if (ow) mail('facilityUnlisted', ow.email, { name: ow.name, venueName: v.name, reason: note || r.reason });
    if (v) await notify(v.owner_id, 'approval', `${v.name} was unlisted after a report: ${note || r.reason}`, '#/owner/facilities');
  }
  const label = { ban_user: 'User banned', unlist_facility: 'Facility unlisted', resolve: 'Resolved', dismiss: 'Dismissed' }[action];
  if (!label) throw fail(400, 'Unknown action.');
  await run('UPDATE reports SET status = ?, admin_action = ? WHERE id = ?', [action === 'dismiss' ? 'Dismissed' : 'Resolved', label + (note ? ` — ${note}` : ''), r.id]);
  res.json({ success: true });
});

// ---------------------------------------------------------------------------
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));
// Only public/ is ever served (on Vercel the CDN serves it before this runs; this is for local `npm start`).
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1h', dotfiles: 'ignore' }));
app.use((err, req, res, next) => {
  if (!err.status) console.error(err);
  res.status(err.status || 500).json({ error: err.status ? err.message : 'Something went wrong. Please try again.', ...(err.extra || {}) });
});

module.exports = app;
