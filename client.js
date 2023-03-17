class ZodError extends Error {
  constructor(issues) {
    super();
    this.name = "ZodError";
    this.issues = issues;
  }
}

(function () {
  const listeners = {};

  window.grow = {
    plant(plantName) {
      return new Proxy({}, {
        get(_target, prop) {
          return function (...args) {
            return callPlant(plantName, prop, args);
          };
        },
      });
    },
    addEventListener(eventType, listener) {
      this.listeners[eventType] = listeners[eventType] || [];
      if (!listeners[eventType].includes(listener)) {
        listeners[eventType].push(listener);
      }
    },
    removeEventListener(eventType, listener) {
      listeners[eventType] = listeners[eventType] || [];
      listeners[eventType] = listeners[eventType]
        .filter((l) => l !== listener);
    },
    dispatchEvent(event) {
      const eventListeners = listeners[event.type] || [];
      eventListeners.forEach((listener) => listener(event));
    },
    urlPrefix: "",
    set sessionId(sessionId) {
      if (sessionId === null || sessionId === undefined) {
        if (sessionId === undefined) {
          console.warn("sessionId can be a string or null but not undefined");
        }

        localStorage.removeItem("sessionId");
        this.dispatchEvent(new CustomEvent("logout"));
      } else {
        localStorage.setItem("sessionId", sessionId);
        this.dispatchEvent(new CustomEvent("login"));
      }
    },
    get sessionId() {
      return localStorage.getItem("sessionId") ?? null;
    },
  };

  async function callPlant(plantName, methodName, args) {
    const requestId = getRandomString();
    const plantNameDash = toDashCase(plantName);
    const methodNameDash = toDashCase(methodName);
    let url = `/${plantNameDash}/${methodNameDash}`;

    if (grow.urlPrefix) {
      url = `${grow.urlPrefix}${url}`;
    }

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "grow-request-id": requestId,
        "grow-session-id": window.grow.sessionId || "",
      },
      body: JSON.stringify(args),
    });

    const text = await res.text();

    let json;
    try {
      json = JSON.parse(text);
    } catch (err) {
      console.log(err);
      console.log(text);
      throw new Error("invalid response from server");
    }

    if (res.status === 401) {
      window.grow.dispatchEvent(new CustomEvent("loginRequired"));
    } else if (res.status === 403) {
      window.grow.dispatchEvent(new CustomEvent("forbidden"));
    }

    if (res.status < 200 || res.status >= 300) {
      if (json.name === "ZodError") {
        throw new ZodError(json.issues);
      } else {
        const err = Object.assign(new Error(json.message), json);
        throw err;
      }
    }

    return json.result;
  }

  function getRandomString() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2);
  }

  function toDashCase(text) {
    return text.replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase();
  }
})();
