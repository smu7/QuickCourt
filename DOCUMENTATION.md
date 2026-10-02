# QuickCourt — Product Structure & Implementation

QuickCourt is a full-stack web app for booking local sports facilities (badminton courts, turf grounds, tennis courts…) and for creating or joining matches with other players. It serves three roles:

| Role | What they do |
|---|---|
| **Player** | Discover venues → book a court → pay (simulated) → manage bookings → review; create / join matches |
| **Facility Owner** | Set up facilities (3-step wizard) → manage courts → configure availability → view bookings & analytics |
| **Admin** | Approve / reject facilities, manage users (ban / unban), handle reports, view platform analytics |

This document describes everything that is built: routes, flows, page sections, form fields, components, API, database and the business rules the backend enforces. Sources: `problem_statement.pdf`, `wireframe.pdf`, and the locked "QuickCourt Final Structure" spec.

---

## 1. Running it

```bash
npm install
npm start          # → http://localhost:3000
```

On first start the server creates `database.sqlite` and seeds demo data: 29 venues across 7 cities (Ahmedabad, Surat, Vadodara, Mumbai, Pune, Bengaluru, Jaipur), two pending and one rejected; 10 players and 4 owners, each tied to a home city; about 210 bookings over the last 3 weeks and the next 5 days, booked by players in that venue's city; matches, reviews, favourites, reports and notifications. Delete `database.sqlite` to reset.

| Demo account | Email | Password |
|---|---|---|
| Player | `player@quickcourt.demo` | `Player@123` |
| Other players | `riya@`, `kabir@`, `meera@`, `harsh@`, `pooja@`, `dev@`, `ishaan@`, `sneha@`, `arjun@quickcourt.demo` | `Player@123` |
| Other owners | `rohan.owner@`, `kunal.owner@`, `ananya.owner@quickcourt.demo` | `Owner@123` |
| Facility Owner | `owner@quickcourt.demo` | `Owner@123` |
| Admin | `admin@quickcourt.demo` | `Admin@123` |

The login page lists the three role accounts under **Demo accounts**; **Use** fills the form. Sign Up links to it ("Just exploring? Try a demo account").

### Locations

`LOCATIONS` in `server.js` is the single State → City → Area tree (each area carries lat/lng and pincode), served in `/api/catalog`. Venues store `state`, `city`, `area` as text that must exist in the tree (checked on facility submit). The selected location is a per-browser preference (`localStorage` `qc_loc`, default Gujarat → Ahmedabad → all areas). The navbar pill opens the picker; Home, Explore venues, Matches and Create Match filter by it. The same cascading selects (`locFields` / `bindLocFields`) are used by the picker, the venue filter panel and the facility wizard.

### Tech stack

| Layer | Choice |
|---|---|
| Frontend | One `index.html`: vanilla JS single-page app with a hash router, plain CSS (dark theme from the wireframes), no build step |
| Backend | Node.js + Express 5 (`server.js`), JSON REST API under `/api` |
| Database | SQLite (`sqlite3`), created and seeded automatically |
| Charts | Hand-rolled CSS bar charts (no chart library) |

---

## 2. Route map (frontend)

Hash-based routes. Each route declares its **layout** and the **roles** that may open it. A guest who opens a protected route is sent to `/login?next=…` and returned there after login. A signed-in user who opens another role's route is sent to their own home.

### Shared — authentication (auth layout: full-screen `assets/auth-bg.webp` photo — the QuickCourt logo is part of it — with one floating card on the right; centered on mobile)

| Route | Page |
|---|---|
| `#/signup`, `#/login` | Sign Up (default) and Log In share one card and swap in place without a page change. Log In has Remember Me (off = session ends with the browser); Google / Apple buttons are placeholders until OAuth is connected |
| `#/verify?email=` | Email / OTP verification |
| `#/forgot` | Forgot password |
| `#/reset?email=` | Reset password (code + new password) |

### Player (site layout: top navbar + footer)

