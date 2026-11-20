import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Renderer, type BackTexture, type DrawParams, type FieldTexture } from '../src/gl/renderer';

function fixture(maxTextureSize = 8192) {
  let lost = false;
  let nextId = 0;
  const resource = () => ({ id: ++nextId });
  const gl = {
    NO_ERROR: 0, OUT_OF_MEMORY: 1285, MAX_TEXTURE_SIZE: 3379,
    VERTEX_SHADER: 35633, FRAGMENT_SHADER: 35632, COMPILE_STATUS: 35713, LINK_STATUS: 35714,
    TEXTURE_2D: 3553, RG16F: 33327, RG: 33319, FLOAT: 5126, RGBA: 6408, UNSIGNED_BYTE: 5121,
    UNPACK_ALIGNMENT: 3317, UNPACK_FLIP_Y_WEBGL: 37440, UNPACK_PREMULTIPLY_ALPHA_WEBGL: 37441,
    TEXTURE_MIN_FILTER: 10241, TEXTURE_MAG_FILTER: 10240, LINEAR: 9729, LINEAR_MIPMAP_LINEAR: 9987,
    TEXTURE_WRAP_S: 10242, TEXTURE_WRAP_T: 10243, CLAMP_TO_EDGE: 33071,
    BLEND: 3042, DEPTH_TEST: 2929, SCISSOR_TEST: 3089, COLOR_BUFFER_BIT: 16384,
    TEXTURE0: 33984, TEXTURE1: 33985, TEXTURE2: 33986, TRIANGLES: 4,
    createProgram: vi.fn<() => object | null>(resource), deleteProgram: vi.fn(),
    createShader: vi.fn<() => object | null>(resource), deleteShader: vi.fn(), detachShader: vi.fn(),
    shaderSource: vi.fn(), compileShader: vi.fn(), getShaderParameter: vi.fn(() => true),
    getShaderInfoLog: vi.fn(() => 'compile failed'), attachShader: vi.fn(), linkProgram: vi.fn(),
    getProgramParameter: vi.fn((_program?: unknown, _name?: number) => true), getProgramInfoLog: vi.fn(() => 'link failed'),
    createVertexArray: vi.fn<() => object | null>(resource), deleteVertexArray: vi.fn(),
    getUniformLocation: vi.fn(resource), disable: vi.fn(), pixelStorei: vi.fn(),
    getParameter: vi.fn(() => maxTextureSize), getError: vi.fn(() => 0),
    isContextLost: vi.fn(() => lost),
    getExtension: vi.fn<() => { COMPLETION_STATUS_KHR: number } | null>(() => null),
    createTexture: vi.fn<() => object | null>(resource), deleteTexture: vi.fn(), bindTexture: vi.fn(),
    texImage2D: vi.fn(), texParameteri: vi.fn(), generateMipmap: vi.fn(),
    viewport: vi.fn(), enable: vi.fn(), scissor: vi.fn(), clearColor: vi.fn(), clear: vi.fn(),
    useProgram: vi.fn(), bindVertexArray: vi.fn(), activeTexture: vi.fn(),
    uniform1i: vi.fn(), uniform1f: vi.fn(), uniform2f: vi.fn(), uniform3f: vi.fn(), uniform4f: vi.fn(),
    drawArrays: vi.fn(),
  };
  const ctx = { clearRect: vi.fn(), drawImage: vi.fn() };
  class Canvas extends EventTarget {
    width = 0;
    height = 0;
    getContext = vi.fn((kind: string) => kind === 'webgl2' ? gl : ctx);
  }
  const canvases: Canvas[] = [];
  vi.stubGlobal('document', {
    createElement: vi.fn(() => {
      const canvas = new Canvas();
      canvases.push(canvas);
      return canvas;
    }),
  });
  return {
    gl, ctx, canvases,
    create() {
      const renderer = Renderer.create();
      expect(renderer).not.toBeNull();
      return renderer!;
    },
    setLost(value: boolean) { lost = value; },
    lose() {
      lost = true;
      const event = new Event('webglcontextlost', { cancelable: true });
      canvases[0].dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);
    },
    restore() {
      lost = false;
      canvases[0].dispatchEvent(new Event('webglcontextrestored'));
    },
  };
}

