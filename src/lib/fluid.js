/**
 * WebGL fluid simulation (Jos Stam style stable fluids on the GPU).
 * Ported from legacy/fluid.js into a mountable factory so React owns the
 * lifecycle: everything registered here is released by `destroy()`.
 */

const DEFAULTS = {
  SIM_RESOLUTION: 128,
  DYE_RESOLUTION: 1440,
  DENSITY_DISSIPATION: 3.5,
  VELOCITY_DISSIPATION: 2,
  PRESSURE: 0.1,
  PRESSURE_ITERATIONS: 20,
  CURL: 3,
  SPLAT_RADIUS: 0.2,
  SPLAT_FORCE: 6000,
  SHADING: true,
  COLOR_UPDATE_SPEED: 10,
  FORCE_COLOR: null,
  TRANSPARENT: true,
  /** Skip the simulation entirely (used for prefers-reduced-motion). */
  ENABLED: true,
}

const BASE_VERTEX_SHADER = `
precision highp float;
attribute vec2 aPosition;
varying vec2 vUv;
varying vec2 vL;
varying vec2 vR;
varying vec2 vT;
varying vec2 vB;
uniform vec2 texelSize;
void main () {
  vUv = aPosition * 0.5 + 0.5;
  vL = vUv - vec2(texelSize.x, 0.0);
  vR = vUv + vec2(texelSize.x, 0.0);
  vT = vUv + vec2(0.0, texelSize.y);
  vB = vUv - vec2(0.0, texelSize.y);
  gl_Position = vec4(aPosition, 0.0, 1.0);
}
`

const COPY_SHADER = `
precision mediump float;
precision mediump sampler2D;
varying highp vec2 vUv;
uniform sampler2D uTexture;
void main () { gl_FragColor = texture2D(uTexture, vUv); }
`

const CLEAR_SHADER = `
precision mediump float;
precision mediump sampler2D;
varying highp vec2 vUv;
uniform sampler2D uTexture;
uniform float value;
void main () { gl_FragColor = value * texture2D(uTexture, vUv); }
`

const DISPLAY_SHADER = `
precision highp float;
precision highp sampler2D;
varying vec2 vUv;
varying vec2 vL;
varying vec2 vR;
varying vec2 vT;
varying vec2 vB;
uniform sampler2D uTexture;
uniform vec2 texelSize;
void main () {
  vec3 c = texture2D(uTexture, vUv).rgb;
#ifdef SHADING
  vec3 lc = texture2D(uTexture, vL).rgb;
  vec3 rc = texture2D(uTexture, vR).rgb;
  vec3 tc = texture2D(uTexture, vT).rgb;
  vec3 bc = texture2D(uTexture, vB).rgb;
  float dx = length(rc) - length(lc);
  float dy = length(tc) - length(bc);
  vec3 n = normalize(vec3(dx, dy, length(texelSize)));
  vec3 l = vec3(0.0, 0.0, 1.0);
  float diffuse = clamp(dot(n, l) + 0.7, 0.7, 1.0);
  c *= diffuse;
#endif
  float a = max(c.r, max(c.g, c.b));
  gl_FragColor = vec4(c, a);
}
`

const SPLAT_SHADER = `
precision highp float;
precision highp sampler2D;
varying vec2 vUv;
uniform sampler2D uTarget;
uniform float aspectRatio;
uniform vec3 color;
uniform vec2 point;
uniform float radius;
void main () {
  vec2 p = vUv - point.xy;
  p.x *= aspectRatio;
  vec3 splat = exp(-dot(p, p) / radius) * color;
  vec3 base = texture2D(uTarget, vUv).xyz;
  gl_FragColor = vec4(base + splat, 1.0);
}
`

const ADVECTION_SHADER = `
precision highp float;
precision highp sampler2D;
varying vec2 vUv;
uniform sampler2D uVelocity;
uniform sampler2D uSource;
uniform vec2 texelSize;
uniform vec2 dyeTexelSize;
uniform float dt;
uniform float dissipation;
vec4 bilerp (sampler2D sam, vec2 uv, vec2 tsize) {
  vec2 st = uv / tsize - 0.5;
  vec2 iuv = floor(st);
  vec2 fuv = fract(st);
  vec4 a = texture2D(sam, (iuv + vec2(0.5, 0.5)) * tsize);
  vec4 b = texture2D(sam, (iuv + vec2(1.5, 0.5)) * tsize);
  vec4 c = texture2D(sam, (iuv + vec2(0.5, 1.5)) * tsize);
  vec4 d = texture2D(sam, (iuv + vec2(1.5, 1.5)) * tsize);
  return mix(mix(a, b, fuv.x), mix(c, d, fuv.x), fuv.y);
}
void main () {
#ifdef MANUAL_FILTERING
  vec2 coord = vUv - dt * bilerp(uVelocity, vUv, texelSize).xy * texelSize;
  vec4 result = bilerp(uSource, coord, dyeTexelSize);
#else
  vec2 coord = vUv - dt * texture2D(uVelocity, vUv).xy * texelSize;
  vec4 result = texture2D(uSource, coord);
#endif
  float decay = 1.0 + dissipation * dt;
  gl_FragColor = result / decay;
}
`

