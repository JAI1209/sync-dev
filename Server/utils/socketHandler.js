function socketHandler(io, socket, fn) {
  return async (data) => {
    try {
      await fn(io, socket, data);
    } catch (err) {
      console.error("[Socket] Unhandled error in handler:", err.message);
      socket.emit("operation-error", { msg: "An unexpected error occurred" });
    }
  };
}

module.exports = socketHandler;
