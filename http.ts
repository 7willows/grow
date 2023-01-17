import { Context, Hono } from "hono";
import { serve } from "std/http/server.ts";
import { CallMethod, Field, Service } from "./types.ts";
import { z } from "zod";

export function isHttpEnabled(field: Field) {
  return Object.values(field.plants).some((plant) => plant.http);
}

export function startHttpServer(
  field: Field,
  instances: Record<string, Service>,
  callMethod: CallMethod,
) {
  const app = new Hono();

  routes({ app, field, instances, callMethod });

  serve(app.fetch);
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
    const args = await c.req.json();
    const argsDef = cfg.methodDef._def.args._def.items;
    const parsed: any[] = [];

    for (const argDef of argsDef) {
      parsed.push(argDef.parse(args));
    }

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
