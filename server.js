// Local development only (`npm start`). On Vercel the app is served through api/index.js.
const app = require('./app');
const { isConfigured } = require('./email');
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`QuickCourt running at http://localhost:${port}`);
  console.log(isConfigured() ? '[email] Gmail API configured' : '[email] Gmail API not configured — emails are logged and skipped (see .env.example)');
});
