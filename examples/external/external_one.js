const root = require("../../root");
const externalTwo = root.proxy("ExternalTwo");

exports.callExternalTwo = async function () {
  return await externalTwo.returnOk();
};
