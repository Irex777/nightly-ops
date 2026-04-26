// sse.js — Server-Sent Events manager for live task streaming
//
// EXPORTS: { EventManager }
//
// INTEGRATION (in server.js):
//   const { EventManager } = require('./sse');
//   const eventManager = new EventManager();
//
//   // SSE endpoint
//   app.get('/api/tasks/events', (req, res) => eventManager.addClient(req, res));
//
//   // Pass eventManager to TaskRunner constructor
//   const runner = new TaskRunner(db, eventManager);

class EventManager {
  constructor() {
    /** @type {import('express').Response[]} */
    this.clients = [];
    this.heartbeatInterval = null;

    // Start heartbeat every 30 seconds
    this.heartbeatInterval = setInterval(() => {
      this._heartbeat();
    }, 30000);
  }

  /**
   * Add a new SSE client connection.
   * Sets proper headers and sends an initial connected event.
   * @param {import('express').Request} req
   * @param {import('express').Response} res
   */
  addClient(req, res) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no', // Disable nginx buffering
    });

    // Send initial connected event
    this._send(res, 'connected', {
      message: 'SSE connection established',
      timestamp: new Date().toISOString(),
      activeClients: this.clients.length + 1,
    });

    this.clients.push(res);
    console.log(`[sse] Client connected. Total: ${this.clients.length}`);

    // Remove client on close
    req.on('close', () => {
      this.removeClient(res);
    });
  }

  /**
   * Remove a client connection.
   * @param {import('express').Response} res
   */
  removeClient(res) {
    const idx = this.clients.indexOf(res);
    if (idx !== -1) {
      this.clients.splice(idx, 1);
      console.log(`[sse] Client disconnected. Total: ${this.clients.length}`);
    }
  }

  /**
   * Broadcast an event to all connected clients.
   * @param {string} event - Event name
   * @param {object} data - Event payload (will be JSON-stringified)
   */
  broadcast(event, data) {
    if (this.clients.length === 0) return;

    const payload = JSON.stringify({
      ...data,
      _timestamp: new Date().toISOString(),
    });

    // Iterate backwards to safely remove dead clients
    for (let i = this.clients.length - 1; i >= 0; i--) {
      const client = this.clients[i];
      try {
        this._send(client, event, payload);
      } catch (err) {
        // Client connection is dead, remove it
        console.warn(`[sse] Failed to send to client, removing: ${err.message}`);
        this.clients.splice(i, 1);
      }
    }
  }

  /**
   * Send a single SSE event to one client.
   * @param {import('express').Response} res
   * @param {string} event
   * @param {string|object} data
   */
  _send(res, event, data) {
    const body = typeof data === 'string' ? data : JSON.stringify(data);
    res.write(`event: ${event}\ndata: ${body}\n\n`);
  }

  /**
   * Send heartbeat to all clients to keep connections alive.
   */
  _heartbeat() {
    for (let i = this.clients.length - 1; i >= 0; i--) {
      try {
        this._send(this.clients[i], 'heartbeat', {
          time: new Date().toISOString(),
          clients: this.clients.length,
        });
      } catch (_err) {
        this.clients.splice(i, 1);
      }
    }
  }

  /**
   * Shut down the event manager — stop heartbeat, close all connections.
   */
  shutdown() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
    for (const client of this.clients) {
      try {
        this._send(client, 'shutdown', { message: 'Server shutting down' });
        client.end();
      } catch (_err) {
        // Already closed
      }
    }
    this.clients = [];
    console.log('[sse] EventManager shut down');
  }
}

// ─── Convenience broadcast helpers ──────────────────────────────────────────

/**
 * Broadcast a task_started event.
 * @param {EventManager} em
 * @param {{ taskId: number, repo: string, taskType: string }} params
 */
function emitTaskStarted(em, { taskId, repo, taskType }) {
  em.broadcast('task_started', { taskId, repo, taskType });
}

/**
 * Broadcast a task_progress event (streamed output lines).
 * @param {EventManager} em
 * @param {{ taskId: number, output: string }} params
 */
function emitTaskProgress(em, { taskId, output }) {
  em.broadcast('task_progress', { taskId, output });
}

/**
 * Broadcast a task_completed event.
 * @param {EventManager} em
 * @param {{ taskId: number, repo: string, taskType: string, result: string, duration: number }} params
 */
function emitTaskCompleted(em, { taskId, repo, taskType, result, duration }) {
  em.broadcast('task_completed', { taskId, repo, taskType, result, duration });
}

/**
 * Broadcast a task_failed event.
 * @param {EventManager} em
 * @param {{ taskId: number, repo: string, taskType: string, error: string }} params
 */
function emitTaskFailed(em, { taskId, repo, taskType, error }) {
  em.broadcast('task_failed', { taskId, repo, taskType, error });
}

/**
 * Broadcast a nightly_started event.
 * @param {EventManager} em
 * @param {{ taskCount: number, repos: string[] }} params
 */
function emitNightlyStarted(em, { taskCount, repos }) {
  em.broadcast('nightly_started', { taskCount, repos });
}

/**
 * Broadcast a nightly_completed event.
 * @param {EventManager} em
 * @param {{ totalTasks: number, completed: number, failed: number, duration: number }} params
 */
function emitNightlyCompleted(em, { totalTasks, completed, failed, duration }) {
  em.broadcast('nightly_completed', { totalTasks, completed, failed, duration });
}

module.exports = {
  EventManager,
  emitTaskStarted,
  emitTaskProgress,
  emitTaskCompleted,
  emitTaskFailed,
  emitNightlyStarted,
  emitNightlyCompleted,
};
