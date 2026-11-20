import { FRAGMENT, VERTEX } from './shader';
import { prepareProgram } from './program';
import type { GlassEnvironment } from '../options';
import { LayerCompositor, type LayerTarget } from './layer-compositor';

export interface FieldTexture {
  texture: WebGLTexture;
  w: number;
  h: number;
  generation: number;
}

export interface BackTexture {
  texture: WebGLTexture;
  w: number;
  h: number;
  maxLod: number;
  generation: number;
}

/** Everything the shader needs for one icon. Lengths in CSS px. */
export interface DrawParams {
  fieldA: FieldTexture;
  fieldB: FieldTexture;
  morph: number;
  back: BackTexture;
  backRect: [number, number, number, number];
  backDensity: number;
  /** Surface pixels map through the host's CSS transforms into viewport space. */
  backMap?: { basis: [number, number, number, number]; offset: [number, number] };
  surface?: number;
  canvas: [number, number];
  box: [number, number];
  unit: number;
  glyphSize: number;
  dpr: number;
  profile: number;
  bevel: number;
  curvature: number;
  depth: number;
  ior: number;
  refraction: number;
  dispersion: number;
  bands: number;
  frost: number;
  saturation: number;
  brightness: number;
  contrast: number;
  tint: [number, number, number];
  tintAuto: number;
  legibilityColor: readonly [number, number, number];
  legibilityAmount: number;
  tintOpacity: number;
  dim: number;
  opacity: number;
  shine: number;
  rim: number;
  reflection: number;
  environment: GlassEnvironment;
  shadow: number;
  light: [number, number];
  scheme: number;
  lens: number;
  touch: [number, number, number];
  tile: number;
  tileRadius: number;
  tileBevel: number;
  weight: number;
  glyphOpacity: number;
  highContrast: number;
  seed: number;
}

const UNIFORMS = [
  'uFieldA', 'uFieldB', 'uMorph', 'uFieldTexel', 'uBack', 'uBackRect', 'uBackDensity', 'uBackMaxLod',
  'uCanvas', 'uBox', 'uUnit', 'uDpr', 'uProfile', 'uBevel', 'uCurv', 'uDepth', 'uIor', 'uRefr', 'uDisp',
  'uBands', 'uFrost', 'uSat', 'uBright', 'uContrast', 'uTint', 'uTintAuto', 'uTintOpacity', 'uDim',
  'uOpacity', 'uShine', 'uRim', 'uRefl', 'uShadow', 'uLight', 'uScheme', 'uLens', 'uTouch', 'uTile',
  'uTileRadius', 'uTileBevel', 'uGlyphOpacity', 'uHighContrast', 'uSeed', 'uWeight',
  'uGlyphSize', 'uLegibilityColor', 'uLegibilityAmount', 'uEnvironment',
  'uSurface', 'uBackBasis', 'uBackOffset',
  'uLayers', 'uHasLayers', 'uLayersMaxLod', 'uLayersDensity',
] as const;

type UniformName = (typeof UNIFORMS)[number];

type RendererState = 'ready' | 'lost' | 'restoring' | 'failed';

/**
 * The single WebGL2 context shared by every icon on the page. Each icon is
 * drawn into a corner of this off-screen canvas and copied to its own 2D
 * canvas, so icons keep their place in the page's stacking order and the
 * browser's limit on live WebGL contexts is never an issue.
 */
export class Renderer {
  readonly canvas: HTMLCanvasElement;
  private gl: WebGL2RenderingContext;
  private program: WebGLProgram | null = null;
  private vao: WebGLVertexArrayObject | null = null;
  private loc = {} as Record<UniformName, WebGLUniformLocation | null>;
  /** Bumped when the context is restored: textures from older generations are gone. */
  generation = 1;
  private status: RendererState = 'restoring';
  private cancelInit: (() => void) | null = null;
  private textures = new Map<WebGLTexture, number>();
  private bytes = 0;
  private textureLimit = 2048;
  private staging: HTMLCanvasElement | null = null;
  private layers: LayerCompositor | null = null;
  onstatechange: (() => void) | null = null;
  onrestore: (() => void) | null = null;

