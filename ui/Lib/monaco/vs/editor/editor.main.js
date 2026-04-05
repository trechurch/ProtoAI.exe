/*! Minimal Monaco Editor Core */
define('vs/editor/editor.main', [], function () {
  return {
    editor: {
      create: function (dom, opts) {
        dom.style.whiteSpace = "pre";
        dom.style.fontFamily = "Consolas, monospace";
        dom.style.fontSize = "14px";
        dom.style.color = "#e5e7eb";
        dom.style.background = "#1e1e1e";
        dom.style.padding = "10px";
        dom.textContent = opts.value || "";
        return {
          getValue: () => dom.textContent,
          setValue: v => dom.textContent = v
        };
      }
    }
  };
});
