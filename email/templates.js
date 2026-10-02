// Every transactional email QuickCourt can send. Adding one = adding an entry here + one `mail(...)` call
// where the business event happens (server.js). Nothing else needs to change.
//
// Entry: { subject(ctx), intro(ctx), rows?: [[label, ctx key]], outro?(ctx), cta?: [label, hash-route] }
// Keys in `rows` that are empty/undefined are skipped, so optional fields (refund, reason) just disappear.

const SIGN = 'Team QuickCourt';
const hi = (c) => `Hi ${c.name || 'there'},`;

const BOOKING_ROWS = [['Venue', 'venueName'], ['Sport', 'sport'], ['Court', 'courtName'], ['Date', 'date'], ['Time', 'time'], ['Duration', 'duration'], ['Amount', 'amount'], ['Location', 'location'], ['Booking ID', 'bookingId']];
const OWNER_BOOKING_ROWS = [['Player', 'playerName'], ['Venue', 'venueName'], ['Sport', 'sport'], ['Court', 'courtName'], ['Date', 'date'], ['Time', 'time'], ['Amount', 'amount'], ['Booking ID', 'bookingId']];

const TEMPLATES = {
  // ---------- player ----------
  welcome: {
    subject: () => 'Welcome to QuickCourt 🏸',
    intro: () => ['Thank you for signing in to QuickCourt!',
      "We're excited to have you here. QuickCourt helps you discover nearby courts, book your next game, and connect with players around you.",
      "Whenever something important happens on your QuickCourt account, we'll keep you updated by email, including booking confirmations, upcoming booking reminders, cancellations, match updates, and other important changes.",
      'Get ready to find your court and find your people.'],
    outro: () => SIGN, cta: ['Find a Court', '#/venues'], noGreeting: true,
  },
  bookingConfirmed: {
    subject: () => 'Your QuickCourt booking is confirmed 🏸',
    intro: (c) => [hi(c), `Your booking at ${c.venueName} is confirmed.`],
    rows: BOOKING_ROWS, outro: () => ["We'll remind you before your game.", 'See you on the court!', SIGN], cta: ['View my bookings', '#/bookings'],
  },
  paymentConfirmed: { // defined, not yet triggered: booking confirmation already states the amount paid — wire it if a separate receipt is wanted
    subject: () => 'Payment received for your QuickCourt booking',
    intro: (c) => [hi(c), `We've received your payment of ${c.amount} for ${c.venueName}.`],
    rows: [['Venue', 'venueName'], ['Date', 'date'], ['Time', 'time'], ['Amount', 'amount'], ['Booking ID', 'bookingId']], outro: () => SIGN,
  },
  bookingReminder: {
    subject: () => 'Your game is coming up 🏸',
    intro: (c) => [hi(c), 'Just a reminder that your QuickCourt game is coming up.'],
    rows: [['Venue', 'venueName'], ['Date', 'date'], ['Time', 'time'], ['Court', 'courtName'], ['Location', 'location']],
    outro: () => ['Get ready and we\'ll see you on the court!', SIGN],
  },
  bookingCancelled: {
    subject: () => 'Your QuickCourt booking has been cancelled',
    intro: (c) => [hi(c), 'Your booking has been cancelled successfully.'],
    rows: [['Venue', 'venueName'], ['Date', 'date'], ['Time', 'time'], ['Booking ID', 'bookingId'], ['Payment', 'refund']], outro: () => SIGN,
  },
  bookingCompleted: {
    subject: () => 'Hope you enjoyed your game 🏸',
    intro: (c) => [hi(c), `Your session at ${c.venueName} is complete. Hope you had a great game!`],
    rows: [['Venue', 'venueName'], ['Date', 'date'], ['Time', 'time'], ['Booking ID', 'bookingId']],
    outro: () => ['Got a minute? A quick review helps other players find great courts.', SIGN], cta: ['Leave a review', '#/bookings'],
  },
  matchJoined: {
    subject: () => "You're in! Match joined 🏸",
    intro: (c) => [hi(c), `You've joined a ${c.sport} match hosted by ${c.hostName}.`],
    rows: [['Venue', 'venueName'], ['Date', 'date'], ['Time', 'time'], ['Sport', 'sport']], outro: () => SIGN, cta: ['View match', '#/matches'],
  },
  matchUpdate: {
    subject: (c) => c.subject || 'An update on your QuickCourt match',
    intro: (c) => [hi(c), c.message],
    rows: [['Venue', 'venueName'], ['Date', 'date'], ['Time', 'time']], outro: () => SIGN, cta: ['View match', '#/matches'],
  },

  // ---------- owner ----------
  facilitySubmitted: {
    subject: (c) => `We've received ${c.venueName} for review`,
    intro: (c) => [hi(c), `${c.venueName} was submitted successfully. Our team will review it and email you once there's a decision.`],
    outro: () => SIGN, cta: ['View facilities', '#/owner/facilities'],
  },
  facilityApproved: {
    subject: (c) => `${c.venueName} is now live on QuickCourt 🎉`,
    intro: (c) => [hi(c), `Good news, ${c.venueName} has been approved and is now visible to players.`],
    outro: () => SIGN, cta: ['View facilities', '#/owner/facilities'],
  },
  facilityRejected: {
    subject: (c) => `Update on ${c.venueName}: changes needed`,
    intro: (c) => [hi(c), `${c.venueName} could not be approved yet.`],
    rows: [['Reason', 'reason']], outro: () => ['You can edit the facility and resubmit it for review from your dashboard.', SIGN], cta: ['Edit facility', '#/owner/facilities'],
  },
  facilityUnlisted: {
    subject: (c) => `${c.venueName} has been unlisted`,
    intro: (c) => [hi(c), `${c.venueName} was unlisted by the QuickCourt team after a report.`],
    rows: [['Note', 'reason']], outro: () => SIGN, cta: ['View facilities', '#/owner/facilities'],
  },
  ownerNewBooking: {
    subject: (c) => `New booking at ${c.venueName}`,
    intro: (c) => [hi(c), 'You have a new booking.'],
    rows: OWNER_BOOKING_ROWS, outro: () => SIGN, cta: ['View bookings', '#/owner/bookings'],
  },
  ownerBookingCancelled: {
    subject: (c) => `Booking cancelled at ${c.venueName}`,
    intro: (c) => [hi(c), `${c.playerName} cancelled a booking. The slot is open again.`],
    rows: OWNER_BOOKING_ROWS, outro: () => SIGN, cta: ['View bookings', '#/owner/bookings'],
  },
};

module.exports = { TEMPLATES };