| Route | Page | Access |
|---|---|---|
| `#/` | Home | guest, player |
| `#/venues` | Explore venues (search, filters, sort, pagination; state kept in the URL query) | guest, player |
| `#/venue/:id` | Venue details | guest, player (owner/admin can preview) |
| `#/book/:venueId` | Court booking | player |
| `#/payment/:bookingId` | Payment (simulated) | player |
| `#/confirmation/:bookingId` | Booking confirmation | player |
| `#/bookings?tab=upcoming\|completed\|cancelled` | My Bookings | player |
| `#/matches?tab=find\|mine` | Find Match / My Matches | guest (find), player |
| `#/matches/new` | Create Match | player |
| `#/match/:id` | Match details + Join | guest, player |
| `#/profile?tab=personal\|sports\|security` | Profile | player |

### Facility Owner (dashboard layout: sidebar + top bar)

| Route | Page |
|---|---|
| `#/owner` | Dashboard & analytics (`?venue=` facility filter, `?period=daily\|weekly\|monthly`) |
| `#/owner/facilities` | Facility list with status |
| `#/owner/facility/new` | Facility setup wizard (3 steps) |
| `#/owner/facility/:id/edit` | Same wizard, prefilled |
| `#/owner/courts?venue=` | Court management |
| `#/owner/availability?venue=&court=&date=` | Availability config + slot blocking |
| `#/owner/bookings?venue=&tab=upcoming\|past` | Booking overview |
| `#/owner/profile?tab=personal\|security` | Profile |

### Admin (dashboard layout)

| Route | Page |
|---|---|
| `#/admin` | Platform dashboard |
| `#/admin/facilities?status=Pending\|Approved\|Rejected` | Facility approval |
| `#/admin/users?q=&role=&status=` | User management |
| `#/admin/reports` | Reports / moderation |
| `#/admin/profile?tab=personal\|security` | Profile |

### Navigation

```text
PLAYER navbar:  QUICKCOURT | Venues · Matches · My Bookings | 🔔 · [avatar ▾ Profile / Logout]
GUEST navbar:   QUICKCOURT | Venues · Matches              | [Login / Sign Up]
OWNER sidebar:  Dashboard · Facilities · Courts · Availability · Bookings · Profile
ADMIN sidebar:  Dashboard · Facility Approval · Users · Reports · Profile
```

On mobile, the player navbar links collapse behind a ☰ button, and the owner/admin sidebar turns into a horizontally scrolling tab strip at the top.

---

## 3. Authentication flow (common to all roles)

```text
Sign Up ──► Verify OTP ──► signed in ──► role home
                                          ├─ player → #/
                                          ├─ owner  → #/owner  (no facility yet → #/owner/facility/new)
                                          └─ admin  → #/admin
Login ──► (email not verified?) ──► Verify OTP
Forgot Password ──► Reset (code + new password + confirm) ──► Login
Logout (avatar menu) ──► session deleted on server ──► Login
```

**Sign Up fields**

| Field | Rule |
|---|---|
| Profile Photo | Not asked at sign-up — added later from Profile |
| Sign up as | **Player** or **Facility Owner** only. Admin is never offered; the server also rejects `role=admin` |
| Full Name | Required |
| Email | Required, valid format, unique ("An account with this email already exists" shown under the field) |
| Password | 8–20 characters, at least 1 uppercase letter, 1 number and 1 special symbol |
| Confirm Password | Must match. Checked on the client **and** the server, **never stored** |

**Verification:** 6 separate OTP boxes (auto-advance, backspace, paste), Verify & Continue, Resend OTP, Edit Email. Codes expire after 10 minutes.

> **Demo mode:** no email provider is connected, so the server returns the OTP and the verify/reset screens show it in a "Demo mode" note. Remove `demoOtp` from the responses once a real email sender is added.

**Sessions:** login returns a random bearer token. The client stores `{token, user}` in `localStorage` and sends `Authorization: Bearer …` on every request. The server resolves the user from the token and never trusts a `user_id` sent by the client. A 401 response sends the user back to login. Banned users can't log in, and banning someone ends their live sessions.

**Admin accounts** are created internally (seeded). There is no public path to create one.

---

## 4. Player

### 4.1 Home (`#/`)
0. **Player summary** (players only): sports + skill, stats (upcoming games, games played, total spent, upcoming matches), next game, payment history, favourite courts.
1. **Hero** + search card: Location (opens the location picker), sport, date, time → `#/venues?sport=`.
2. **Popular sports**: horizontal row of sport cards, each linking to `#/venues?sport=X`.
3. **Popular venues** in the selected location (sorted by review count and rating). An area with no venues falls back to the whole city with a note.
4. **Venues near you**: a **Use my location** button asks for browser geolocation and loads the 4 nearest venues (`sort=distance`).
5. **Open matches** in the selected city: next 3 with Join, plus **Create match** for players.

