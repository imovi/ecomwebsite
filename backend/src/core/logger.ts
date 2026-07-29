import { pino, type Logger, type LoggerOptions } from "pino";
import { config } from "../config/index.js";

/**
 * Structured logging.
 *
 * JSON by default so logs are queryable in whatever aggregator sits downstream
 * (CloudWatch, Loki, Datadog). Pretty-printing is development-only and is
 * blocked in production by config validation.
 *
 * The redaction list is the important part: request logging otherwise writes
 * `Authorization: Bearer <valid token>` and plaintext passwords straight into
 * persistent storage, which turns a log export into a credential leak.
 */
const REDACTED_PATHS = [
  "req.headers.authorization",
  "req.headers.cookie",
  "req.headers['set-cookie']",
  "res.headers['set-cookie']",
  "password",
  "currentPassword",
  "newPassword",
  "confirmPassword",
  "token",
  "accessToken",
  "refreshToken",
  "*.password",
  "*.token",
  "*.accessToken",
  "*.refreshToken",
  "*.passwordHash",
];

const options: LoggerOptions = {
  level: config.logging.level,
  base: {
    service: "gng-api",
    env: config.env,
  },
  redact: {
    paths: REDACTED_PATHS,
    censor: "[redacted]",
  },
  formatters: {
    /* Emit `level: "info"` rather than `level: 30` — most log backends group
       on the string and it costs nothing here. */
    level: (label) => ({ level: label }),
  },
  timestamp: pino.stdTimeFunctions.isoTime,
};

export const logger: Logger = config.logging.pretty
  ? pino({
      ...options,
      transport: {
        target: "pino-pretty",
        options: {
          colorize: true,
          translateTime: "HH:MM:ss.l",
          ignore: "pid,hostname,service,env",
          singleLine: false,
        },
      },
    })
  : pino(options);

/**
 * Creates a child logger bound to a subsystem, so log lines carry their origin
 * without every call site repeating it.
 */
export function createLogger(context: string, bindings: Record<string, unknown> = {}): Logger {
  return logger.child({ context, ...bindings });
}
