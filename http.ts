import { Context, Hono, match, P, serve, StatusCode } from "./deps.ts";
import { CallMethod, Field, Proc } from "./types.ts";

export function isHttpEnabled(field: Field) {
  return (
    field.http || Object.values(field.plants).some((plant) => plant.http)
  );
}

export function startHttpServer(
  field: Field,
  procs: Map<string, Proc>,
  callMethod: CallMethod,
) {
  const app = new Hono();

  routes({ app, field, procs, callMethod });

  serveClient(app);

  app.onError((err, c) => {
    return c.json(err, errorToStatus(err));
  });

  setTimeout(() => {
    if (field.http) {
      field.http(app);
    }
  });

  let port = Deno.env.get("GROW_PORT") as any;
  if (port) {
    port = parseInt(port, 10);
  } else {
    port = 8000;
  }

  serve(app.fetch as any, { port });
}

async function tryFetch(
  attempts: number,
  url: any,
  options: any,
): Promise<any> {
  try {
    return await fetch(url, options);
  } catch (err) {
    if (attempts > 0) {
      return await tryFetch(attempts - 1, url, options);
    } else throw err;
  }
}

function serveClient(app: Hono) {
  let client = "";

  const url = new URL(import.meta.url);
  const pathSplit = url.pathname.split("/");
  pathSplit.pop();
  pathSplit.push("client.js");
  url.pathname = pathSplit.join("/");

  tryFetch(5, url, {})
    .then((res) => res.text())
    .then((text) => {
      client = text;
    });

  app.get("/grow.js", (c) => {
    c.header("content-type", "text/javascript");
    return c.body(client);
  });
}

function toCamelCase(dashCase: string): string {
  return dashCase.replace(/-([a-z])/g, (g) => g[1].toUpperCase());
}

function routes(cfg: {
  app: Hono;
  field: Field;
  procs: Map<string, Proc>;
  callMethod: CallMethod;
}) {
  for (const [plantName, plantDef] of Object.entries(cfg.field.plants)) {
    const plantNameDashCase = toDashCase(plantName);

    if (!plantDef.http) {
      continue;
    }

    if (!plantDef.contracts) {
      const url = `/${plantNameDashCase}/:method`;

      cfg.app.post(url, (c) => {
        const { method } = c.req.param() as any;
        const methodCamelCase = toCamelCase(method);

        return handleRequest({
          plantName,
          methodName: methodCamelCase,
          procs: cfg.procs,
          callMethod: cfg.callMethod,
        })(c);
      });

      continue;
    }

    for (const contract of plantDef.contracts) {
      for (const [methodName] of Object.entries(contract.shape)) {
        const methodDashCase = toDashCase(methodName);

        const url = `/${plantNameDashCase}/${methodDashCase}`;

        cfg.app.post(
          url,
          handleRequest({
            plantName,
            methodName,
            procs: cfg.procs,
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
  procs: Map<string, Proc>;
  callMethod: CallMethod;
}) {
  return async (c: Context<any, any, any>) => {
    const args = (await c.req.json()) as any[];

    let result;
    try {
      result = await cfg.callMethod({
        plantName: cfg.plantName,
        methodName: cfg.methodName,
        args,
        procs: cfg.procs,
        sessionId: c.req.header("grow-session-id") ?? "",
        requestId: c.req.header("grow-request-id") ?? "",
      });
    } catch (err) {
      return c.json(err, errorToStatus(err));
    }

    delete (result as any).receiver;
    delete (result as any).callId;

    if (result?.type === "error") {
      const status = errorToStatus(result as any);
      return c.json(result, status);
    }

    return c.json(result);
  };
}

function errorToStatus(err: { message: string; name: string }) {
  return match<[string, string], StatusCode>([err.message, err.name])
    .with(["notFound", P._], () => 404)
    .with(["unauthorized", P._], () => 401)
    .with(["forbidden", P._], () => 403)
    .with(["badRequest", P._], () => 400)
    .with(["validationError", P._], () => 400)
    .with(["conflict", P._], () => 409)
    .with([P._, "ZodError"], () => 400)
    .otherwise(() => 500);
}
