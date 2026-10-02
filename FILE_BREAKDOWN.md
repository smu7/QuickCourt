# QuickCourt — File-by-File Breakdown

Every file in the project (excluding `node_modules/`), what it's for, and — for the two files that hold all the actual product (`index.html`, `server.js`) — where each part lives inside them, down to every CSS `:hover` effect. For *what the product does* (routes, flows, business rules), see [DOCUMENTATION.md](DOCUMENTATION.md); this file is about *where things live in the code*.

---

## 1. Root directory

| File | Type | Purpose |
|---|---|---|
| `index.html` | Frontend (HTML+CSS+JS, one file) | The entire client app: a vanilla-JS single-page app with a hash router, inline `<style>` (theme + every component's CSS) and inline `<script>` (state, API calls, UI components, all pages for all 3 roles, router). No build step, no framework. See §3–§5. |
| `server.js` | Backend (Node.js) | The entire backend: Express app, SQLite schema + seed data, session/auth middleware, and every `/api/*` route. See §6. |
| `package.json` | Config | npm manifest. Deps: `express`, `cors`, `sqlite3`. Scripts: `npm start` / `npm run dev` both just run `node server.js`. |
| `package-lock.json` | Config (generated) | Locked dependency tree for `npm install`. Never edited by hand. |
| `database.sqlite` | Data (generated) | The live SQLite database — created and seeded automatically on first `npm start` (see DOCUMENTATION.md §1). Delete it to reset all demo data. Not served to the browser. |
| `database.backup-before-locations.sqlite` | Data (generated, stale) | A snapshot taken before the location-tree (State→City→Area) feature was added to `server.js`. Safe to delete — `database.sqlite` is now the live one; keep only if you want a rollback point. |
| `DOCUMENTATION.md` | Docs | Product/feature documentation: routes, user flows, forms, API surface, DB schema, business rules. The "what the app does" doc. |
| `FILE_BREAKDOWN.md` | Docs | This file — the "what's where in the code" doc. |
| `problem_statement.pdf` | Reference material | The original hackathon problem statement QuickCourt was built to satisfy. Not used by the app at runtime. |
| `wireframe.pdf` | Reference material | The design wireframes the UI (dark-theme layout, page structure) was built from. Not used by the app at runtime. |
| `QuickCourt_Presentation.pptx` | Reference material | The pitch/demo slide deck for presenting the project. Not used by the app at runtime. |
| `authentication_pagebackground_image.png` | **Unused asset** | An earlier version of the auth-page background (2.4 MB). Superseded by `assets/auth-bg.webp`, which is what `index.html` actually references. Not linked from any file — safe to delete. |
| `.impeccable/hook.cache.json` | Tool cache (generated) | Internal cache for the "Impeccable" design-review Claude Code plugin (tracks which files it's already scanned for design issues like overused fonts). Not part of the app; safe to delete/ignore. |

---

## 2. `assets/`

| File | Used as | Referenced from |
|---|---|---|
| `horizontal_cutout_logo.webp` | The QuickCourt wordmark/logo shown in the navbar and dashboard sidebars | `index.html` line 1154, constant `LOGO` |
| `auth-bg.webp` | Full-bleed photo background for the auth screens (Login/Sign Up/Verify/Forgot/Reset); the logo is baked into this photo itself | `authShell()`, `index.html` §5 CSS `.auth` rules |
| `horizontal_cutout_logo.png` | **Unused** — a heavier PNG version of the same logo, superseded by the `.webp` above | Not referenced anywhere |
| `logo.jpeg` | **Unused** — an earlier logo draft | Not referenced anywhere |

---

## 3. `index.html` — top-level structure

| Lines | Block | Contents |
|---|---|---|
| 1–9 | `<head>` | Charset/viewport meta, title, description, Google Fonts (Archivo, Caveat) |
| 10–771 | `<style>` | All CSS for the whole app — design tokens, then every component, page and responsive rule. See §4. |
| 776–2555 | `<script>` | All JS — state/helpers, reusable UI components, every page for every role, the router, and bootstrap. See §5. |
| 776, 2551–2552 | Bootstrap | `window.addEventListener('hashchange', render)` + initial `render()` call starts the SPA |

---

## 4. `index.html` — CSS map (inside `<style>`, lines 10–771)

| Lines | Section | What it styles |
|---|---|---|
| 11–58 | Design tokens (`:root`) | The entire palette as CSS variables (paper/ink/primary red + 3 sport colors), semantic aliases (`--bg`, `--text`, `--accent`…), the neo-brutalist hard-shadow tokens (`--shadow*` = solid offset shadows, no blur), fonts (Archivo for UI, Caveat hand-script for accents), the SVG "scribble" underline used under nav/tab labels, the faint tennis-court-line background and paper-grain noise texture on `body` |
| 59–105 | Buttons & form controls | `.btn` variants (primary/danger/social/sm), inputs, checkboxes/radios — the "physical" interaction pattern (lift + hard shadow on hover, press flat on `:active`) |
| 106–127 | Cards, chips, badges | `.card`, `.chip`, `.badge` (status-tone colors), `.avatar` |
| 128–138 | Empty/done states | Hand-drawn circle mark used to decorate empty-state and success illustrations |
| 139–225 | Site layout | Navbar (`.nav-links`, scribble underline on active/hover), location pill (`.loc`), favourite heart (`.fav`), user/notification dropdown (`.menu`), footer |
| 226–239 | Dashboard shell | Owner/admin sidebar layout (`.side nav`), top bar |
| 240–322 | Auth layout | Full-bleed photo + floating card (`.auth`), password show/hide toggle, segmented control, social login buttons |
| 323–492 | **Home page** | Hero + search card, popular-sport index cards (`.icard`), popular-venue "court" cards (`.court`), the photo collage (`.print`, rotated Polaroid-style images) — the most visually elaborate page in the app |
| 493–513 | Venue cards & listing grid | `.venue-card` used on Explore Venues / Nearby / Home |
| 514–533 | Venue details | Image gallery + thumbnails + nav arrows |
| 534–554 | Booking | Time-slot grid (`.slot`) |
| 555–571 | Tabs & tables | `.tab`, `.table` (row hover highlight) |
| 572–613 | Dashboard charts | `.bar-col` (vertical bar chart + tooltip), `.hbar` (horizontal bar), `.picker` (dropdown filter) |
| 614–712 | Owner/admin control-center (`.shell`) | KPI stat cards, mini-lists, calendar grid, tinted chart variants — all scoped under `.shell` so player pages are unaffected |
| 713–733 | Modal & toast | Native `<dialog>` styling, toast notifications |
| 734–771 | Responsive | `≤960px` (stack to one column, sticky "Book now" bar) and `≤800px` (collapse nav, sidebar → tab strip, tables → labelled rows) breakpoints |

### 4a. Every `:hover` effect (all 47, in file order)

| Line | Selector | Where it appears | Effect |
|---|---|---|---|
| 43 | `a:hover` | Any text link, sitewide | Underline appears in accent red |
| 64 | `.btn:not(:disabled):hover` | Every default button | Lifts (`translate -1px -2px`), scales 1.01×, gains a hard offset shadow, inverts to ink bg / paper text |
| 69 | `.btn-primary:not(:disabled):hover` | Primary (red) buttons | Background darkens to `--color-primary-dark` |
| 71 | `.btn-danger:not(:disabled):hover` | Danger buttons (Cancel, Delete, Ban) | Fills solid danger red + hard shadow |
| 73 | `.btn-sm:not(:disabled):hover` | Small buttons | Smaller hard shadow (3px vs 5px) |
| 77 | `.btn:hover .arr` | The "→" arrow inside CTA buttons | Arrow slides right 4px |
| 80 | `.icon-btn:hover` | Icon-only buttons (bell, close, etc.) | Border appears |
| 102 | `.check:hover` | Checkbox/radio custom control | Border appears |
| 153 | `.nav-links a:is(.active,:hover,:focus-visible)::after` | Navbar links | Hand-drawn scribble underline reveals (clip-path wipes in) |
| 155 | `.nav-links:has(a:is(:hover,:focus-visible)) a.active:not(:hover,:focus-visible)::after` | Navbar, when a non-active link is hovered | The *active* link's own underline hides, so only one scribble shows at a time |
| 160 | `.loc:hover` | Location pill (navbar) | Lifts 1px + hard shadow |
| 169 | `.loc-quick .chip:hover` | Quick-location chips (in the location picker) | Lifts + soft shadow |
| 174 | `.fav:hover` | Favourite/heart icon on venue cards | Scales up 1.08× |
| 215 | `details.dropdown > summary:hover` | User/notification dropdown trigger | Border appears |
| 218 | `.menu a:hover, .menu button:hover` | Rows inside dropdown menus | Background tint, underline removed |
| 235 | `.side nav a:hover` | Owner/admin sidebar links | Text darkens, border appears, nudges right 2px |
| 264 | `.ctl .pw-toggle:hover` | Password show/hide eye icon | Text darkens, background tint |
| 274 | `.seg label:hover span` | Segmented control option (e.g. Login/Sign Up toggle) | Border + text darken |
| 288 | `.btn-social:hover` | Google/Apple auth buttons | Lifts + hard shadow |
| 403 | `.court:hover` | "Popular venue" card on Home | Lifts 4px + hard shadow |
| 406 | `.court:hover .court-img img` | Same card's cover photo | Zooms in 1.04× |
| 407 | `.court:hover .tag` | Sport tag chip on the card | Slides right + tilts −2° |
| 408 | `.court:hover .btn-primary` | Card's CTA button | Darkens (redundant with global rule, reinforces on card hover) |
| 409 | `.court:hover .arr` | Card's arrow icon | Slides right 4px |
| 423 | `.icard:hover` | Popular-sport index card on Home | Un-rotates to 0deg, lifts, hard shadow |
| 426 | `.icard:hover .icard-img img` | Sport card's photo | Zooms in 1.05× |
| 427 | `.icard:hover .arr` | Sport card's arrow | Slides right |
| 448 | `.print:hover` | Polaroid-style collage photo on Home | Un-rotates, scales 1.02×, comes to front (`z-index:3`) |
| 462 | `.qfoot .btn:not(:disabled):hover` | Buttons inside the dark footer CTA band | Shadow uses paper color (for contrast on dark bg) |
| 496 | `.venue-card:hover` | Venue grid card (Explore/Nearby/Home) | Lifts 4px + hard shadow |
| 499 | `.venue-card:hover .vc-img img` | Venue card's photo | Zooms in 1.04× |
| 509 | `.pager a:hover` | Pagination number links | Lifts + soft shadow |
| 519 | `.gallery-nav:hover` | Prev/next arrows on venue photo gallery | Inverts to solid ink bg |
| 523 | `.thumbs button:hover` | Gallery thumbnail strip | Fades to full opacity |
| 539 | `.slot:not(:disabled):hover` | Booking time-slot button | Lifts + soft shadow |
| 558 | `.tab:hover` | Tab labels (bookings/matches/etc.) | Text darkens |
| 568 | `.table tbody tr:hover td` | Any data table row | Row background tints |
| 582 | `.bar-col:hover .bar, .bar-col:focus .bar` | Vertical chart bar (owner/admin dashboards) | Bar recolors to accent |
| 584 | `.bar-col:hover::after, .bar-col:focus::after` | Same chart bar | Tooltip (`data-tip` value) appears above it |
| 591 | `.bars:hover .bar-col:not(:hover) .bar` | Sibling bars in the same chart | Dim to 40% opacity, spotlighting the hovered bar |
| 594 | `.hbar:hover .fill` | Horizontal bar chart fill | Recolors to accent |
| 595 | `.hbar:hover .val` | Horizontal bar's value label | Text darkens |
| 607 | `.picker select:hover` | Chart/table filter dropdown | Background lightens, shadow + 1px lift |
| 612 | `.picker:hover::after` | Dropdown's custom arrow icon | Rotates/shifts |
| 629 | `.shell .stat:hover .kpi-art` | Decorative icon behind a KPI stat card | Rotates −6°, scales 1.06×, fades to 55% |
| 645 | `.shell .mini-list li:hover .chev` | Row chevron in dashboard mini-lists | Slides right 3px, darkens |
| 649 | `.shell .kpis>.card:hover, .chart-card:hover, .lists>.card:hover` | Dashboard cards (owner/admin) | Lifts 2px + hard shadow |
| 650 | `.shell .kpis>.card:hover` | KPI card | Top border picks up its tone color |
| 655 | `.shell .chart-card .bar-col:hover .bar` | Dashboard chart bar (tinted variant) | Recolors to the chart's tone color |
| 656 | `.shell .chart-card .hbar:hover .fill` | Dashboard horizontal bar (tinted variant) | Recolors to tone color |
| 666 | `.shell .cal-day:hover` | Day cell in the owner booking calendar | Border appears |
| 682 | `.side nav a:hover::after` | Sidebar link's scribble underline | Reveals via clip-path wipe |
| 725 | `.star-input label:hover` | Star-rating input (review modal) | Star lifts 2px |
| 726 | `.star-input input:checked~label, label:hover, label:hover~label` | Star-rating input | Stars up to the hovered/checked one turn orange |

---

## 5. `index.html` — JavaScript map (inside `<script>`, lines 776–2555)

| Lines | Section | Contents |
|---|---|---|
| 778–1237 | **Core: state, helpers, shared UI components** | Session state (`S`), location state (`LOC`, `bindLocFields`), `go()`/router helpers, `toast()`, status-tone map (`TONE`), sport→color/icon maps, form helpers (`setErrors`, `formError`, `readImage`), `modal()` / `confirmDialog()` (native `<dialog>` wrappers), reusable card builders (`venueCard`, `matchCard`, `bookingSummary`), `dataTable`, `pager`, `barChart`/`hbarChart` (+ `revealCharts`/`countUp` animation), `reportModal`, `userMenu`, and the three page shells: `siteShell` (player/guest), `dashShell` (owner/admin), `authShell` |
| 1238–1447 | **Auth pages** | `pAuth` (Login+Sign Up, shared card), `pVerify` (OTP boxes), `pForgot`, `pReset`, demo-account list, password/field validators |
| 1448–1994 | **Player pages** | Home (`playerPanel`), Explore Venues, Venue Details, Booking flow, Payment, Confirmation, My Bookings (`bookingCard`), Matches (Find/Create/Details), `reviewModal` |
| 1995–2064 | **Profile page** (shared by all 3 roles) | `pProfile` — Personal Info / Sports & Skill / Security tabs |
| 2065–2357 | **Facility Owner pages** | Dashboard & analytics, Facilities list, 3-step Facility Wizard, Court management (`courtModal`), Availability + slot blocking (`blockModal`), Owner Bookings |
| 2358–2477 | **Admin pages** | Admin dashboard, Facility approval (`facilityReview`), User management, Reports/moderation |
| 2478–2532 | **Router** | `ROUTES` table (path pattern → page function → layout → allowed roles), `matchPath()`, `render()` (resolves route, checks role access, mounts the right shell, calls the page function) |
| 2533–2552 | **Global event delegation + bootstrap** | One `click` listener handles logout, retry, password-eye toggle, mobile nav toggle, location actions, favouriting; broken-image fallback; notification-bell open handler; `hashchange` → `render()`; initial `render()` call |

---

## 6. `server.js` — structure

| Lines (approx.) | Section |
|---|---|
| 1–60 | Setup: Express app, CORS, JSON body parsing, static serving of `index.html` and `assets/` only |
| 60–120 | SQLite schema (`CREATE TABLE` for all 12 tables — see DOCUMENTATION.md §10) |
| 119–324 | Seed data: `LOCATIONS` tree, `SPORTS`/`AMENITIES`/`SKILL_LEVELS` catalogs, and the demo-data generator (venues, users, bookings, matches, reviews…) that runs once on first start |
| 324–356 | Auth helpers: password hashing, `auth(role)` middleware, session map, `publicUser()` (strips password hash before sending a user object to the client) |
| 357–456 | `POST /api/auth/*` routes (signup, verify-otp, resend-otp, login, logout, forgot/reset-password), `/api/me`, `/api/catalog` |
| 458–468 | Notifications routes |
| 469–531 | Venues routes (list/filter/sort/paginate, details, reviews) |
| 532–583 | Availability engine: `bookingProblem()` (the shared slot-conflict check) + `GET /api/venues/:id/availability` |
| 584–659 | Bookings routes (create/reserve, pay, cancel, get by id, my bookings) — the double-booking lock lives here |
| 660–675 | Reviews route |
| 676–770+ | Matches routes, Favourites routes |
| (further down, per DOCUMENTATION.md §9) | Reports routes; Owner routes (venues/courts/availability/blocks/bookings/stats, all scoped to `owner_id`); Admin routes (stats, facility approve/reject, user ban/unban, reports) |

Full endpoint list with access rules: DOCUMENTATION.md §9. Full DB schema: DOCUMENTATION.md §10.

---

## 7. Housekeeping notes

- **Delete-safe / unused right now:** `authentication_pagebackground_image.png`, `assets/horizontal_cutout_logo.png`, `assets/logo.jpeg`, `database.backup-before-locations.sqlite`, `.impeccable/` (tool cache).
- **Never edit by hand:** `package-lock.json`, `database.sqlite` (regenerate by deleting it and restarting the server).
- **Single source of truth for styling:** all CSS lives in `index.html`'s one `<style>` block — there is no separate `.css` file anywhere in the project.
- **Single source of truth for app logic:** all frontend JS lives in `index.html`'s one `<script>` block — there is no separate `.js` frontend file; `server.js` is the only other JS file and it's backend-only.
