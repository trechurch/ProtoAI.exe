define('vs/basic-languages/javascript/javascript', [], function () {
  return {
    tokenizer: {
      root: [
        [/[{}]/, "delimiter.bracket"],
        [/[a-zA-Z_$][\w$]*/, "identifier"],
        [/\d+/, "number"],
        [/".*?"/, "string"],
        [/'.*?'/, "string"]
      ]
    }
  };
});
