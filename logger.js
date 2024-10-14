import winston from 'winston';

// Create a logger instance with custom configuration
const logger = winston.createLogger({
  // Set the minimum severity level for logged messages
  level: 'info',
  
  // Define the format for log messages
  format: winston.format.combine(
    // Add timestamps to each log entry
    winston.format.timestamp(),
    // Format the log as a JSON object
    winston.format.json()
  ),
  
  // Specify where log messages should be output (transports)
  transports: [
    // Log errors to a separate file
    new winston.transports.File({ filename: 'error.log', level: 'error' }),
    // Log all messages to a combined file
    new winston.transports.File({ filename: 'combined.log' }),
    // Also log to the console with a simpler format
    new winston.transports.Console({
      format: winston.format.simple()
    })
  ]
});

// Export the logger instance for use in other parts of the application
export default logger;