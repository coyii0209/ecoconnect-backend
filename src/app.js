const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const createLogger = require("./utils/logger");

const healthRoutes = require("./api/routes/health.routes");
const detectionRoutes = require("./api/routes/detection.routes");
const processRoutes = require("./api/routes/process.routes");
const sessionRoutes = require("./api/routes/session.routes");

function resolveRouter(routeModule) {
	return routeModule && routeModule.default ? routeModule.default : routeModule;
}

const app = express();
const httpLog = createLogger("HTTP");

if (process.env.TRUST_PROXY === "1") {
	app.set("trust proxy", true);
}

// Middleware
app.use(cors());
app.use(helmet());
app.use(express.json());
if (createLogger.isEnabled) {
	app.use(morgan("tiny", {
		stream: {
			write(line) {
				const trimmed = String(line || "").trim();
				if (trimmed) {
					httpLog.info("request", { line: trimmed });
				}
			}
		}
	}));
}

// Routes
app.use("/api/health", resolveRouter(healthRoutes));
app.use("/api/detection", resolveRouter(detectionRoutes));
app.use("/api/process", resolveRouter(processRoutes));
app.use("/api/session", resolveRouter(sessionRoutes));

module.exports = app;