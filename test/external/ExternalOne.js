module.exports = async (root) => {
  const externalTwo = await root.proxy("ExternalTwo");
  const internal = await root.proxy("Internal");

  return {
    async callExternalTwo(ctx) {
      return await externalTwo.returnOk(ctx);
    },

    async callInternal(ctx) {
      return await internal.hello(ctx);
    },

    async foo(_ctx) {
      return "bar";
    },
  };
};
