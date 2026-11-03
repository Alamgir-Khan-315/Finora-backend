import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import mongoose from "mongoose";
import api from "./routes/api.js";

const app = express();
app.disable("x-powered-by");
app.use(helmet());

// CLIENT_ORIGIN can hold several addresses separated by commas, e.g.
// "http://localhost:5173,https://finora-frontend.vercel.app"
const origins = (process.env.CLIENT_ORIGIN || "http://localhost:5173" || "https://finorafrontend.vercel.app").split(",").map(x => x.trim().replace(/\/$/, ""));
app.use(cors({ origin: (origin, cb) => (!origin || origins.includes("*") || origins.includes(origin)) ? cb(null, true) : cb(new Error("Origin not allowed by CORS")) }));
app.use(express.json({ limit: "1mb" }));
app.use(morgan("tiny"));
app.locals.dbReady = false;

// --- MongoDB connection that works both locally and on Vercel (serverless) ---
// A serverless function must not exit or wait forever when the database is down,
// so the connection is opened on demand, reused between requests, and failures return a 503.
let connecting = null;
async function connectDb() {
  if (mongoose.connection.readyState === 1) return;
  if (!process.env.MONGODB_URI) throw new Error("MONGODB_URI is not set. Add it in Vercel > Settings > Environment Variables.");
  connecting ??= mongoose.connect(process.env.MONGODB_URI, {
    dbName: process.env.MONGODB_DB || "finora_finance",
    serverSelectionTimeoutMS: 8000,
    bufferCommands: false
  }).catch(err => { connecting = null; throw err; });
  await connecting;
}
app.use("/api", async (req, res, next) => {
  try { await connectDb(); app.locals.dbReady = true; }
  catch (err) {
    app.locals.dbReady = false;
    console.error("MongoDB connection failed:", err.message); // visible in Vercel > Logs
    if (req.path !== "/health") return res.status(503).json({ message: "Database is not reachable. Check MONGODB_URI and the Atlas Network Access list." });
  }
  next();
});

app.get("/", (req, res) => res.json({ ok: true, service: "Finora API", docs: "Try /api/health and /api/sales" }));
app.use("/api", api);
app.use((err, req, res, next) => {
  console.error(err.message);
  if (err.code === 11000) return res.status(409).json({ message: "A record with this reference already exists." });
  res.status(err.status || 500).json({ message: process.env.NODE_ENV === "production" ? "Internal server error" : err.message || "Unexpected server error" });
});

// Only start a listener on your own computer. Vercel runs the exported app itself.
if (!process.env.VERCEL) {
  const port = Number(process.env.PORT) || 5000;
  app.listen(port, () => console.log(`Finora API listening on http://localhost:${port}`));
}

export default app;