const DIVERGENCE_SHADER = `
precision mediump float;
precision mediump sampler2D;
varying highp vec2 vUv;
varying highp vec2 vL;
varying highp vec2 vR;
varying highp vec2 vT;
varying highp vec2 vB;
uniform sampler2D uVelocity;
void main () {
  float L = texture2D(uVelocity, vL).x;
  float R = texture2D(uVelocity, vR).x;
  float T = texture2D(uVelocity, vT).y;
  float B = texture2D(uVelocity, vB).y;
  vec2 C = texture2D(uVelocity, vUv).xy;
  if (vL.x < 0.0) { L = -C.x; }
  if (vR.x > 1.0) { R = -C.x; }
  if (vT.y > 1.0) { T = -C.y; }
  if (vB.y < 0.0) { B = -C.y; }
  float div = 0.5 * (R - L + T - B);
  gl_FragColor = vec4(div, 0.0, 0.0, 1.0);
}
`

const CURL_SHADER = `
precision mediump float;
precision mediump sampler2D;
varying highp vec2 vUv;
varying highp vec2 vL;
varying highp vec2 vR;
varying highp vec2 vT;
varying highp vec2 vB;
uniform sampler2D uVelocity;
void main () {
  float L = texture2D(uVelocity, vL).y;
  float R = texture2D(uVelocity, vR).y;
  float T = texture2D(uVelocity, vT).x;
  float B = texture2D(uVelocity, vB).x;
  float vorticity = R - L - T + B;
  gl_FragColor = vec4(0.5 * vorticity, 0.0, 0.0, 1.0);
}
`

const VORTICITY_SHADER = `
precision highp float;
precision highp sampler2D;
varying vec2 vUv;
varying vec2 vL;
varying vec2 vR;
varying vec2 vT;
varying vec2 vB;
uniform sampler2D uVelocity;
uniform sampler2D uCurl;
uniform float curl;
uniform float dt;
void main () {
  float L = texture2D(uCurl, vL).x;
  float R = texture2D(uCurl, vR).x;
  float T = texture2D(uCurl, vT).x;
  float B = texture2D(uCurl, vB).x;
  float C = texture2D(uCurl, vUv).x;
  vec2 force = 0.5 * vec2(abs(T) - abs(B), abs(R) - abs(L));
  force /= length(force) + 0.0001;
  force *= curl * C;
  force.y *= -1.0;
  vec2 velocity = texture2D(uVelocity, vUv).xy;
  velocity += force * dt;
  velocity = min(max(velocity, -1000.0), 1000.0);
  gl_FragColor = vec4(velocity, 0.0, 1.0);
}
`

const PRESSURE_SHADER = `
precision mediump float;
precision mediump sampler2D;
varying highp vec2 vUv;
varying highp vec2 vL;
varying highp vec2 vR;
varying highp vec2 vT;
varying highp vec2 vB;
uniform sampler2D uPressure;
uniform sampler2D uDivergence;
void main () {
  float L = texture2D(uPressure, vL).x;
  float R = texture2D(uPressure, vR).x;
  float T = texture2D(uPressure, vT).x;
  float B = texture2D(uPressure, vB).x;
  float divergence = texture2D(uDivergence, vUv).x;
  float pressure = (L + R + B + T - divergence) * 0.25;
  gl_FragColor = vec4(pressure, 0.0, 0.0, 1.0);
}
`

const GRADIENT_SUBTRACT_SHADER = `
precision mediump float;
precision mediump sampler2D;
varying highp vec2 vUv;
varying highp vec2 vL;
varying highp vec2 vR;
varying highp vec2 vT;
varying highp vec2 vB;
uniform sampler2D uPressure;
uniform sampler2D uVelocity;
void main () {
  float L = texture2D(uPressure, vL).x;
  float R = texture2D(uPressure, vR).x;
  float T = texture2D(uPressure, vT).x;
  float B = texture2D(uPressure, vB).x;
  vec2 velocity = texture2D(uVelocity, vUv).xy;
  velocity.xy -= vec2(R - L, T - B);
  gl_FragColor = vec4(velocity, 0.0, 1.0);
}
`

function createPointer() {
  return {
    id: -1,
    texcoordX: 0,
    texcoordY: 0,
    prevTexcoordX: 0,
    prevTexcoordY: 0,
    deltaX: 0,
    deltaY: 0,
    down: false,
    moved: false,
    color: { r: 0, g: 0, b: 0 },
  }
}

