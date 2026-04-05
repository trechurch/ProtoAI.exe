define('vs/basic-languages/json/json', [], function () {
  return {
    tokenizer: {
      root: [
        [/"([^"\\]|\\.)*"/, "string"],
        [/\d+/, "number"],
        [/[{}]/, "delimiter.bracket"],
        [/:/, "delimiter"],
        [/[,]/, "delimiter"]
      ]
    }
  };
});
