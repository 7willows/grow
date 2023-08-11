const http = require("http");
const makeHttpRequest = require("./make-http-request");
const { serviceProxy } = require("./http-service-proxy.js");

const field = JSON.parse(process.env.FIELD ?? "{}");
const procName = process.env.PROC_NAME;

function logDebug(...args) {
  console.debug("proc:" + procName + " " + args[0], ...args.slice(1));
}

function logError(...args) {
  console.error("proc:" + procName + " " + args[0], ...args.slice(1));
}

if (!field || !procName) {
  logError("FIELD and PROC_NAME environment variables are required");
  process.exit(1);
}

const port = new URL(field.procs[procName].url).port;
const communicationSecret = field.communicationSecret;
const mainUrl = field.procs.main.url;

if (!port) {
  logError("port for " + procName + " not found");
  process.exit(1);
}

if (!communicationSecret) {
  logError("communicationSecret not found in field");
  process.exit(1);
}

if (!mainUrl) {
  logError("main.url not found in procs");
  process.exit(1);
}

let proc;
const plants = {};

async function processInit(init) {
  for (const [plantName, plantConfig] of Object.entries(field.plants)) {
    if (plantConfig.proc !== procName) {
      continue;
    }

    const plant = require("./" + plantName);

    plants[plantName] = await plant({
      field,
      proc,
      plantName,
      plantConfig,
      proxy: makeProxy.bind(
        null,
        { field, communicationSecret, mainUrl },
        plantName,
      ),
    });
  }

  return {
    initComplete: true,
  };
}

function makeProxy(procCfg, caller, plantName) {
  if (plants[plantName]) {
    return plantName;
  }

  return serviceProxy(procCfg, caller, plantName);
}

async function processCall(call) {
  const plant = plants[call.receiver];

  if (!plant) {
    logError(`Plant ${call.receiver} is not part of proc ${procName}`);
    return {
      callResult: {
        type: "error",
        receiver: call.receiver,
        callId: call.callId,
        name: "notFound",
        message: `Plant ${call.receiver} is not part of proc ${procName}`,
      },
    };
  }

  if (!plant[call.method]) {
    logError(`Method ${call.receiver}.${call.method}() does not exist`);
    return {
      callResult: {
        type: "error",
        receiver: call.receiver,
        callId: call.callId,
        name: "notFound",
        message: `Method ${call.receiver}.${call.method}() does not exist`,
      },
    };
  }

  const ctx = {
    sessionId: call.sessionId,
    requestId: call.requestId,
  };

  try {
    const result = await plant[call.method](ctx, ...call.args);
    return {
      callResult: {
        type: "success",
        result,
        callId: call.callId,
      },
    };
  } catch (err) {
    logError(`call ${call.receiver}.${call.method}() failed`, err);
    return {
      callResult: {
        type: "error",
        receiver: call.receiver,
        callId: call.callId,
        name: "notFound",
        message: `call failed`,
      },
    };
  }
}

function processSend(send) {
  // add a call to a queue
}

async function dispatchMessage(msg) {
  if (msg.init) {
    return await processInit(msg.init);
  } else if (msg.call) {
    return await processCall(msg.call);
  } else if (msg.callResult) {
    // do nothing
  } else if (msg.send) {
    return await processSend(msg.send);
  }

  return {};
}

function sendToMain(msg) {
  return makeHttpRequest(`${mainUrl}/grow/msg`, msg);
}

const routes = {
  "POST /grow/msg": async (req, res) => {
    try {
      const msg = await readJsonPayload(req);
      const result = await dispatchMessage(msg);
      return sendJson(res, 200, result);
    } catch (err) {
      logError("reading json payload failed", err);
      return routes[400](req, res);
    }
  },

  403: (req, res) => sendJson(res, 403, { error: "forbidden" }),
  404: (req, res) => sendJson(res, 404, { error: "not found" }),
  400: (req, res) => sendJson(res, 400, { error: "bad request" }),
  500: (req, res) => sendJson(res, 500, { error: "internal server error" }),
};

function sendJson(res, status, json) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(json));
}

const server = http.createServer(async (req, res) => {
  for (const [route, handler] of Object.entries(routes)) {
    if (route < 600) {
      continue;
    }

    const [method, path] = route.split(" ");

    if (req.method !== method || req.url !== path) {
      continue;
    }

    if (req.headers["communication-secret"] !== communicationSecret) {
      logError(`403: Forbidden: ${req.method} ${req.url}`);
      return routes[403](req, res);
    }

    await handler(req, res).catch((err) => {
      logError(`500: Internal Server Error: ${req.method} ${req.url}`, err);
      routes[500](req, res);
    });

    logDebug(`200: OK: ${req.method} ${req.url}`);
    return;
  }

  logDebug(`404: Not Found: ${req.method} ${req.url}`);
  return routes[404](req, res);
});

function readJsonPayload(req) {
  return new Promise((resolve, reject) => {
    let body = "";

    req.on("data", (chunk) => {
      body += chunk;
    });

    req.on("end", () => {
      try {
        const payload = JSON.parse(body);
        resolve(payload);
      } catch (error) {
        reject(error);
      }
    });

    req.on("error", (error) => {
      reject(error);
    });
  });
}

server.listen(port, () => {
  logDebug(`${procName} listening on ${field.procs[procName].url}/`);
});

sendToMain({ ready: true, procName });
