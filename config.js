import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// Load environment variables from .env file
dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const config = {
  // Telegram API credentials
  API_ID: parseInt(process.env.API_ID, 10),
  API_HASH: process.env.API_HASH,

  // Download settings
  MAX_SIMULTANEOUS_DOWNLOADS: 3,
  MAX_RETRIES: 3,
  DOWNLOAD_TIMEOUT: 300000, // 5 minutes in milliseconds

  // Telegram client settings
  CONNECTION_RETRIES: 5,
  CLIENT_TIMEOUT: 120000, // 2 minutes in milliseconds

  // Worker settings
  PROGRESS_UPDATE_INTERVAL: 500, // 500 milliseconds

  // Logging settings
  LOG_LEVEL: process.env.LOG_LEVEL || 'info',
  LOG_DIR: process.env.LOG_DIR || path.join(__dirname, 'logs'),

  // File paths
  DOWNLOADS_PATH: process.env.DOWNLOADS_PATH || path.join(process.env.HOME || process.env.USERPROFILE, 'Downloads'),
  SESSION_FILE_PATH: path.join(__dirname, 'session.json'),

  // Application settings
  NODE_ENV: process.env.NODE_ENV || 'development',
};

// Validate required configurations
const requiredConfigs = ['API_ID', 'API_HASH'];
for (const configName of requiredConfigs) {
  if (!config[configName]) {
    throw new Error(`Missing required configuration: ${configName}`);
  }
}

export default config;

// Usage instructions:
// 1. Create a .env file in the root directory of your project
// 2. Add the following variables to the .env file:
//    API_ID=your_api_id
//    API_HASH=your_api_hash
//    LOG_LEVEL=info (or debug, error, etc.)
//    LOG_DIR=/path/to/log/directory (optional)
//    DOWNLOADS_PATH=/path/to/downloads/directory (optional)
//    NODE_ENV=development (or production)

// You can also override any of these settings by adding them to your .env file.

// To use this configuration in other files:
// import config from './config.js';
// Then you can access settings like this: config.API_ID, config.MAX_SIMULTANEOUS_DOWNLOADS, etc.