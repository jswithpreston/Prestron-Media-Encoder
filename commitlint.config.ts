/** @type {import('@commitlint/types').UserConfig} */
const config = {
  extends: ["@commitlint/config-conventional"],
  rules: {
    "body-max-line-length": [1, "always", 100],
    "footer-max-line-length": [1, "always", 100],
    "header-max-length": [2, "always", 100],
  },
};

export default config;
