/**
 * Structured Logging with Winston + Morgan
 * Provides JSON logs with level, timestamp, and context for observability
 */

const winston = require("winston");
const morgan = require("morgan");

const { combine, timestamp, json, errors } = winston.format;

// Winston logger for application logs
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || "info",
  defaultMeta: { service: "syncdev-server" },
  format: combine(
    timestamp(),
    errors({ stack: true }),
    json()
  ),
  transports: [
    new winston.transports.Console(),
    // File transports for production
    ...(process.env.LOG_FILE ? [
      new winston.transports.File({ filename: "logs/error.log", level: "error" }),
      new winston.transports.File({ filename: "logs/combined.log" }),
    ] : []),
  ],
});

// Morgan HTTP request logger middleware
const morganMiddleware = morgan(
  (tokens, req, res) => {
    return JSON.stringify({
      method: tokens.method(req, res),
      url: tokens.url(req, res),
      status: Number.parseInt(tokens.status(req, res), 10),
      responseTime: Number.parseFloat(tokens["response-time"](req, res)),
      contentLength: tokens.res(req, res, "content-length"),
      timestamp: new Date().toISOString(),
      userAgent: tokens["user-agent"](req, res),
      remoteAddr: tokens["remote-addr"](req, res),
    });
  },
  {
    stream: {
      write: (message) => {
        const data = JSON.parse(message);
        logger.http("HTTP request", data);
      },
    },
  }
);

// Socket event logger
function logSocketEvent(eventName, details = {}) {
  logger.info("Socket event", { event: eventName, ...details });
}

// Room activity logger
function logRoomActivity(action, roomId, userId, details = {}) {
  logger.info("Room activity", { action, roomId, userId, ...details });
}

// Error logger with context
function logError(error, context = {}) {
  logger.error("Error occurred", {
    message: error.message,
    stack: error.stack,
    ...context,
  });
}

module.exports = {
  logger,
  morganMiddleware,
  logSocketEvent,
  logRoomActivity,
  logError,
};
