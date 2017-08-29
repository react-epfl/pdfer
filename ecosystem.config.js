module.exports = {
  apps: [{
    name: 'pdfer',
    script: 'server.js',
    cwd: '/opt/pdfer/',
    instances: 1,
    max_memory_restart: '1024M',
    log_file: '/var/log/pdfer/pdfer.log',
    error_file: '/var/log/pdfer/err.log',
    out_file: '/dev/null',
    log_date_format: 'YYYY-MM-DD HH:mm Z',
    merge_logs: true,
  }],
};
