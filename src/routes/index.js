const homeRoutes = require('./homeRoutes');
const authRoutes = require('./authRoutes');
const dashboardRoutes = require('./dashboardRoutes');
const listingRoutes = require('./listingRoutes');
const spotycoinRoutes = require('./spotycoinRoutes');
const adminRoutes = require('./adminRoutes');
const moderatorRoutes = require('./moderatorRoutes');
const apiRoutes = require('./apiRoutes');
const seoRoutes = require('./seoRoutes');
const legalRoutes = require('./legalRoutes');
const launchRoutes = require('./launchRoutes');
const { launchGate } = require('../middleware/launchGate');

function registerRoutes(app) {
  app.use(launchRoutes);
  app.use(launchGate);
  app.use(apiRoutes);
  app.use(seoRoutes);
  app.use(legalRoutes);
  app.use(homeRoutes);
  app.use(authRoutes);
  app.use(dashboardRoutes);
  app.use(listingRoutes);
  app.use(spotycoinRoutes);
  app.use(moderatorRoutes);
  app.use(adminRoutes);
}

module.exports = {
  registerRoutes
};
