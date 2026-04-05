self.onmessage = function (e) {
  postMessage({ type: "md-ack", data: e.data });
};
