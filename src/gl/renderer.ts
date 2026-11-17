import { COMPOSE, FRAGMENT, VERTEX, VERTEX_TARGET } from './shader';

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

/** A float texture a group's shapes are composed into, plus the framebuffer to draw there. */
export interface FieldTarget extends FieldTexture {
  framebuffer: WebGLFramebuffer;
}

/** One shape added to a group field. Lengths in CSS px, relative to the group canvas. */
export interface ComposeItem {
  /** 0 rounded box into the body, 1 icon field into the body, 2 icon field into the marks. */
  kind: 0 | 1 | 2;
  /** Centre x, centre y, half width, half height. */
  rect: [number, number, number, number];
  radius: number;
  thick: number;
  fieldA: FieldTexture | null;
  fieldB: FieldTexture | null;
  morph: number;
  /** Where the icon's field texture sits: x, y, w, h. */
  fieldRect: [number, number, number, number];
  unit: number;
  /** Smoothing length of the union this shape joins. */
  k: number;
  /** Grow (positive) or shrink (negative) the shape all round. */
  grow: number;
  scale: number;
}

/** Everything the shader needs for one icon or one group. Lengths in CSS px. */
export interface DrawParams {
  /** 0 the icon is the body, 1 a plate is the body and the icon a mark, 2 a composed group field. */
  source: 0 | 1 | 2;
  marks: number;
  fieldA: FieldTexture;
  fieldB: FieldTexture;
  morph: number;
  k: number;
  k2: number;
  back: BackTexture;
  backRect: [number, number, number, number];
  backDensity: number;
  canvas: [number, number];
  box: [number, number];
  unit: number;
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
  tileRadius: number;
  tileBevel: number;
  glyphOpacity: number;
  highContrast: number;
  seed: number;
}

const UNIFORMS = [
  'uSource', 'uMarks', 'uFieldA', 'uFieldB', 'uMorph', 'uFieldTexel', 'uK', 'uK2', 'uBack', 'uBackRect', 'uBackDensity',
  'uBackMaxLod', 'uCanvas', 'uBox', 'uUnit', 'uDpr', 'uProfile', 'uBevel', 'uCurv', 'uDepth', 'uIor', 'uRefr', 'uDisp',
  'uBands', 'uFrost', 'uSat', 'uBright', 'uContrast', 'uTint', 'uTintAuto', 'uTintOpacity', 'uDim', 'uOpacity', 'uShine',
  'uRim', 'uRefl', 'uShadow', 'uLight', 'uScheme', 'uLens', 'uTouch', 'uTileRadius', 'uTileBevel', 'uGlyphOpacity',
  'uHighContrast', 'uSeed',
] as const;

const COMPOSE_UNIFORMS = [
  'uGroup', 'uKind', 'uRect', 'uRadius', 'uThick', 'uFieldA', 'uFieldB', 'uMorph', 'uFieldRect', 'uUnit', 'uK', 'uGrow', 'uScale',
] as const;

type UniformName = (typeof UNIFORMS)[number];
type ComposeUniformName = (typeof COMPOSE_UNIFORMS)[number];

/**
 * The single WebGL2 context shared by every icon on the page. Each icon (or
 * group) is drawn into a corner of this off-screen canvas and copied to its
 * own 2D canvas, so glass keeps its place in the page's stacking order and the
 * browser's limit on live WebGL contexts is never an issue.
 */
export class Renderer {
  readonly canvas: HTMLCanvasElement;
  private gl: WebGL2RenderingContext;
  private program: WebGLProgram | null = null;
  private composeProgram: WebGLProgram | null = null;
  private vao: WebGLVertexArrayObject | null = null;
  private loc = {} as Record<UniformName, WebGLUniformLocation | null>;
  private composeLoc = {} as Record<ComposeUniformName, WebGLUniformLocation | null>;
  /** Bumped when the context is restored: textures from older generations are gone. */
  generation = 1;
  lost = false;
  /** True when shapes can be composed into a float texture, which merging needs. */
  canCompose = false;
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

