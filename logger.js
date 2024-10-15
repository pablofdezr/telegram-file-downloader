import winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
import path from 'path';
import config from './config.js'; // Import configuration

// Define custom log levels
const customLevels = {
  levels: {
    error: 0,
    warn: 1,
    info: 2,
    http: 3,
    verbose: 4,
    debug: 5,
    silly: 6
  },
  colors: {
    error: 'red',
    warn: 'yellow',
    info: 'green',
    http: 'magenta',
    verbose: 'cyan',
    debug: 'blue',
    silly: 'gray'
  }
};

// Create a custom format for console output
const consoleFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.printf(({ timestamp, level, message }) => {
    return `${timestamp} [${level}]: ${message}`;
  })
);

// Create a custom format for file output
const fileFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.json()
);

// Create a logger instance with custom configuration
const logger = winston.createLogger({
  levels: customLevels.levels,
  level: config.LOG_LEVEL || 'info', // Use LOG_LEVEL from config, default to 'info'
  
  transports: [
    // Console transport
    new winston.transports.Console({
      format: consoleFormat
    }),
    
    // File transport for all logs
    new DailyRotateFile({
      filename: path.join(config.LOG_DIR, 'application-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      zippedArchive: true,
      maxSize: '20m',
      maxFiles: '14d',
      format: fileFormat
    }),
    
    // File transport for error logs
    new DailyRotateFile({
      filename: path.join(config.LOG_DIR, 'error-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      zippedArchive: true,
      maxSize: '20m',
      maxFiles: '14d',
      level: 'error',
      format: fileFormat
    })
  ],
  
  // Handle exceptions and rejections
  exceptionHandlers: [
    new winston.transports.File({ filename: path.join(config.LOG_DIR, 'exceptions.log') })
  ],
  rejectionHandlers: [
    new winston.transports.File({ filename: path.join(config.LOG_DIR, 'rejections.log') })
  ],
  
  exitOnError: false // Do not exit on handled exceptions
});

// Add colors to winston
winston.addColors(customLevels.colors);

// If we're not in production, log to the console with the format:
// `${info.level}: ${info.message} JSON.stringify({ ...rest }) `
if (process.env.NODE_ENV !== 'production') {
  logger.add(new winston.transports.Console({
    format: winston.format.simple(),
  }));
}

// Create a stream object with a 'write' function that will be used by morgan
logger.stream = {
  write: function(message, encoding) {
    // Use the 'info' log level so the output will be picked up by both transports (file and console)
    logger.info(message);
  },
};

// Export the logger instance for use in other parts of the application
export default logger;