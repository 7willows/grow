import { Context, Hono } from "hono";
import { StatusCode } from "hono/utils/http-status.ts";
import { serveStatic } from "hono/middleware.ts";
import { serve } from "std/http/server.ts";
import { CallMethod, Field, Service } from "./types.ts";
import { z } from "zod";
import { match, P } from "ts-pattern";

export function isHttpEnabled(field: Field) {
  return field.http ||
    Object.values(field.plants).some((plant) => plant.http);
}

export function startHttpServer(
  field: Field,
  instances: Record<string, Service>,
  callMethod: CallMethod,
) {
  const app = new Hono();

  routes({ app, field, instances, callMethod });

  app.use("/grow.js", serveStatic({ path: "./client.js" }));

  app.onError((err, c) => {
    const status = match<[string, string], StatusCode>([err.message, err.name])
      .with(["notFound", P._], () => 404)
      .with(["unauthorized", P._], () => 401)
      .with(["forbidden", P._], () => 403)
      .with(["badRequest", P._], () => 400)
      .with(["conflict", P._], () => 409)
      .with([P._, "ZodError"], () => 400)
      .otherwise(() => 500);

    return c.json(err, status);
  });

  setTimeout(() => {
    if (field.http) {
      field.http(app);
    }
  });

  serve(app.fetch as any);
}

function routes(cfg: {
  app: Hono;
  field: Field;
  instances: Record<string, Service>;
  callMethod: CallMethod;
}) {
  for (const [plantName, plantDef] of Object.entries(cfg.field.plants)) {
    const plantNameDashCase = toDashCase(plantName);

    for (const contract of plantDef.contracts) {
      for (const [methodName, methodDef] of Object.entries(contract.shape)) {
        const methodDashCase = toDashCase(methodName);

        const url = `/${plantNameDashCase}/${methodDashCase}`;

        cfg.app.post(
          url,
          handleRequest({
            plantName,
            methodName,
            methodDef: methodDef as z.ZodFunction<any, any>,
            instances: cfg.instances,
            callMethod: cfg.callMethod,
          }),
        );
      }
    }
  }
}

function toDashCase(text: string) {
  return text.replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase();
}

/**
 * Structure of request:
 * POST /plant-name/method-name
 * Content-Type: application/json
 *
 * [
 *   arg1,
 *   arg2,
 * ]
 */
function handleRequest(cfg: {
  plantName: string;
  methodName: string;
  methodDef: z.ZodFunction<any, any>;
  instances: Record<string, Service>;
  callMethod: CallMethod;
}) {
  return async (c: Context<any, any, any>) => {
    const args = await c.req.json() as any[];
    const argsDef = cfg.methodDef._def.args._def.items;
    const parsed: any[] = [];

    z.any().array().parse(args);

    argsDef.forEach((argDef: any, i: number) => {
      parsed.push(argDef.parse(args[i]));
    });

    const result = await cfg.callMethod({
      plantName: cfg.plantName,
      methodName: cfg.methodName,
      args: parsed,
      instances: cfg.instances,
    });

    if ("error" in result) {
      return c.json(result.error, 500);
    }

    return c.json(result.result);
  };
}
