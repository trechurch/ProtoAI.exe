// SDOA Version
exports.VERSION = "1.0.0";
exports.getVersion = () => exports.VERSION;

class WorkflowResult {
  constructor(status, data, error = null) {
    this.status = status;      // "ok" | "error"
    this.data = data || null;
    this.error = error;
    this.version = exports.VERSION;
  }

  static ok(data) {
    return new WorkflowResult("ok", data, null);
  }

  static error(error) {
    return new WorkflowResult("error", null, error instanceof Error ? error.message : error);
  }
}

module.exports = WorkflowResult;