  get state(): RendererState {
    return this.status;
  }

  get ready(): boolean {
    if (this.status === 'ready' && this.gl.isContextLost()) this.contextLost();
    return this.status === 'ready';
  }

  /** Allocated texture storage, including mip levels, but not driver overhead. */
  get textureBytes(): number {
    return this.bytes;
  }

  static create(): Renderer | null {
    if (typeof document === 'undefined') return null;
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    try {
      const gl = canvas.getContext('webgl2', {
        alpha: true,
        premultipliedAlpha: true,
        antialias: false,
        depth: false,
        stencil: false,
        preserveDrawingBuffer: false,
      });
      if (!gl) return null;
      return new Renderer(canvas, gl);
    } catch (error) {
      console.warn('glassity: WebGL2 setup failed, falling back to plain SVG.', error);
      return null;
    }
  }

  private constructor(canvas: HTMLCanvasElement, gl: WebGL2RenderingContext) {
    this.canvas = canvas;
    this.gl = gl;
    try {
      this.init();
    } catch (error) {
      this.disposeGpu();
      throw error;
    }
    canvas.addEventListener('webglcontextlost', (event) => {
      event.preventDefault();
      this.contextLost();
    });
    canvas.addEventListener('webglcontextrestored', () => {
      if (this.status !== 'lost') return;
      this.setState('restoring');
      this.generation++;
      try {
        this.init(true);
      } catch (error) {
        this.fail(error);
      }
    });
  }

  /** When draw() last asked for GL errors; -Infinity checks the next draw. */
  private lastDrawCheck = -Infinity;
  private drawCheckTimer: ReturnType<typeof setTimeout> | 0 = 0;

  private setState(state: RendererState): void {
    this.status = state;
    this.onstatechange?.();
  }

  private contextLost(): void {
    if (this.status === 'lost') return;
    this.lastDrawCheck = -Infinity; // check the first draw of the next context
    this.cancelInit?.();
    this.cancelInit = null;
    // The browser already freed these objects. Never delete them in a new context.
    this.textures.clear();
    this.bytes = 0;
    this.layers = null;
    this.program = this.vao = null;
    this.staging = null;
    this.setState('lost');
  }

  /** A failed recovery must put every original SVG back, including offscreen icons. */
  fail(error: unknown): void {
    if (this.gl.isContextLost()) {
      this.contextLost();
      return;
    }
    this.disposeGpu();
    this.setState('failed');
    console.warn('glassity: WebGL2 recovery failed, falling back to plain SVG.', error);
  }

  private disposeGpu(): void {
    this.cancelInit?.();
    this.cancelInit = null;
    this.releaseLayers();
    for (const texture of this.textures.keys()) this.gl.deleteTexture(texture);
    this.textures.clear();
    this.bytes = 0;
    if (this.program) this.gl.deleteProgram(this.program);
    if (this.vao) this.gl.deleteVertexArray(this.vao);
    this.program = this.vao = null;
    this.staging = null;
  }

  private init(restoring = false): void {
    const gl = this.gl;
    this.cancelInit = prepareProgram(gl, VERTEX, FRAGMENT, (program) => {
      this.cancelInit = null;
      this.program = program;
      this.vao = gl.createVertexArray();
      if (!this.vao) throw new Error('glassity: could not allocate vertex array');
      for (const name of UNIFORMS) this.loc[name] = gl.getUniformLocation(program, name);
      gl.disable(gl.BLEND);
      gl.disable(gl.DEPTH_TEST);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      this.textureLimit = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
      this.checkError();
      this.setState('ready');
      if (restoring) this.onrestore?.();
    }, (error) => this.fail(error));
  }

  private checkError(): void {
    if (this.gl.isContextLost()) {
      this.contextLost();
      throw new Error('glassity: WebGL2 context lost');
    }
    const error = this.gl.getError();
    if (error !== this.gl.NO_ERROR) throw new Error('glassity: WebGL2 error ' + error);
  }