Horizontal rows (`.hscroll`) are plain scroll-snap containers, so they can become carousels later without changing the markup.

### 4.2 Explore venues (`#/venues`)
- **Filter panel** (sidebar on desktop, collapsible on mobile): location (state / city / area), search by name, sport, price range slider (max ₹/hr), venue type (Any / Indoor / Outdoor, where "Both" venues match either), rating (4★+, 3★+, 1★+), **Clear filters**.
- **Sort**: Popularity, Rating, Price low→high, Price high→low.
- **Results**: count, grid of venue cards, pagination (9 per page).
- **Venue card**: cover image, name, rating (count), area + city, starting price/hour (cheapest active court), sport chips, venue type chip, derived tags ("Top rated" ≥ 4.5★, "Budget" ≤ ₹300), **View Details**.
- Empty state: "No venues match these filters" with a Clear filters button.

### 4.3 Venue details (`#/venue/:id`)
Sections: name + location + rating, **Report this facility** (players) · image gallery (cover first, prev/next, thumbnails) · Sports available (courts per sport + price range) · Courts & pricing table (court, sport, price/hr, hours, status) · Amenities · About venue + venue type · Reviews & ratings.
Side panel: **Book This Venue** (sticky), operating hours + open days, full address + **Open in Maps** (lat/long) + contact phone.
On mobile a sticky bottom bar ("₹X /hr onwards · Book now") keeps the booking CTA in reach.

### 4.4 Booking flow

```text
Venue ─► Book ─► Sport* ─► Date ─► Start time ─► Duration ─► Court ─► auto price ─► Continue to Payment
                                                                                        │
            server: check court + slot free? ── no ──► 409 "slot was just booked…" (grid refreshes)
                                                 yes ─► booking created as RESERVED (held 10 min)
                                                                                        ▼
                      Payment page (summary + countdown) ─► Pay ─► CONFIRMED ─► Confirmation ─► My Bookings
```
\* Sport appears only when the venue has more than one sport.

| Booking field | Behaviour |
|---|---|
| Sport | Dropdown, only for multi-sport venues |
| Date | Native date picker, today to +60 days |
| Start time | Slot grid from the server; a slot is enabled only if at least one court of that sport is free for the **whole** chosen duration. Past times today are disabled |
| Duration | − / + stepper in steps of the facility's slot duration (max 6 h). Changing it re-checks availability |
| Court | Only the courts free at the chosen time. Auto-selected when there is exactly one |
| Price | Shown as court rate × duration; the **server calculates** the stored price |

The player never enters a user ID, venue ID, court ID or price.

**Payment (`#/payment/:id`)**: booking summary, "slot held" countdown (10 min), method choice (UPI / Card, simulated, nothing is charged), **Pay ₹X**, **Cancel reservation**.
**Confirmation**: ✓ summary, booking ID, payment status, **Go to My Bookings**, **Book another**.

### 4.5 My Bookings (`#/bookings`)
Tabs with counts: **Upcoming** (Confirmed), **Completed**, **Cancelled**.
Booking card: venue (sport), date, time range, location, court, duration, amount, status badge. Actions:
- **Details**: modal with the full summary, payment status and booking ID
- **Cancel booking**: upcoming only, after a confirm dialog. Releases the slot and marks the payment Refunded
- **Write review**: completed only, once per booking. Modal with 1–5 stars and a comment

### 4.6 Matches
- **Find Match** (`#/matches`): sport filter, match cards (sport, venue, date/time, host, skill level, players-joined progress bar, **Join** / Joined / Full).
- **Match details** (`#/match/:id`): details, participants (host tagged), **Join match**, **Report host**.
- **Create Match** (`#/matches/new`):

| Field | Required | Notes |
|---|---|---|
| Sport | ✅ | Predefined list |
| Venue | ✅ | Approved venues offering that sport (reloads when the sport changes) |
| Date | ✅ | Today or later |
| Start Time | ✅ | 30-min steps |
| Duration | ✅ | 1 / 1.5 / 2 / 3 h |
| Players Needed | ✅ | 2–30, total including the host |
| Skill Level | optional | Beginner / Intermediate / Advanced |
| Description | optional | ≤ 300 chars |