  private build(vertex: string, fragment: string): WebGLProgram {
    const gl = this.gl;
    const compile = (type: number, source: string) => {
      const shader = gl.createShader(type)!;
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error('glassity shader: ' + gl.getShaderInfoLog(shader));
      return shader;
    };
    const program = gl.createProgram()!;
    gl.attachShader(program, compile(gl.VERTEX_SHADER, vertex));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fragment));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error('glassity program: ' + gl.getProgramInfoLog(program));
    return program;
  }

  private init(): void {
    const gl = this.gl;
    this.program = this.build(VERTEX, FRAGMENT);
    for (const name of UNIFORMS) this.loc[name] = gl.getUniformLocation(this.program, name);
    this.vao = gl.createVertexArray();
    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);

    // Merging adds shapes into a half-float texture. That needs the extension
    // that makes float textures renderable; nearly every WebGL2 device has it.
    this.canCompose = false;
    this.composeProgram = null;
    if (gl.getExtension('EXT_color_buffer_float') || gl.getExtension('EXT_color_buffer_half_float')) {
      try {
        this.composeProgram = this.build(VERTEX_TARGET, COMPOSE);
        for (const name of COMPOSE_UNIFORMS) this.composeLoc[name] = gl.getUniformLocation(this.composeProgram, name);
        const probe = this.createTarget(4, 4);
        this.canCompose = probe !== null;
        this.releaseTarget(probe);
      } catch (error) {
        console.warn('glassity: icons will not merge on this device.', error);
      }
    }
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

  /** A half-float texture that shapes can be drawn into. Null when the device cannot render to one. */
  createTarget(w: number, h: number): FieldTarget | null {
    const gl = this.gl;
    const texture = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const framebuffer = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    const complete = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (!complete) {
      gl.deleteFramebuffer(framebuffer);
      gl.deleteTexture(texture);
      return null;
    }
    return { texture, framebuffer, w, h, generation: this.generation };
  }

  releaseTarget(target: FieldTarget | null): void {
    if (!target || target.generation !== this.generation || this.lost) return;
    this.gl.deleteFramebuffer(target.framebuffer);
    this.gl.deleteTexture(target.texture);
  }

  /**
   * Draw a group's shapes into its field as a smooth union.
   * @param size the group canvas in CSS px; the target may have any resolution
   */
  compose(target: FieldTarget, size: [number, number], items: ComposeItem[]): boolean {
    if (this.lost || !this.composeProgram || target.generation !== this.generation) return false;
    const gl = this.gl;
    const u = this.composeLoc;
    const sx = target.w / size[0];
    const sy = target.h / size[1];

    gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
    gl.viewport(0, 0, target.w, target.h);
    gl.disable(gl.SCISSOR_TEST);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.useProgram(this.composeProgram);
    gl.bindVertexArray(this.vao);
    gl.uniform2f(u.uGroup, size[0], size[1]);
    gl.uniform1i(u.uFieldA, 0);
    gl.uniform1i(u.uFieldB, 1);
    gl.enable(gl.SCISSOR_TEST);

    for (const item of items) {
      // Past this distance a shape's weight is below what the target can store.
      const reach = item.k * 15 + Math.max(item.grow, 0) + 2;
      const halfW = item.rect[2] * item.scale + reach;
      const halfH = item.rect[3] * item.scale + reach;
      const x0 = Math.max(0, Math.floor((item.rect[0] - halfW) * sx));
      const y0 = Math.max(0, Math.floor((item.rect[1] - halfH) * sy));
      const x1 = Math.min(target.w, Math.ceil((item.rect[0] + halfW) * sx));
      const y1 = Math.min(target.h, Math.ceil((item.rect[1] + halfH) * sy));
      if (x1 <= x0 || y1 <= y0) continue;
      gl.scissor(x0, y0, x1 - x0, y1 - y0);

      // Always rebind both units. The target itself may still be bound from the last
      // shading pass, and sampling the texture being drawn into makes the GPU drop the draw.
      const a = item.fieldA;
      const b = item.fieldB ?? a;
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, a ? a.texture : null);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, b ? b.texture : null);
      gl.uniform1i(u.uKind, item.kind);
      gl.uniform4f(u.uRect, item.rect[0], item.rect[1], item.rect[2], item.rect[3]);
      gl.uniform1f(u.uRadius, item.radius);
      gl.uniform1f(u.uThick, item.thick);
      gl.uniform1f(u.uMorph, item.morph);
      gl.uniform4f(u.uFieldRect, item.fieldRect[0], item.fieldRect[1], item.fieldRect[2], item.fieldRect[3]);
      gl.uniform1f(u.uUnit, item.unit);
      gl.uniform1f(u.uK, item.k);
      gl.uniform1f(u.uGrow, item.grow);
      gl.uniform1f(u.uScale, item.scale);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    gl.disable(gl.BLEND);
    gl.disable(gl.SCISSOR_TEST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return true;
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

  /** Draw one icon or group and copy it into `target`. Returns false when the context is lost. */
  draw(target: CanvasRenderingContext2D, pw: number, ph: number, p: DrawParams): boolean {
    if (this.lost || !this.program) return false;
    const gl = this.gl;
    const canvas = this.canvas;
    if (canvas.width < pw || canvas.height < ph) {
      canvas.width = Math.max(canvas.width, Math.ceil(pw / 128) * 128);
      canvas.height = Math.max(canvas.height, Math.ceil(ph / 128) * 128);
    }
    const y = canvas.height - ph;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.disable(gl.BLEND);
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
    gl.uniform1i(u.uSource, p.source);
    gl.uniform1f(u.uMarks, p.marks);
    gl.uniform1i(u.uFieldA, 0);
    gl.uniform1i(u.uFieldB, 1);
    gl.uniform1i(u.uBack, 2);
    gl.uniform1f(u.uMorph, p.morph);
    gl.uniform2f(u.uFieldTexel, 1 / p.fieldA.w, 1 / p.fieldA.h);
    gl.uniform1f(u.uK, p.k);
    gl.uniform1f(u.uK2, p.k2);
    gl.uniform4f(u.uBackRect, p.backRect[0], p.backRect[1], p.backRect[2], p.backRect[3]);
    gl.uniform1f(u.uBackDensity, p.backDensity);
    gl.uniform1f(u.uBackMaxLod, p.back.maxLod);
    gl.uniform2f(u.uCanvas, p.canvas[0], p.canvas[1]);
    gl.uniform2f(u.uBox, p.box[0], p.box[1]);
    gl.uniform1f(u.uUnit, p.unit);
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
    gl.uniform1f(u.uTileRadius, p.tileRadius);
    gl.uniform1f(u.uTileBevel, p.tileBevel);
    gl.uniform1f(u.uGlyphOpacity, p.glyphOpacity);
    gl.uniform1f(u.uHighContrast, p.highContrast);
    gl.uniform1f(u.uSeed, p.seed);

    gl.drawArrays(gl.TRIANGLES, 0, 3);

    target.clearRect(0, 0, pw, ph);
    target.drawImage(canvas, 0, 0, pw, ph, 0, 0, pw, ph);
    return true;
  }
}
