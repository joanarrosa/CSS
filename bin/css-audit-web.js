#!/usr/bin/env node
import { startServer } from "../src/server.js";

const port = Number(process.argv[2]) || Number(process.env.PORT) || 4173;
const server = startServer(port);

process.on("SIGINT", () => {
  server.close(() => process.exit(0));
});