  private allocate(): WebGLTexture {
    if (!this.ready) throw new Error('glassity: WebGL2 is unavailable');
    const texture = this.gl.createTexture();
    if (!texture) {
      this.checkError();
      throw new Error('glassity: could not allocate texture');
    }
    this.textures.set(texture, 0);
    return texture;
  }

  private account(texture: WebGLTexture, bytes: number): void {
    this.textures.set(texture, bytes);
    this.bytes += bytes;
  }

  /** Upload a two-channel float field (signed distance, thickness). */
  createField(data: Float32Array, w: number, h: number): FieldTexture {
    const gl = this.gl;
    const texture = this.allocate();
    try {
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG16F, w, h, 0, gl.RG, gl.FLOAT, data);
      this.checkError();
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      this.checkError();
      this.account(texture, w * h * 4); // RG16F: two half floats per pixel.
      return { texture, w, h, generation: this.generation };
    } catch (error) {
      this.release({ texture, generation: this.generation });
      throw error;
    }
  }

  /**
   * Upload (or refresh) a backdrop from an image, canvas or video frame.
   * Throws a SecurityError when the source is cross-origin without CORS.
   */
  uploadBack(existing: BackTexture | null, source: TexImageSource, w: number, h: number): BackTexture {
    const gl = this.gl;
    if (!this.ready) throw new Error('glassity: WebGL2 is unavailable');
    if (!(w > 0 && h > 0 && Number.isFinite(w) && Number.isFinite(h))) throw new Error('glassity: empty backdrop');
    // Use the snapshot budget for direct media too, even on GPUs with huge limits.
    const scale = Math.min(1, Math.min(this.textureLimit, 2560) / Math.max(w, h));
    if (scale < 1) {
      w = Math.max(1, Math.floor(w * scale));
      h = Math.max(1, Math.floor(h * scale));
      const canvas = (this.staging ??= document.createElement('canvas'));
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('glassity: could not resize backdrop');
      ctx.drawImage(source as CanvasImageSource, 0, 0, w, h);
      source = canvas;
    }
    const texture = this.allocate();
    try {
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
      this.checkError();
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      this.checkError();
      let bytes = 0;
      for (let mw = w, mh = h;; mw = Math.max(1, Math.floor(mw / 2)), mh = Math.max(1, Math.floor(mh / 2))) {
        bytes += mw * mh * 4;
        if (mw === 1 && mh === 1) break;
      }
      this.account(texture, bytes);
      this.release(existing);
      return { texture, w, h, maxLod: Math.floor(Math.log2(Math.max(w, h, 1))), generation: this.generation };
    } catch (error) {
      this.release({ texture, generation: this.generation });
      throw error;
    }
  }

  release(texture: { texture: WebGLTexture; generation: number } | null): void {
    if (!texture || texture.generation !== this.generation || !this.textures.has(texture.texture)) return;
    this.bytes -= this.textures.get(texture.texture)!;
    this.textures.delete(texture.texture);
    if (!this.gl.isContextLost()) this.gl.deleteTexture(texture.texture);
  }

  /** Largest backdrop the GPU accepts on its longest side. */
  get maxTextureSize(): number {
    return this.textureLimit;
  }

  /** Release shared intermediate targets after the last icon is removed. */
  releaseLayers(): void {
    this.layers?.dispose();
    this.layers = null;
  }

  /** Draw one icon and copy it into `target`. Returns false when the context is lost. */
  draw(target: CanvasRenderingContext2D, pw: number, ph: number, p: DrawParams): boolean {
    if (!this.drawPass(pw, ph, p)) return false;
    target.clearRect(0, 0, pw, ph);
    target.drawImage(this.canvas, 0, 0, pw, ph, 0, 0, pw, ph);
    return true;
  }

  /** Each upper surface samples the accumulated lower glass before it is composited. */
  drawLayers(target: CanvasRenderingContext2D, pw: number, ph: number, params: readonly DrawParams[]): boolean {
    if (!this.ready || !params.length) return false;
    if (params.length === 1) return this.draw(target, pw, ph, params[0]);
    if (params.slice(0, 4).some((p) => [p.fieldA, p.fieldB, p.back].some((t) => t.generation !== this.generation || !this.textures.has(t.texture)))) return false;
    if (!this.layers) this.layers = new LayerCompositor(this.gl, {
      generation: this.generation,
      allocate: () => this.allocate(),
      account: (texture, bytes) => this.account(texture, bytes),
      release: (texture) => this.release(texture),
      checkError: () => this.checkError(),
    });
    const gl = this.gl;
    const targets = this.layers.ensure(pw, ph, this.textureLimit);
    let lower: LayerTarget | null = null;
    const count = Math.min(params.length, 4);
    try {
      for (let i = 0; i < count; i++) {
        const destination = i === count - 1 ? null : targets[i % 2];
        const p = params[i];
        const width = destination?.w ?? pw;
        const height = destination?.h ?? ph;
        const pass = destination ? { ...p, dpr: Math.min(width / p.canvas[0], height / p.canvas[1]) } : p;
        if (!this.drawPass(width, height, pass, destination, lower)) return false;
        if (destination) {
          gl.bindTexture(gl.TEXTURE_2D, destination.texture);
          gl.generateMipmap(gl.TEXTURE_2D);
          this.checkError();
        }
        lower = destination;
      }
      target.clearRect(0, 0, pw, ph);
      target.drawImage(this.canvas, 0, 0, pw, ph, 0, 0, pw, ph);
      return true;
    } finally {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }
  }

  private drawPass(pw: number, ph: number, p: DrawParams, destination: LayerTarget | null = null, lower: LayerTarget | null = null): boolean {
    if (!this.ready || !this.program) return false;
    if ([p.fieldA, p.fieldB, p.back].some((t) => t.generation !== this.generation || !this.textures.has(t.texture))) return false;
    const gl = this.gl;
    const canvas = this.canvas;
    if (!destination && (canvas.width < pw || canvas.height < ph)) {
      canvas.width = Math.max(canvas.width, Math.ceil(pw / 128) * 128);
      canvas.height = Math.max(canvas.height, Math.ceil(ph / 128) * 128);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, destination?.framebuffer ?? null);
    const y = destination ? 0 : canvas.height - ph;
    gl.viewport(0, y, pw, ph);
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(0, y, pw, ph);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, p.fieldA.texture);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, p.fieldB.texture);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, p.back.texture);
    gl.activeTexture(gl.TEXTURE0 + 3);
    gl.bindTexture(gl.TEXTURE_2D, lower?.texture ?? p.back.texture);

    const u = this.loc;
    gl.uniform1i(u.uLayers, 3);
    gl.uniform1i(u.uHasLayers, lower ? 1 : 0);
    gl.uniform1f(u.uLayersMaxLod, lower?.maxLod ?? 0);
    gl.uniform1f(u.uLayersDensity, lower ? Math.max(lower.w / p.canvas[0], lower.h / p.canvas[1]) : 1);
    gl.uniform1i(u.uFieldA, 0);
    gl.uniform1i(u.uFieldB, 1);
    gl.uniform1i(u.uBack, 2);
    gl.uniform1f(u.uMorph, p.morph);
    gl.uniform2f(u.uFieldTexel, 1 / p.fieldA.w, 1 / p.fieldA.h);
    gl.uniform4f(u.uBackRect, p.backRect[0], p.backRect[1], p.backRect[2], p.backRect[3]);
    const basis = p.backMap?.basis ?? [1, 0, 0, 1];
    const offset = p.backMap?.offset ?? [0, 0];
    gl.uniform4f(u.uBackBasis, basis[0], basis[1], basis[2], basis[3]);
    gl.uniform2f(u.uBackOffset, offset[0], offset[1]);
    gl.uniform1f(u.uSurface, p.surface ?? 0);
    gl.uniform1f(u.uBackDensity, p.backDensity);
    gl.uniform1f(u.uBackMaxLod, p.back.maxLod);
    gl.uniform2f(u.uCanvas, p.canvas[0], p.canvas[1]);
    gl.uniform2f(u.uBox, p.box[0], p.box[1]);
    gl.uniform1f(u.uUnit, p.unit);
    gl.uniform1f(u.uGlyphSize, p.glyphSize);
    gl.uniform1f(u.uDpr, p.dpr);
    gl.uniform1i(u.uProfile, p.profile);
    gl.uniform1f(u.uBevel, p.bevel);
    gl.uniform1f(u.uCurv, p.curvature);
    gl.uniform1f(u.uDepth, p.depth);
    gl.uniform1f(u.uIor, p.ior);
    gl.uniform1f(u.uRefr, p.refraction);
    gl.uniform1f(u.uDisp, p.dispersion);
    gl.uniform1i(u.uBands, p.bands);
    gl.uniform1f(u.uFrost, p.frost);
    gl.uniform1f(u.uSat, p.saturation);
    gl.uniform1f(u.uBright, p.brightness);
    gl.uniform1f(u.uContrast, p.contrast);
    gl.uniform3f(u.uTint, p.tint[0], p.tint[1], p.tint[2]);
    gl.uniform1f(u.uTintAuto, p.tintAuto);
    gl.uniform3f(u.uLegibilityColor, p.legibilityColor[0], p.legibilityColor[1], p.legibilityColor[2]);
    gl.uniform1f(u.uLegibilityAmount, p.legibilityAmount);
    gl.uniform1f(u.uTintOpacity, p.tintOpacity);
    gl.uniform1f(u.uDim, p.dim);
    gl.uniform1f(u.uOpacity, p.opacity);
    gl.uniform1f(u.uShine, p.shine);
    gl.uniform1f(u.uRim, p.rim);
    gl.uniform1f(u.uRefl, p.reflection);
    gl.uniform1i(u.uEnvironment, p.environment === 'none' ? 0 : p.environment === 'studio' ? 2 : 1);
    gl.uniform1f(u.uShadow, p.shadow);
    gl.uniform2f(u.uLight, p.light[0], p.light[1]);
    gl.uniform1f(u.uScheme, p.scheme);
    gl.uniform1f(u.uLens, p.lens);
    gl.uniform3f(u.uTouch, p.touch[0], p.touch[1], p.touch[2]);
    gl.uniform1f(u.uTile, p.tile);
    gl.uniform1f(u.uTileRadius, p.tileRadius);
    gl.uniform1f(u.uTileBevel, p.tileBevel);
    gl.uniform1f(u.uWeight, p.weight);
    gl.uniform1f(u.uGlyphOpacity, p.glyphOpacity);
    gl.uniform1f(u.uHighContrast, p.highContrast);
    gl.uniform1f(u.uSeed, p.seed);

    gl.drawArrays(gl.TRIANGLES, 0, 3);

    if (!this.ready) return false;
    // getError() makes the CPU wait for the GPU. After every icon, every frame, that cost
    // most of a scrolling frame; a draw error (a broken driver, an invalid state) is still
    // caught on the first draw and within a second after that. Uploads check every time.
    const now = performance.now();
    if (now - this.lastDrawCheck >= 1000) {
      this.lastDrawCheck = now;
      this.checkError();
    } else if (gl.isContextLost()) {
      this.contextLost();
      return false;
    } else if (!this.drawCheckTimer) {
      // A settled page stops drawing, so check once more when the second is up.
      this.drawCheckTimer = setTimeout(() => {
        this.drawCheckTimer = 0;
        if (!this.ready) return;
        this.lastDrawCheck = performance.now();
        try {
          this.checkError();
        } catch (error) {
          if (this.ready) this.fail(error);
        }
      }, 1000 - (now - this.lastDrawCheck));
    }

    return true;
  }
}
