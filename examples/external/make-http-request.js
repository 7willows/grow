const http = require("http");
const https = require("https");

module.exports = function makeHttpRequest(url, body) {
  const postData = JSON.stringify(body);
  url = new URL(url);
  const options = {
    hostname: url.hostname,
    port: url.port,
    path: url.pathname,
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(postData),
    },
  };
  const protocol = url.protocol === "https:" ? https : http;

  return new Promise((resolve, reject) => {
    const req = protocol.request(options, (res) => {
      let responseData = "";
      res.on("data", (chunk) => {
        responseData += chunk;
      });
      res.on("end", () => {
        resolve({
          status: res.statusCode,
          data: responseData ? JSON.parse(responseData) : null,
        });
      });
    });

    req.on("error", (error) => {
      reject(error);
    });

    req.write(postData);
    req.end();
  });
};