Title, organizer, location and price are **not** asked; they come from the creator and the venue.
- **My Matches** (`#/matches?tab=mine`): upcoming and past matches the player created or joined.
- The host is added as the first participant. A match becomes **Full** when it reaches Players Needed, and the host gets a notification whenever someone joins.

### 4.7 Profile (`#/profile`), shared component for all roles
Left card: avatar, name, phone, email, role badge, section menu (+ "All Bookings" link for players).
- **Personal Info**: photo (upload / remove, ≤1 MB), Full Name, Email (read-only), Phone (10 digits). Reset / Save.
- **Sports & Skill Level** (player only): sports checkboxes, skill level radios.
- **Security**: Current password, New password, Confirm. Uses the same password rules as signup.

---

## 5. Facility Owner

### 5.1 Dashboard & analytics (`#/owner`)
The first login with no facility redirects to the setup wizard (Owner account → Create facility).
- Facility filter (All facilities / one facility), plus a callout for any Pending or Rejected facility.
- **KPIs** (all calculated on the server): Today's bookings, Total bookings, Active courts, Revenue (sum of Paid payments), Occupancy (booked court-hours ÷ open court-hours on active days, last 7 days).
- **Booking calendar**: the next 7 days, bookings per day (time · court · venue).
- **Recent customers**: last 5 players who booked, with booking count, spend and last visit.
- **Booking trends**: Daily (14 days) / Weekly (8 weeks) / Monthly (6 months) tabs.
- **Revenue summary**: revenue per period plus revenue by sport.
- **Peak booking hours**: bookings by start hour, 6 AM–11 PM.

Charts are single-series bars with hover/focus tooltips and a hidden data table for screen readers.

### 5.2 Facilities (`#/owner/facilities`)
List of the owner's facilities: cover, name, area, sports, active court count, status badge (**Pending / Approved / Rejected**), the rejection reason if rejected. Actions: Edit, Courts, Availability, View listing (approved only). **Add facility**.

### 5.3 Facility setup wizard (`#/owner/facility/new`, `…/:id/edit`)
A 3-step form with a step indicator, Back / Next and per-step validation. Everything is submitted together at the end and validated again on the server.

**Step 1 — Basic information**

| Field | Rule |
|---|---|
| Facility Name | required |
| Description | required |
| Address Line | required |
| State → City → Area | required, picked from the locations tree; choosing an area pre-fills pincode and map pin |
| Pincode | required, 6 digits |
| Map Location | required: latitude + longitude inputs, **Use my current location**, "Check on map ↗" link |
| Contact Phone | required, 10 digits |

**Step 2 — Sports & amenities**: Supported sports (predefined multi-select, ≥1), Venue type (Indoor / Outdoor / Both), Amenities (predefined multi-select). No free text.

**Step 3 — Photos**: multiple upload (≤ 8, each ≤ 1 MB), thumbnail grid, **Cover** radio, Remove. No video (MVP).

Submitting creates the facility as **Pending** and notifies admins. **Editing** later resubmits it as Pending, because admins review changes and never edit owner data.

### 5.4 Court management (`#/owner/courts`)
Table: Court, Sport, Price/hour, Hours ("Facility hours" or an Override chip), Status, Edit / Delete.
Add/Edit court modal:

| Field | Rule |
|---|---|
| Court Name | required |
| Sport | one of the facility's sports |
| Base Price / Hour | > 0 |
| Status | Active / Maintenance (Maintenance removes the court from booking) |
| Override facility hours | optional checkbox that reveals opens/closes times for this court only |

A court with upcoming bookings cannot be deleted. Set it to Maintenance instead.

### 5.5 Availability (`#/owner/availability`)
Owners never create slots one by one.
1. **Operating schedule**: Opening Time, Closing Time, Slot Duration (30/60/90/120 min), Active Days → **Generate Availability**. This saves the schedule. Slots are then derived automatically for every court and every date.
2. **Slots**: court + date picker and a colour-coded slot grid (Available / Booked / Blocked / Maintenance).
   - Click an available slot → **Block** modal (from/to, reason: Maintenance / Private event / Tournament / Other).
   - Click a blocked slot → Unblock.
   - **Block a time range** for longer maintenance windows.
   - The server refuses to block a range that already contains a player's booking.

