self.onmessage = function (e) {
  // Minimal worker stub
  postMessage({ type: "ready" });
};
