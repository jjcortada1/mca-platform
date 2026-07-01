#!/usr/bin/env node

/**
 * Auto-redeploy script for Replit
 * Polls git every 30 seconds and restarts dev server if changes detected
 *
 * Run with: node scripts/auto-redeploy.js
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const LOCK_FILE = '/tmp/replit-redeploy.lock';
const POLL_INTERVAL = 30000; // 30 seconds
let lastCommit = null;
let isRestarting = false;

function log(msg) {
  console.log(`[${new Date().toLocaleTimeString()}] ${msg}`);
}

function getCurrentCommit() {
  try {
    return execSync('git rev-parse HEAD').toString().trim();
  } catch {
    return null;
  }
}

function pullLatest() {
  try {
    log('Pulling latest code from main...');
    execSync('git fetch origin main', { stdio: 'inherit' });
    execSync('git reset --hard origin/main', { stdio: 'inherit' });
    return true;
  } catch (err) {
    log('Git pull failed (this is ok if sandbox is blocking)');
    return false;
  }
}

function restartDevServer() {
  if (isRestarting) {
    log('Restart already in progress, skipping...');
    return;
  }

  isRestarting = true;
  try {
    log('🔄 Restarting dev server...');
    fs.writeFileSync(LOCK_FILE, Date.now().toString());

    // Kill existing dev server
    try {
      execSync('pkill -f "npm run dev"', { stdio: 'ignore' });
    } catch {}

    // Wait a moment for cleanup
    require('child_process').spawnSync('sleep', ['2']);

    // Restart dev server in background
    require('child_process').spawn('bash', ['-c', 'npm run setup && npm run dev'], {
      detached: true,
      stdio: 'ignore'
    }).unref();

    log('✅ Dev server restart initiated');
  } catch (err) {
    log('Error restarting dev server:', err.message);
  } finally {
    isRestarting = false;
  }
}

function checkForChanges() {
  const currentCommit = getCurrentCommit();

  if (!currentCommit) {
    log('Could not get current commit');
    return;
  }

  if (lastCommit === null) {
    lastCommit = currentCommit;
    log(`Started monitoring. Current commit: ${currentCommit.slice(0, 8)}`);
    return;
  }

  if (currentCommit !== lastCommit) {
    log(`📦 New commits detected! (${lastCommit.slice(0, 8)} → ${currentCommit.slice(0, 8)})`);
    lastCommit = currentCommit;
    pullLatest();
    setTimeout(restartDevServer, 1000);
  }
}

log('🚀 Auto-redeploy monitor started (polling every 30s)');
log('Changes to main branch will trigger automatic redeploy');

setInterval(checkForChanges, POLL_INTERVAL);
checkForChanges(); // Check immediately on start
