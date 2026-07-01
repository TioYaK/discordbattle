module.exports = {
  apps: [
    {
      name: 'ascended-bot',
      script: 'bot.js',
      cwd: 'C:\\Users\\pifot\\Desktop\\Discord',
      watch: false,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000,
      env: {
        NODE_ENV: 'production',
      },
      log_date_format: 'DD/MM/YYYY HH:mm:ss',
      error_file: 'C:\\Users\\pifot\\Desktop\\Discord\\logs\\error.log',
      out_file: 'C:\\Users\\pifot\\Desktop\\Discord\\logs\\out.log',
      merge_logs: true,
    },
  ],
};
