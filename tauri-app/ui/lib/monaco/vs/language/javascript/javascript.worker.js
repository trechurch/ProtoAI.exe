self.onmessage = function (e) {
  postMessage({ type: "js-ack", data: e.data });
};
