define('vs/basic-languages/markdown/markdown', [], function () {
  return {
    tokenizer: {
      root: [
        [/^#+ .*/, "keyword"],
        [/\*\*.*?\*\*/, "strong"],
        [/\*.*?\*/, "emphasis"],
        [/`.*?`/, "string"]
      ]
    }
  };
});
