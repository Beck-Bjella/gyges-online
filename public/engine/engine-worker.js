/**
 * The Gygès engine, running in the player's browser.
 *
 * This worker hosts `gyges_engine.wasm` — the real engine, compiled to
 * wasm32-wasip1 — and talks to it over its ordinary UGI protocol on stdin and
 * stdout. It is the same interface the desktop binary exposes; nothing about
 * the engine's behaviour is special-cased for the web.
 *
 * ## Why a worker
 *
 * A search takes seconds and is a tight CPU loop. On the main thread that
 * freezes the page — no scrolling, no clicking, nothing — for its whole
 * duration. Here it runs alongside a responsive UI.
 *
 * ## Why WASI
 *
 * The engine reads commands from stdin and writes results to stdout. WASI is
 * what gives a wasm module those, so the engine keeps its real interface
 * instead of needing a bespoke entry point. The module imports exactly eight
 * WASI functions and no filesystem at all — the evaluation network is compiled
 * into the binary — so the shim below is the whole host, with no dependency.
 *
 * ## One instance per search
 *
 * `_start` runs the UGI loop until stdin is exhausted, so a search means a
 * fresh instance. That costs re-parsing the network each time, but buys
 * something worth more: every search begins with an empty transposition table,
 * so the same position and node budget always produce the same move. The
 * compiled module is cached, so only instantiation repeats, not compilation.
 */

const WASM_URL = "/engine/gyges_engine.wasm";

/** WASI errno. Only success and "bad file descriptor" are ever returned. */
const ERRNO_SUCCESS = 0;
const ERRNO_BADF = 8;

/** Thrown by proc_exit to unwind out of the module. Not an error. */
class ProcExit extends Error {
  constructor(code) {
    super(`exit ${code}`);
    this.code = code;
  }
}

/**
 * A minimal WASI preview1 host.
 *
 * Implements only what `WebAssembly.Module.imports()` says the engine needs:
 * stdin, stdout/stderr, a clock, randomness, an empty environment, yield and
 * exit. Anything the engine does not import is deliberately absent rather than
 * stubbed, so a future build that starts needing more fails loudly here rather
 * than misbehaving quietly.
 */
function createWasi(stdinBytes, onStdout) {
  let memory = null;
  let stdinPos = 0;

  const view = () => new DataView(memory.buffer);
  const bytes = () => new Uint8Array(memory.buffer);

  /** Walk a WASI iovec array, calling fn(chunk) for each buffer. */
  const eachIovec = (iovsPtr, iovsLen, fn) => {
    const dv = view();
    let total = 0;
    for (let i = 0; i < iovsLen; i++) {
      const base = iovsPtr + i * 8;
      const ptr = dv.getUint32(base, true);
      const len = dv.getUint32(base + 4, true);
      total += fn(ptr, len);
    }
    return total;
  };

  return {
    setMemory: (m) => {
      memory = m;
    },
    imports: {
      /** stdin (fd 0). Returns 0 bytes at the end, which ends the UGI loop. */
      fd_read(fd, iovsPtr, iovsLen, nreadPtr) {
        if (fd !== 0) return ERRNO_BADF;
        const mem = bytes();
        const read = eachIovec(iovsPtr, iovsLen, (ptr, len) => {
          const n = Math.min(len, stdinBytes.length - stdinPos);
          if (n <= 0) return 0;
          mem.set(stdinBytes.subarray(stdinPos, stdinPos + n), ptr);
          stdinPos += n;
          return n;
        });
        view().setUint32(nreadPtr, read, true);
        return ERRNO_SUCCESS;
      },

      /** stdout (1) and stderr (2). Both are forwarded as text. */
      fd_write(fd, iovsPtr, iovsLen, nwrittenPtr) {
        if (fd !== 1 && fd !== 2) return ERRNO_BADF;
        const mem = bytes();
        const decoder = new TextDecoder();
        const written = eachIovec(iovsPtr, iovsLen, (ptr, len) => {
          if (len > 0) onStdout(decoder.decode(mem.subarray(ptr, ptr + len)));
          return len;
        });
        view().setUint32(nwrittenPtr, written, true);
        return ERRNO_SUCCESS;
      },

      /**
       * The clock, in nanoseconds.
       *
       * The engine uses this for elapsed-time reporting and for its `maxTime`
       * option. Bots are bounded by node count rather than time, so this only
       * affects what the engine says about itself — but it must be monotonic
       * and real, or the reported timings would be nonsense.
       */
      clock_time_get(_id, _precision, timePtr) {
        const ns = BigInt(Math.round(performance.now() * 1e6));
        view().setBigUint64(timePtr, ns, true);
        return ERRNO_SUCCESS;
      },

      random_get(bufPtr, len) {
        crypto.getRandomValues(bytes().subarray(bufPtr, bufPtr + len));
        return ERRNO_SUCCESS;
      },

      environ_sizes_get(countPtr, sizePtr) {
        const dv = view();
        dv.setUint32(countPtr, 0, true);
        dv.setUint32(sizePtr, 0, true);
        return ERRNO_SUCCESS;
      },

      environ_get() {
        return ERRNO_SUCCESS;
      },

      sched_yield() {
        return ERRNO_SUCCESS;
      },

      proc_exit(code) {
        throw new ProcExit(code);
      },
    },
  };
}

/** The compiled module, kept so only instantiation repeats between searches. */
let modulePromise = null;

function loadModule() {
  if (!modulePromise) {
    modulePromise = WebAssembly.compileStreaming
      ? WebAssembly.compileStreaming(fetch(WASM_URL))
      : fetch(WASM_URL)
          .then((r) => r.arrayBuffer())
          .then((b) => WebAssembly.compile(b));
  }
  return modulePromise;
}

/**
 * Run one search and return what the engine said.
 *
 * `options` are UGI option names and values, applied verbatim — the site does
 * not interpret them, so a future engine option needs no change here.
 */
async function search(board, options) {
  const lines = ["ugi", "isready"];
  for (const [name, value] of Object.entries(options ?? {})) {
    lines.push(`setoption ${name} ${value}`);
  }
  lines.push(`setpos data ${board}`, "go", "quit", "");

  const stdin = new TextEncoder().encode(lines.join("\n"));

  let out = "";
  const wasi = createWasi(stdin, (chunk) => {
    out += chunk;
  });

  const module = await loadModule();
  const instance = await WebAssembly.instantiate(module, {
    wasi_snapshot_preview1: wasi.imports,
  });
  wasi.setMemory(instance.exports.memory);

  try {
    instance.exports._start();
  } catch (err) {
    // proc_exit is the ordinary way a WASI program ends; anything else is real.
    if (!(err instanceof ProcExit)) throw err;
  }

  // "bestmove 3|21|23 score 1938.078 time 2.523", or "bestmove null ..." for a
  // position the engine considers drawn.
  const match = out.match(/^bestmove (\S+) score (\S+) time (\S+)/m);
  if (!match) {
    throw new Error(`engine produced no bestmove. Output:\n${out.slice(-400)}`);
  }

  return {
    move: match[1] === "null" ? null : match[1],
    score: Number(match[2]),
    seconds: Number(match[3]),
    output: out,
  };
}

self.onmessage = async (event) => {
  const { id, board, options } = event.data;
  try {
    const result = await search(board, options);
    self.postMessage({ id, ok: true, ...result });
  } catch (err) {
    self.postMessage({ id, ok: false, error: String(err && err.message) || "engine failed" });
  }
};