### 5.6 Bookings (`#/owner/bookings`)
Tabs **Upcoming** / **Past** with a facility filter. Table: User, Court (+ facility), Sport, Date, Time, Duration, Amount, Status, View. The View modal shows the user's email, full summary, payment status and booking time.

---

## 6. Admin

### 6.1 Dashboard (`#/admin`)
KPIs: Total users (players + owners), Players, Facility owners, Live venues (+ active courts), Total bookings, Revenue, **Pending approvals** (links to approval).
Lists: Recent users, New venue registrations (with status), Platform activity (latest bookings). Charts add **Bookings by city**.
Charts: Booking activity (14 days), User registration trends (14 days), Facility approval trend (facilities by status), Most active sports, Earnings simulation (Paid payments per day, 14 days).

### 6.2 Facility approval (`#/admin/facilities`)
Tabs: Pending / Approved / Rejected. Each row shows cover, name, owner, area, sports and submitted date, with **Review**.
The review modal is read-only: all photos (cover marked), owner name + email, full address + map link, contact, venue type, sports, amenities, description, submitted date, status.
Actions for Pending: **Approve**, or **Reject** with an optional reason/comment. The owner is notified and sees the reason on their Facilities page.

### 6.3 User management (`#/admin/users`)
Search (name/email), Role filter, Status filter. Table: Name, Email, Role, Status, Joined, Booking count, Actions: **View** (profile modal), **Booking history** (modal table), **Ban** / **Unban** (with confirm). Passwords and hashes are never selected or shown.

### 6.4 Reports / moderation (`#/admin/reports`)
Players submit reports from **Report this facility** (venue page) and **Report host** (match page).
Table: Reported (Facility/User + name), Reason, Reporter, Submitted, Status, Admin action.
**Take action** modal: Ban this user (user reports) or Unlist this facility (facility reports, which sets it to Rejected), Mark resolved, or Dismiss, plus an optional note.

---

## 7. Common systems

| System | Player | Owner | Admin |
|---|:-:|:-:|:-:|
| Sign up | ✅ | ✅ | ❌ (internal) |
| Login / OTP verify / Forgot + reset password | ✅ | ✅ | ✅ |
| Profile + edit + change password | ✅ | ✅ | ✅ |
| Logout | ✅ | ✅ | ✅ |
| Role-based access (client route guard **and** server `auth(role)` middleware) | ✅ | ✅ | ✅ |
| Notifications (🔔 dropdown, unread dot, marked read on open) | booking confirmed, match joined | new / cancelled booking, facility approved / rejected / unlisted | facility submitted, new report |

**Status badges** use one tone map across the app: green (Approved, Confirmed, Active, Paid, Resolved), blue (Completed, Full), amber (Pending, Reserved, Open, Maintenance), red (Rejected, Cancelled, Banned), grey (Refunded, Dismissed, Expired).

**Loading / empty / error states**: every page renders a spinner while loading, an empty state with a next-step CTA when there is no data, and an error state with **Try again** on failure. Form errors appear under the relevant field (`aria-invalid` + message). API errors appear in the form or as a toast.

**Images**: stored as data URLs (≤1 MB each, checked on the client) for avatars and facility photos. A broken remote image falls back to the neutral card background.

---

## 8. Component inventory (`index.html`)

| Component | Used by |
|---|---|
| `siteShell` / `dashShell` / `authShell` | Layouts: navbar+footer, sidebar+topbar, split auth |
| `userMenu` + notification panel | All signed-in layouts |
| `venueCard` | Home, Venues, Nearby |
| `matchCard` | Home, Matches, My Matches |
| `bookingCard`, `bookingSummary` | My Bookings, Payment, Confirmation, owner/admin booking modals |
| `statCard` | Owner + admin dashboards |
| `barChart`, `hbarChart`, `fillDays` | Owner + admin dashboards |
| `dataTable` | Courts, owner bookings, users, reports, booking history. Collapses into labelled rows on mobile |
| `tabs`, `pager`, `venuePicker` | Tabbed pages, venue listing, owner pages |
| `modal`, `confirmDialog` (native `<dialog>`) | Reviews, reports, court form, block slot, facility review, user view |
| `field`, `pwInput` (show/hide), `options`, `setErrors`, `busy` | All forms |
| `badge`, `rating`, `stars`, `avatar` | Everywhere |
| `loadingState`, `emptyState`, `errorState`, `toast` | Everywhere |
| `reportModal`, `reviewModal`, `courtModal`, `blockModal`, `facilityReview` | Feature modals |

