module.exports = (root) => {
  const externalTwo = root.proxy("ExternalTwo");

  return {
    async callExternalTwo() {
      return await externalTwo.returnOk();
    },
  };
};
