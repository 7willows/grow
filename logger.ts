import { log } from "./deps.ts";

export type Logger = log.Logger & {
  child: (nameSuffix: string, fields?: Record<string, any>) => Logger;
};

export function getLogger(cfg: {
  name: string;
  sessionId?: string;
  requestId?: string;
  fields?: Record<string, any>;
}) {
  const logLevel = (Deno.env.get("GROW_LOG_LEVEL") ?? "DEBUG") as any;
  const isPretty = Deno.env.get("GROW_LOG_PRETTY") === "true";

  function toString(obj: any) {
    if (obj instanceof Error) {
      return obj.stack;
    }
    if (isPretty) {
      return JSON.stringify(obj, null, 2);
    }
    return JSON.stringify(obj);
  }

  log.setup({
    //define handlers
    handlers: {
      debug: new log.handlers.ConsoleHandler(logLevel, {
        formatter: function debugFormatter(rec: log.LogRecord) {
          const base = `${rec.datetime.toISOString()} [${rec.levelName}] ` +
            `[${cfg.name}] ${rec.msg} | sid:${cfg.sessionId} rid:${cfg.requestId}`;

          const extra = rec.args.map((arg) => toString(arg));

          if (cfg.fields) {
            extra.push(toString(cfg.fields));
          }

          const rest = extra ? " | " + extra.join(" | ") : "";

          return base + rest;
        },
      }),
    },
    loggers: {
      [cfg.name]: {
        level: logLevel,
        handlers: ["debug"],
      },
    },
  });
  const logger = log.getLogger(cfg.name) as Logger;

  logger.child = (nameSuffix: string, fields?: Record<string, any>) => {
    cfg.name = `${cfg.name}${nameSuffix}`;
    cfg.fields = {
      ...(cfg.fields ?? {}),
      ...(fields ?? {}),
    };
    return getLogger(cfg);
  };

  return logger;
}
