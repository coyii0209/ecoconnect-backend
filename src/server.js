require("dotenv").config();
const app = require("./app");
const http = require("http");
const { Server } = require("socket.io");
const { setProcessStateEmitter, getProcessState } = require("./services/process.service");

const PORT = process.env.PORT || 3000;
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*"
  }
});

setProcessStateEmitter((payload) => {
  io.emit("process:status", payload);
});

io.on("connection", (socket) => {
  socket.emit("process:status", {
    reason: "INITIAL_SYNC",
    state: getProcessState()
  });
});

server.listen(PORT, () => {
  console.log("EcoConnect backend running on port", PORT);
});
console.log("SERVER.JS RUNNING");