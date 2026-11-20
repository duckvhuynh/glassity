/** Link without forcing the driver to finish compilation on the caller's task. */
export function prepareProgram(
  gl: WebGL2RenderingContext, vertex: string, fragment: string,
  ready: (program: WebGLProgram) => void, failed: (error: unknown) => void,
): () => void {
  const shaders: WebGLShader[] = [];
  let program: WebGLProgram | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let active = true;
  const releaseShaders = () => {
    if (!gl.isContextLost()) for (const shader of shaders) {
      if (program) gl.detachShader(program, shader);
      gl.deleteShader(shader);
    }
    shaders.length = 0;
  };
  const cancel = () => {
    if (!active) return;
    active = false;
    clearTimeout(timer);
    releaseShaders();
    if (program && !gl.isContextLost()) gl.deleteProgram(program);
    program = null;
  };
  const compile = (type: number, source: string) => {
    const shader = gl.createShader(type);
    if (!shader) throw new Error('glassity: could not allocate shader');
    shaders.push(shader);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    return shader;
  };
  const complete = () => {
    if (gl.isContextLost()) throw new Error('glassity: WebGL2 context lost');
    for (const shader of shaders)
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error('glassity shader: ' + gl.getShaderInfoLog(shader));
    if (!gl.getProgramParameter(program!, gl.LINK_STATUS)) throw new Error('glassity program: ' + gl.getProgramInfoLog(program!));
    releaseShaders();
    const linked = program!;
    program = null; // Ownership passes to the renderer, also if its setup fails.
    active = false;
    ready(linked);
  };
  try {
    program = gl.createProgram();
    if (!program) throw new Error('glassity: could not allocate program');
    gl.attachShader(program, compile(gl.VERTEX_SHADER, vertex));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fragment));
    gl.linkProgram(program);
    const extension = gl.getExtension('KHR_parallel_shader_compile');
    if (!extension) complete();
    else {
      const poll = () => {
        if (!active) return;
        try {
          if (gl.isContextLost()) throw new Error('glassity: WebGL2 context lost');
          if (gl.getProgramParameter(program!, extension.COMPLETION_STATUS_KHR)) complete();
          else timer = setTimeout(poll, 8);
        } catch (error) {
          cancel();
          failed(error);
        }
      };
      timer = setTimeout(poll, 0);
    }
  } catch (error) {
    cancel();
    throw error;
  }
  return cancel;
}