/**
 * @param {HTMLCanvasElement} canvas
 * @param {Partial<typeof DEFAULTS>} [overrides]
 * @returns {{destroy: () => void, config: object} | null} null when WebGL is unavailable
 */
export function createFluidSimulation(canvas, overrides = {}) {
  const config = { ...DEFAULTS, ...overrides }
  if (config.ENABLED === false) return null

  const gl = acquireContext(canvas)
  if (!gl) return null

  const ctx = gl.gl
  const ext = gl.ext
  if (!ext.formatRGBA || !ext.formatRG || !ext.formatR) {
    console.error('[fluid] no float render targets available on this GPU')
    return null
  }
  if (!ext.supportLinearFiltering) {
    config.DYE_RESOLUTION = 256
    config.SHADING = false
  }

  const listeners = []
  const shaders = new Set()
  const programs = new Set()
  const renderTargets = new Set()
  const on = (target, type, handler, options) => {
    target.addEventListener(type, handler, options)
    listeners.push(() => target.removeEventListener(type, handler, options))
  }

  const pointers = [createPointer()]

  const compileShader = (type, source, keywords) => {
    const shader = ctx.createShader(type)
    ctx.shaderSource(shader, addKeywords(source, keywords))
    ctx.compileShader(shader)
    if (!ctx.getShaderParameter(shader, ctx.COMPILE_STATUS)) {
      console.error('[fluid] shader compile failed:', ctx.getShaderInfoLog(shader))
    }
    shaders.add(shader)
    return shader
  }

  const createProgram = (vertexShader, fragmentShader) => {
    const program = ctx.createProgram()
    ctx.attachShader(program, vertexShader)
    ctx.attachShader(program, fragmentShader)
    ctx.linkProgram(program)
    if (!ctx.getProgramParameter(program, ctx.LINK_STATUS)) {
      console.error('[fluid] program link failed:', ctx.getProgramInfoLog(program))
    }
    programs.add(program)
    return program
  }

  const getUniforms = (program) => {
    const uniforms = {}
    const count = ctx.getProgramParameter(program, ctx.ACTIVE_UNIFORMS)
    for (let i = 0; i < count; i++) {
      const name = ctx.getActiveUniform(program, i).name
      uniforms[name] = ctx.getUniformLocation(program, name)
    }
    return uniforms
  }

  class Program {
    constructor(vertexShader, fragmentShader) {
      this.program = createProgram(vertexShader, fragmentShader)
      this.uniforms = getUniforms(this.program)
    }
    bind() {
      ctx.useProgram(this.program)
    }
  }

  class Material {
    constructor(vertexShader, fragmentShaderSource) {
      this.vertexShader = vertexShader
      this.fragmentShaderSource = fragmentShaderSource
      this.programs = []
      this.activeProgram = null
      this.uniforms = []
    }
    setKeywords(keywords) {
      let hash = 0
      for (let i = 0; i < keywords.length; i++) hash += hashCode(keywords[i])
      let program = this.programs[hash]
      if (program == null) {
        const fragmentShader = compileShader(ctx.FRAGMENT_SHADER, this.fragmentShaderSource, keywords)
        program = createProgram(this.vertexShader, fragmentShader)
        this.programs[hash] = program
      }
      if (program === this.activeProgram) return
      this.uniforms = getUniforms(program)
      this.activeProgram = program
    }
    bind() {
      ctx.useProgram(this.activeProgram)
    }
  }

  const baseVertexShader = compileShader(ctx.VERTEX_SHADER, BASE_VERTEX_SHADER)
  const copyShader = compileShader(ctx.FRAGMENT_SHADER, COPY_SHADER)
  const clearShader = compileShader(ctx.FRAGMENT_SHADER, CLEAR_SHADER)
  const splatShader = compileShader(ctx.FRAGMENT_SHADER, SPLAT_SHADER)
  const advectionShader = compileShader(
    ctx.FRAGMENT_SHADER,
    ADVECTION_SHADER,
    ext.supportLinearFiltering ? null : ['MANUAL_FILTERING'],
  )
  const divergenceShader = compileShader(ctx.FRAGMENT_SHADER, DIVERGENCE_SHADER)
  const curlShader = compileShader(ctx.FRAGMENT_SHADER, CURL_SHADER)
  const vorticityShader = compileShader(ctx.FRAGMENT_SHADER, VORTICITY_SHADER)
  const pressureShader = compileShader(ctx.FRAGMENT_SHADER, PRESSURE_SHADER)
  const gradientSubtractShader = compileShader(ctx.FRAGMENT_SHADER, GRADIENT_SUBTRACT_SHADER)

  const buffers = []

  const blit = (() => {
    const vbo = ctx.createBuffer()
    buffers.push(vbo)
    ctx.bindBuffer(ctx.ARRAY_BUFFER, vbo)
    ctx.bufferData(ctx.ARRAY_BUFFER, new Float32Array([-1, -1, -1, 1, 1, 1, 1, -1]), ctx.STATIC_DRAW)
    const ibo = ctx.createBuffer()
    buffers.push(ibo)
    ctx.bindBuffer(ctx.ELEMENT_ARRAY_BUFFER, ibo)
    ctx.bufferData(ctx.ELEMENT_ARRAY_BUFFER, new Uint16Array([0, 1, 2, 0, 2, 3]), ctx.STATIC_DRAW)
    ctx.vertexAttribPointer(0, 2, ctx.FLOAT, false, 0, 0)
    ctx.enableVertexAttribArray(0)
    return (target, clear = false) => {
      if (target == null) {
        ctx.viewport(0, 0, ctx.drawingBufferWidth, ctx.drawingBufferHeight)
        ctx.bindFramebuffer(ctx.FRAMEBUFFER, null)
      } else {
        ctx.viewport(0, 0, target.width, target.height)
        ctx.bindFramebuffer(ctx.FRAMEBUFFER, target.fbo)
      }
      if (clear) {
        ctx.clearColor(0.0, 0.0, 0.0, 1.0)
        ctx.clear(ctx.COLOR_BUFFER_BIT)
      }
      ctx.drawElements(ctx.TRIANGLES, 6, ctx.UNSIGNED_SHORT, 0)
    }
  })()

  let dye = null
  let velocity = null
  let divergence = null
  let curl = null
  let pressure = null

  const copyProgram = new Program(baseVertexShader, copyShader)
  const clearProgram = new Program(baseVertexShader, clearShader)
  const splatProgram = new Program(baseVertexShader, splatShader)
  const advectionProgram = new Program(baseVertexShader, advectionShader)
  const divergenceProgram = new Program(baseVertexShader, divergenceShader)
  const curlProgram = new Program(baseVertexShader, curlShader)
  const vorticityProgram = new Program(baseVertexShader, vorticityShader)
  const pressureProgram = new Program(baseVertexShader, pressureShader)
  const gradientSubtractProgram = new Program(baseVertexShader, gradientSubtractShader)
  const displayMaterial = new Material(baseVertexShader, DISPLAY_SHADER)

  function createFBO(w, h, internalFormat, format, type, param) {
    ctx.activeTexture(ctx.TEXTURE0)
    const texture = ctx.createTexture()
    ctx.bindTexture(ctx.TEXTURE_2D, texture)
    ctx.texParameteri(ctx.TEXTURE_2D, ctx.TEXTURE_MIN_FILTER, param)
    ctx.texParameteri(ctx.TEXTURE_2D, ctx.TEXTURE_MAG_FILTER, param)
    ctx.texParameteri(ctx.TEXTURE_2D, ctx.TEXTURE_WRAP_S, ctx.CLAMP_TO_EDGE)
    ctx.texParameteri(ctx.TEXTURE_2D, ctx.TEXTURE_WRAP_T, ctx.CLAMP_TO_EDGE)
    ctx.texImage2D(ctx.TEXTURE_2D, 0, internalFormat, w, h, 0, format, type, null)
    const fbo = ctx.createFramebuffer()
    ctx.bindFramebuffer(ctx.FRAMEBUFFER, fbo)
    ctx.framebufferTexture2D(ctx.FRAMEBUFFER, ctx.COLOR_ATTACHMENT0, ctx.TEXTURE_2D, texture, 0)
    ctx.viewport(0, 0, w, h)
    ctx.clear(ctx.COLOR_BUFFER_BIT)

    const target = {
      texture,
      fbo,
      width: w,
      height: h,
      texelSizeX: 1.0 / w,
      texelSizeY: 1.0 / h,
      attach(id) {
        ctx.activeTexture(ctx.TEXTURE0 + id)
        ctx.bindTexture(ctx.TEXTURE_2D, texture)
        return id
      },
      dispose() {
        ctx.deleteTexture(texture)
        ctx.deleteFramebuffer(fbo)
        renderTargets.delete(target)
      },
    }
    renderTargets.add(target)
    return target
  }

  function createDoubleFBO(w, h, internalFormat, format, type, param) {
    let fbo1 = createFBO(w, h, internalFormat, format, type, param)
    let fbo2 = createFBO(w, h, internalFormat, format, type, param)
    return {
      width: w,
      height: h,
      texelSizeX: fbo1.texelSizeX,
      texelSizeY: fbo1.texelSizeY,
      get read() {
        return fbo1
      },
      set read(value) {
        fbo1 = value
      },
      get write() {
        return fbo2
      },
      set write(value) {
        fbo2 = value
      },
      swap() {
        const temp = fbo1
        fbo1 = fbo2
        fbo2 = temp
      },
    }
  }

  function resizeFBO(target, w, h, internalFormat, format, type, param) {
    const next = createFBO(w, h, internalFormat, format, type, param)
    copyProgram.bind()
    ctx.uniform1i(copyProgram.uniforms.uTexture, target.attach(0))
    blit(next)
    target.dispose()
    return next
  }

  function resizeDoubleFBO(target, w, h, internalFormat, format, type, param) {
    if (target.width === w && target.height === h) return target
    target.read = resizeFBO(target.read, w, h, internalFormat, format, type, param)
    target.write = createFBO(w, h, internalFormat, format, type, param)
    target.width = w
    target.height = h
    target.texelSizeX = 1.0 / w
    target.texelSizeY = 1.0 / h
    return target
  }

  function initFramebuffers() {
    const simRes = getResolution(config.SIM_RESOLUTION)
    const dyeRes = getResolution(config.DYE_RESOLUTION)
    const texType = ext.halfFloatTexType
    const rgba = ext.formatRGBA
    const rg = ext.formatRG
    const r = ext.formatR
    const filtering = ext.supportLinearFiltering ? ctx.LINEAR : ctx.NEAREST
    ctx.disable(ctx.BLEND)
    dye =
      dye == null
        ? createDoubleFBO(dyeRes.width, dyeRes.height, rgba.internalFormat, rgba.format, texType, filtering)
        : resizeDoubleFBO(dye, dyeRes.width, dyeRes.height, rgba.internalFormat, rgba.format, texType, filtering)
    velocity =
      velocity == null
        ? createDoubleFBO(simRes.width, simRes.height, rg.internalFormat, rg.format, texType, filtering)
        : resizeDoubleFBO(velocity, simRes.width, simRes.height, rg.internalFormat, rg.format, texType, filtering)
    divergence = createFBO(simRes.width, simRes.height, r.internalFormat, r.format, texType, ctx.NEAREST)
    curl = createFBO(simRes.width, simRes.height, r.internalFormat, r.format, texType, ctx.NEAREST)
    pressure = createDoubleFBO(simRes.width, simRes.height, r.internalFormat, r.format, texType, ctx.NEAREST)
  }

  function updateKeywords() {
    const displayKeywords = []
    if (config.SHADING) displayKeywords.push('SHADING')
    displayMaterial.setKeywords(displayKeywords)
  }

  function resizeCanvas() {
    const width = scaleByPixelRatio(canvas.clientWidth)
    const height = scaleByPixelRatio(canvas.clientHeight)
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width
      canvas.height = height
      return true
    }
    return false
  }

  function updateColors(dt) {
    colorUpdateTimer += dt * config.COLOR_UPDATE_SPEED
    if (colorUpdateTimer >= 1) {
      colorUpdateTimer = wrap(colorUpdateTimer, 0, 1)
      for (const pointer of pointers) pointer.color = generateColor()
    }
  }

  function applyInputs() {
    for (const pointer of pointers) {
      if (pointer.moved) {
        pointer.moved = false
        splatPointer(pointer)
      }
    }
  }

  function step(dt) {
    ctx.disable(ctx.BLEND)

    curlProgram.bind()
    ctx.uniform2f(curlProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY)
    ctx.uniform1i(curlProgram.uniforms.uVelocity, velocity.read.attach(0))
    blit(curl)

    vorticityProgram.bind()
    ctx.uniform2f(vorticityProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY)
    ctx.uniform1i(vorticityProgram.uniforms.uVelocity, velocity.read.attach(0))
    ctx.uniform1i(vorticityProgram.uniforms.uCurl, curl.attach(1))
    ctx.uniform1f(vorticityProgram.uniforms.curl, config.CURL)
    ctx.uniform1f(vorticityProgram.uniforms.dt, dt)
    blit(velocity.write)
    velocity.swap()

    divergenceProgram.bind()
    ctx.uniform2f(divergenceProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY)
    ctx.uniform1i(divergenceProgram.uniforms.uVelocity, velocity.read.attach(0))
    blit(divergence)

    clearProgram.bind()
    ctx.uniform1i(clearProgram.uniforms.uTexture, pressure.read.attach(0))
    ctx.uniform1f(clearProgram.uniforms.value, config.PRESSURE)
    blit(pressure.write)
    pressure.swap()

    pressureProgram.bind()
    ctx.uniform2f(pressureProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY)
    ctx.uniform1i(pressureProgram.uniforms.uDivergence, divergence.attach(0))
    for (let i = 0; i < config.PRESSURE_ITERATIONS; i++) {
      ctx.uniform1i(pressureProgram.uniforms.uPressure, pressure.read.attach(1))
      blit(pressure.write)
      pressure.swap()
    }

    gradientSubtractProgram.bind()
    ctx.uniform2f(gradientSubtractProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY)
    ctx.uniform1i(gradientSubtractProgram.uniforms.uPressure, pressure.read.attach(0))
    ctx.uniform1i(gradientSubtractProgram.uniforms.uVelocity, velocity.read.attach(1))
    blit(velocity.write)
    velocity.swap()

    advectionProgram.bind()
    ctx.uniform2f(advectionProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY)
    if (!ext.supportLinearFiltering) {
      ctx.uniform2f(advectionProgram.uniforms.dyeTexelSize, velocity.texelSizeX, velocity.texelSizeY)
    }
    const velocityId = velocity.read.attach(0)
    ctx.uniform1i(advectionProgram.uniforms.uVelocity, velocityId)
    ctx.uniform1i(advectionProgram.uniforms.uSource, velocityId)
    ctx.uniform1f(advectionProgram.uniforms.dt, dt)
    ctx.uniform1f(advectionProgram.uniforms.dissipation, config.VELOCITY_DISSIPATION)
    blit(velocity.write)
    velocity.swap()

    if (!ext.supportLinearFiltering) {
      ctx.uniform2f(advectionProgram.uniforms.dyeTexelSize, dye.texelSizeX, dye.texelSizeY)
    }
    ctx.uniform1i(advectionProgram.uniforms.uVelocity, velocity.read.attach(0))
    ctx.uniform1i(advectionProgram.uniforms.uSource, dye.read.attach(1))
    ctx.uniform1f(advectionProgram.uniforms.dissipation, config.DENSITY_DISSIPATION)
    blit(dye.write)
    dye.swap()
  }

  function render(target) {
    if (target == null && config.TRANSPARENT) {
      ctx.bindFramebuffer(ctx.FRAMEBUFFER, null)
      ctx.viewport(0, 0, ctx.drawingBufferWidth, ctx.drawingBufferHeight)
      ctx.clearColor(0, 0, 0, 0)
      ctx.clear(ctx.COLOR_BUFFER_BIT)
    }
    ctx.blendFunc(ctx.ONE, ctx.ONE_MINUS_SRC_ALPHA)
    ctx.enable(ctx.BLEND)
    drawDisplay(target)
  }

  function drawDisplay(target) {
    const width = target == null ? ctx.drawingBufferWidth : target.width
    const height = target == null ? ctx.drawingBufferHeight : target.height
    displayMaterial.bind()
    if (config.SHADING) ctx.uniform2f(displayMaterial.uniforms.texelSize, 1.0 / width, 1.0 / height)
    ctx.uniform1i(displayMaterial.uniforms.uTexture, dye.read.attach(0))
    blit(target)
  }

  function splatPointer(pointer) {
    splat(
      pointer.texcoordX,
      pointer.texcoordY,
      pointer.deltaX * config.SPLAT_FORCE,
      pointer.deltaY * config.SPLAT_FORCE,
      pointer.color,
    )
  }

  function clickSplat(pointer) {
    const color = generateColor()
    color.r *= 10.0
    color.g *= 10.0
    color.b *= 10.0
    splat(
      pointer.texcoordX,
      pointer.texcoordY,
      10 * (Math.random() - 0.5),
      30 * (Math.random() - 0.5),
      color,
    )
  }

  function splat(x, y, dx, dy, color) {
    splatProgram.bind()
    ctx.uniform1i(splatProgram.uniforms.uTarget, velocity.read.attach(0))
    ctx.uniform1f(splatProgram.uniforms.aspectRatio, canvas.width / canvas.height)
    ctx.uniform2f(splatProgram.uniforms.point, x, y)
    ctx.uniform3f(splatProgram.uniforms.color, dx, dy, 0.0)
    ctx.uniform1f(splatProgram.uniforms.radius, correctRadius(config.SPLAT_RADIUS / 100.0))
    blit(velocity.write)
    velocity.swap()
    ctx.uniform1i(splatProgram.uniforms.uTarget, dye.read.attach(0))
    ctx.uniform3f(splatProgram.uniforms.color, color.r, color.g, color.b)
    blit(dye.write)
    dye.swap()
  }

  function correctRadius(radius) {
    const aspectRatio = canvas.width / canvas.height
    if (aspectRatio > 1) radius *= aspectRatio
    return radius
  }

  function updatePointerDownData(pointer, id, posX, posY) {
    pointer.id = id
    pointer.down = true
    pointer.moved = false
    pointer.texcoordX = posX / canvas.width
    pointer.texcoordY = 1.0 - posY / canvas.height
    pointer.prevTexcoordX = pointer.texcoordX
    pointer.prevTexcoordY = pointer.texcoordY
    pointer.deltaX = 0
    pointer.deltaY = 0
    pointer.color = generateColor()
  }

  function updatePointerMoveData(pointer, posX, posY, color) {
    pointer.prevTexcoordX = pointer.texcoordX
    pointer.prevTexcoordY = pointer.texcoordY
    pointer.texcoordX = posX / canvas.width
    pointer.texcoordY = 1.0 - posY / canvas.height
    pointer.deltaX = correctDeltaX(pointer.texcoordX - pointer.prevTexcoordX)
    pointer.deltaY = correctDeltaY(pointer.texcoordY - pointer.prevTexcoordY)
    pointer.moved = Math.abs(pointer.deltaX) > 0 || Math.abs(pointer.deltaY) > 0
    pointer.color = color
  }

  function updatePointerUpData(pointer) {
    pointer.down = false
  }

  function correctDeltaX(delta) {
    const aspectRatio = canvas.width / canvas.height
    if (aspectRatio < 1) delta *= aspectRatio
    return delta
  }

  function correctDeltaY(delta) {
    const aspectRatio = canvas.width / canvas.height
    if (aspectRatio > 1) delta /= aspectRatio
    return delta
  }

  /** Violet theme (matches #b388ff): random brightness with slight hue drift. */
  function generateColor() {
    if (config.FORCE_COLOR) return { ...config.FORCE_COLOR }
    const v = 0.1 + Math.random() * 0.1
    const t = Math.random()
    return { r: v * (0.62 + 0.16 * t), g: v * (0.42 + 0.22 * t), b: v }
  }

  function onMouseDown(event) {
    const pointer = pointers[0]
    updatePointerDownData(
      pointer,
      -1,
      scaleByPixelRatio(event.clientX),
      scaleByPixelRatio(event.clientY),
    )
    clickSplat(pointer)
  }

  function onMouseMove(event) {
    const pointer = pointers[0]
    updatePointerMoveData(
      pointer,
      scaleByPixelRatio(event.clientX),
      scaleByPixelRatio(event.clientY),
      pointer.color,
    )
  }

  /**
   * One-shot: the pointer starts at {0,0,0}, so the very first move would splat
   * black and the trail would begin invisible. Seed a real colour first.
   */
  function onFirstMouseMove(event) {
    updatePointerMoveData(
      pointers[0],
      scaleByPixelRatio(event.clientX),
      scaleByPixelRatio(event.clientY),
      generateColor(),
    )
    document.body.removeEventListener('mousemove', onFirstMouseMove)
  }

  /** Same priming for touch, before any finger has reported a move. */
  function onFirstTouchStart(event) {
    const pointer = pointers[0]
    for (const touch of event.targetTouches) {
      updatePointerDownData(
        pointer,
        touch.identifier,
        scaleByPixelRatio(touch.clientX),
        scaleByPixelRatio(touch.clientY),
      )
    }
    document.body.removeEventListener('touchstart', onFirstTouchStart)
  }

  function onTouchStart(event) {
    const pointer = pointers[0]
    for (const touch of event.targetTouches) {
      updatePointerDownData(
        pointer,
        touch.identifier,
        scaleByPixelRatio(touch.clientX),
        scaleByPixelRatio(touch.clientY),
      )
    }
  }

  function onTouchMove(event) {
    const pointer = pointers[0]
    for (const touch of event.targetTouches) {
      updatePointerMoveData(
        pointer,
        scaleByPixelRatio(touch.clientX),
        scaleByPixelRatio(touch.clientY),
        pointer.color,
      )
    }
  }

  function onTouchEnd() {
    updatePointerUpData(pointers[0])
  }

  on(document.body, 'mousemove', onFirstMouseMove, { passive: true })
  on(document.body, 'touchstart', onFirstTouchStart, { passive: true })
  on(canvas, 'webglcontextlost', (event) => {
    event.preventDefault()
    cancelAnimationFrame(raf)
  })

  on(window, 'mousedown', onMouseDown)
  on(window, 'mousemove', onMouseMove, { passive: true })
  on(window, 'touchstart', onTouchStart, { passive: true })
  on(window, 'touchmove', onTouchMove, { passive: true })
  on(window, 'touchend', onTouchEnd, { passive: true })

  resizeCanvas()
  updateKeywords()
  initFramebuffers()

  let lastUpdateTime = Date.now()
  let colorUpdateTimer = 0.0
  let raf = 0
  let destroyed = false

  function update() {
    if (destroyed) return
    const dt = calcDeltaTime()
    if (resizeCanvas()) initFramebuffers()
    updateColors(dt)
    applyInputs()
    step(dt)
    render(null)
    raf = requestAnimationFrame(update)
  }

  function calcDeltaTime() {
    const now = Date.now()
    const dt = (now - lastUpdateTime) / 1000
    lastUpdateTime = now
    return Math.min(dt, 0.016666)
  }

  function getResolution(resolution) {
    let aspectRatio = ctx.drawingBufferWidth / ctx.drawingBufferHeight
    if (aspectRatio < 1) aspectRatio = 1.0 / aspectRatio
    const min = Math.round(resolution)
    const max = Math.round(resolution * aspectRatio)
    if (ctx.drawingBufferWidth > ctx.drawingBufferHeight) return { width: max, height: min }
    return { width: min, height: max }
  }

  raf = requestAnimationFrame(update)

  return {
    config,
    /**
     * Releases every GL object we created. Deliberately does NOT call
     * `WEBGL_lose_context.loseContext()`: the canvas element survives a React
     * remount (StrictMode does exactly that in development), and a lost context
     * can never be revived on the same canvas - the next mount would come up
     * with a dead context and fail silently.
     */
    destroy() {
      if (destroyed) return
      destroyed = true
      cancelAnimationFrame(raf)
      for (const off of listeners) off()
      listeners.length = 0
      for (const target of [...renderTargets]) target.dispose()
      renderTargets.clear()
      for (const program of programs) ctx.deleteProgram(program)
      for (const shader of shaders) ctx.deleteShader(shader)
      for (const buffer of buffers) ctx.deleteBuffer(buffer)
      programs.clear()
      shaders.clear()
      buffers.length = 0
    },
  }
}

