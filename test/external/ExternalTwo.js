// deno-lint-ignore-file require-await

module.exports = async (_root) => ({
  async returnOk() {
    return "ok";
  },

  async crash() {
    process.exit(1);
  },
});
