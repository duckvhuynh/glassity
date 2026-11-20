// Installed only by the benchmark page; the published library has no instrumentation.
export function installProbe(version) {
  const counts = { draws: 0, uploads: 0, captures: 0, textures: 0, contextLosses: 0, pendingCaptures: 0 };
  const liveTextures = new WeakSet();
  const capturePrototypes = new WeakSet();
  const firstDraws = new Map();
  const themeDraws = new Map();
  let themeVersions = null;
  let engine = null;
  let recording = false;
  let started = 0;
  let themeStarted = 0;
  let initialCapture = null;
  let longTasks = [];
  const rememberTasks = (entries) => {
    for (const entry of entries) longTasks.push({ startTime: entry.startTime, duration: entry.duration });
  };
  const observer = new PerformanceObserver((list) => rememberTasks(list.getEntries()));
  observer.observe({ type: 'longtask', buffered: true });

  const gl = WebGL2RenderingContext.prototype;
  const createTexture = gl.createTexture;
  gl.createTexture = function (...args) {
    const texture = createTexture.apply(this, args);
    if (texture) {
      liveTextures.add(texture);
      counts.textures++;
    }
    return texture;
  };
  const deleteTexture = gl.deleteTexture;
  gl.deleteTexture = function (texture) {
    if (texture && liveTextures.delete(texture)) counts.textures--;
    return deleteTexture.call(this, texture);
  };
  for (const name of ['texImage2D', 'texSubImage2D']) {
    const upload = gl[name];
    gl[name] = function (...args) {
      counts.uploads++;
      return upload.apply(this, args);
    };
  }

  function attach(value) {
    engine = value;
    const renderer = engine.renderer;
    if (!renderer) return;
    renderer.canvas.addEventListener('webglcontextlost', () => counts.contextLosses++);
    const draw = renderer.draw;
    renderer.draw = function (target, width, height, params) {
      const ok = draw.call(this, target, width, height, params);
      if (!ok) return ok;
      counts.draws++;
      if ((!recording && !themeVersions) || params.lens <= 0) return ok;
      const svg = target.canvas.previousElementSibling;
      const instance = svg && engine.get(svg);
      const backdrop = instance?.backdrop;
      // Version 1 is the temporary colour swatch, not the requested backdrop.
      if (!backdrop || backdrop.version < 2 || engine.backStates.get(backdrop)?.version !== backdrop.version) return ok;
      const id = Number(svg.getAttribute('data-bench-icon'));
      const now = performance.now();
      if (recording && !firstDraws.has(id)) firstDraws.set(id, now - started);
      if (themeVersions && backdrop.version > themeVersions.get(backdrop) && !themeDraws.has(id))
        themeDraws.set(id, now - themeStarted);
      return ok;
    };
    const backdropFor = engine.backdropFor;
    engine.backdropFor = function (...args) {
      const backdrop = backdropFor.apply(this, args);
      const proto = Object.getPrototypeOf(backdrop);
      if (typeof proto.capture === 'function' && !capturePrototypes.has(proto)) {
        capturePrototypes.add(proto);
        // The first constructor has already entered capture before returning here.
        if (backdrop.busy) {
          counts.captures++;
          initialCapture = new WeakRef(backdrop);
        }
        const capture = proto.capture;
        proto.capture = function (...captureArgs) {
          const started = !this.disposed && !this.busy;
          if (started) {
            counts.captures++;
            counts.pendingCaptures++;
          }
          const result = capture.apply(this, captureArgs);
          if (started) result.then(() => counts.pendingCaptures--, () => counts.pendingCaptures--);
          return result;
        };
      }
      return backdrop;
    };
  }

  const key = Symbol.for('glassity.engine@' + version);
  if (globalThis[key]) throw new Error('The benchmark must install its probe before glassity starts.');
  Object.defineProperty(globalThis, key, { configurable: true, get: () => engine, set: attach });

  const timing = (map, count) => {
    const times = [...map.values()].sort((a, b) => a - b);
    return {
      firstMs: times[0] ?? null,
      ninetyMs: times[Math.ceil(count * 0.9) - 1] ?? null,
      allMs: times.length === count ? times[times.length - 1] : null,
    };
  };
  return {
    get engine() { return engine; },
    counters: () => {
      // The first constructor's Promise is already running when it becomes observable.
      if (initialCapture && !initialCapture.deref()?.busy) initialCapture = null;
      return { ...counts, pendingCaptures: counts.pendingCaptures + (initialCapture ? 1 : 0) };
    },
    startMount() {
      firstDraws.clear();
      recording = true;
      started = performance.now();
    },
    mountTiming: (count) => timing(firstDraws, count),
    finishMount() { recording = false; },
    startTheme() {
      themeDraws.clear();
      themeVersions = new WeakMap();
      for (const instance of engine.instances.values())
        if (instance.backdrop) themeVersions.set(instance.backdrop, instance.backdrop.version);
      themeStarted = performance.now();
    },
    finishTheme(count) {
      const result = { ...timing(themeDraws, count), updatedCount: themeDraws.size };
      themeVersions = null;
      themeDraws.clear();
      return result;
    },
    drainLongTasks() {
      rememberTasks(observer.takeRecords());
      const result = longTasks;
      longTasks = [];
      return result;
    },
    pauseLongTasks() {
      rememberTasks(observer.takeRecords());
      observer.disconnect();
      const result = longTasks;
      longTasks = [];
      return result;
    },
    resumeLongTasks() {
      observer.observe({ type: 'longtask' });
    },
    clearMeasurements() {
      firstDraws.clear();
      themeDraws.clear();
      themeVersions = null;
      recording = false;
    },
  };
}
