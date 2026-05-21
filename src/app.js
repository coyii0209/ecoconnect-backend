const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");

const healthRoutes = require("./api/routes/health.routes");
const detectionRoutes = require("./api/routes/detection.routes");
const sessionRoutes = require("./api/routes/session.routes");

function resolveRouter(routeModule) {
	return routeModule && routeModule.default ? routeModule.default : routeModule;
}

const app = express();

// Middleware
app.use(cors());
app.use(helmet());
app.use(express.json());
app.use(morgan("dev"));

// Routes
app.use("/api/health", resolveRouter(healthRoutes));
app.use("/api/detection", resolveRouter(detectionRoutes));
app.use("/api/session", resolveRouter(sessionRoutes));

module.exports = app;