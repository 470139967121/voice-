const { db, messaging } = require('./firebase');
const { createAlertManager } = require('./alertManager');
const alertManager = createAlertManager(db, messaging);
module.exports = alertManager;
