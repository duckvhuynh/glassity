import type { BackTexture } from './renderer';

export interface LayerTarget extends BackTexture {
  framebuffer: WebGLFramebuffer;
}

interface TextureOwner {
  generation: number;
  allocate(): WebGLTexture;
  account(texture: WebGLTexture, bytes: number): void;
  release(texture: BackTexture): void;
  checkError(): void;
}

/** Two shared targets, never one allocation per icon or per layer. */
export class LayerCompositor {
  private targets: LayerTarget[] = [];

  constructor(private gl: WebGL2RenderingContext, private owner: TextureOwner) {}

  ensure(pw: number, ph: number, limit: number): readonly LayerTarget[] {
    const cap = Math.min(limit, 2048);
    const scale = Math.min(1, cap / Math.max(pw, ph));
    // Grow in small buckets so differently sized icons can share the same pair.
    const w = Math.min(cap, Math.max(this.targets[0]?.w ?? 0, Math.ceil(pw * scale / 64) * 64));
    const h = Math.min(cap, Math.max(this.targets[0]?.h ?? 0, Math.ceil(ph * scale / 64) * 64));
    if (this.targets[0]?.w === w && this.targets[0]?.h === h) return this.targets;
    this.dispose();
    try {
      this.targets.push(this.create(w, h));
      this.targets.push(this.create(w, h));
      return this.targets;
    } catch (error) {
      this.dispose();
      throw error;
    } finally {
      this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null);
    }
  }

  private create(w: number, h: number): LayerTarget {
    const { gl, owner } = this;
    const texture = owner.allocate();
    const target: LayerTarget = {
      texture, w, h, maxLod: Math.floor(Math.log2(Math.max(w, h))),
      generation: owner.generation, framebuffer: null as unknown as WebGLFramebuffer,
    };
    try {
      const framebuffer = gl.createFramebuffer();
      if (!framebuffer) throw new Error('glassity: could not allocate layer framebuffer');
      target.framebuffer = framebuffer;
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE)
        throw new Error('glassity: incomplete layer framebuffer');
      owner.checkError();
      let bytes = 0;
      for (let mw = w, mh = h;; mw = Math.max(1, Math.floor(mw / 2)), mh = Math.max(1, Math.floor(mh / 2))) {
        bytes += mw * mh * 4;
        if (mw === 1 && mh === 1) break;
      }
      owner.account(texture, bytes);
      return target;
    } catch (error) {
      if (target.framebuffer && !gl.isContextLost()) gl.deleteFramebuffer(target.framebuffer);
      owner.release(target);
      throw error;
    }
  }

  dispose(): void {
    for (const target of this.targets) {
      if (!this.gl.isContextLost()) this.gl.deleteFramebuffer(target.framebuffer);
      this.owner.release(target);
    }
    this.targets = [];
  }
}
