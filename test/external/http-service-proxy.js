const makeHttpRequest = require("./make-http-request");

exports.serviceProxy = function serviceProxy(procCfg, caller, serviceName) {
  const link = new ServiceLink(
    procCfg.field,
    procCfg.secretKey,
    procCfg.mainUrl,
  );

  return new Proxy({}, {
    get(target, prop) {
      if (prop === "then") {
        return target.then;
      }

      return function (ctx, ...args) {
        return link.call({
          sessionId: ctx.sessionId,
          requestId: ctx.requestId,
          receiver: serviceName,
          method: prop,
          args,
        });
      };
    },
  });
};

class ServiceLink {
  constructor(field, secretKey, mainUrl) {
    this._field = field;
    this._secretKey = secretKey;
    this._mainUrl = mainUrl;
  }

  async call({
    caller,
    sessionId,
    requestId,
    receiver,
    method,
    args,
  }) {
    this._validateCall(receiver, method, args);
    requestId = requestId || this._generateUniqueId();
    const callId = this._generateUniqueId();
    const body = {
      call: {
        caller,
        sessionId,
        requestId,
        receiver,
        method,
        args,
        callId,
      },
    };

    const url = this._findReceiverUrl(receiver) + "/grow/msg";
    const secret = this._field.communicationSecret;
    const result = await makeHttpRequest(url, secret, body);

    if (result.status !== 200) {
      console.error(`calling ${receiver}.${method}() failed`, result);
      throw new Error("invalid response from server");
    }

    if (!result.data.result) {
      console.error(`invalid response from ${receiver}.${method}()`, result);
      throw new Error("invalid response from server");
    }

    return result.data.result;
  }

  _findReceiverUrl(receiver) {
    const proc = this._field.plants[receiver]?.proc ?? receiver;
    return this._field.procs[proc]?.url || this._mainUrl;
  }

  _generateUniqueId() {
    return Math.random().toString(36).substr(2, 9);
  }

  _validateCall(service, method, args) {
    if (!this._field.plants[service]) {
      throw new Error(`Service ${service} not found`);
    }
  }
}
