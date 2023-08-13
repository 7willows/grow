module.exports = (root) => ({
  returnOk() {
    return "ok";
  },

  crash() {
    process.exit(1);
  },
});
