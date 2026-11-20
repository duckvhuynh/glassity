import { FRAGMENT, VERTEX } from './shader';

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
  'uGlyphSize', 'uLegibilityColor', 'uLegibilityAmount',
] as const;

type UniformName = (typeof UNIFORMS)[number];

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
  lost = false;
  onrestore: (() => void) | null = null;

  static create(): Renderer | null {
    if (typeof document === 'undefined') return null;
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const gl = canvas.getContext('webgl2', {
      alpha: true,
      premultipliedAlpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      preserveDrawingBuffer: false,
    });
    if (!gl) return null;
    try {
      return new Renderer(canvas, gl);
    } catch (error) {
      console.warn('glassity: WebGL2 setup failed, falling back to plain SVG.', error);
      return null;
    }
  }

  private constructor(canvas: HTMLCanvasElement, gl: WebGL2RenderingContext) {
    this.canvas = canvas;
    this.gl = gl;
    this.init();
    canvas.addEventListener('webglcontextlost', (event) => {
      event.preventDefault();
      this.lost = true;
    });
    canvas.addEventListener('webglcontextrestored', () => {
      this.lost = false;
      this.generation++;
      this.init();
      this.onrestore?.();
    });
  }

  private init(): void {
    const gl = this.gl;
    const compile = (type: number, source: string) => {
      const shader = gl.createShader(type)!;
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error('glassity shader: ' + gl.getShaderInfoLog(shader));
      return shader;
    };
    const program = gl.createProgram()!;
    gl.attachShader(program, compile(gl.VERTEX_SHADER, VERTEX));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FRAGMENT));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error('glassity program: ' + gl.getProgramInfoLog(program));
    this.program = program;
    this.vao = gl.createVertexArray();
    for (const name of UNIFORMS) this.loc[name] = gl.getUniformLocation(program, name);
    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  }

  /** Upload a two-channel float field (signed distance, thickness). */
  createField(data: Float32Array, w: number, h: number): FieldTexture {
    const gl = this.gl;
    const texture = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG16F, w, h, 0, gl.RG, gl.FLOAT, data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return { texture, w, h, generation: this.generation };
  }

  /**
   * Upload (or refresh) a backdrop from an image, canvas or video frame.
   * Throws a SecurityError when the source is cross-origin without CORS.
   */
  uploadBack(existing: BackTexture | null, source: TexImageSource, w: number, h: number): BackTexture {
    const gl = this.gl;
    const reuse = existing && existing.generation === this.generation;
    const texture = reuse ? existing.texture : gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.generateMipmap(gl.TEXTURE_2D);
    if (!reuse) {
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    }
    return { texture, w, h, maxLod: Math.floor(Math.log2(Math.max(w, h, 1))), generation: this.generation };
  }

  release(texture: { texture: WebGLTexture; generation: number } | null): void {
    if (texture && texture.generation === this.generation && !this.lost) this.gl.deleteTexture(texture.texture);
  }

  /** Largest backdrop the GPU accepts on its longest side. */
  get maxTextureSize(): number {
    return this.lost ? 2048 : (this.gl.getParameter(this.gl.MAX_TEXTURE_SIZE) as number);
  }

  /** Draw one icon and copy it into `target`. Returns false when the context is lost. */
  draw(target: CanvasRenderingContext2D, pw: number, ph: number, p: DrawParams): boolean {
    if (this.lost || !this.program) return false;
    const gl = this.gl;
    const canvas = this.canvas;
    if (canvas.width < pw || canvas.height < ph) {
      canvas.width = Math.max(canvas.width, Math.ceil(pw / 128) * 128);
      canvas.height = Math.max(canvas.height, Math.ceil(ph / 128) * 128);
    }
    const y = canvas.height - ph;
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

    const u = this.loc;
    gl.uniform1i(u.uFieldA, 0);
    gl.uniform1i(u.uFieldB, 1);
    gl.uniform1i(u.uBack, 2);
    gl.uniform1f(u.uMorph, p.morph);
    gl.uniform2f(u.uFieldTexel, 1 / p.fieldA.w, 1 / p.fieldA.h);
    gl.uniform4f(u.uBackRect, p.backRect[0], p.backRect[1], p.backRect[2], p.backRect[3]);
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

    target.clearRect(0, 0, pw, ph);
    target.drawImage(canvas, 0, 0, pw, ph, 0, 0, pw, ph);
    return true;
  }
}
