"use strict";

/**
 * Celestial supervisor
 * --------------------
 * Runs index.js as a child process and restarts it if it exits with a
 * non-zero code (e.g. the memory guard's exit(1) or a crash).
 * Exit code 0 (SIGTERM/SIGINT shutdown) stops the supervisor too.
 *
 * Use:  npm run start:safe     (or run index.js under PM2 instead)
 * On Railway the platform restart policy already does this job.
 */

const { spawn } = require("child_process");
const path = require("path");

const ENTRY = path.join(__dirname, "index.js");
const RESTART_MIN_MS = Math.max(1000, Number(process.env.SUPERVISOR_RESTART_MIN_MS || 3000));
const RESTART_MAX_MS = Math.max(RESTART_MIN_MS, Number(process.env.SUPERVISOR_RESTART_MAX_MS || 8000));
const WINDOW_MS = 10 * 60 * 1000;
const MAX_RESTARTS_IN_WINDOW = Math.max(1, Number(process.env.SUPERVISOR_MAX_RESTARTS || 10));

let child = null;
let stopping = false;
const restarts = [];

function launch() {
  child = spawn(process.execPath, [ENTRY], { stdio: "inherit", env: process.env });

  child.on("exit", (code, signal) => {
    child = null;
    if (stopping || code === 0) {
      console.log("[SUPERVISOR] bot exited cleanly, stopping");
      process.exit(0);
    }

    const now = Date.now();
    restarts.push(now);
    while (restarts.length && now - restarts[0] > WINDOW_MS) restarts.shift();

    if (restarts.length > MAX_RESTARTS_IN_WINDOW) {
      console.error(`[SUPERVISOR] ${restarts.length} crashes in 10 min, giving up (last code=${code} signal=${signal})`);
      process.exit(1);
    }

    const wait = RESTART_MIN_MS + Math.floor(Math.random() * (RESTART_MAX_MS - RESTART_MIN_MS + 1));
    console.warn(`[SUPERVISOR] bot exited (code=${code} signal=${signal}), restarting in ${Math.round(wait / 1000)}s`);
    setTimeout(launch, wait);
  });
}

for (const sig of ["SIGTERM", "SIGINT"]) {
  process.on(sig, () => {
    stopping = true;
    if (child) child.kill(sig);
    else process.exit(0);
  });
}

launch();
