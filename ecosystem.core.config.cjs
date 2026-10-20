const os = require('os');
const path = require('path');

const dataDir = process.env.METABOT_CORE_DATA_DIR
  || path.join(os.homedir(), '.metabot-core', 'data');
const logDir = path.join(os.homedir(), '.metabot-core', 'logs');
const releaseVersion = require('./package.json').version;

module.exports = {
  apps: [
    {
      name: 'metabot-core',
      script: 'packages/server/dist/index.js',
      interpreter: 'node',
      cwd: __dirname,
      watch: false,
      autorestart: true,
      max_restarts: 10,
      min_uptime: '10s',
      restart_delay: 3000,
      error_file: path.join(logDir, 'error.log'),
      out_file: path.join(logDir, 'out.log'),
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      env: {
        NODE_ENV: 'production',
        METABOT_CORE_HOST: process.env.METABOT_CORE_HOST || '127.0.0.1',
        METABOT_CORE_PORT: process.env.METABOT_CORE_PORT || '9200',
        METABOT_CORE_DATA_DIR: dataDir,
        METABOT_RELEASE_VERSION: releaseVersion,
        METABOT_CORE_UI_ALLOWED_EMAILS: '',
        METABOT_PUBLIC_DISTRIBUTION: '0',
        LOG_FORMAT: process.env.LOG_FORMAT || 'json',
      },
    },
  ],
};
