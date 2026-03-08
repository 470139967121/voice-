const { db } = require('./firebase');
const { createLogger } = require('./logger');
const logger = createLogger(db);
module.exports = logger;
