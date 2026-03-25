require('dotenv').config();
module.exports = {
  apps: [{
    name: 'divino-fogao',
    script: 'server.js',
    env_file: '.env'
  }]
};
