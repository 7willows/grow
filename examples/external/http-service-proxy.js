const makeHttpReqest = require("./make-http-request");

exports.serviceProxy = function serviceProxy(procCfg, caller, serviceName) {
  const link = new ServiceLink(
    procCfg.field,
    procCfg.secretKey,
    procCfg.mainUrl,
  );

  return new Proxy({}, {
    get(target, prop) {
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
    this._validateCall(service, method, args);
    requestId = requestId || this._generateUniqueId();
    const callId = this._generateUniqueId();
    const body = {
      caller,
      sessionId,
      requestId,
      receiver,
      method,
      args,
      callId,
    };

    const url = this._findReceiverUrl(receiver);
    const result = await this._makeHttpCall(url, body);

    if (result.status !== 200) {
      console.error(`calling ${service}.${method}() failed`, result);
      throw new Error("invalid response from server");
    }

    if (!result.data.result) {
      console.error(`invalid response from ${service}.${method}()`, result);
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
