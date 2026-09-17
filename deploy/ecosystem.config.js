// PM2 process definition for AutoDex.
// Start:  pm2 start deploy/ecosystem.config.js
// Reload: pm2 reload autodex
// Logs:   pm2 logs autodex
module.exports = {
  apps: [
    {
      name: 'autodex',
      script: 'server.js',
      cwd: __dirname + '/..',
      instances: 1,
      exec_mode: 'fork',
      // PM2 does not read .env — server.js loads it via dotenv, so we only
      // need to make sure NODE_ENV is production here.
      env: {
        NODE_ENV: 'production'
      },
      max_memory_restart: '400M',
      // Wait for the app to bind before considering the start successful
      wait_ready: false,
      restart_delay: 5000,
      max_restarts: 10,
      merge_logs: true,
      time: true
    }
  ]
};