---

## 9. Backend API (`server.js`)

`auth()` = any signed-in user; `auth('player')` etc. = that role only. Every error returns `{ error }` with a proper status code (400 validation, 401 not signed in, 403 wrong role/banned, 404, 409 conflict).

| Area | Method & path | Access |
|---|---|---|
| Auth | `POST /api/auth/signup`, `/verify-otp`, `/resend-otp`, `/login`, `/logout`, `/forgot-password`, `/reset-password` | public |
| Me | `GET /api/me`, `PUT /api/me`, `PUT /api/me/password` | auth() |
| Catalog | `GET /api/catalog` (sports, amenities, skill levels, sport images) | public |
| Notifications | `GET /api/notifications`, `PUT /api/notifications/read` | auth() |
| Favourites | `GET /api/my/favorites` · `PUT` / `DELETE /api/my/favorites/:venueId` | player |
| Venues | `GET /api/venues` (state, city, area, q, sport, type, maxPrice, minRating, sort, lat/lng, page) · `GET /api/venues/:id` · `GET /api/venues/:id/reviews` · `GET /api/venues/:id/availability?date&sport&duration` | public (non-approved venues: owner/admin only) |
| Bookings | `POST /api/bookings` (reserve) · `POST /api/bookings/:id/pay` · `GET /api/bookings/:id` · `GET /api/my/bookings` · `PUT /api/bookings/:id/cancel` | player (GET by id: booker, venue owner, admin) |
| Reviews | `POST /api/reviews` | player |
| Matches | `GET /api/matches` · `GET /api/matches/:id` · `POST /api/matches` · `POST /api/matches/:id/join` · `GET /api/my/matches` | read public, write player |
| Reports | `POST /api/reports` | auth() |
| Owner | `GET/POST /api/owner/venues` · `PUT /api/owner/venues/:id` · `PUT /api/owner/venues/:id/availability` · `GET/POST /api/owner/venues/:id/courts` · `PUT/DELETE /api/owner/courts/:id` · `GET /api/owner/courts/:id/slots` · `POST /api/owner/courts/:id/block` · `DELETE /api/owner/blocks/:id` · `GET /api/owner/bookings` · `GET /api/owner/stats` | owner, and only their own records |
| Admin | `GET /api/admin/stats` · `GET /api/admin/venues?status` · `PUT /api/admin/venues/:id/approve\|reject` · `GET /api/admin/users` · `GET /api/admin/users/:id/bookings` · `PUT /api/admin/users/:id/ban\|unban` · `GET /api/admin/reports` · `PUT /api/admin/reports/:id` | admin |

Only `/` (the SPA shell) is served statically. The database file and server source are **not** publicly reachable.

---

## 10. Database

| Table | Columns |
|---|---|
| `users` | id, name, email (unique), password_hash, avatar, role (player/owner/admin), phone, sports (JSON), skill_level, status (Active/Banned), email_verified, otp, otp_expires, created_at |
| `venues` | id, owner_id, name, description, address, area, city, state, pincode, latitude, longitude, venue_type, contact_phone, sports (JSON), amenities (JSON), cover_image, images (JSON), opening_time, closing_time, slot_minutes, active_days (JSON), status (Pending/Approved/Rejected), reject_reason, created_at |
| `courts` | id, venue_id, name, sport, price_per_hour, status (Active/Maintenance), opening_time*, closing_time* (*NULL = inherit facility hours) |
| `blocked_slots` | id, court_id, date, start_time, end_time, reason |
| `bookings` | id, user_id, venue_id, court_id, sport, date, start_time, duration, total_price, status, created_at |
| `payments` | id, booking_id, amount, status (Paid/Refunded), created_at |
| `reviews` | id, user_id, venue_id, booking_id (unique), rating, comment, created_at |
| `matches` | id, creator_id, venue_id, sport, date, start_time, duration, max_players, skill_level, description, status (Open/Full), created_at |
| `match_participants` | match_id, user_id (composite primary key) |
| `reports` | id, reporter_id, target_type (venue/user), target_id, reason, status (Open/Resolved/Dismissed), admin_action, created_at |
| `notifications` | id, user_id, type, message, link, read, created_at |
| `favorites` | user_id, venue_id (composite primary key), created_at |