function acquireContext(canvas) {
  const params = {
    alpha: true,
    depth: false,
    stencil: false,
    antialias: false,
    preserveDrawingBuffer: false,
  }
  let gl = canvas.getContext('webgl2', params)
  const isWebGL2 = !!gl
  if (!isWebGL2) {
    gl = canvas.getContext('webgl', params) || canvas.getContext('experimental-webgl', params)
  }
  if (!gl || gl.isContextLost()) return null

  let halfFloat
  let supportLinearFiltering
  if (isWebGL2) {
    gl.getExtension('EXT_color_buffer_float')
    supportLinearFiltering = gl.getExtension('OES_texture_float_linear')
  } else {
    halfFloat = gl.getExtension('OES_texture_half_float')
    supportLinearFiltering = gl.getExtension('OES_texture_half_float_linear')
  }
  gl.clearColor(0.0, 0.0, 0.0, 1.0)
  const halfFloatTexType = isWebGL2 ? gl.HALF_FLOAT : halfFloat.HALF_FLOAT_OES
  const formatRGBA = getSupportedFormat(
    gl,
    isWebGL2 ? gl.RGBA16F : gl.RGBA,
    gl.RGBA,
    halfFloatTexType,
  )
  const formatRG = getSupportedFormat(
    gl,
    isWebGL2 ? gl.RG16F : gl.RGBA,
    isWebGL2 ? gl.RG : gl.RGBA,
    halfFloatTexType,
  )
  const formatR = getSupportedFormat(
    gl,
    isWebGL2 ? gl.R16F : gl.RGBA,
    isWebGL2 ? gl.RED : gl.RGBA,
    halfFloatTexType,
  )

  return {
    gl,
    ext: { formatRGBA, formatRG, formatR, halfFloatTexType, supportLinearFiltering },
  }
}