function source(width = 8, height = 4): HTMLCanvasElement {
  return { width, height } as HTMLCanvasElement;
}

function params(field: FieldTexture, back: BackTexture): DrawParams {
  return {
    fieldA: field, fieldB: field, back, morph: 0, backRect: [0, 0, 1, 1], backDensity: 1,
    canvas: [24, 24], box: [24, 24], unit: 24, dpr: 1, profile: 0,
    bevel: 0, curvature: 0, depth: 0, ior: 1.5, refraction: 0, dispersion: 0,
    bands: 0, frost: 0, saturation: 1, brightness: 1, contrast: 1,
    tint: [0, 0, 0], tintAuto: 0, tintOpacity: 0, dim: 0, opacity: 1,
    shine: 0, rim: 0, reflection: 0, shadow: 0, light: [0, 0], scheme: 0,
    lens: 0, touch: [0, 0, 0], tile: 0, tileRadius: 0, tileBevel: 0,
    weight: 0, glyphOpacity: 0, highContrast: 0, seed: 0,
    glyphSize: 24, legibilityColor: [0, 0, 0], legibilityAmount: 0,
  };
}

beforeEach(() => { vi.spyOn(console, 'warn').mockImplementation(() => {}); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('renderer texture ownership', () => {
  it('counts RG16F and every rectangular mip level, then releases each texture once', () => {
    const f = fixture();
    const renderer = f.create();
    const field = renderer.createField(new Float32Array(16), 4, 2);
    expect(renderer.textureBytes).toBe(32);
    const back = renderer.uploadBack(null, source(5, 3), 5, 3);
    // RGBA levels: 5x3, 2x1, 1x1. A flat 4/3 multiplier would be wrong.
    expect(renderer.textureBytes).toBe(32 + 60 + 8 + 4);
    expect(back.maxLod).toBe(2);
    renderer.release(field);
    renderer.release(field);
    expect(renderer.textureBytes).toBe(72);
    renderer.release(back);
    renderer.release(back);
    renderer.release(null);
    expect(renderer.textureBytes).toBe(0);
    expect(f.gl.deleteTexture.mock.calls.map(([texture]) => texture)).toEqual([field.texture, back.texture]);
  });

  it('keeps the previous backdrop when an upload throws and deletes only the failed allocation', () => {
    const f = fixture();
    const renderer = f.create();
    const previous = renderer.uploadBack(null, source(), 8, 4);
    const bytes = renderer.textureBytes;
    f.gl.texImage2D.mockImplementationOnce(() => { throw new Error('tainted source'); });
    expect(() => renderer.uploadBack(previous, source(), 8, 4)).toThrow('tainted source');
    const failed = f.gl.createTexture.mock.results[1].value;
    expect(renderer.textureBytes).toBe(bytes);
    expect(f.gl.deleteTexture.mock.calls).toEqual([[failed]]);
    const replacement = renderer.uploadBack(previous, source(), 8, 4);
    expect(replacement.texture).not.toBe(previous.texture);
    expect(renderer.textureBytes).toBe(bytes);
    expect(f.gl.deleteTexture.mock.calls).toEqual([[failed], [previous.texture]]);
    renderer.release(previous);
    expect(renderer.textureBytes).toBe(bytes);
    expect(f.gl.deleteTexture).toHaveBeenCalledTimes(2);
  });

  it('rolls back a WebGL upload error as well as a thrown exception', () => {
    const f = fixture();
    const renderer = f.create();
    const previous = renderer.uploadBack(null, source(), 8, 4);
    const bytes = renderer.textureBytes;
    f.gl.getError.mockReturnValueOnce(f.gl.OUT_OF_MEMORY);
    expect(() => renderer.uploadBack(previous, source(), 8, 4)).toThrow('1285');
    expect(renderer.textureBytes).toBe(bytes);
    expect(f.gl.deleteTexture).toHaveBeenCalledTimes(1);
    expect(f.gl.deleteTexture).not.toHaveBeenCalledWith(previous.texture);
    expect(renderer.state).toBe('ready');
  });

  it('cleans up a failed field without changing the bytes of an existing field', () => {
    const f = fixture();
    const renderer = f.create();
    const field = renderer.createField(new Float32Array(16), 4, 2);
    f.gl.texImage2D.mockImplementationOnce(() => { throw new Error('field failed'); });
    expect(() => renderer.createField(new Float32Array(16), 4, 2)).toThrow('field failed');
    expect(renderer.textureBytes).toBe(32);
    expect(f.gl.deleteTexture).toHaveBeenCalledTimes(1);
    expect(f.gl.deleteTexture).not.toHaveBeenCalledWith(field.texture);
    f.gl.createTexture.mockReturnValueOnce(null);
    expect(() => renderer.createField(new Float32Array(16), 4, 2)).toThrow('allocate texture');
    expect(renderer.textureBytes).toBe(32);
    expect(f.gl.deleteTexture).toHaveBeenCalledTimes(1);
  });
});

describe('renderer recovery', () => {
  it('skips work while lost and redraws only after retained data is uploaded into the new generation', () => {
    const f = fixture();
    const renderer = f.create();
    const data = new Float32Array(16);
    const field = renderer.createField(data, 4, 2);
    const back = renderer.uploadBack(null, source(), 8, 4);
    const oldParams = params(field, back);
    const target = f.ctx as unknown as CanvasRenderingContext2D;
    expect(renderer.draw(target, 24, 24, oldParams)).toBe(true);
    const states: string[] = [];
    renderer.onstatechange = () => { states.push(renderer.state); };
    let recovered: DrawParams | null = null;
    renderer.onrestore = () => {
      recovered = params(renderer.createField(data, 4, 2), renderer.uploadBack(null, source(), 8, 4));
    };
    f.lose();
    expect(renderer.state).toBe('lost');
    expect(renderer.ready).toBe(false);
    expect(renderer.textureBytes).toBe(0);
    const uploads = f.gl.texImage2D.mock.calls.length;
    const allocations = f.gl.createTexture.mock.calls.length;
    expect(() => renderer.createField(data, 4, 2)).toThrow('unavailable');
    expect(() => renderer.uploadBack(back, source(), 8, 4)).toThrow('unavailable');
    expect(renderer.draw(target, 24, 24, oldParams)).toBe(false);
    expect(f.gl.texImage2D).toHaveBeenCalledTimes(uploads);
    expect(f.gl.createTexture).toHaveBeenCalledTimes(allocations);
    expect(f.gl.drawArrays).toHaveBeenCalledTimes(1);
    expect(f.gl.deleteTexture).not.toHaveBeenCalled();
    f.restore();
    expect(states).toEqual(['lost', 'restoring', 'ready']);
    expect(renderer.generation).toBe(2);
    expect(renderer.ready).toBe(true);
    const recoveredBytes = renderer.textureBytes;
    expect(recoveredBytes).toBeGreaterThan(0);
    renderer.release(field);
    renderer.release(back);
    expect(renderer.textureBytes).toBe(recoveredBytes);
    expect(f.gl.deleteTexture).not.toHaveBeenCalled();
    expect(renderer.draw(target, 24, 24, oldParams)).toBe(false);
    expect(renderer.draw(target, 24, 24, recovered!)).toBe(true);
    expect(f.gl.drawArrays).toHaveBeenCalledTimes(2);
  });

  it('detects a lost context before the event arrives and clears accounting only once', () => {
    const f = fixture();
    const renderer = f.create();
    renderer.createField(new Float32Array(16), 4, 2);
    renderer.onstatechange = vi.fn();
    f.setLost(true);
    expect(renderer.ready).toBe(false);
    expect(renderer.textureBytes).toBe(0);
    expect(renderer.state).toBe('lost');
    f.lose();
    expect(renderer.onstatechange).toHaveBeenCalledTimes(1);
    expect(f.gl.deleteTexture).not.toHaveBeenCalled();
  });

  it('reports failed recovery without throwing out of the context event', () => {
    const f = fixture();
    const renderer = f.create();
    const states: string[] = [];
    renderer.onstatechange = () => { states.push(renderer.state); };
    renderer.onrestore = vi.fn();
    f.lose();
    f.gl.getShaderParameter.mockReturnValue(false);
    expect(() => f.restore()).not.toThrow();
    expect(states).toEqual(['lost', 'restoring', 'failed']);
    expect(renderer.state).toBe('failed');
    expect(renderer.ready).toBe(false);
    expect(renderer.textureBytes).toBe(0);
    expect(renderer.onrestore).not.toHaveBeenCalled();
    expect(f.gl.deleteProgram).toHaveBeenCalledTimes(1);
    expect(renderer.draw(f.ctx as unknown as CanvasRenderingContext2D, 24, 24, {} as DrawParams)).toBe(false);
    expect(() => renderer.uploadBack(null, source(), 8, 4)).toThrow('unavailable');
  });

  it('releases partial recovery uploads exactly once if the restore callback fails', () => {
    const f = fixture();
    const renderer = f.create();
    renderer.onrestore = () => {
      renderer.createField(new Float32Array(16), 4, 2);
      renderer.uploadBack(null, source(), 8, 4);
      throw new Error('geometry recovery failed');
    };
    f.lose();
    f.restore();
    expect(renderer.state).toBe('failed');
    expect(renderer.textureBytes).toBe(0);
    expect(f.gl.deleteTexture).toHaveBeenCalledTimes(2);
    expect(f.gl.deleteProgram).toHaveBeenCalledTimes(1);
    expect(f.gl.deleteVertexArray).toHaveBeenCalledTimes(1);
    renderer.fail(new Error('already failed'));
    expect(f.gl.deleteTexture).toHaveBeenCalledTimes(2);
    expect(f.gl.deleteProgram).toHaveBeenCalledTimes(1);
    expect(f.gl.deleteVertexArray).toHaveBeenCalledTimes(1);
  });
});

describe('renderer initialization cleanup', () => {
  it('deletes compiled shaders once after a successful initialization', () => {
    const f = fixture();
    const renderer = f.create();
    expect(renderer.state).toBe('ready');
    expect(f.gl.deleteShader).toHaveBeenCalledTimes(2);
    expect(f.gl.detachShader).toHaveBeenCalledTimes(2);
    expect(f.gl.deleteProgram).not.toHaveBeenCalled();
    expect(f.gl.deleteVertexArray).not.toHaveBeenCalled();
  });

  it('releases every allocated shader and the program when compilation fails', () => {
    const f = fixture();
    f.gl.getShaderParameter.mockReturnValueOnce(true).mockReturnValueOnce(false);
    expect(Renderer.create()).toBeNull();
    expect(f.gl.deleteProgram).toHaveBeenCalledTimes(1);
    expect(f.gl.deleteShader).toHaveBeenCalledTimes(2);
    expect(f.gl.createVertexArray).not.toHaveBeenCalled();
  });

  it('releases shaders and program when vertex-array allocation fails', () => {
    const f = fixture();
    f.gl.createVertexArray.mockReturnValueOnce(null);
    expect(Renderer.create()).toBeNull();
    expect(f.gl.deleteProgram).toHaveBeenCalledTimes(1);
    expect(f.gl.deleteShader).toHaveBeenCalledTimes(2);
    expect(f.gl.deleteVertexArray).not.toHaveBeenCalled();
  });

  it('also releases the vertex array when initialization fails after allocation', () => {
    const f = fixture();
    f.gl.getUniformLocation.mockImplementationOnce(() => { throw new Error('uniform setup'); });
    expect(Renderer.create()).toBeNull();
    expect(f.gl.deleteProgram).toHaveBeenCalledTimes(1);
    expect(f.gl.deleteShader).toHaveBeenCalledTimes(2);
    expect(f.gl.deleteVertexArray).toHaveBeenCalledTimes(1);
  });
});

describe('direct media texture limits', () => {
  it.each([
    { gpuLimit: 1024, width: 1024, height: 512 },
    { gpuLimit: 8192, width: 2560, height: 1280 },
  ])('caps a large source at $width pixels when the GPU limit is $gpuLimit', ({ gpuLimit, width, height }) => {
    const f = fixture(gpuLimit);
    const renderer = f.create();
    const media = source(4096, 2048);
    const back = renderer.uploadBack(null, media, 4096, 2048);
    expect(renderer.maxTextureSize).toBe(gpuLimit);
    expect(back.w).toBe(width);
    expect(back.h).toBe(height);
    expect(f.canvases).toHaveLength(2);
    const staging = f.canvases[1];
    expect(staging.width).toBe(width);
    expect(staging.height).toBe(height);
    expect(f.ctx.drawImage).toHaveBeenCalledWith(media, 0, 0, width, height);
    expect(f.gl.texImage2D).toHaveBeenCalledWith(f.gl.TEXTURE_2D, 0, f.gl.RGBA, f.gl.RGBA, f.gl.UNSIGNED_BYTE, staging);
  });

  it('leaves small media unscaled and preserves the previous texture if resizing fails', () => {
    const f = fixture(1024);
    const renderer = f.create();
    const media = source();
    const previous = renderer.uploadBack(null, media, 8, 4);
    expect(f.canvases).toHaveLength(1);
    expect(f.gl.texImage2D).toHaveBeenLastCalledWith(f.gl.TEXTURE_2D, 0, f.gl.RGBA, f.gl.RGBA, f.gl.UNSIGNED_BYTE, media);
    const bytes = renderer.textureBytes;
    f.ctx.drawImage.mockImplementationOnce(() => { throw new Error('cannot resize'); });
    expect(() => renderer.uploadBack(previous, source(4096, 2048), 4096, 2048)).toThrow('cannot resize');
    expect(renderer.textureBytes).toBe(bytes);
    expect(f.gl.createTexture).toHaveBeenCalledTimes(1);
    expect(f.gl.deleteTexture).not.toHaveBeenCalled();
  });
});


describe('parallel shader compilation', () => {
  it('does not query blocking compile/link status or uniforms before completion', () => {
    vi.useFakeTimers();
    const f = fixture();
    const completion = 0x91b1;
    let complete = false;
    f.gl.getExtension.mockReturnValue({ COMPLETION_STATUS_KHR: completion });
    f.gl.getProgramParameter.mockImplementation((_program?: unknown, name?: number) => name === completion ? complete : true);
    const renderer = f.create();
    const states: string[] = [];
    renderer.onstatechange = () => states.push(renderer.state);
    expect(renderer.ready).toBe(false);
    expect(f.gl.getShaderParameter).not.toHaveBeenCalled();
    expect(f.gl.getUniformLocation).not.toHaveBeenCalled();
    expect(f.gl.getProgramParameter).not.toHaveBeenCalled();
    vi.advanceTimersByTime(20);
    expect(renderer.ready).toBe(false);
    expect(f.gl.getProgramParameter.mock.calls.every((call) => call[1] === completion)).toBe(true);
    complete = true;
    vi.advanceTimersByTime(8);
    expect(renderer.ready).toBe(true);
    expect(states).toEqual(['ready']);
    expect(f.gl.getShaderParameter).toHaveBeenCalledTimes(2);
    expect(f.gl.getUniformLocation).toHaveBeenCalled();
    expect(f.gl.deleteShader).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cancels a pending generation on loss and publishes only the restored program', () => {
    vi.useFakeTimers();
    const f = fixture();
    f.gl.getExtension.mockReturnValue({ COMPLETION_STATUS_KHR: 0x91b1 });
    f.gl.getProgramParameter.mockReturnValue(false);
    const renderer = f.create();
    renderer.onrestore = vi.fn();
    f.lose();
    vi.advanceTimersByTime(100);
    expect(renderer.state).toBe('lost');
    expect(f.gl.getUniformLocation).not.toHaveBeenCalled();
    expect(f.gl.deleteProgram).not.toHaveBeenCalled();
    expect(f.gl.deleteShader).not.toHaveBeenCalled();
    f.gl.getProgramParameter.mockReturnValue(true);
    f.restore();
    expect(renderer.state).toBe('restoring');
    vi.runAllTimers();
    expect(renderer.state).toBe('ready');
    expect(renderer.generation).toBe(2);
    expect(renderer.onrestore).toHaveBeenCalledTimes(1);
    expect(f.gl.deleteShader).toHaveBeenCalledTimes(2);
  });

  it('releases pending program resources when compilation finishes with an error', () => {
    vi.useFakeTimers();
    const f = fixture();
    f.gl.getExtension.mockReturnValue({ COMPLETION_STATUS_KHR: 0x91b1 });
    const renderer = f.create();
    f.gl.getShaderParameter.mockReturnValue(false);
    vi.runAllTimers();
    expect(renderer.state).toBe('failed');
    expect(f.gl.deleteProgram).toHaveBeenCalledTimes(1);
    expect(f.gl.deleteShader).toHaveBeenCalledTimes(2);
    expect(f.gl.createVertexArray).not.toHaveBeenCalled();
  });
});
