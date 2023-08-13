module.exports = async (root) => {
  const externalTwo = await root.proxy("ExternalTwo");

  return {
    async callExternalTwo(ctx) {
      return await externalTwo.returnOk(ctx);
    },
  };
};