function getSupportedFormat(gl, internalFormat, format, type) {
  if (!supportRenderTextureFormat(gl, internalFormat, format, type)) {
    switch (internalFormat) {
      case gl.R16F:
        return getSupportedFormat(gl, gl.RG16F, gl.RG, type)
      case gl.RG16F:
        return getSupportedFormat(gl, gl.RGBA16F, gl.RGBA, type)
      default:
        return null
    }
  }
  return { internalFormat, format }
}

function supportRenderTextureFormat(gl, internalFormat, format, type) {
  const texture = gl.createTexture()
  gl.bindTexture(gl.TEXTURE_2D, texture)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, 4, 4, 0, format, type, null)
  const fbo = gl.createFramebuffer()
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0)
  const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE
  gl.deleteTexture(texture)
  gl.deleteFramebuffer(fbo)
  return ok
}

function addKeywords(source, keywords) {
  if (keywords == null) return source
  let out = ''
  for (const keyword of keywords) out += '#define ' + keyword + '\n'
  return out + source
}

function hashCode(s) {
  if (s.length === 0) return 0
  let hash = 0
  for (let i = 0; i < s.length; i++) {
    hash = (hash << 5) - hash + s.charCodeAt(i)
    hash |= 0
  }
  return hash
}

function wrap(value, min, max) {
  const range = max - min
  if (range === 0) return min
  return ((value - min) % range) + min
}

function scaleByPixelRatio(input) {
  const pixelRatio = window.devicePixelRatio || 1
  return Math.floor(input * pixelRatio)
}
