// config.js — Environment variables + defaults

module.exports = {
  PORT: parseInt(process.env.PORT, 10) || 3000,
  DB_PATH: process.env.DB_PATH || '/app/data/nightly-ops.db',
  SYNC_LIMIT: parseInt(process.env.SYNC_LIMIT, 10) || 50,
  DEFAULT_SCHEDULE: process.env.DEFAULT_SCHEDULE || '02:00',
  MAX_PARALLEL: parseInt(process.env.MAX_PARALLEL, 10) || 2,
  TASK_TIMEOUT_MIN: parseInt(process.env.TASK_TIMEOUT_MIN, 10) || 30,
  TASK_TIMEOUT: parseInt(process.env.TASK_TIMEOUT, 10) || 1800000, // 30 min in ms
  NODE_ENV: process.env.NODE_ENV || 'development',
  ZAI_API_KEY: process.env.ZAI_API_KEY || '',
  NIGHTLY_CRON_KEY: process.env.NIGHTLY_CRON_KEY || 'changeme',
};