**Mapping to the spec's entity list**
- *Sports, Amenities, Venue-Sports, Venue-Amenities, Venue Images*: the predefined sports/amenities catalog lives in `server.js` (`SPORTS`, `AMENITIES`, served by `/api/catalog`). A venue's selections and photos are JSON columns on `venues`. The data and behaviour are the same as join tables. Split them into tables if sports need their own admin CRUD or cross-venue reporting.
- *Availability / Time Slots*: slots are **derived** from `opening_time`, `closing_time`, `slot_minutes`, `active_days` (+ a court's override hours), minus active bookings and `blocked_slots`. Only exceptions (blocks) are stored, which is what "Generate Availability" means without writing hundreds of rows.
- `confirmPassword` is never stored. Passwords are hashed.

**Status lifecycles**
```text
Booking:  Reserved ──pay──► Confirmed ──end time passes──► Completed
             │                  └──cancel──► Cancelled (payment → Refunded)
             ├──cancel──► Cancelled
             └──10 min unpaid──► Expired (slot released)
Facility: Pending ──► Approved | Rejected ; any owner edit ──► Pending
Match:    Open ──► Full (max players reached)
Report:   Open ──► Resolved | Dismissed
```

---

## 11. Business rules enforced on the server

1. **No double booking.** `POST /api/bookings` re-checks the exact court + date + time range against Confirmed/Completed bookings, unexpired Reserved bookings and blocked slots. The check and the insert run under a lock, so two simultaneous requests can't both succeed. The losing request gets **409**.
2. The booking must be today or later, start in the future, fall inside the court's hours (override or facility), on an active day, and the court must be **Active**.
3. **Price** = court `price_per_hour` × duration, calculated on the server. The client's number is display only.
4. IDs, ownership (`owner_id`, `user_id`, `creator_id`, `reporter_id`), timestamps, statuses and prices are set by the server, never taken from the form.
5. Reviews: only by the booker, only for a **Completed** booking, once per booking.
6. Owners can only read or modify their own venues, courts, blocks and bookings.
7. Admins approve or reject but cannot edit facility content. Rejection reasons go to the owner.
8. Unpaid reservations hold the slot for 10 minutes, then stop blocking it.
9. Confirmed bookings flip to Completed automatically once their end time passes.

---

## 12. Responsive behaviour

A single structure is used for every device; layouts reflow with CSS breakpoints.

| Width | Changes |
|---|---|
| ≤ 960px | Venue listing, venue details, booking and hero stack into one column; filters become collapsible; venue page gets a sticky bottom "Book now" bar |
| ≤ 800px | Auth image hidden (per wireframe); player nav collapses behind ☰; owner/admin sidebar becomes a top scrolling tab strip; 2-column forms go 1 column; data tables turn into labelled rows; chart labels thin out |

Accessibility basics: labelled inputs, `aria-invalid` + inline errors, keyboard-reachable chart bars with tooltips, screen-reader data tables for charts, native `<dialog>` modals (focus trap and Esc), `aria-current` on tabs, steps and pages, and reduced-motion support for the spinner.

---

## 13. Known limits (deliberate for the hackathon demo)

| Shortcut | Upgrade path |
|---|---|
| OTP shown on screen instead of emailed | Plug in an email/SMS provider and drop `demoOtp` from responses |
| Passwords hashed with SHA-256 | Switch to bcrypt/argon2 before real users |
| Sessions kept in memory (a restart logs everyone out) | Sessions table or JWT |
| One global booking lock | Per-court locks if booking volume grows |
| Photos stored as data URLs in SQLite | Object storage (S3 etc.) + URLs |
| Distance uses a flat-earth approximation (fine within one city) | Haversine / PostGIS for multi-city |
| Location tree is fixed in `server.js` | A locations table if owners need to add areas |
| Owner occupancy reads low (~1%) because the seed books a small share of 17 open hours × every court | Seed denser bookings if the demo needs a realistic occupancy figure |
| Creating a match does not reserve a court | Link a match to a booking if venues require it |
| Visual design is functional, not final | Carousels, motion and polish can be layered onto the existing components without restructuring |
