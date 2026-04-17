self.onmessage = function (e) {
  postMessage({ type: "json-ack", data: e.data });
};
