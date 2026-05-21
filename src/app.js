const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");

const healthRoutes = require("./api/routes/health.routes");
const detectionRoutes = require("./api/routes/detection.routes");

const app = express();

app.use(cors());
app.use(helmet());
app.use(express.json());
app.use(morgan("dev"));

// Routes
app.use("/api/health", healthRoutes);
app.use("/api/detection", detectionRoutes);

module.exports = app;