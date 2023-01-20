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
                    }
                }
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
                .filter(l => l !== listener);
        },
        dispatchEvent(event) {
            const listeners = this.listeners[event.type] || [];
            listeners.forEach(listener => listener(event));
        },
        set sessionId(sessionId) {
            if (sessionId === null || sessionId === undefined) {
                if (sessionId === undefined) {
                    console.warn("sessionId can be a string or null but not undefined");
                }
                
                localStorage.deleteItem("sessionId");
                this.dispatchEvent(new CustomEvent('logout'));
            } else {
                localStorage.setItem('sessionId', sessionId);
                this.dispatchEvent(new CustomEvent('login'));
            }
        },
        get sessionId() {
            return localStorage.getItem('sessionId') ?? null;
        },
    }
    
    async function callPlant(plantName, methodName, args) {
        const requestId = getRandomString();
        const plantNameDash = toDashCase(plantName);
        const methodNameDash = toDashCase(methodName);
        const url = `/${plantNameDash}/${methodNameDash}`;

        const res = await fetch(url, {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                'grow-request-id': requestId,
                'grow-session-id': window.grow.sessionId,
            },
            body: JSON.stringify(args)
        });

        const json = await res.json();

        if (result.status === 401) {
            window.grow.dispatchEvent(new CustomEvent('loginRequired'));
        } else if (result.status === 403) {
            window.grow.dispatchEvent(new CustomEvent('forbidden'));
        }
        
        if (res.status < 200 || res.status >= 300) {
            if (json.name === 'ZodError') {
                throw new ZodError(json.issues);
            } else {
                throw new Error(json.error);
            }
        }
        
        return json;
    }

    function getRandomString() {
        return Date.now().toString(36) + Math.random().toString(36).slice(2)
    }

    function toDashCase(text) {
        return text.replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase();
    }

})();
